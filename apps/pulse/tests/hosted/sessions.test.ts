import { describe, expect, it } from "vitest";

import { cleanupSqliteFiles, createTempHostedDbPath } from "./temp-db.js";

const dbPath = createTempHostedDbPath("pulse-sessions");
process.env.HOSTED_DB_PATH = dbPath;

const { createOrg, createUser, getHostedDb } =
  await import("../../hosted/db.js");
const {
  AUTH_PROVIDER_NAMES,
  CLAWNET_AUTH_PROVIDER,
  FIRST_PARTY_AUTH_PROVIDER,
  cleanupSessions,
  createSession,
  getSessionById,
  getSessionByToken,
  hashSessionToken,
  initSessionsSchema,
  isFirstPartyAuthEnabled,
  revokeSessionByToken,
  resolveAuthProviderName,
  rotateSession,
} = await import("../../hosted/sessions.js");

function createIdentity(label: string) {
  const org = createOrg({ name: `${label} Org` });
  const user = createUser({
    email: `${label}-${Math.random().toString(16).slice(2)}@example.test`,
    name: `${label} User`,
    passwordHash: "hash",
  });
  return { org, user };
}

describe("first-party sessions", () => {
  it("resolves auth provider flags with ClawNet as the default rollback path", () => {
    expect(AUTH_PROVIDER_NAMES).toEqual([
      CLAWNET_AUTH_PROVIDER,
      FIRST_PARTY_AUTH_PROVIDER,
    ]);
    expect(resolveAuthProviderName(undefined)).toBe(CLAWNET_AUTH_PROVIDER);
    expect(resolveAuthProviderName("")).toBe(CLAWNET_AUTH_PROVIDER);
    expect(resolveAuthProviderName(CLAWNET_AUTH_PROVIDER)).toBe(
      CLAWNET_AUTH_PROVIDER,
    );
    expect(resolveAuthProviderName(FIRST_PARTY_AUTH_PROVIDER)).toBe(
      FIRST_PARTY_AUTH_PROVIDER,
    );
    expect(isFirstPartyAuthEnabled(CLAWNET_AUTH_PROVIDER)).toBe(false);
    expect(isFirstPartyAuthEnabled(FIRST_PARTY_AUTH_PROVIDER)).toBe(true);
    expect(() => resolveAuthProviderName("other")).toThrow(
      "Unknown AUTH_PROVIDER",
    );
  });

  it("initializes the additive sessions table", () => {
    initSessionsSchema();

    const table = getHostedDb()
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sessions'",
      )
      .get() as { name: string } | undefined;

    expect(table?.name).toBe("sessions");
  });

  it("creates sessions without storing the raw token", () => {
    const { org, user } = createIdentity("create-session");
    const { session, token } = createSession({
      userId: user.id,
      orgId: org.id,
      userAgent: "vitest",
      ipAddress: "127.0.0.1",
    });

    const stored = getHostedDb()
      .prepare("SELECT * FROM sessions WHERE id = ?")
      .get(session.id) as Record<string, unknown>;

    expect(token).toMatch(/^ps_/);
    expect(stored.token_hash).toBe(hashSessionToken(token));
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(getSessionByToken(token)).toMatchObject({
      id: session.id,
      user_id: user.id,
      org_id: org.id,
      user_agent: "vitest",
      ip_address: "127.0.0.1",
    });
  });

  it("does not return expired sessions", () => {
    const { org, user } = createIdentity("expired-session");
    const now = new Date("2026-01-01T00:00:00.000Z");
    const { session, token } = createSession({
      userId: user.id,
      orgId: org.id,
      ttlSeconds: 1,
      now,
    });

    expect(getSessionByToken(token, { now })).toMatchObject({ id: session.id });
    expect(
      getSessionByToken(token, { now: new Date("2026-01-01T00:00:02.000Z") }),
    ).toBeNull();
  });

  it("revokes sessions without deleting their audit trail", () => {
    const { org, user } = createIdentity("revoked-session");
    const { session, token } = createSession({
      userId: user.id,
      orgId: org.id,
    });

    const revoked = revokeSessionByToken(token, {
      now: new Date("2026-02-01T12:00:00.000Z"),
    });

    expect(revoked).toMatchObject({
      id: session.id,
      revoked_at: "2026-02-01T12:00:00.000Z",
    });
    expect(getSessionByToken(token)).toBeNull();
    expect(getSessionById(session.id)?.token_hash).toBe(
      hashSessionToken(token),
    );
  });

  it("rotates sessions by revoking the old token and issuing a new token", () => {
    const { org, user } = createIdentity("rotated-session");
    const { session: original, token: oldToken } = createSession({
      userId: user.id,
      orgId: org.id,
      userAgent: "old-agent",
      ipAddress: "10.0.0.1",
    });

    const rotated = rotateSession({
      token: oldToken,
      userAgent: "new-agent",
      ipAddress: "10.0.0.2",
      now: new Date("2026-03-01T12:00:00.000Z"),
    });

    expect(rotated).not.toBeNull();
    expect(rotated!.token).not.toBe(oldToken);
    expect(getSessionByToken(oldToken)).toBeNull();
    expect(
      getSessionByToken(rotated!.token, {
        now: new Date("2026-03-01T12:00:00.000Z"),
      }),
    ).toMatchObject({
      id: rotated!.session.id,
      user_id: user.id,
      org_id: org.id,
      user_agent: "new-agent",
      ip_address: "10.0.0.2",
      rotated_from_session_id: original.id,
    });
    expect(getSessionById(original.id)).toMatchObject({
      revoked_at: "2026-03-01T12:00:00.000Z",
      rotated_to_session_id: rotated!.session.id,
    });
  });

  it("cleans up expired and old revoked sessions while preserving active sessions", () => {
    const { org, user } = createIdentity("cleanup-session");
    const cleanupTime = new Date("2026-04-01T00:00:00.000Z");
    const expired = createSession({
      userId: user.id,
      orgId: org.id,
      ttlSeconds: 1,
      now: new Date("2026-03-01T00:00:00.000Z"),
    });
    const revoked = createSession({
      userId: user.id,
      orgId: org.id,
      now: cleanupTime,
    });
    const active = createSession({
      userId: user.id,
      orgId: org.id,
      now: cleanupTime,
    });

    revokeSessionByToken(revoked.token, {
      now: new Date("2026-03-15T00:00:00.000Z"),
    });

    const removed = cleanupSessions({
      now: cleanupTime,
      revokedBefore: new Date("2026-03-20T00:00:00.000Z"),
    });

    expect(removed).toBeGreaterThanOrEqual(2);
    expect(getSessionById(expired.session.id)).toBeNull();
    expect(getSessionById(revoked.session.id)).toBeNull();
    expect(getSessionById(active.session.id)).toMatchObject({
      id: active.session.id,
    });
  });
});

process.on("exit", () => {
  cleanupSqliteFiles(dbPath);
});
