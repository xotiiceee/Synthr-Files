import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { getUser, type User } from "./db.js";
import {
  firstPartyLogin,
  issueCsrfBundle,
  logoutByToken,
  verifyCsrfBundle,
  type CsrfBundle,
  type LoginResult,
} from "./first-party-auth.js";
import {
  signUpUser,
  verifyUserEmail,
  type SignUpUserResult,
  type SignUpUserError,
} from "./password-auth.js";
import { sendVerificationEmail } from "./auth.js";
import {
  getSessionById,
  getSessionByToken,
  isFirstPartyAuthEnabled,
  resolveAuthProviderName,
  SESSION_COOKIE,
  type HostedSession,
} from "./sessions.js";
import { isAllowedOrigin, isSameOrigin } from "./session-security.js";

export const FIRST_PARTY_AUTH_DISABLED_CODE = "AUTH_PROVIDER_DISABLED";
export const INVALID_ORIGIN_CODE = "INVALID_ORIGIN";
export const INVALID_REQUEST_CODE = "INVALID_REQUEST";
export const UNAUTHENTICATED_CODE = "UNAUTHENTICATED";
export const X_CSRF_TOKEN_HEADER = "x-csrf-token";
export const X_CSRF_HASH_HEADER = "x-csrf-hash";

export interface FirstPartyAuthRouteOptions {
  authProvider?: string;
  expectedOrigin?: string;
  allowedOrigins?: readonly string[];
  isProduction?: boolean;
  sessionMaxAge?: number;
  allowMissingMutationOrigin?: boolean;
}

export interface FirstPartyAuthRouteResponse<TBody = unknown> {
  status: ContentfulStatusCode;
  headers?: Record<string, string>;
  body: TBody;
}

export interface FirstPartyAuthUserView {
  id: string;
  email: string;
  name: string;
}

export interface FirstPartyAuthSessionView {
  id: string;
  orgId: string | null;
  expiresAt: string;
  lastSeenAt: string;
}

export interface LoginRequestInput extends FirstPartyAuthRouteOptions {
  email: string;
  password: string;
  orgId?: string | null;
  origin?: string | null;
  requestUrl?: string;
  userAgent?: string;
  ipAddress?: string;
  now?: Date;
}

export interface LogoutRequestInput extends FirstPartyAuthRouteOptions {
  cookieHeader?: string | null;
  origin?: string | null;
  requestUrl?: string;
  now?: Date;
}

export interface SessionRequestInput extends FirstPartyAuthRouteOptions {
  cookieHeader?: string | null;
  now?: Date;
}

export interface VerifyCsrfRequestInput extends FirstPartyAuthRouteOptions {
  cookieHeader?: string | null;
  origin?: string | null;
  requestUrl?: string;
  csrfToken: string;
  csrfHash: string;
  now?: Date;
}

export function buildFirstPartyAuthDisabledResponse(): FirstPartyAuthRouteResponse<{
  ok: false;
  error: string;
  code: string;
}> {
  return {
    status: 404,
    body: {
      ok: false,
      error: "First-party auth is not enabled",
      code: FIRST_PARTY_AUTH_DISABLED_CODE,
    },
  };
}

export function guardFirstPartyAuthProvider(
  authProvider?: string,
): FirstPartyAuthRouteResponse<{
  ok: false;
  error: string;
  code: string;
}> | null {
  const provider = resolveAuthProviderName(authProvider);
  if (isFirstPartyAuthEnabled(provider)) return null;
  return buildFirstPartyAuthDisabledResponse();
}

export function resolveExpectedOrigin(input: {
  expectedOrigin?: string;
  requestUrl?: string;
}): string | null {
  const candidate = input.expectedOrigin ?? input.requestUrl;
  if (!candidate) return null;
  try {
    const { origin } = new URL(candidate);
    return origin;
  } catch {
    return null;
  }
}

export function validateFirstPartyMutationOrigin(input: {
  origin?: string | null;
  expectedOrigin?: string;
  requestUrl?: string;
  allowedOrigins?: readonly string[];
  allowMissingOrigin?: boolean;
}): FirstPartyAuthRouteResponse<{
  ok: false;
  error: string;
  code: string;
}> | null {
  const expectedOrigin = resolveExpectedOrigin(input);
  const requestOrigin = input.origin;
  const allowMissingOrigin = input.allowMissingOrigin ?? false;

  if (!expectedOrigin) {
    return {
      status: 500,
      body: {
        ok: false,
        error: "Expected origin is not configured",
        code: INVALID_REQUEST_CODE,
      },
    };
  }

  if (
    isSameOrigin(requestOrigin, expectedOrigin, {
      allowMissingOrigin,
    })
  ) {
    return null;
  }

  if (requestOrigin && input.allowedOrigins?.length) {
    if (isAllowedOrigin(requestOrigin, input.allowedOrigins)) {
      return null;
    }
  }

  return {
    status: 403,
    body: {
      ok: false,
      error: "Origin validation failed",
      code: INVALID_ORIGIN_CODE,
    },
  };
}

export function readSessionTokenFromCookieHeader(
  cookieHeader?: string | null,
): string | null {
  if (!cookieHeader) return null;
  for (const cookie of cookieHeader.split(";")) {
    const [name, ...valueParts] = cookie.trim().split("=");
    if (name !== SESSION_COOKIE.name) continue;
    const rawValue = valueParts.join("=");
    if (!rawValue) return null;
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }
  return null;
}

export function handleFirstPartyLoginRequest(
  input: LoginRequestInput,
): FirstPartyAuthRouteResponse {
  const providerGuard = guardFirstPartyAuthProvider(input.authProvider);
  if (providerGuard) return providerGuard;

  const originGuard = validateFirstPartyMutationOrigin({
    origin: input.origin,
    expectedOrigin: input.expectedOrigin,
    requestUrl: input.requestUrl,
    allowedOrigins: input.allowedOrigins,
    allowMissingOrigin: input.allowMissingMutationOrigin,
  });
  if (originGuard) return originGuard;

  const result = firstPartyLogin({
    email: input.email,
    password: input.password,
    orgId: input.orgId,
    userAgent: input.userAgent,
    ipAddress: input.ipAddress,
    now: input.now,
    isProduction: input.isProduction,
    maxAge: input.sessionMaxAge,
  });

  return loginResultToRouteResponse(result);
}

function loginResultToRouteResponse(
  result: LoginResult,
): FirstPartyAuthRouteResponse {
  if (!result.ok) {
    return {
      status: result.httpStatus,
      body: {
        ok: false,
        error: result.error,
      },
    };
  }

  const session = getSessionById(result.sessionId);
  const user = getUser(result.userId);

  return {
    status: 200,
    headers: {
      "Set-Cookie": result.setCookieHeader,
    },
    body: {
      ok: true,
      user: user
        ? toUserView(user)
        : { id: result.userId, email: "", name: "" },
      session: session
        ? toSessionView(session)
        : {
            id: result.sessionId,
            orgId: null,
            expiresAt: "",
            lastSeenAt: "",
          },
      csrf: result.csrf,
    },
  };
}

export function handleFirstPartyLogoutRequest(
  input: LogoutRequestInput,
): FirstPartyAuthRouteResponse {
  const providerGuard = guardFirstPartyAuthProvider(input.authProvider);
  if (providerGuard) return providerGuard;

  const originGuard = validateFirstPartyMutationOrigin({
    origin: input.origin,
    expectedOrigin: input.expectedOrigin,
    requestUrl: input.requestUrl,
    allowedOrigins: input.allowedOrigins,
    allowMissingOrigin: input.allowMissingMutationOrigin,
  });
  if (originGuard) return originGuard;

  const token = readSessionTokenFromCookieHeader(input.cookieHeader);
  const result = token
    ? logoutByToken(token, {
        now: input.now,
        isProduction: input.isProduction,
      })
    : logoutByToken("", {
        now: input.now,
        isProduction: input.isProduction,
      });

  return {
    status: 200,
    headers: {
      "Set-Cookie": result.clearCookieHeader,
    },
    body: {
      ok: true,
      revoked: result.revoked,
      sessionId: result.session?.id ?? null,
    },
  };
}

export function handleFirstPartySessionRequest(
  input: SessionRequestInput,
): FirstPartyAuthRouteResponse {
  const providerGuard = guardFirstPartyAuthProvider(input.authProvider);
  if (providerGuard) return providerGuard;

  const token = readSessionTokenFromCookieHeader(input.cookieHeader);
  if (!token) {
    return {
      status: 200,
      body: {
        ok: true,
        authenticated: false,
      },
    };
  }

  const session = getSessionByToken(token, { now: input.now, touch: true });
  if (!session) {
    return {
      status: 200,
      body: {
        ok: true,
        authenticated: false,
      },
    };
  }

  const user = getUser(session.user_id);
  if (!user) {
    return {
      status: 401,
      body: {
        ok: false,
        error: "Session user not found",
        code: UNAUTHENTICATED_CODE,
      },
    };
  }

  return {
    status: 200,
    body: {
      ok: true,
      authenticated: true,
      user: toUserView(user),
      session: toSessionView(session),
      csrf: buildCsrfView(session.id),
    },
  };
}

export function handleFirstPartyCsrfVerifyRequest(
  input: VerifyCsrfRequestInput,
): FirstPartyAuthRouteResponse {
  const providerGuard = guardFirstPartyAuthProvider(input.authProvider);
  if (providerGuard) return providerGuard;

  const originGuard = validateFirstPartyMutationOrigin({
    origin: input.origin,
    expectedOrigin: input.expectedOrigin,
    requestUrl: input.requestUrl,
    allowedOrigins: input.allowedOrigins,
    allowMissingOrigin: input.allowMissingMutationOrigin,
  });
  if (originGuard) return originGuard;

  const token = readSessionTokenFromCookieHeader(input.cookieHeader);
  if (!token) {
    return {
      status: 401,
      body: {
        ok: false,
        error: "Session cookie required",
        code: UNAUTHENTICATED_CODE,
      },
    };
  }

  const session = getSessionByToken(token, { now: input.now });
  if (!session) {
    return {
      status: 401,
      body: {
        ok: false,
        error: "Session not found",
        code: UNAUTHENTICATED_CODE,
      },
    };
  }

  return {
    status: 200,
    body: {
      ok: true,
      valid: verifyCsrfBundle(
        { token: input.csrfToken, hash: input.csrfHash },
        session.id,
      ),
    },
  };
}

export function handleSignUpRequest(input: {
  email: string;
  password: string;
  name?: string;
}): FirstPartyAuthRouteResponse {
  const result = signUpUser({
    email: input.email,
    password: input.password,
    name: input.name,
  });

  if (!result.ok) {
    return {
      status: 400,
      body: {
        ok: false,
        error: result.error,
        message: "message" in result ? result.message : undefined,
      },
    };
  }

  return {
    status: 200,
    body: {
      ok: true,
      user: { id: result.user.id, email: result.user.email, name: result.user.name },
      verificationToken: result.verificationToken,
    },
  };
}

export function handleVerifyEmailRequest(input: {
  token: string;
}): FirstPartyAuthRouteResponse {
  const result = verifyUserEmail(input.token);

  if (!result.ok) {
    return {
      status: 400,
      body: {
        ok: false,
        error: "invalid_token",
        message: "Verification token is invalid or expired.",
      },
    };
  }

  return {
    status: 200,
    body: {
      ok: true,
      userId: result.userId,
    },
  };
}

export function createFirstPartyAuthRouteHandlers(
  options: FirstPartyAuthRouteOptions = {},
): {
  login: (c: Context) => Promise<Response>;
  logout: (c: Context) => Response;
  session: (c: Context) => Response;
  verifyCsrf: (c: Context) => Promise<Response>;
  signup: (c: Context) => Promise<Response>;
  verifyEmail: (c: Context) => Response | Promise<Response>;
} {
  return {
    login: async (c) => {
      const body = await readJsonBody(c);
      if (
        !body ||
        typeof body.email !== "string" ||
        typeof body.password !== "string"
      ) {
        return jsonRouteResponse(c, {
          status: 400,
          body: {
            ok: false,
            error: "email and password are required",
            code: INVALID_REQUEST_CODE,
          },
        });
      }

      return jsonRouteResponse(
        c,
        handleFirstPartyLoginRequest({
          ...options,
          email: body.email,
          password: body.password,
          orgId: typeof body.orgId === "string" ? body.orgId : null,
          origin: c.req.header("origin"),
          requestUrl: c.req.url,
          userAgent: c.req.header("user-agent"),
          ipAddress:
            c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip"),
        }),
      );
    },
    logout: (c) =>
      jsonRouteResponse(
        c,
        handleFirstPartyLogoutRequest({
          ...options,
          cookieHeader: c.req.header("cookie"),
          origin: c.req.header("origin"),
          requestUrl: c.req.url,
        }),
      ),
    session: (c) =>
      jsonRouteResponse(
        c,
        handleFirstPartySessionRequest({
          ...options,
          cookieHeader: c.req.header("cookie"),
        }),
      ),
    verifyCsrf: async (c) => {
      const body = await readJsonBody(c);
      const csrfToken =
        typeof body?.csrfToken === "string"
          ? body.csrfToken
          : c.req.header(X_CSRF_TOKEN_HEADER);
      const csrfHash =
        typeof body?.csrfHash === "string"
          ? body.csrfHash
          : c.req.header(X_CSRF_HASH_HEADER);

      if (!csrfToken || !csrfHash) {
        return jsonRouteResponse(c, {
          status: 400,
          body: {
            ok: false,
            error: "csrfToken and csrfHash are required",
            code: INVALID_REQUEST_CODE,
          },
        });
      }

      return jsonRouteResponse(
        c,
        handleFirstPartyCsrfVerifyRequest({
          ...options,
          cookieHeader: c.req.header("cookie"),
          origin: c.req.header("origin"),
          requestUrl: c.req.url,
          csrfToken,
          csrfHash,
        }),
      );
    },
    signup: async (c) => {
      const body = await readJsonBody(c);
      if (
        !body ||
        typeof body.email !== "string" ||
        typeof body.password !== "string"
      ) {
        return jsonRouteResponse(c, {
          status: 400,
          body: {
            ok: false,
            error: "email and password are required",
            code: INVALID_REQUEST_CODE,
          },
        });
      }

      const result = signUpUser({
        email: body.email,
        password: body.password,
        name: typeof body.name === "string" ? body.name : undefined,
      });

      if (!result.ok) {
        return jsonRouteResponse(c, {
          status: 400,
          body: {
            ok: false,
            error: result.error,
            message: "message" in result ? result.message : undefined,
          },
        });
      }

      const baseUrl = options.expectedOrigin ?? "http://localhost:3457";
      sendVerificationEmail(result.user.email, result.verificationToken, baseUrl).catch(() => {});

      return jsonRouteResponse(c, {
        status: 200,
        body: {
          ok: true,
          user: { id: result.user.id, email: result.user.email, name: result.user.name },
          verificationToken: result.verificationToken,
        },
      });
    },
    verifyEmail: (c) => {
      const token = c.req.query("token");
      if (!token) {
        return c.html(renderVerificationPage(false, "Missing verification token."));
      }

      const result = verifyUserEmail(token);

      if (!result.ok) {
        return c.html(
          renderVerificationPage(false, "This verification link is invalid or has expired."),
        );
      }

      return c.html(renderVerificationPage(true));
    },
  };
}

function buildCsrfView(sessionId: string): CsrfBundle {
  return issueCsrfBundle(sessionId);
}

function toUserView(user: User): FirstPartyAuthUserView {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
  };
}

function toSessionView(session: HostedSession): FirstPartyAuthSessionView {
  return {
    id: session.id,
    orgId: session.org_id,
    expiresAt: session.expires_at,
    lastSeenAt: session.last_seen_at,
  };
}

async function readJsonBody(
  c: Context,
): Promise<Record<string, unknown> | null> {
  try {
    return (await c.req.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function jsonRouteResponse(
  c: Context,
  response: FirstPartyAuthRouteResponse,
): Response {
  if (response.headers) {
    for (const [name, value] of Object.entries(response.headers)) {
      c.header(name, value);
    }
  }
  return c.json(response.body, { status: response.status });
}

function renderVerificationPage(success: boolean, errorMessage?: string): string {
  const favicon = `<link rel="icon" type="image/svg+xml" href="/favicon.svg" />`;
  const logo = `<div style="margin-bottom:24px;"><svg width="32" height="32" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="48" height="48" rx="10" fill="#0d1117"/><path d="M6 24h6l5-12 8 30 6-18h11" stroke="#863bff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="37" cy="24" r="3" fill="#863bff"/><circle cx="14" cy="24" r="2" fill="#863bff"/></svg><div style="color:#e6edf3;font-size:1.2rem;font-weight:700;margin-top:8px;letter-spacing:-0.02em;">Pulse</div></div>`;

  if (success) {
    return `<!DOCTYPE html>
<html><head><title>Email Verified — Pulse</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
${favicon}
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0d1117;color:#e6edf3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh}
.card{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:40px;max-width:420px;width:90%;text-align:center}
.check{width:56px;height:56px;border-radius:50%;background:#238636;display:inline-flex;align-items:center;justify-content:center;margin-bottom:20px}
.check svg{width:28px;height:28px;fill:none;stroke:#fff;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round}
h1{color:#e6edf3;font-size:1.5rem;margin-bottom:8px;letter-spacing:-0.02em}
p{color:#8b949e;font-size:0.9rem;line-height:1.5;margin-bottom:24px}
.btn{display:inline-block;padding:12px 28px;background:#238636;color:#fff;text-decoration:none;border-radius:8px;font-size:0.95rem;font-weight:600;transition:background 0.15s}
.btn:hover{background:#2ea043}
</style>
</head><body><div class="card">
${logo}
<div class="check"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg></div>
<h1>Email verified</h1>
<p>Your email has been verified successfully. You can now sign in to your Pulse account.</p>
<a href="/login" class="btn">Sign in to Pulse</a>
</div></body></html>`;
  }

  return `<!DOCTYPE html>
<html><head><title>Verification Failed — Pulse</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
${favicon}
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0d1117;color:#e6edf3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh}
.card{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:40px;max-width:420px;width:90%;text-align:center}
.x-mark{width:56px;height:56px;border-radius:50%;background:rgba(248,81,73,0.15);display:inline-flex;align-items:center;justify-content:center;margin-bottom:20px}
.x-mark svg{width:28px;height:28px;fill:none;stroke:#f85149;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round}
h1{color:#e6edf3;font-size:1.5rem;margin-bottom:8px;letter-spacing:-0.02em}
p{color:#8b949e;font-size:0.9rem;line-height:1.5;margin-bottom:24px}
.btn{display:inline-block;padding:12px 28px;background:#21262d;color:#e6edf3;text-decoration:none;border:1px solid #30363d;border-radius:8px;font-size:0.95rem;font-weight:600;transition:background 0.15s}
.btn:hover{background:#30363d}
</style>
</head><body><div class="card">
${logo}
<div class="x-mark"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></div>
<h1>Verification failed</h1>
<p>${errorMessage || "This verification link is invalid or has expired."}</p>
<a href="/signup" class="btn">Create a new account</a>
</div></body></html>`;
}
