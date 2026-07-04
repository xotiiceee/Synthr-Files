import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { schemas } from '../lib/schemas';
import {
  synthesizeStackBrief,
  synthesizeDepsAudit,
  synthesizeAdvice,
  searchVulns,
  synthesizeBreaking,
  UpstreamError,
} from '../services/intel';

export const cyberRoutes = new Hono();

// POST /v1/cyber/stack-brief  (primary high-value)
cyberRoutes.post(
  '/stack-brief',
  zValidator('json', schemas.StackBriefRequest),
  async (c) => {
    const input = c.req.valid('json');
    try {
      const result = await synthesizeStackBrief(input);
      return c.json(result, 200);
    } catch (err) {
      if (err instanceof UpstreamError) {
        return c.json({ error: 'upstream_unavailable', upstream: err.upstream, message: err.message }, 503);
      }
      throw err;
    }
  }
);

// POST /v1/cyber/audit-deps
cyberRoutes.post(
  '/audit-deps',
  zValidator('json', schemas.DepsAuditRequest),
  async (c) => {
    const input = c.req.valid('json');
    try {
      const result = await synthesizeDepsAudit(input);
      return c.json(result, 200);
    } catch (err) {
      if (err instanceof UpstreamError) {
        return c.json({ error: 'upstream_unavailable', upstream: err.upstream, message: err.message }, 503);
      }
      throw err;
    }
  }
);

// POST /v1/cyber/advice
cyberRoutes.post(
  '/advice',
  zValidator('json', schemas.AdviceRequest),
  async (c) => {
    const input = c.req.valid('json');
    try {
      const result = await synthesizeAdvice(input);
      return c.json(result, 200);
    } catch (err) {
      if (err instanceof UpstreamError) {
        return c.json({ error: 'upstream_unavailable', upstream: err.upstream, message: err.message }, 503);
      }
      throw err;
    }
  }
);

// POST /v1/cyber/vulns  - flexible vuln search (EPSS + KEV filtered)
cyberRoutes.post(
  '/vulns',
  zValidator('json', schemas.VulnSearchRequest),
  async (c) => {
    const input = c.req.valid('json');
    try {
      const result = await searchVulns(input);
      return c.json(result, 200);
    } catch (err) {
      if (err instanceof UpstreamError) {
        return c.json({ error: 'upstream_unavailable', upstream: err.upstream, message: err.message }, 503);
      }
      throw err;
    }
  }
);

// GET /v1/cyber/breaking - recent high-signal actively exploited items
cyberRoutes.get(
  '/breaking',
  zValidator('query', schemas.BreakingRequest),
  async (c) => {
    const input = c.req.valid('query');
    try {
      const result = await synthesizeBreaking(input);
      return c.json(result, 200);
    } catch (err) {
      if (err instanceof UpstreamError) {
        return c.json({ error: 'upstream_unavailable', upstream: err.upstream, message: err.message }, 503);
      }
      throw err;
    }
  }
);

export default cyberRoutes;
