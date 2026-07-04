/**
 * Shared mount for the Pulse agent API surface.
 * Applies the exact delegation skip rule for pure x402 intel paths (/intel/ and /goal/)
 * so that tests and server.ts drive the identical middleware chain.
 */

import { Hono } from 'hono';
import { delegationAuth } from './delegation-auth.js';
import agentRouter from './agent-routes.js';

export function createPulseAgentApp(): Hono {
  const app = new Hono();

  // Apply delegation only to paths that need it.
  // /v1/pulse/intel/* and /v1/pulse/goal/* bypass so pure no-account x402 works.
  app.use('/v1/pulse/*', async (c, next) => {
    const p = c.req.path || '';
    if (p.includes('/intel/') || p.includes('/goal/')) {
      return next();
    }
    return delegationAuth()(c, next);
  });

  app.route('/v1/pulse', agentRouter);

  return app;
}