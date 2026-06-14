import { describe, expect, it } from "vitest";

import { cleanupSqliteFiles, createTempHostedDbPath } from "./temp-db.js";

const dbPath = createTempHostedDbPath("pulse-first-party-auth");
process.env.HOSTED_DB_PATH = dbPath;

const { addMembership, createOrg, createUser } = await import(
  "../../hosted/db.js"
);
const { createSession, getSessionById } =
  await import("../../hosted/sessions.js");
const { createFirstPartyUser } = await import("../../hosted/password-auth.js");
const {
  buildClearSessionCookieHeader,
  buildSessionSetCookieHeader,
  firstPartyLogin,
  issueCsrfBundle,
  logoutByToken,
  shapeLoginResult,
  verifyCsrfBundle,
} = await import("../../hosted/first-party-auth.js");

// ─── CSRF Bundle ──────────────────────────────────────────────────────────────

describe("issueCsrfBundle", () => {
  it("produces a token and a session-bound hash", () => {
    const sessionId = "ses_abc123";
    const bundle = issueCsrfBundle(sessionId);
    expect(bundle.token).toBeTruthy();
    expect(bundle.hash).toBeTruthy();
    expect(bundle.token).not.toBe(bundle.hash);
  });

  it("different sessions produce different hashes for the same token shape", () => {
    const a = issueCsrfBundle("ses_aaa");
    const b = issueCsrfBundle("ses_bbb");
    expect(a.hash).not.toBe(b.hash);
  });
});

describe("verifyCsrfBundle", () => {
  it("accepts a bundle against its own session", () => {
    const sessionId = "ses_verify1";
    const bundle = issueCsrfBundle(sessionId);
    expect(verifyCsrfBundle(bundle, sessionId)).toBe(true);
  });

  it("rejects a bundle replayed against a different session", () => {
    const bundle = issueCsrfBundle("ses_real");
    expect(verifyCsrfBundle(bundle, "ses_other")).toBe(false);
  });

  it("rejects a tampered token", () => {
    const sessionId = "ses_tamper";
    const bundle = issueCsrfBundle(sessionId);
    expect(verifyCsrfBundle({ ...bundle, token: "bad" }, sessionId)).toBe(
      false,
    );
  });

  it("rejects a tampered hash", () => {
    const sessionId = "ses_tamper2";
    const bundle = issueCsrfBundle(sessionId);
    expect(
      verifyCsrfBundle({ ...bundle, hash: "0".repeat(64) }, sessionId),
    ).toBe(false);
  });
});

// ─── Cookie Headers ───────────────────────────────────────────────────────────

describe("buildSessionSetCookieHeader", () => {
  it("includes the token and session cookie attributes", () => {
    const header = buildSessionSetCookieHeader("ps_token123", {
      isProduction: false,
    });
    expect(header).toContain("pulse_session=ps_token123");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");
    expect(header).not.toContain("Secure");
  });

  it("adds Secure flag in production", () => {
    const header = buildSessionSetCookieHeader("ps_token456", {
      isProduction: true,
    });
    expect(header).toContain("Secure");
  });

  it("respects a custom maxAge", () => {
    const header = buildSessionSetCookieHeader("ps_tok", {
      isProduction: false,
      maxAge: 300,
    });
    expect(header).toContain("Max-Age=300");
  });
});

describe("buildClearSessionCookieHeader", () => {
  it("sets Max-Age=0 to expire the cookie immediately", () => {
    const header = buildClearSessionCookieHeader(false);
    expect(header).toContain("Max-Age=0");
    expect(header).toContain("pulse_session=");
    expect(header).toContain("HttpOnly");
  });
});

// ─── shapeLoginResult ─────────────────────────────────────────────────────────

describe("shapeLoginResult", () => {
  it("shapes a failure into a LoginFailure with httpStatus 401", () => {
    const result = shapeLoginResult(
      { ok: false, error: "invalid_credentials" },
      { isProduction: false },
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toBe("invalid_credentials");
    expect(result.httpStatus).toBe(401);
  });

  it("shapes a password_not_configured error with httpStatus 401", () => {
    const result = shapeLoginResult(
      { ok: false, error: "password_not_configured" },
      { isProduction: false },
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toBe("password_not_configured");
    expect(result.httpStatus).toBe(401);
  });

  it("shapes a success into a LoginSuccess with cookie header and CSRF bundle", () => {
    const org = createOrg({ name: "Shape Org" });
    const user = createFirstPartyUser({
      email: "shape@example.test",
      password: "shape login password",
    });
    const { session, token } = createSession({
      userId: user.id,
      orgId: org.id,
    });

    const result = shapeLoginResult(
      { ok: true, user, session, token },
      { isProduction: false },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.userId).toBe(user.id);
    expect(result.sessionId).toBe(session.id);
    expect(result).not.toHaveProperty("token");
    expect(result.setCookieHeader).toContain(`pulse_session=${token}`);
    expect(result.csrf.token).toBeTruthy();
    expect(result.csrf.hash).toBeTruthy();
    expect(verifyCsrfBundle(result.csrf, session.id)).toBe(true);
  });
});

// ─── firstPartyLogin ──────────────────────────────────────────────────────────

describe("firstPartyLogin", () => {
  it("returns a LoginSuccess for valid credentials", () => {
    const org = createOrg({ name: "Login Org" });
    const user = createFirstPartyUser({
      email: "fp-login@example.test",
      password: "first party login password",
    });
    addMembership(org.id, user.id, "owner");

    const result = firstPartyLogin({
      email: "fp-login@example.test",
      password: "first party login password",
      orgId: org.id,
      userAgent: "vitest",
      ipAddress: "127.0.0.1",
      now: new Date("2026-05-26T12:00:00.000Z"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.setCookieHeader).toContain("pulse_session=");
    expect(result.setCookieHeader).toContain("HttpOnly");
    expect(verifyCsrfBundle(result.csrf, result.sessionId)).toBe(true);
  });

  it("returns a LoginFailure for wrong password", () => {
    createFirstPartyUser({
      email: "fp-wrong@example.test",
      password: "correct fp password",
    });

    const result = firstPartyLogin({
      email: "fp-wrong@example.test",
      password: "wrong fp password",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toBe("invalid_credentials");
    expect(result.httpStatus).toBe(401);
  });

  it("defaults isProduction to false so Secure flag is absent", () => {
    createFirstPartyUser({
      email: "fp-nosecure@example.test",
      password: "no secure flag password",
    });
    const result = firstPartyLogin({
      email: "fp-nosecure@example.test",
      password: "no secure flag password",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.setCookieHeader).not.toContain("Secure");
  });

  it("includes Secure flag when isProduction is true", () => {
    createFirstPartyUser({
      email: "fp-prod@example.test",
      password: "production mode password",
    });
    const result = firstPartyLogin({
      email: "fp-prod@example.test",
      password: "production mode password",
      isProduction: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.setCookieHeader).toContain("Secure");
  });
});

// ─── logoutByToken ────────────────────────────────────────────────────────────

describe("logoutByToken", () => {
  it("revokes the session and returns a clear-cookie header", () => {
    const user = createUser({
      email: "logout@example.test",
      name: "Logout User",
      passwordHash: "hash",
    });
    const { token, session } = createSession({ userId: user.id });

    const result = logoutByToken(token);

    expect(result.revoked).toBe(true);
    expect(result.session?.id).toBe(session.id);
    expect(result.session?.revoked_at).toBeTruthy();
    expect(result.clearCookieHeader).toContain("Max-Age=0");
    expect(result.clearCookieHeader).toContain("pulse_session=");
  });

  it("returns revoked: false for an unknown token", () => {
    const result = logoutByToken("ps_nonexistent_token");
    expect(result.revoked).toBe(false);
    expect(result.session).toBeNull();
    expect(result.clearCookieHeader).toContain("Max-Age=0");
  });

  it("marks session revoked_at in DB after logout", () => {
    const user = createUser({
      email: "logout-db@example.test",
      name: "Logout DB User",
      passwordHash: "hash",
    });
    const { token, session } = createSession({ userId: user.id });

    logoutByToken(token);

    const stored = getSessionById(session.id);
    expect(stored?.revoked_at).toBeTruthy();
  });
});

process.on("exit", () => {
  cleanupSqliteFiles(dbPath);
});
