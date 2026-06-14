import crypto from "node:crypto";

import { SESSION_COOKIE } from "./sessions.js";

const CSRF_TOKEN_BYTES = 32;
const CSRF_HMAC_ALGORITHM = "sha256";
const CSRF_VERSION = "pulse-csrf-v1";

// ─── Cookie Options ───────────────────────────────────────────────────────────

export interface SessionCookieOptions {
  name: string;
  path: string;
  httpOnly: boolean;
  sameSite: "Strict" | "Lax" | "None";
  secure: boolean;
  maxAge: number;
}

/**
 * Builds cookie options from SESSION_COOKIE metadata.
 * The `secure` flag is gated on `isProduction` so dev servers work over HTTP.
 */
export function buildSessionCookieOptions(
  isProduction: boolean,
  overrides?: Partial<Pick<SessionCookieOptions, "maxAge" | "sameSite">>,
): SessionCookieOptions {
  return {
    name: SESSION_COOKIE.name,
    path: SESSION_COOKIE.path,
    httpOnly: SESSION_COOKIE.httpOnly,
    sameSite: overrides?.sameSite ?? (SESSION_COOKIE.sameSite as "Lax"),
    secure: SESSION_COOKIE.secureInProduction && isProduction,
    maxAge: overrides?.maxAge ?? SESSION_COOKIE.maxAgeSeconds,
  };
}

/**
 * Serializes cookie options into a Set-Cookie header value string.
 * Does not percent-encode the value — callers must encode if needed.
 */
export function serializeSetCookieHeader(
  value: string,
  options: SessionCookieOptions,
): string {
  const parts: string[] = [`${options.name}=${value}`];
  parts.push(`Path=${options.path}`);
  parts.push(`Max-Age=${options.maxAge}`);
  parts.push(`SameSite=${options.sameSite}`);
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

// ─── CSRF Helpers ─────────────────────────────────────────────────────────────

/**
 * Generates a cryptographically random CSRF token (base64url, 32 bytes).
 */
export function generateCsrfToken(): string {
  return crypto.randomBytes(CSRF_TOKEN_BYTES).toString("base64url");
}

/**
 * Produces an HMAC of the CSRF token bound to a session ID.
 * Binding to sessionId ties each CSRF hash to a specific session so a token
 * issued for one session cannot be replayed against another.
 */
export function hashCsrfToken(token: string, sessionId: string): string {
  return crypto
    .createHmac(CSRF_HMAC_ALGORITHM, `${CSRF_VERSION}:${sessionId}`)
    .update(token, "utf8")
    .digest("hex");
}

/**
 * Verifies a CSRF token against its stored hash using constant-time comparison.
 * Returns false for any length mismatch (prevents timing oracle on empty input).
 */
export function verifyCsrfToken(
  token: string,
  storedHash: string,
  sessionId: string,
): boolean {
  if (!token || !storedHash || !sessionId) return false;
  const expected = hashCsrfToken(token, sessionId);
  if (expected.length !== storedHash.length) return false;
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(storedHash, "hex"),
    );
  } catch {
    return false;
  }
}

// ─── Origin / Same-Site Validation ───────────────────────────────────────────

/**
 * Extracts the scheme+host+port origin from a URL string.
 * Returns null if the URL is malformed.
 */
export function parseOrigin(url: string): string | null {
  try {
    const { protocol, host } = new URL(url);
    return `${protocol}//${host}`;
  } catch {
    return null;
  }
}

/**
 * Returns true when the request Origin header matches the expected origin.
 * A null/missing Origin (e.g. same-origin form posts in some browsers) is
 * treated as valid when `allowMissingOrigin` is true (default: false).
 */
export function isSameOrigin(
  requestOrigin: string | null | undefined,
  expectedOrigin: string,
  options?: { allowMissingOrigin?: boolean },
): boolean {
  if (!requestOrigin) return options?.allowMissingOrigin === true;
  const req = parseOrigin(requestOrigin);
  const exp = parseOrigin(expectedOrigin);
  if (!req || !exp) return false;
  return req === exp;
}

/**
 * Returns true when the request Origin header is in the allowedOrigins list.
 * Normalises both sides via parseOrigin before comparing.
 */
export function isAllowedOrigin(
  requestOrigin: string | null | undefined,
  allowedOrigins: readonly string[],
): boolean {
  if (!requestOrigin) return false;
  const req = parseOrigin(requestOrigin);
  if (!req) return false;
  return allowedOrigins.some((o) => parseOrigin(o) === req);
}

// ─── Session TTL Validation ───────────────────────────────────────────────────

export interface SessionTtlStatus {
  valid: boolean;
  expired: boolean;
  expiresAt: Date;
  remainingMs: number;
}

/**
 * Validates whether a session is within its TTL window.
 * `expiresAt` must be an ISO-8601 string (as stored in the sessions table).
 */
export function validateSessionTtl(
  expiresAt: string,
  now?: Date,
): SessionTtlStatus {
  const expiry = new Date(expiresAt);
  const reference = now ?? new Date();
  if (Number.isNaN(expiry.getTime())) {
    return {
      valid: false,
      expired: true,
      expiresAt: expiry,
      remainingMs: 0,
    };
  }

  const remainingMs = expiry.getTime() - reference.getTime();
  const expired = remainingMs <= 0;
  return {
    valid: !expired,
    expired,
    expiresAt: expiry,
    remainingMs: Math.max(0, remainingMs),
  };
}

/**
 * Convenience predicate — true when the session has passed its expiry time.
 */
export function isSessionExpired(expiresAt: string, now?: Date): boolean {
  return validateSessionTtl(expiresAt, now).expired;
}
