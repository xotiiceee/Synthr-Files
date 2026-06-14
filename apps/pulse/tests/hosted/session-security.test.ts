import { describe, expect, it } from "vitest";

import {
  buildSessionCookieOptions,
  generateCsrfToken,
  hashCsrfToken,
  isAllowedOrigin,
  isSessionExpired,
  isSameOrigin,
  parseOrigin,
  serializeSetCookieHeader,
  validateSessionTtl,
  verifyCsrfToken,
} from "../../hosted/session-security.js";

// ─── Cookie options ───────────────────────────────────────────────────────────

describe("buildSessionCookieOptions", () => {
  it("sets secure=true in production", () => {
    const opts = buildSessionCookieOptions(true);
    expect(opts.secure).toBe(true);
  });

  it("sets secure=false outside production", () => {
    const opts = buildSessionCookieOptions(false);
    expect(opts.secure).toBe(false);
  });

  it("always sets httpOnly=true", () => {
    expect(buildSessionCookieOptions(true).httpOnly).toBe(true);
    expect(buildSessionCookieOptions(false).httpOnly).toBe(true);
  });

  it("uses SESSION_COOKIE name and path", () => {
    const opts = buildSessionCookieOptions(false);
    expect(opts.name).toBe("pulse_session");
    expect(opts.path).toBe("/");
  });

  it("defaults to Lax sameSite", () => {
    expect(buildSessionCookieOptions(false).sameSite).toBe("Lax");
  });

  it("accepts maxAge and sameSite overrides", () => {
    const opts = buildSessionCookieOptions(false, {
      maxAge: 300,
      sameSite: "Strict",
    });
    expect(opts.maxAge).toBe(300);
    expect(opts.sameSite).toBe("Strict");
  });
});

describe("serializeSetCookieHeader", () => {
  it("includes all mandatory cookie attributes in production", () => {
    const opts = buildSessionCookieOptions(true);
    const header = serializeSetCookieHeader("tok123", opts);
    expect(header).toContain("pulse_session=tok123");
    expect(header).toContain("Path=/");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain(`Max-Age=${opts.maxAge}`);
  });

  it("omits Secure outside production", () => {
    const opts = buildSessionCookieOptions(false);
    const header = serializeSetCookieHeader("tok123", opts);
    expect(header).not.toContain("Secure");
  });
});

// ─── CSRF helpers ─────────────────────────────────────────────────────────────

describe("generateCsrfToken", () => {
  it("produces a non-empty base64url string", () => {
    const token = generateCsrfToken();
    expect(token).toBeTruthy();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("produces unique tokens on each call", () => {
    const tokens = new Set(Array.from({ length: 50 }, generateCsrfToken));
    expect(tokens.size).toBe(50);
  });
});

describe("hashCsrfToken / verifyCsrfToken", () => {
  const sessionId = "ses_abc123";
  const sessionId2 = "ses_xyz789";

  it("verifies a correctly generated hash", () => {
    const token = generateCsrfToken();
    const hash = hashCsrfToken(token, sessionId);
    expect(verifyCsrfToken(token, hash, sessionId)).toBe(true);
  });

  it("rejects a tampered token", () => {
    const token = generateCsrfToken();
    const hash = hashCsrfToken(token, sessionId);
    const tampered = token.slice(0, -4) + "XXXX";
    expect(verifyCsrfToken(tampered, hash, sessionId)).toBe(false);
  });

  it("rejects a tampered hash", () => {
    const token = generateCsrfToken();
    const hash = hashCsrfToken(token, sessionId);
    const tampered = "0".repeat(hash.length);
    expect(verifyCsrfToken(token, tampered, sessionId)).toBe(false);
  });

  it("rejects a token from a different session", () => {
    const token = generateCsrfToken();
    const hash = hashCsrfToken(token, sessionId);
    expect(verifyCsrfToken(token, hash, sessionId2)).toBe(false);
  });

  it("rejects empty inputs without throwing", () => {
    expect(verifyCsrfToken("", "somehash", sessionId)).toBe(false);
    expect(verifyCsrfToken("sometoken", "", sessionId)).toBe(false);
    expect(verifyCsrfToken("sometoken", "somehash", "")).toBe(false);
  });

  it("produces deterministic hashes for the same inputs", () => {
    const token = generateCsrfToken();
    expect(hashCsrfToken(token, sessionId)).toBe(
      hashCsrfToken(token, sessionId),
    );
  });

  it("produces distinct hashes for distinct sessions", () => {
    const token = generateCsrfToken();
    expect(hashCsrfToken(token, sessionId)).not.toBe(
      hashCsrfToken(token, sessionId2),
    );
  });
});

// ─── Origin / same-site validation ───────────────────────────────────────────

describe("parseOrigin", () => {
  it("extracts scheme+host from a URL", () => {
    expect(parseOrigin("https://app.example.com/path?q=1")).toBe(
      "https://app.example.com",
    );
  });

  it("includes non-default ports", () => {
    expect(parseOrigin("http://localhost:3000/api")).toBe(
      "http://localhost:3000",
    );
  });

  it("returns null for malformed URLs", () => {
    expect(parseOrigin("not-a-url")).toBeNull();
    expect(parseOrigin("")).toBeNull();
  });
});

describe("isSameOrigin", () => {
  const expected = "https://pulse.example.com";

  it("returns true for matching origin", () => {
    expect(isSameOrigin("https://pulse.example.com", expected)).toBe(true);
  });

  it("returns true for matching origin with trailing path", () => {
    expect(isSameOrigin("https://pulse.example.com/login", expected)).toBe(
      true,
    );
  });

  it("returns false for different subdomain", () => {
    expect(isSameOrigin("https://other.example.com", expected)).toBe(false);
  });

  it("returns false for different scheme", () => {
    expect(isSameOrigin("http://pulse.example.com", expected)).toBe(false);
  });

  it("returns false for different port", () => {
    expect(isSameOrigin("https://pulse.example.com:8443", expected)).toBe(
      false,
    );
  });

  it("returns false for null origin by default", () => {
    expect(isSameOrigin(null, expected)).toBe(false);
    expect(isSameOrigin(undefined, expected)).toBe(false);
  });

  it("returns true for null origin when allowMissingOrigin is set", () => {
    expect(isSameOrigin(null, expected, { allowMissingOrigin: true })).toBe(
      true,
    );
  });
});

describe("isAllowedOrigin", () => {
  const allowed = ["https://pulse.example.com", "https://admin.example.com"];

  it("returns true when origin is in the allowlist", () => {
    expect(isAllowedOrigin("https://pulse.example.com", allowed)).toBe(true);
    expect(isAllowedOrigin("https://admin.example.com", allowed)).toBe(true);
  });

  it("returns false when origin is not in the allowlist", () => {
    expect(isAllowedOrigin("https://evil.example.com", allowed)).toBe(false);
  });

  it("returns false for null/undefined origin", () => {
    expect(isAllowedOrigin(null, allowed)).toBe(false);
    expect(isAllowedOrigin(undefined, allowed)).toBe(false);
  });

  it("handles empty allowlist", () => {
    expect(isAllowedOrigin("https://pulse.example.com", [])).toBe(false);
  });
});

// ─── Session TTL validation ───────────────────────────────────────────────────

describe("validateSessionTtl", () => {
  const base = new Date("2026-06-01T12:00:00.000Z");

  it("marks a future expiry as valid", () => {
    const expiresAt = new Date(base.getTime() + 3600 * 1000).toISOString();
    const result = validateSessionTtl(expiresAt, base);
    expect(result.valid).toBe(true);
    expect(result.expired).toBe(false);
    expect(result.remainingMs).toBeGreaterThan(0);
  });

  it("marks a past expiry as expired", () => {
    const expiresAt = new Date(base.getTime() - 1000).toISOString();
    const result = validateSessionTtl(expiresAt, base);
    expect(result.valid).toBe(false);
    expect(result.expired).toBe(true);
    expect(result.remainingMs).toBe(0);
  });

  it("returns correct remainingMs", () => {
    const expiresAt = new Date(base.getTime() + 5000).toISOString();
    const result = validateSessionTtl(expiresAt, base);
    expect(result.remainingMs).toBe(5000);
  });

  it("exposes the parsed expiresAt Date", () => {
    const iso = new Date(base.getTime() + 1000).toISOString();
    const result = validateSessionTtl(iso, base);
    expect(result.expiresAt.toISOString()).toBe(iso);
  });

  it("fails closed for malformed expiry values", () => {
    const result = validateSessionTtl("not-a-date", base);
    expect(result.valid).toBe(false);
    expect(result.expired).toBe(true);
    expect(result.remainingMs).toBe(0);
    expect(Number.isNaN(result.expiresAt.getTime())).toBe(true);
  });
});

describe("isSessionExpired", () => {
  const base = new Date("2026-06-01T12:00:00.000Z");

  it("returns false for a session that has not yet expired", () => {
    const future = new Date(base.getTime() + 1000).toISOString();
    expect(isSessionExpired(future, base)).toBe(false);
  });

  it("returns true for a session that has expired", () => {
    const past = new Date(base.getTime() - 1000).toISOString();
    expect(isSessionExpired(past, base)).toBe(true);
  });

  it("treats exact expiry moment as expired", () => {
    expect(isSessionExpired(base.toISOString(), base)).toBe(true);
  });
});
