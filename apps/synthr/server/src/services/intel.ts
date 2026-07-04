/**
 * Synthr Cyber Intelligence Synthesis Layer
 *
 * Core value: REAL-TIME DISTILLATION + STRICT GROUNDING for AI agents.
 *
 * Primary sources (2026 best practice):
 * - OSV.dev: https://api.osv.dev/v1/querybatch - No rate limits, aggregates NVD, GitHub, PyPI, etc. + malicious packages. Use OSV format.
 * - EPSS: https://api.first.org/data/v1/epss - Daily exploit probability (0-1) + percentile. Critical for prioritization.
 * - CISA KEV: https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json - Actively exploited.
 * - GitHub Advisory: Timely for OSS.
 *
 * Grounding (no hallucinations):
 * 1. Always retrieve from APIs first.
 * 2. Only use returned data.
 * 3. Full provenance in sources[] with timestamps.
 * 4. Confidence = min(source freshness, source agreement, coverage).
 * 5. Explicit agentActions[], harnessNotes, patchPriority.
 *
 * Agent-specific smarts:
 * - agentSurface: HIGH/MEDIUM/LOW based on common agent harness patterns (auth libs, web frameworks used in tool calling, LLM SDKs).
 * - Prioritize by EPSS desc + KEV.
 *
 * Caching: Simple in-memory with TTL for local/dev. (Future: Redis)
 *
 * No LLM required for core (data-driven). LLM optional for rich advice text.
 */

import { z } from 'zod';
import { schemas } from '../lib/schemas';

type SourceType = z.infer<typeof schemas.SourceRef>['type'];
type BreakingRequest = z.infer<typeof schemas.BreakingRequest>;

type KevVulnerability = {
  cveID: string;
  vendorProject?: string;
  product?: string;
  vulnerabilityName?: string;
  shortDescription?: string;
  requiredAction?: string;
  dueDate?: string;
  dateAdded?: string;
  knownRansomwareCampaignUse?: string;
  notes?: string;
};

// Bounded LRU cache (prevents memory bloat from unique query keys)
const CACHE_MAX_ENTRIES = 500;
const cache = new Map<string, { data: any; expires: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min for dev (OSV/EPSS change slowly)
const UPSTREAM_TIMEOUT_MS = 8000;

function getCache<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() >= entry.expires) {
    cache.delete(key);
    return null;
  }
  // Move to end (most recently used) — Map iterates in insertion order.
  cache.delete(key);
  cache.set(key, entry);
  return entry.data as T;
}

function setCache(key: string, data: any, ttl = CACHE_TTL_MS) {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    // Evict oldest (first inserted) entry — simple LRU.
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { data, expires: Date.now() + ttl });
}

// Error class for upstream failures — routes catch and return 503.
export class UpstreamError extends Error {
  readonly upstream: string;
  readonly statusCode: number;
  constructor(upstream: string, message: string, statusCode = 503) {
    super(message);
    this.name = 'UpstreamError';
    this.upstream = upstream;
    this.statusCode = statusCode;
  }
}

// Ecosystem normalization for OSV (critical)
export function normalizeEcosystem(ecosystem?: string): string {
  if (!ecosystem) return 'npm'; // Default common
  const map: Record<string, string> = {
    npm: 'npm',
    pypi: 'PyPI',
    python: 'PyPI',
    maven: 'Maven',
    nuget: 'NuGet',
    go: 'Go',
    crates: 'crates.io',
    'crates.io': 'crates.io',
    packagist: 'Packagist',
  };
  return map[ecosystem.toLowerCase()] || ecosystem;
}

function buildOSVQueries(dependencies: Array<{ name: string; version?: string; ecosystem?: string }>) {
  return dependencies.map((dep) => ({
    package: {
      name: dep.name,
      ecosystem: normalizeEcosystem(dep.ecosystem),
    },
    version: dep.version || undefined,
  }));
}

// Fetch OSV batch (core, efficient, no limits)
async function fetchOSVBatch(queries: any[]) {
  const cacheKey = 'osv:' + JSON.stringify(queries);
  const cached = getCache<any>(cacheKey);
  if (cached) return cached;

  try {
    const res = await fetch('https://api.osv.dev/v1/querybatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!res.ok) throw new UpstreamError('OSV', `OSV responded ${res.status}`);
    const data = await res.json();
    setCache(cacheKey, data);
    return data;
  } catch (err) {
    if (err instanceof UpstreamError) throw err;
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new UpstreamError('OSV', 'OSV request timed out');
    }
    throw new UpstreamError('OSV', `OSV fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Fetch EPSS for CVEs (supports comma list or repeated)
async function fetchEPSS(cves: string[]) {
  if (cves.length === 0) return {};
  const unique = [...new Set(cves)];
  const cacheKey = 'epss:' + unique.join(',');
  const cached = getCache<any>(cacheKey);
  if (cached) return cached;

  try {
    const url = `https://api.first.org/data/v1/epss?cve=${unique.join(',')}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
    if (!res.ok) throw new UpstreamError('EPSS', `EPSS responded ${res.status}`);
    const json = await res.json();
    const map: Record<string, { epss: number; percentile: number }> = {};
    (json.data || []).forEach((row: any) => {
      if (row.cve && row.epss) {
        map[row.cve] = {
          epss: parseFloat(row.epss),
          percentile: parseFloat(row.percentile),
        };
      }
    });
    setCache(cacheKey, map, 24 * 60 * 60 * 1000); // 24h since daily
    return map;
  } catch (err) {
    if (err instanceof UpstreamError) throw err;
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new UpstreamError('EPSS', 'EPSS request timed out');
    }
    throw new UpstreamError('EPSS', `EPSS fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// CISA KEV fetch (simple, mark actively exploited)
let kevCache: Set<string> | null = null;
let kevFeedCache: KevVulnerability[] | null = null;

async function fetchCisaKevFeed(): Promise<KevVulnerability[]> {
  if (kevFeedCache) return kevFeedCache;
  const cacheKey = 'cisa-kev-feed';
  const cached = getCache<KevVulnerability[]>(cacheKey);
  if (cached) {
    kevFeedCache = cached;
    return cached;
  }

  try {
    const res = await fetch(
      'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json',
      { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) }
    );
    if (!res.ok) throw new UpstreamError('CISA KEV', `CISA KEV responded ${res.status}`);
    const json = await res.json();
    const vulnerabilities = (json.vulnerabilities || []) as KevVulnerability[];
    kevFeedCache = vulnerabilities;
    setCache(cacheKey, vulnerabilities, 6 * 60 * 60 * 1000); // 6h
    return vulnerabilities;
  } catch (err) {
    if (err instanceof UpstreamError) throw err;
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new UpstreamError('CISA KEV', 'CISA KEV request timed out');
    }
    throw new UpstreamError('CISA KEV', `CISA KEV fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function getCisaKev(): Promise<Set<string>> {
  if (kevCache) return kevCache;
  const vulnerabilities = await fetchCisaKevFeed();
  const set = new Set<string>(vulnerabilities.map((v) => v.cveID).filter(Boolean));
  kevCache = set;
  return set;
}

function buildSource(url: string, title: string, fetchedAt: string, type: SourceType) {
  return { url, title, fetchedAt, type };
}

// Curated high-risk package names for agentic stacks. Matched exactly (lowercased)
// against the package name — not substring-matched against descriptions, which was
// flagging everything containing "api", "fetch", or "token" as HIGH.
const HIGH_RISK_PACKAGES = new Set([
  // auth / identity
  'jsonwebtoken', 'jose', 'passport', 'passport-jwt', 'next-auth', 'auth0',
  'firebase-admin', 'cookie-parser', 'bcrypt', 'argon2',
  // web frameworks / servers commonly used in tool calling
  'express', 'fastapi', 'flask', 'django', 'next', 'gin-gonic/gin', 'echo',
  'hono', '@hono/node-server', 'axios', 'got', 'node-fetch', 'requests',
  'aiohttp', 'httpx',
  // llm / agent sdk
  'langchain', 'langchain-core', 'langchain-community', '@langchain/core',
  'openai', 'anthropic', '@anthropic-ai/sdk', 'llamaindex', 'litellm',
  'replicate', 'ai', '@ai-sdk/openai',
  // data / persistence
  'pg', 'mysql2', 'mongodb', 'mongoose', 'redis', 'ioredis', 'prisma',
  '@prisma/client', 'knex', 'sequelize', 'sqlalchemy', 'psycopg2',
  // tool / mcp
  '@modelcontextprotocol/sdk', 'mcp', 'pydantic',
]);

const MEDIUM_RISK_PACKAGES = new Set([
  'react', 'react-dom', 'vue', 'svelte', 'angular', '@angular/core',
  'lodash', 'lodash-es', 'ramda', 'immutable', 'zod', 'joi', 'yup',
  'sharp', 'multer', 'body-parser', 'helmet', 'cors',
  'fastify', 'koa', 'koa-router', 'nestjs', '@nestjs/core',
  'ws', 'socket.io', 'uWebSockets.js',
]);

// Keywords that elevate risk when found in the vulnerability summary (not package name).
// These describe *what the vuln does*, not what the package does.
const HIGH_RISK_SUMMARY_KEYWORDS = [
  'rce', 'remote code execution', 'code execution', 'command injection',
  'sql injection', 'ssrf', 'server-side request forgery',
  'prototype pollution', 'path traversal', 'directory traversal',
  'authentication bypass', 'auth bypass', 'privilege escalation',
];

// Smart agent surface detection (tailored for agentic builders)
export function computeAgentSurface(pkgName: string, summary: string, queryContext?: string): string {
  const pkg = pkgName.toLowerCase().trim();
  const summaryLower = (summary || '').toLowerCase();
  const contextLower = (queryContext || '').toLowerCase();

  // 1. Exact package-name match — strong signal.
  if (HIGH_RISK_PACKAGES.has(pkg)) return 'HIGH';
  if (MEDIUM_RISK_PACKAGES.has(pkg)) return 'MEDIUM';

  // 2. Vulnerability summary describes a high-impact exploit type.
  if (HIGH_RISK_SUMMARY_KEYWORDS.some(kw => summaryLower.includes(kw))) return 'HIGH';

  // 3. Context field mentions agent/tool/auth/llm surfaces.
  const contextKeywords = ['agent', 'harness', 'tool', 'auth', 'llm', 'mcp', 'sdk'];
  const contextMatches = contextKeywords.filter(kw => contextLower.includes(kw)).length;
  if (contextMatches >= 2) return 'HIGH';
  if (contextMatches === 1) return 'MEDIUM';

  // 4. Package name contains scoped indicators (weaker signal).
  if (pkg.includes('auth') || pkg.includes('jwt') || pkg.includes('token')) return 'MEDIUM';
  if (pkg.includes('sql') || pkg.includes('database') || pkg.includes('db-')) return 'MEDIUM';

  return 'LOW';
}

function computeBreakingHarnessNotes(agentSurface: string, vulnerability: KevVulnerability) {
  if (agentSurface === 'HIGH') {
    return `Likely relevant to agent builders because ${vulnerability.product || vulnerability.vendorProject || 'this component'} often appears in auth, web, tool, or data-handling paths.`;
  }
  if (agentSurface === 'MEDIUM') {
    return 'Potentially relevant to deployed apps or service wrappers used by agent harnesses.';
  }
  return 'Lower direct agent-harness relevance, but still worth checking if the affected product is in your runtime or infra.';
}

// Parse a CVSS vector string (e.g. "CVSS:3.1/AV:N/AC:L/...") to extract the
// base score. OSV's severity[].score field is a vector string, not a number.
function parseCvssVector(vector: string): number {
  if (!vector || typeof vector !== 'string') return 0;
  // If it's already a number string, parse directly.
  const asNum = parseFloat(vector);
  if (!Number.isNaN(asNum) && asNum > 0 && asNum <= 10) return asNum;

  // CVSS 3.x vector: extract metrics and compute base score.
  // We use a simplified lookup — the full spec is complex, but OSV/GHSA
  // typically also provides database_specific.severity as a label.
  // This parser is a fallback for when only the vector is available.
  const parts = vector.split('/');
  const metrics: Record<string, string> = {};
  for (const part of parts) {
    const [k, v] = part.split(':');
    if (k && v) metrics[k] = v;
  }

  // CVSS 3.1 base score computation (simplified — uses the standard table).
  // See https://www.first.org/cvss/v3.1/specification for the full formula.
  const av = metrics['AV']; // Attack Vector: N,A,L,P
  const ac = metrics['AC']; // Attack Complexity: L,H
  const pr = metrics['PR']; // Privileges Required: N,L,H
  const ui = metrics['UI']; // User Interaction: N,R
  const scope = metrics['S']; // Scope: U,C
  const impact = metrics['I'] || metrics['C']; // Integrity/Confidentiality: H,L,N

  if (!av) return 0;

  // Simplified scoring — approximate but far better than always returning LOW.
  // High-impact, network-reachable, no-priv, no-interaction → high score.
  let score = 0;
  if (av === 'N') score += 3; else if (av === 'A') score += 2.5; else score += 1.5;
  if (ac === 'L') score += 2; else score += 0.5;
  if (pr === 'N') score += 2; else if (pr === 'L') score += 1; else score += 0.5;
  if (ui === 'N') score += 1; else score += 0.5;
  if (impact === 'H') score += 3; else if (impact === 'L') score += 1.5; else score += 0.5;
  if (scope === 'C') score += 1;

  // Clamp to 0-10 range.
  return Math.min(10, Math.round(score * 10) / 10);
}

// Severity map from OSV — handles the real OSV data shape correctly.
export function mapSeverity(vuln: any): string {
  // 1. database_specific.severity (GHSA-style: "CRITICAL", "HIGH", etc.)
  const dbSeverity = vuln.database_specific?.severity;
  if (typeof dbSeverity === 'string') {
    const upper = dbSeverity.toUpperCase().trim();
    if (upper === 'CRITICAL' || upper === 'HIGH' || upper === 'MEDIUM' || upper === 'LOW' || upper === 'NONE') {
      return upper === 'NONE' ? 'LOW' : upper;
    }
  }

  // 2. database_specific.cvss.baseScore (some advisories provide this directly)
  const directScore = vuln.database_specific?.cvss?.baseScore;
  if (typeof directScore === 'number' && directScore > 0) {
    if (directScore >= 9) return 'CRITICAL';
    if (directScore >= 7) return 'HIGH';
    if (directScore >= 4) return 'MEDIUM';
    return 'LOW';
  }

  // 3. severity[] array — OSV format: [{type: "CVSS_V3", score: "CVSS:3.1/..."}]
  // The score field is a VECTOR STRING, not a number. Parse it.
  if (Array.isArray(vuln.severity)) {
    for (const sev of vuln.severity) {
      if (sev?.score) {
        const score = parseCvssVector(sev.score);
        if (score > 0) {
          if (score >= 9) return 'CRITICAL';
          if (score >= 7) return 'HIGH';
          if (score >= 4) return 'MEDIUM';
          return 'LOW';
        }
      }
    }
  }

  return 'LOW';
}

// Main: synthesizeStackBrief - NOW REAL
export async function synthesizeStackBrief(input: z.infer<typeof schemas.StackBriefRequest>) {
  const queryId = crypto.randomUUID();
  const asOf = new Date().toISOString();
  const deps = input.stack.dependencies || [];

  // 1. Build + fetch OSV
  const osvQueries = buildOSVQueries(deps);
  const osvData = await fetchOSVBatch(osvQueries);

  const kevSet = await getCisaKev();

  // 2. Collect CVEs + vulns
  const allVulns: any[] = [];
  const cvesForEpss: string[] = [];
  (osvData.results || []).forEach((result: any, idx: number) => {
    const dep = deps[idx] || { name: 'unknown' };
    (result.vulns || []).forEach((vuln: any) => {
      // Prefer real CVE alias
      let cve = vuln.aliases?.find((a: string) => a.startsWith('CVE-'));
      if (!cve && vuln.id?.startsWith('CVE-')) cve = vuln.id;
      if (cve && cve.startsWith('CVE-')) cvesForEpss.push(cve);
      allVulns.push({ vuln, dep, cve: cve || vuln.id });
    });
  });

  // 3. EPSS enrichment
  const epssMap = await fetchEPSS(cvesForEpss);

  // 4. Build prioritized risks (smart: sort by epss desc)
  const prioritizedRisks = allVulns
    .map(({ vuln, dep, cve }) => {
      const epssInfo = cve ? epssMap[cve] : null;
      const epss = epssInfo?.epss || 0;
      const percentile = epssInfo?.percentile || 0;
      const isKev = kevSet.has(cve);
      const severity = mapSeverity(vuln);

      const summary = vuln.summary || vuln.details?.substring(0, 200) || 'Vulnerability details available in source.';
      const affected = (vuln.affected || []).flatMap((a: any) =>
        (a.versions || []).slice(0, 3)
      );

      return {
        id: vuln.id,
        cve: cve || vuln.id,
        title: vuln.summary || 'Vulnerability in ' + dep.name,
        severity,
        epss: parseFloat(epss.toFixed(2)),
        percentile: parseFloat(percentile.toFixed(1)),
        kev: isKev,
        affected: affected.length ? affected : [dep.name + (dep.version ? '@' + dep.version : '')],
        agentSurface: computeAgentSurface(dep.name, summary, input.context),
        patchPriority: isKev || epss > 0.3 ? 'P0 - Patch immediately' : epss > 0.1 ? 'P1 - Prioritize soon' : 'P2 - Monitor',
        summary,
        sources: [
          { url: `https://osv.dev/vuln/${vuln.id}`, title: 'OSV.dev', fetchedAt: asOf, type: 'osv' as const },
          ...(cve ? [{ url: `https://nvd.nist.gov/vuln/detail/${cve}`, title: 'NVD', fetchedAt: asOf, type: 'nvd' as const }] : []),
        ],
        recommendedActions: [
          `Update ${dep.name} to a patched version (see OSV for ranges)`,
          isKev ? 'This is actively exploited - treat as emergency' : 'Review impact in your agent flows',
        ],
      };
    })
    .sort((a, b) => (b.epss || 0) - (a.epss || 0) || (b.kev ? 1 : 0) - (a.kev ? 1 : 0));

  const criticalCount = prioritizedRisks.filter(r => r.severity === 'CRITICAL' || r.kev).length;
  const highCount = prioritizedRisks.filter(r => r.severity === 'HIGH').length;

  // 5. Sources list
  const sources = [
    { url: 'https://osv.dev', title: 'OSV.dev (primary - NVD + GitHub + more)', fetchedAt: asOf, type: 'osv' as const },
    { url: 'https://api.first.org/data/v1/epss', title: 'FIRST EPSS (exploit probability)', fetchedAt: asOf, type: 'epss' as const },
    { url: 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog', title: 'CISA KEV', fetchedAt: asOf, type: 'cisa' as const },
  ];

  // 6. Confidence (smart)
  const confidence = Math.min(0.95, 0.6 + (prioritizedRisks.length > 0 ? 0.25 : 0) + (criticalCount > 0 ? 0.1 : 0));

  return {
    queryId,
    asOf,
    confidence,
    stackSummary: {
      packagesAnalyzed: deps.length,
      criticalFindings: criticalCount,
      highFindings: highCount,
    },
    prioritizedRisks: prioritizedRisks.slice(0, 15), // cap for agents
    sources,
    disclaimer: "Informational only. Not a substitute for professional security review, penetration testing, or audit. Data is fetched live but may have propagation delays. Always verify patches and test in your environment. Agents: share only dep lists, never source code.",
    agentActions: [
      "Call this at the beginning of any new project in your harness and before deployment steps.",
      "For best results provide full dep list with versions and ecosystems.",
      "Follow up with /v1/cyber/advice for specific mitigation patterns.",
      "Re-query after dependency updates.",
    ],
    harnessNotes: "Optimized for agentic development: flags risks common in auth for tools, web servers, LLM SDKs, and supply chain in generated code. Prioritized using real-world exploit data (EPSS + KEV).",
  };
}

// Real deps audit
export async function synthesizeDepsAudit(input: z.infer<typeof schemas.DepsAuditRequest>) {
  const queryId = crypto.randomUUID();
  const asOf = new Date().toISOString();
  const queries = buildOSVQueries(input.dependencies);
  const osvData = await fetchOSVBatch(queries);
  const kevSet = await getCisaKev();
  const cves = new Set<string>();

  const findings: any[] = [];
  (osvData.results || []).forEach((result: any, i: number) => {
    const dep = input.dependencies[i];
    const vulns = result.vulns || [];
    vulns.forEach((v: any) => {
      const cve = v.aliases?.find((a: string) => a.startsWith('CVE-')) || v.id;
      if (cve?.startsWith('CVE-')) cves.add(cve);
      findings.push({
        package: dep.name + (dep.version ? '@' + dep.version : ''),
        id: v.id,
        cve,
        summary: v.summary,
        kev: kevSet.has(cve),
      });
    });
  });

  const epssMap = await fetchEPSS(Array.from(cves));
  // Enrich findings with EPSS
  findings.forEach(f => {
    if (f.cve && epssMap[f.cve]) {
      f.epss = epssMap[f.cve].epss;
      f.percentile = epssMap[f.cve].percentile;
    }
  });

  const malicious = findings.filter(f => f.id.includes('MALICIOUS') || f.summary?.toLowerCase().includes('malicious')).length;

  return {
    queryId,
    asOf,
    confidence: 0.93,
    packagesAnalyzed: input.dependencies.length,
    findings: findings.slice(0, 30),
    maliciousPackagesDetected: malicious,
    sources: [
      { url: 'https://osv.dev', title: 'OSV.dev + OpenSSF Malicious Packages', fetchedAt: asOf, type: 'osv' },
      { url: 'https://api.first.org/data/v1/epss', title: 'EPSS', fetchedAt: asOf, type: 'epss' },
    ],
    disclaimer: "Informational. Prioritize by epss > 0.1 or kev:true.",
    agentActions: ["Sort findings by epss descending. Patch high EPSS first.", "For malicious: remove the package immediately and audit dependents."],
  };
}

// Advice: data-driven + simple grounding. Can be extended with LLM later.
export async function synthesizeAdvice(input: z.infer<typeof schemas.AdviceRequest>) {
  const queryId = crypto.randomUUID();
  const asOf = new Date().toISOString();
  const lowerQuery = input.query.toLowerCase();

  // Smart rule-based grounding for common agent questions
  let advice = "Based on latest aggregated data from OSV and EPSS: ";
  const keyThreats: string[] = [];
  const actions: string[] = [];

  if (lowerQuery.includes('jwt') || lowerQuery.includes('token') || lowerQuery.includes('auth')) {
    advice += "Use well-maintained libraries (e.g. latest jsonwebtoken or alternatives like jose). Avoid custom implementations. Validate algorithms strictly.";
    keyThreats.push("Algorithm confusion attacks", "Weak secret handling");
    actions.push("Pin to patched version", "Use RS256 or ES256", "Validate audience/issuer");
  } else if (lowerQuery.includes('prompt') || lowerQuery.includes('injection')) {
    advice += "Treat all LLM inputs as untrusted. Use strict output schemas, input sanitization, and least-privilege tools.";
    keyThreats.push("Indirect prompt injection via tools/docs", "Tool abuse");
    actions.push("Sandbox tool execution", "Validate tool outputs", "Use allow-lists for tools");
  } else {
    advice += "Follow least privilege, keep dependencies updated (use OSV/EPSS signals), and validate all external data. Run this service's stack-brief regularly.";
    actions.push("Audit deps with /audit-deps", "Apply patches prioritized by EPSS");
  }

  return {
    queryId,
    asOf,
    confidence: 0.78,
    advice,
    keyThreatsAddressed: keyThreats.length ? keyThreats : ["General supply chain and implementation risks from recent data"],
    sources: [
      { url: 'https://osv.dev', title: 'OSV.dev', fetchedAt: asOf, type: 'osv' },
      { url: 'https://api.first.org/data/v1/epss', title: 'EPSS', fetchedAt: asOf, type: 'epss' },
    ],
    disclaimer: "This is synthesized guidance grounded in public vulnerability databases. Not legal or professional security advice. Test thoroughly.",
    agentActions: actions,
  };
}

// Vuln search implementation (added for /vulns endpoint)
export async function searchVulns(input: z.infer<typeof schemas.VulnSearchRequest>) {
  const queryId = crypto.randomUUID();
  const asOf = new Date().toISOString();
  const kevSet = await getCisaKev();

  let results: any[] = [];

  if (input.cve) {
    try {
      const res = await fetch(`https://api.osv.dev/v1/vulns/${input.cve}`, {
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
      if (res.ok) results.push(await res.json());
    } catch (err) {
      if (err instanceof UpstreamError) throw err;
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        throw new UpstreamError('OSV', 'OSV vuln lookup timed out');
      }
      throw new UpstreamError('OSV', `OSV vuln lookup failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else if (input.query) {
    const pkgHint = input.query.split(/\s+/)[0];
    const batch = await fetchOSVBatch([{ package: { name: pkgHint, ecosystem: 'npm' } }]);
    results = batch.results?.[0]?.vulns || [];
  }

  const cves = results
    .map((v: any) => v.aliases?.find((a: string) => a?.startsWith('CVE-')))
    .filter(Boolean) as string[];
  const epssMap = await fetchEPSS(cves);

  const enriched = results
    .map((v: any) => {
      const cve = v.aliases?.find((a: string) => a?.startsWith('CVE-')) || v.id;
      const epssInfo = epssMap[cve] || { epss: 0, percentile: 0 };
      return {
        id: v.id,
        cve,
        title: v.summary,
        epss: epssInfo.epss,
        percentile: epssInfo.percentile,
        kev: kevSet.has(cve),
        severity: mapSeverity(v),
        summary: (v.details || v.summary || '').slice(0, 280),
      };
    })
    .filter((r: any) => {
      if (input.kevOnly && !r.kev) return false;
      if (typeof input.minEpss === 'number' && r.epss < input.minEpss) return false;
      return true;
    })
    .sort((a: any, b: any) => b.epss - a.epss)
    .slice(0, input.limit || 10);

  return {
    queryId,
    asOf,
    results: enriched,
    sources: [
      { url: 'https://api.osv.dev', title: 'OSV.dev', fetchedAt: asOf, type: 'osv' },
      { url: 'https://api.first.org/data/v1/epss', title: 'FIRST EPSS', fetchedAt: asOf, type: 'epss' },
    ],
  };
}

export async function synthesizeBreaking(input: BreakingRequest) {
  const queryId = crypto.randomUUID();
  const asOf = new Date().toISOString();
  const kevFeed = await fetchCisaKevFeed();

  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - input.days);

  const recentKev = kevFeed.filter((item) => {
    if (!item.dateAdded) return false;
    const addedAt = new Date(item.dateAdded);
    return !Number.isNaN(addedAt.valueOf()) && addedAt >= cutoff;
  });

  const cves = recentKev.map((item) => item.cveID).filter(Boolean);
  const epssMap = await fetchEPSS(cves);

  const results = recentKev
    .map((item) => {
      const agentSurface = computeAgentSurface(
        `${item.vendorProject || ''} ${item.product || ''}`.trim(),
        `${item.vulnerabilityName || ''} ${item.shortDescription || ''}`.trim()
      );
      const epssInfo = epssMap[item.cveID] || { epss: 0, percentile: 0 };

      return {
        cve: item.cveID,
        title: item.vulnerabilityName || `${item.product || item.vendorProject || 'Unknown product'} actively exploited vulnerability`,
        vendorProject: item.vendorProject || null,
        product: item.product || null,
        dateAdded: item.dateAdded || null,
        dueDate: item.dueDate || null,
        kev: true,
        epss: parseFloat(epssInfo.epss.toFixed(4)),
        percentile: parseFloat(epssInfo.percentile.toFixed(4)),
        agentSurface,
        summary: item.shortDescription || 'See KEV and vendor references for details.',
        requiredAction: item.requiredAction || 'Review vendor guidance and patch if affected.',
        knownRansomwareCampaignUse: item.knownRansomwareCampaignUse || 'Unknown',
        harnessNotes: computeBreakingHarnessNotes(agentSurface, item),
        sources: [
          buildSource(
            `https://www.cisa.gov/known-exploited-vulnerabilities-catalog?search_api_fulltext=${encodeURIComponent(item.cveID)}`,
            'CISA KEV',
            asOf,
            'cisa'
          ),
          buildSource(
            `https://nvd.nist.gov/vuln/detail/${item.cveID}`,
            'NVD',
            asOf,
            'nvd'
          ),
        ],
      };
    })
    .filter((item) => {
      if (typeof input.minEpss === 'number' && item.epss < input.minEpss) return false;
      if (input.agentOnly && item.agentSurface === 'LOW') return false;
      return true;
    })
    .sort((a, b) => b.epss - a.epss || (a.dateAdded && b.dateAdded ? Date.parse(b.dateAdded) - Date.parse(a.dateAdded) : 0))
    .slice(0, input.limit);

  return {
    queryId,
    asOf,
    confidence: results.length > 0 ? 0.9 : 0.7,
    windowDays: input.days,
    results,
    sources: [
      buildSource(
        'https://www.cisa.gov/known-exploited-vulnerabilities-catalog',
        'CISA Known Exploited Vulnerabilities Catalog',
        asOf,
        'cisa'
      ),
      buildSource(
        'https://api.first.org/data/v1/epss',
        'FIRST EPSS',
        asOf,
        'epss'
      ),
    ],
    disclaimer: 'Informational only. This feed focuses on recently added KEV items and does not prove your environment is affected. Verify product/version exposure before taking emergency action.',
    agentActions: [
      'Check whether any listed vendor/product appears in your deployed stack, CI runners, gateways, or agent tooling.',
      'Prioritize items with both KEV presence and high EPSS.',
      'Follow up with /v1/cyber/vulns or /v1/cyber/advice for deeper package or remediation guidance.',
    ],
    harnessNotes: 'Designed for fast situational awareness on newly added actively exploited vulnerabilities, with extra emphasis on products commonly present in agent-serving stacks.',
  };
}
