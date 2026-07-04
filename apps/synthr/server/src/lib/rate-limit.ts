import type { Context, Next } from 'hono';

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

function getClientKey(c: Context) {
  const forwardedFor = c.req.header('x-forwarded-for');
  const realIp = c.req.header('x-real-ip');
  const fallback = 'unknown';
  const ip = forwardedFor?.split(',')[0]?.trim() || realIp || fallback;
  return `${c.req.method}:${c.req.path}:${ip}`;
}

export function createRateLimitMiddleware(options: {
  maxRequests: number;
  windowMs: number;
}) {
  const { maxRequests, windowMs } = options;

  return async function rateLimitMiddleware(c: Context, next: Next) {
    const now = Date.now();
    const key = getClientKey(c);
    const current = buckets.get(key);

    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      c.header('X-RateLimit-Limit', String(maxRequests));
      c.header('X-RateLimit-Remaining', String(maxRequests - 1));
      c.header('X-RateLimit-Reset', String(Math.ceil((now + windowMs) / 1000)));
      await next();
      return;
    }

    current.count += 1;
    const remaining = Math.max(0, maxRequests - current.count);

    c.header('X-RateLimit-Limit', String(maxRequests));
    c.header('X-RateLimit-Remaining', String(remaining));
    c.header('X-RateLimit-Reset', String(Math.ceil(current.resetAt / 1000)));

    if (current.count > maxRequests) {
      const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      c.header('Retry-After', String(retryAfterSeconds));
      return c.json(
        {
          error: 'RATE_LIMITED',
          message: 'Too many requests. Please retry later.',
          retryAfterSeconds,
        },
        429
      );
    }

    await next();
  };
}
