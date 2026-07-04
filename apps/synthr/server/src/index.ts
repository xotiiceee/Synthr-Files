import { Hono } from 'hono';
import { serve } from '@hono/node-server'; // For Node compatibility; Bun uses native
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import { paymentMiddleware, x402ResourceServer } from '@x402/hono';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import pino from 'pino';
import { readFile } from 'fs/promises';
import { join } from 'path';

import { cyberRoutes } from './routes/cyber';
import { x402Routes } from './routes/x402';
import { healthRoutes } from './routes/health';
import { config, isPlaceholderPayTo, networkLabel } from './lib/config';
import { createRateLimitMiddleware } from './lib/rate-limit';
import { buildOpenApiSpec } from './lib/openapi';
import { renderHomepage } from './lib/homepage';

// Logger - structured for production/observability
const log = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV === 'production' ? undefined : { target: 'pino-pretty' },
});

const app = new Hono();
const cyberRateLimit = createRateLimitMiddleware({
  maxRequests: config.rateLimitMaxRequests,
  windowMs: config.rateLimitWindowMs,
});

// Global middleware
app.use('*', logger());
app.use('*', cors({
  origin: config.corsOrigin,
  allowMethods: ['GET', 'POST'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-PAYMENT'],
}));

// Health (always free, for discovery/monitoring)
app.route('/health', healthRoutes);

// === x402 Payment Setup (Modern Foundation) ===
const payTo = config.payToAddress as `0x${string}`;
const facilitatorClient = new HTTPFacilitatorClient({
  url: config.facilitatorUrl,
});

const x402Server = new x402ResourceServer(facilitatorClient)
  .register(config.network, new ExactEvmScheme());

const publicBaseUrl = config.publicBaseUrl || `http://localhost:${config.port}`;
const paymentConfigured = !isPlaceholderPayTo(payTo);

// Cyber intelligence routes - protected with x402
// Pricing and descriptions defined here for transparency and agent discovery.
const cyberPaymentConfig = {
  // Example: Stack brief endpoint - high value synthesis
  "POST /v1/cyber/stack-brief": {
    resource: `${publicBaseUrl}/v1/cyber/stack-brief`,
    accepts: [
      {
        scheme: "exact" as const,
        price: `$${config.defaultPriceUsd}`,
        network: config.network,
        payTo,
      },
    ],
    description: "Get prioritized, actionable cybersecurity brief for your tech stack. Agent-optimized JSON with EPSS, sources, and harness-specific recommendations. Fresh data from OSV, GitHub, CISA, EPSS.",
    mimeType: "application/json",
  },
  // Add more protected routes here as implemented
  "POST /v1/cyber/audit-deps": {
    resource: `${publicBaseUrl}/v1/cyber/audit-deps`,
    accepts: [
      {
        scheme: "exact" as const,
        price: `$${config.defaultPriceUsd}`,
        network: config.network,
        payTo,
      },
    ],
    description: "Audit a list of dependencies for known vulnerabilities, malicious packages, and prioritized patches. Returns OSV + EPSS enriched results.",
    mimeType: "application/json",
  },
  "POST /v1/cyber/advice": {
    resource: `${publicBaseUrl}/v1/cyber/advice`,
    accepts: [
      {
        scheme: "exact" as const,
        price: `$${config.defaultPriceUsd * 1.5}`,
        network: config.network,
        payTo,
      },
    ],
    description: "Secure implementation advice or pattern review grounded in latest threats. Provide query + optional stack context. Citations included.",
    mimeType: "application/json",
  },
  "POST /v1/cyber/vulns": {
    resource: `${publicBaseUrl}/v1/cyber/vulns`,
    accepts: [
      {
        scheme: "exact" as const,
        price: `$${config.defaultPriceUsd}`,
        network: config.network,
        payTo,
      },
    ],
    description: "Search vulnerabilities with EPSS, KEV filters. Returns prioritized results from OSV + EPSS. Agent friendly.",
    mimeType: "application/json",
  },
  "GET /v1/cyber/breaking": {
    resource: `${publicBaseUrl}/v1/cyber/breaking`,
    accepts: [
      {
        scheme: "exact" as const,
        price: `$${config.defaultPriceUsd}`,
        network: config.network,
        payTo,
      },
    ],
    description: "Recent actively exploited vulnerabilities from CISA KEV, enriched with EPSS and agent relevance notes.",
    mimeType: "application/json",
  },
  "POST /v1/x402/endpoint-check": {
    resource: `${publicBaseUrl}/v1/x402/endpoint-check`,
    accepts: [
      {
        scheme: "exact" as const,
        price: `$${config.defaultPriceUsd}`,
        network: config.network,
        payTo,
      },
    ],
    description: "Check whether a discovered x402 endpoint appears documented, reachable, and safe for an agent to pay. Returns trustScore, payabilityStatus, recommendation, and evidence.",
    mimeType: "application/json",
  },
};

// Apply payment middleware to paid routes
app.use('/v1/cyber/*', cyberRateLimit);
app.use('/v1/cyber/*', paymentMiddleware(cyberPaymentConfig, x402Server));
app.use('/v1/x402/*', cyberRateLimit);
app.use('/v1/x402/*', paymentMiddleware(cyberPaymentConfig, x402Server));

// Mount cyber routes (actual handlers with grounding & synthesis)
app.route('/v1/cyber', cyberRoutes);
app.route('/v1/x402', x402Routes);

function buildPublicMetadata() {
  return {
    name: "Synthr Cyber x402",
    description: "Premium, agent-native cybersecurity intelligence. Real-time OSV.dev + EPSS + CISA. Pay per high-signal insight. Built for autonomous harnesses and builders.",
    version: "0.1.0",
    endpoints: {
      health: "/health",
      stackBrief: "POST /v1/cyber/stack-brief (paid)",
      auditDeps: "POST /v1/cyber/audit-deps (paid)",
      advice: "POST /v1/cyber/advice (paid)",
      vulns: "POST /v1/cyber/vulns (paid)",
      breaking: "GET /v1/cyber/breaking (paid)",
      endpointCheck: "POST /v1/x402/endpoint-check (paid)",
    },
    pricing: `~$${config.defaultPriceUsd} USDC per call`,
    networks: [config.network],
    paymentConfigured,
    ...(paymentConfigured ? { payTo } : {}),
    discovery: {
      llms: `${publicBaseUrl}/llms.txt`,
      catalog: `${publicBaseUrl}/x402-catalog.json`,
      openapi: `${publicBaseUrl}/openapi.json`,
      x402scan: "Register at x402scan.com",
    },
    x402: {
      discovery: "List on x402scan.com with rich description + schemas",
      mcp: "MCP support planned / implementable via official patterns",
    },
    corsOrigin: config.corsOrigin,
    publicBaseUrl,
    setupStatus: paymentConfigured
      ? "ready_for_payment_testing"
      : "service_live_but_payment_address_placeholder",
    disclaimer: "Informational only. Not a substitute for professional security audit or testing. Verify all advice.",
  };
}

// Root info for agents/humans discovering the service
app.get('/', (c) => {
  return c.html(
    renderHomepage({
      publicBaseUrl,
      priceUsd: config.defaultPriceUsd,
      network: config.network,
      networkLabel: networkLabel(config.network),
      paymentConfigured,
      setupStatus: paymentConfigured
        ? 'ready_for_payment_testing'
        : 'service_live_but_payment_address_placeholder',
      lastUpdated: '2026-07-04',
      githubUrl: config.githubUrl || '',
      statusPageUrl: config.statusPageUrl || '',
      contactEmail: config.contactEmail || '',
    })
  );
});

app.get('/meta.json', (c) => {
  const track = c.req.query('track');
  if (track === 'homepage-click') {
    log.info({
      event: 'homepage_click',
      target: c.req.query('target') || 'unknown',
      href: c.req.query('href') || '',
      userAgent: c.req.header('user-agent') || '',
      referer: c.req.header('referer') || '',
      ip: c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || '',
    }, 'Homepage click');
  }

  return c.json(buildPublicMetadata());
});

// Serve discovery files from server/public/ (for local dev and easy testing)
const publicDir = join(process.cwd(), 'public');

app.get('/llms.txt', async (c) => {
  try {
    const content = await readFile(join(publicDir, 'llms.txt'), 'utf-8');
    return c.text(content);
  } catch {
    return c.text('See server/public/llms.txt in the repo for agent instructions.');
  }
});

app.get('/x402-catalog.json', async (c) => {
  try {
    const content = await readFile(join(publicDir, 'x402-catalog.json'), 'utf-8');
    const catalog = JSON.parse(content);
    const origin = config.publicBaseUrl || new URL(c.req.url).origin;
    return c.json({
      ...catalog,
      baseUrl: origin,
      llmsTxt: `${origin}/llms.txt`,
      openApi: `${origin}/openapi.json`,
    });
  } catch {
    return c.json({ note: 'Full catalog in server/public/x402-catalog.json' });
  }
});

app.get('/openapi.json', (c) => {
  return c.json(buildOpenApiSpec());
});

// Error handling
app.onError((err, c) => {
  log.error({ err }, 'Unhandled error');
  return c.json({ error: 'Internal error', message: err.message }, 500);
});

// Start server
// Bun native serve or node-server adapter
const port = config.port;
log.info(`Starting Synthr Cyber x402 server on port ${port}`);

if (typeof Bun !== 'undefined') {
  // Bun native
  Bun.serve({
    port,
    fetch: app.fetch,
  });
  log.info(`Bun server listening on http://localhost:${port}`);
} else {
  // Node fallback
  serve({
    fetch: app.fetch,
    port,
  });
  log.info(`Node server listening on http://localhost:${port}`);
}

export { app };
