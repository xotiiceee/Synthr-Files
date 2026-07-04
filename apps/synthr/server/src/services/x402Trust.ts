import { z } from 'zod';
import { schemas } from '../lib/schemas';

type EndpointCheckInput = z.infer<typeof schemas.X402EndpointCheckRequest>;
type ProbeStatus = 'ok' | 'missing' | 'error' | 'skipped';
type PayabilityStatus = 'payable' | 'misconfigured' | 'broken' | 'unknown';
type AgentRecommendation = 'call' | 'avoid' | 'retry_later' | 'human_review';

const SAFE_TIMEOUT_MS = 5000;
const PRIVATE_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);

function withTimeout(ms = SAFE_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, done: () => clearTimeout(timeout) };
}

function normalizeUrl(value: string) {
  const url = new URL(value);
  url.hash = '';
  return url;
}

function isPrivateHost(hostname: string) {
  const host = hostname.toLowerCase();
  if (PRIVATE_HOSTS.has(host)) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;
  return false;
}

function assertPublicProbeTarget(url: URL) {
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only http and https endpoint URLs are supported.');
  }
  if (isPrivateHost(url.hostname) && process.env.NODE_ENV === 'production') {
    throw new Error('Private network endpoint checks are disabled in production.');
  }
}

function siblingUrl(endpointUrl: URL, pathname: string) {
  return new URL(pathname, endpointUrl.origin).toString();
}

async function fetchText(url: string) {
  const timer = withTimeout();
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: timer.signal,
      headers: { accept: 'text/plain, application/json;q=0.9, */*;q=0.5' },
    });
    const text = await res.text();
    return {
      status: res.status,
      ok: res.ok,
      contentType: res.headers.get('content-type') || '',
      text: text.slice(0, 5000),
    };
  } catch (error) {
    return {
      status: 0,
      ok: false,
      contentType: '',
      text: '',
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    timer.done();
  }
}

async function fetchJson(url: string) {
  const result = await fetchText(url);
  if (!result.ok) return { ...result, json: null };
  try {
    return { ...result, json: JSON.parse(result.text) };
  } catch {
    return { ...result, json: null, error: 'Response was not valid JSON.' };
  }
}

async function probeEndpoint(input: EndpointCheckInput, endpointUrl: URL) {
  const shouldUseUnsafeMethod =
    input.allowUnpaidRequestProbe || input.expectedMethod === 'GET';
  const method = shouldUseUnsafeMethod ? input.expectedMethod : 'HEAD';
  const timer = withTimeout();

  try {
    const res = await fetch(endpointUrl.toString(), {
      method,
      signal: timer.signal,
      headers: {
        accept: 'application/json, text/plain;q=0.9, */*;q=0.5',
        ...(method !== 'GET' && method !== 'HEAD'
          ? { 'content-type': 'application/json' }
          : {}),
      },
      ...(method !== 'GET' && method !== 'HEAD' ? { body: '{}' } : {}),
    });

    const text = await res.text().catch(() => '');
    return {
      status: res.status,
      method,
      ok: res.ok,
      paymentRequired: res.status === 402,
      hasPaymentHeader:
        res.headers.has('www-authenticate') ||
        res.headers.has('x-payment') ||
        res.headers.has('x-accepts'),
      bodyPreview: text.slice(0, 1000),
    };
  } catch (error) {
    return {
      status: 0,
      method,
      ok: false,
      paymentRequired: false,
      hasPaymentHeader: false,
      error: error instanceof Error ? error.message : String(error),
      bodyPreview: '',
    };
  } finally {
    timer.done();
  }
}

function scoreProbe(status: ProbeStatus, points: number) {
  return status === 'ok' ? points : 0;
}

function classifyScore(score: number, endpointReachable: boolean): {
  payabilityStatus: PayabilityStatus;
  agentRecommendation: AgentRecommendation;
} {
  if (!endpointReachable) {
    return { payabilityStatus: 'broken', agentRecommendation: 'avoid' };
  }
  if (score >= 80) {
    return { payabilityStatus: 'payable', agentRecommendation: 'call' };
  }
  if (score >= 55) {
    return { payabilityStatus: 'unknown', agentRecommendation: 'human_review' };
  }
  return { payabilityStatus: 'misconfigured', agentRecommendation: 'avoid' };
}

function hasCatalogResource(catalog: any, endpointUrl: URL) {
  const resources = Array.isArray(catalog?.resources) ? catalog.resources : [];
  return resources.some((resource: any) => {
    if (typeof resource?.path !== 'string') return false;
    const absolute = resource.path.startsWith('http')
      ? resource.path
      : new URL(resource.path, endpointUrl.origin).toString();
    return absolute === endpointUrl.toString() || resource.path === endpointUrl.pathname;
  });
}

function hasOpenApiPath(openapi: any, endpointUrl: URL) {
  return Boolean(openapi?.paths && openapi.paths[endpointUrl.pathname]);
}

export async function checkX402Endpoint(input: EndpointCheckInput) {
  const queryId = crypto.randomUUID();
  const asOf = new Date().toISOString();
  const endpointUrl = normalizeUrl(input.endpointUrl);
  assertPublicProbeTarget(endpointUrl);

  const healthUrl = siblingUrl(endpointUrl, '/health');
  const catalogUrl = input.catalogUrl || siblingUrl(endpointUrl, '/x402-catalog.json');
  const openApiUrl = input.openApiUrl || siblingUrl(endpointUrl, '/openapi.json');
  const llmsTxtUrl = input.llmsTxtUrl || siblingUrl(endpointUrl, '/llms.txt');

  const [health, catalog, openapi, llmsTxt, endpointProbe] = await Promise.all([
    fetchJson(healthUrl),
    fetchJson(catalogUrl),
    fetchJson(openApiUrl),
    fetchText(llmsTxtUrl),
    probeEndpoint(input, endpointUrl),
  ]);

  const checks = {
    health: {
      status: health.ok ? 'ok' as const : 'missing' as const,
      url: healthUrl,
      httpStatus: health.status,
    },
    catalog: {
      status: catalog.ok && catalog.json ? 'ok' as const : 'missing' as const,
      url: catalogUrl,
      httpStatus: catalog.status,
      endpointListed: catalog.json ? hasCatalogResource(catalog.json, endpointUrl) : false,
    },
    openapi: {
      status: openapi.ok && openapi.json ? 'ok' as const : 'missing' as const,
      url: openApiUrl,
      httpStatus: openapi.status,
      endpointDocumented: openapi.json ? hasOpenApiPath(openapi.json, endpointUrl) : false,
    },
    llmsTxt: {
      status: llmsTxt.ok ? 'ok' as const : 'missing' as const,
      url: llmsTxtUrl,
      httpStatus: llmsTxt.status,
      mentionsX402: /x402|payment|pay/i.test(llmsTxt.text),
    },
    unpaidProbe: {
      status: endpointProbe.status > 0 ? 'ok' as const : 'error' as const,
      methodUsed: endpointProbe.method,
      httpStatus: endpointProbe.status,
      paymentRequired: endpointProbe.paymentRequired,
      hasPaymentHeader: endpointProbe.hasPaymentHeader,
      skippedUnsafeMethod: endpointProbe.method !== input.expectedMethod,
      error: 'error' in endpointProbe ? endpointProbe.error : undefined,
    },
  };

  let trustScore = 0;
  trustScore += scoreProbe(checks.health.status, 15);
  trustScore += scoreProbe(checks.catalog.status, 20);
  trustScore += checks.catalog.endpointListed ? 10 : 0;
  trustScore += scoreProbe(checks.openapi.status, 15);
  trustScore += checks.openapi.endpointDocumented ? 10 : 0;
  trustScore += scoreProbe(checks.llmsTxt.status, 10);
  trustScore += checks.llmsTxt.mentionsX402 ? 5 : 0;
  trustScore += checks.unpaidProbe.paymentRequired ? 15 : 0;
  trustScore += checks.unpaidProbe.hasPaymentHeader ? 5 : 0;

  trustScore = Math.min(100, trustScore);

  const endpointReachable = checks.unpaidProbe.status === 'ok';
  const classification = classifyScore(trustScore, endpointReachable);

  const evidence = [
    checks.health.status === 'ok'
      ? 'Health endpoint responded.'
      : 'No working /health endpoint was detected.',
    checks.catalog.status === 'ok'
      ? checks.catalog.endpointListed
        ? 'x402 catalog is present and lists the endpoint.'
        : 'x402 catalog is present but does not list this endpoint.'
      : 'No valid x402 catalog was detected.',
    checks.openapi.status === 'ok'
      ? checks.openapi.endpointDocumented
        ? 'OpenAPI document is present and includes the endpoint path.'
        : 'OpenAPI document is present but does not include this endpoint path.'
      : 'No valid OpenAPI document was detected.',
    checks.llmsTxt.status === 'ok'
      ? 'llms.txt is present for agent instructions.'
      : 'No llms.txt file was detected.',
    checks.unpaidProbe.paymentRequired
      ? 'Endpoint returned HTTP 402 without payment, which is expected for x402.'
      : `Endpoint probe returned HTTP ${checks.unpaidProbe.httpStatus || '0'} instead of a clear 402 challenge.`,
  ];

  const agentActions = classification.agentRecommendation === 'call'
    ? [
        'Endpoint appears payable and documented. Proceed with an x402-aware client.',
        'Read the OpenAPI or catalog schema before sending production payloads.',
      ]
    : [
        'Do not pay this endpoint automatically yet.',
        'Ask for human review or retry after the provider fixes discovery/payment metadata.',
      ];

  return {
    queryId,
    asOf,
    confidence: 0.82,
    endpoint: endpointUrl.toString(),
    expectedMethod: input.expectedMethod,
    trustScore,
    payabilityStatus: classification.payabilityStatus,
    agentRecommendation: classification.agentRecommendation,
    checks,
    evidence,
    agentActions,
    sources: [
      { url: healthUrl, title: 'Health endpoint', fetchedAt: asOf, type: 'other' },
      { url: catalogUrl, title: 'x402 catalog', fetchedAt: asOf, type: 'other' },
      { url: openApiUrl, title: 'OpenAPI document', fetchedAt: asOf, type: 'other' },
      { url: llmsTxtUrl, title: 'LLM instructions', fetchedAt: asOf, type: 'other' },
    ],
    disclaimer:
      'This is a lightweight live trust check, not a guarantee of endpoint quality, settlement success, or provider honesty. Avoid probing endpoints you do not have permission to test.',
  };
}
