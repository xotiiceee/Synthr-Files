import type { FirstPartyPasswordAuthResult } from "./password-auth.js";
import {
  authenticateFirstPartyPassword,
  type AuthenticateFirstPartyPasswordInput,
} from "./password-auth.js";
import { revokeSessionByToken, type HostedSession } from "./sessions.js";
import {
  buildSessionCookieOptions,
  generateCsrfToken,
  hashCsrfToken,
  serializeSetCookieHeader,
  verifyCsrfToken,
} from "./session-security.js";

// ─── CSRF Bundle ──────────────────────────────────────────────────────────────

export interface CsrfBundle {
  token: string;
  hash: string;
}

export function issueCsrfBundle(sessionId: string): CsrfBundle {
  const token = generateCsrfToken();
  return { token, hash: hashCsrfToken(token, sessionId) };
}

export function verifyCsrfBundle(
  bundle: { token: string; hash: string },
  sessionId: string,
): boolean {
  return verifyCsrfToken(bundle.token, bundle.hash, sessionId);
}

// ─── Cookie Headers ───────────────────────────────────────────────────────────

export interface CookieHeaderOptions {
  isProduction: boolean;
  maxAge?: number;
}

export function buildSessionSetCookieHeader(
  token: string,
  options: CookieHeaderOptions,
): string {
  const cookieOptions = buildSessionCookieOptions(options.isProduction, {
    maxAge: options.maxAge,
  });
  return serializeSetCookieHeader(token, cookieOptions);
}

export function buildClearSessionCookieHeader(isProduction: boolean): string {
  const cookieOptions = buildSessionCookieOptions(isProduction, { maxAge: 0 });
  return serializeSetCookieHeader("", cookieOptions);
}

// ─── Login Result Shape ───────────────────────────────────────────────────────

export interface LoginSuccess {
  ok: true;
  userId: string;
  sessionId: string;
  setCookieHeader: string;
  csrf: CsrfBundle;
}

export interface LoginFailure {
  ok: false;
  error:
    | "invalid_credentials"
    | "password_not_configured"
    | "org_membership_required";
  httpStatus: 401;
}

export type LoginResult = LoginSuccess | LoginFailure;

export interface ShapeLoginResultOptions {
  isProduction: boolean;
  maxAge?: number;
}

export function shapeLoginResult(
  authResult: FirstPartyPasswordAuthResult,
  options: ShapeLoginResultOptions,
): LoginResult {
  if (!authResult.ok) {
    return { ok: false, error: authResult.error, httpStatus: 401 };
  }
  const { user, session, token } = authResult;
  const setCookieHeader = buildSessionSetCookieHeader(token, options);
  const csrf = issueCsrfBundle(session.id);
  return {
    ok: true,
    userId: user.id,
    sessionId: session.id,
    setCookieHeader,
    csrf,
  };
}

// ─── Login Entry Point ────────────────────────────────────────────────────────

export interface FirstPartyLoginInput extends AuthenticateFirstPartyPasswordInput {
  isProduction?: boolean;
  maxAge?: number;
}

export function firstPartyLogin(input: FirstPartyLoginInput): LoginResult {
  const { isProduction = false, maxAge, ...authInput } = input;
  const authResult = authenticateFirstPartyPassword(authInput);
  return shapeLoginResult(authResult, { isProduction, maxAge });
}

// ─── Logout / Session Revocation ─────────────────────────────────────────────

export interface LogoutResult {
  revoked: boolean;
  session: HostedSession | null;
  clearCookieHeader: string;
}

export function logoutByToken(
  token: string,
  options: { now?: Date; isProduction?: boolean } = {},
): LogoutResult {
  const { now, isProduction = false } = options;
  const session = revokeSessionByToken(token, { now });
  return {
    revoked: session?.revoked_at != null,
    session,
    clearCookieHeader: buildClearSessionCookieHeader(isProduction),
  };
}
