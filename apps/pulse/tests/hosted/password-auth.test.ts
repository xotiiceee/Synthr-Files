import { describe, expect, it } from "vitest";

import { cleanupSqliteFiles, createTempHostedDbPath } from "./temp-db.js";

const dbPath = createTempHostedDbPath("pulse-password-auth");
process.env.HOSTED_DB_PATH = dbPath;

const { addMembership, createOrg, createUser } = await import(
  "../../hosted/db.js"
);
const { getSessionByToken } = await import("../../hosted/sessions.js");
const {
  authenticateFirstPartyPassword,
  createFirstPartyUser,
  hashPassword,
  validatePasswordStrength,
  verifyPassword,
} = await import("../../hosted/password-auth.js");

describe("first-party password auth", () => {
  it("hashes passwords with a versioned scrypt hash", () => {
    const hash = hashPassword("correct horse battery staple", {
      salt: "0123456789abcdef0123456789abcdef",
    });

    expect(hash).toMatch(/^pulse-scrypt-v1:[0-9a-f]+:[0-9a-f]+$/);
    expect(hash).not.toContain("correct horse");
    expect(verifyPassword("correct horse battery staple", hash)).toBe(true);
    expect(verifyPassword("wrong horse battery staple", hash)).toBe(false);
  });

  it("rejects weak passwords before hashing", () => {
    expect(() => validatePasswordStrength("short")).toThrow(
      "Password must be at least 12 characters",
    );
    expect(() => hashPassword("short")).toThrow(
      "Password must be at least 12 characters",
    );
  });

  it("creates first-party users with normalized email and no raw password", () => {
    const user = createFirstPartyUser({
      email: "  OWNER@Example.TEST ",
      name: "Owner",
      password: "standalone product password",
    });

    expect(user.email).toBe("owner@example.test");
    expect(user.password_hash).not.toContain("standalone product password");
    expect(
      verifyPassword("standalone product password", user.password_hash),
    ).toBe(true);
  });

  it("authenticates valid credentials and issues a session", () => {
    const org = createOrg({ name: "Login Org" });
    const user = createFirstPartyUser({
      email: "login@example.test",
      password: "correct login password",
    });
    addMembership(org.id, user.id, "owner");

    const result = authenticateFirstPartyPassword({
      email: " LOGIN@example.test ",
      password: "correct login password",
      orgId: org.id,
      userAgent: "vitest",
      ipAddress: "127.0.0.1",
      now: new Date("2026-05-26T12:00:00.000Z"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected password auth success");
    expect(result.user.id).toBe(user.id);
    expect(
      getSessionByToken(result.token, {
        now: new Date("2026-05-26T12:00:00.000Z"),
      }),
    ).toMatchObject({
      user_id: user.id,
      org_id: org.id,
      user_agent: "vitest",
      ip_address: "127.0.0.1",
    });
  });

  it("denies org-scoped login when the user is not a member of that org", () => {
    const org = createOrg({ name: "Denied Org" });
    createFirstPartyUser({
      email: "cross-org@example.test",
      password: "correct login password",
    });

    const result = authenticateFirstPartyPassword({
      email: "cross-org@example.test",
      password: "correct login password",
      orgId: org.id,
    });

    expect(result).toEqual({ ok: false, error: "org_membership_required" });
  });

  it("does not issue sessions for invalid credentials", () => {
    createFirstPartyUser({
      email: "invalid@example.test",
      password: "correct login password",
    });

    expect(
      authenticateFirstPartyPassword({
        email: "invalid@example.test",
        password: "wrong login password",
      }),
    ).toEqual({ ok: false, error: "invalid_credentials" });
    expect(
      authenticateFirstPartyPassword({
        email: "missing@example.test",
        password: "correct login password",
      }),
    ).toEqual({ ok: false, error: "invalid_credentials" });
  });

  it("distinguishes users without configured first-party passwords", () => {
    createUser({
      email: "legacy@example.test",
      name: "Legacy",
    });

    expect(
      authenticateFirstPartyPassword({
        email: "legacy@example.test",
        password: "correct login password",
      }),
    ).toEqual({ ok: false, error: "password_not_configured" });
  });
});

process.on("exit", () => {
  cleanupSqliteFiles(dbPath);
});
