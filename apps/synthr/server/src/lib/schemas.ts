import { z } from 'zod';

// Core input schemas for Cyber endpoints (strict for agents + validation)
export const StackBriefRequest = z.object({
  stack: z.object({
    languages: z.array(z.string()).optional(),
    frameworks: z.array(z.string()).optional(),
    dependencies: z.array(z.object({
      name: z.string(),
      version: z.string().optional(),
      ecosystem: z.string().optional(), // e.g. npm, pypi, maven
    })).min(1).max(100),
  }),
  context: z.string().max(2000).optional(), // e.g. "building a web app with agent tools, Next.js + FastAPI"
  depth: z.enum(['quick', 'standard', 'deep']).default('standard'),
});

export const DepsAuditRequest = z.object({
  dependencies: z.array(z.object({
    name: z.string(),
    version: z.string().optional(),
    ecosystem: z.string().optional(),
  })).min(1).max(200),
  includeMalicious: z.boolean().default(true),
});

export const AdviceRequest = z.object({
  query: z.string().min(5).max(1500),
  stackContext: z.object({
    languages: z.array(z.string()).optional(),
    frameworks: z.array(z.string()).optional(),
  }).optional(),
  focus: z.enum(['implementation', 'design', 'agent_harness', 'redteam']).default('implementation'),
});

export const VulnSearchRequest = z.object({
  query: z.string().optional(),
  cve: z.string().regex(/^CVE-\d{4}-\d+$/).optional(),
  minEpss: z.number().min(0).max(1).optional(),
  kevOnly: z.boolean().default(false),
  limit: z.number().min(1).max(20).default(10),
});

const queryBoolean = z.preprocess((value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return value;
}, z.boolean());

export const BreakingRequest = z.object({
  days: z.coerce.number().min(1).max(90).default(14),
  limit: z.coerce.number().min(1).max(20).default(10),
  minEpss: z.coerce.number().min(0).max(1).optional(),
  agentOnly: queryBoolean.default(false),
});

export const VulnResponse = z.object({
  queryId: z.string(),
  asOf: z.string(),
  results: z.array(z.any()),
  sources: z.array(z.any()),
});

// Response shapes (example - agents love predictable + rich)
export const SourceRef = z.object({
  url: z.string().url(),
  title: z.string(),
  fetchedAt: z.string().datetime(),
  type: z.enum(['osv', 'github', 'cisa', 'epss', 'nvd', 'social', 'other']),
});

export const CyberResponseBase = z.object({
  queryId: z.string(),
  asOf: z.string().datetime(),
  confidence: z.number().min(0).max(1),
  sources: z.array(SourceRef),
  disclaimer: z.string(),
  agentActions: z.array(z.string()),
});

// Extend per endpoint as needed
export const schemas = {
  StackBriefRequest,
  DepsAuditRequest,
  AdviceRequest,
  VulnSearchRequest,
  BreakingRequest,
  SourceRef,
  CyberResponseBase,
};
