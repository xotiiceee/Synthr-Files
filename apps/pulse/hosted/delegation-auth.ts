import type { Context, Next } from 'hono';
import { getTenantByApiKey, createTenant } from './db.js';
import type { Tenant } from './db.js';

declare module 'hono' {
  interface ContextVariableMap {
    agentApiKey: string;
    agentTenant: Tenant;
  }
}

const CLAWNET_API = process.env.CLAWNET_API_URL || 'https://api.claw-net.org';

interface ClawNetKeyInfo {
  userId: string;
  email: string;
  active: boolean;
}

async function fetchKeyInfo(apiKey: string): Promise<ClawNetKeyInfo | null> {
  try {
    const res = await fetch(`${CLAWNET_API}/v1/auth/me`, {
      headers: { 'X-API-Key': apiKey },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    return {
      userId: data.userId || data.id || '',
      email: data.email || '',
      active: data.active !== false,
    };
  } catch {
    return null;
  }
}

/**
 * Look up or create a tenant for the given root API key.
 * Returns null if the key is invalid or inactive.
 */
export async function resolveAgentTenant(apiKey: string): Promise<Tenant | null> {
  const existing = getTenantByApiKey(apiKey);
  if (existing) return existing;

  const info = await fetchKeyInfo(apiKey);
  if (!info || !info.active) return null;

  return createTenant(apiKey, info.userId, info.email);
}

// Scope glob helper — "pulse.*" matches "pulse.post", "pulse.reply", etc.
function matchesScope(patterns: string[], action: string): boolean {
  return patterns.some(p =>
    p.endsWith('.*') ? action.startsWith(p.slice(0, -1)) : p === action,
  );
}

const PATH_TO_SCOPE: Record<string, string> = {
  '/v1/pulse/post':     'pulse.post',
  '/v1/pulse/reply':    'pulse.reply',
  '/v1/pulse/thread':   'pulse.thread',
  '/v1/pulse/schedule': 'pulse.schedule',
  '/v1/pulse/monitor':  'pulse.monitor',
};

/**
 * Delegation auth middleware for agent routes.
 *
 * Accepts:
 *   X-API-Key: cn-xxx           — root ClawNet API key, full access
 *   Authorization: Bearer <key> — Soma delegation key; validated against
 *                                 ClawNet's /v1/economy/keys/delegated/:key/chain
 *
 * On success: sets agentApiKey (owner's billing key) and agentTenant in context.
 */
export function delegationAuth() {
  return async (c: Context, next: Next) => {
    const rawKey = c.req.header('X-API-Key');
    const authHeader = c.req.header('Authorization');

    // ── Root ClawNet API key path ──────────────────────────────────────────
    if (rawKey?.startsWith('cn-')) {
      const tenant = await resolveAgentTenant(rawKey);
      if (!tenant) {
        return c.json({ error: 'Invalid or inactive API key', code: 'INVALID_KEY' }, 401);
      }
      c.set('agentApiKey', rawKey);
      c.set('agentTenant', tenant);
      return next();
    }

    // ── Delegation key path ────────────────────────────────────────────────
    const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    if (!bearer) {
      return c.json(
        { error: 'Authentication required. Use X-API-Key: cn-xxx or Authorization: Bearer <delegation-key>', code: 'UNAUTHENTICATED' },
        401,
      );
    }

    // 1. Validate chain
    let chain: any;
    try {
      const res = await fetch(
        `${CLAWNET_API}/v1/economy/keys/delegated/${encodeURIComponent(bearer)}/chain`,
        { signal: AbortSignal.timeout(5000) },
      );
      if (!res.ok) return c.json({ error: 'Delegation key invalid or not found', code: 'REVOKED' }, 401);
      chain = await res.json();
    } catch {
      return c.json({ error: 'Delegation verification unavailable', code: 'AUTH_ERROR' }, 502);
    }

    if (!chain.valid) {
      return c.json({ error: 'Delegation key revoked or expired', code: chain.revoked ? 'REVOKED' : 'EXPIRED' }, 401);
    }

    // 2. Scope check
    const pathname = new URL(c.req.url).pathname;
    const action = PATH_TO_SCOPE[pathname] ?? null;
    const allowedEndpoints: string[] | undefined = chain.scope?.endpoints;
    if (action && allowedEndpoints && !matchesScope(allowedEndpoints, action)) {
      return c.json({ error: 'Delegation scope does not include this action', code: 'SCOPE_VIOLATION' }, 403);
    }

    // 3. Resolve root account info via ClawNet /v1/auth/me (now accepts delegation keys)
    const info = await fetchKeyInfo(bearer);
    if (!info || !info.active) {
      return c.json({ error: 'Root account inactive or unreachable', code: 'ACCOUNT_INVALID' }, 401);
    }

    // 4. Find root tenant by email (X credentials live on root tenant)
    const { getTenantByEmail } = await import('./db.js');
    const rootTenant = getTenantByEmail(info.email);
    if (!rootTenant) {
      return c.json({ error: 'No Pulse account found for this delegation key', code: 'ACCOUNT_NOT_FOUND' }, 403);
    }

    // agentApiKey = delegation key (deduct endpoint accepts it, bills root account)
    c.set('agentApiKey', bearer);
    c.set('agentTenant', rootTenant);
    return next();
  };
}
