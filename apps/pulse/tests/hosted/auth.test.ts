import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

vi.mock("../../hosted/db.js", () => ({
  getTenantByApiKey: vi.fn(),
  createTenant: vi.fn(),
  hasPin: vi.fn(),
  getPinHash: vi.fn(),
  setPinHash: vi.fn(),
  storeOtp: vi.fn(),
  getOtp: vi.fn(),
  incrementOtpAttempts: vi.fn(),
  deleteOtp: vi.fn(),
  cleanExpiredOtps: vi.fn(),
  getPinRecoveryEmail: vi.fn(),
}));

import {
  getLegacyPinOtpPosture,
  hashPin,
  verifyPin,
  verifyOtp,
  isPinVerified,
  deductPulseCredits,
  SESSION_MAX_AGE,
  PIN_COOKIE_MAX_AGE,
} from "../../hosted/auth.js";
import { getOtp, deleteOtp, incrementOtpAttempts } from "../../hosted/db.js";
import {
  CLAWNET_AUTH_PROVIDER,
  FIRST_PARTY_AUTH_PROVIDER,
} from "../../hosted/sessions.js";

const mockContext = (cookieHeader?: string) =>
  ({
    req: {
      header: (name: string) => (name === "Cookie" ? (cookieHeader ?? "") : ""),
    },
  }) as any;

const futureIso = () => new Date(Date.now() + 60_000).toISOString();
const pastIso = () => new Date(Date.now() - 1000).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// ─── Constants ───────────────────────────────────────────────────────────────

describe("SESSION_MAX_AGE and PIN_COOKIE_MAX_AGE", () => {
  it("SESSION_MAX_AGE === 1800 (30 min)", () => {
    expect(SESSION_MAX_AGE).toBe(1800);
  });

  it("PIN_COOKIE_MAX_AGE === 300 (5 min)", () => {
    expect(PIN_COOKIE_MAX_AGE).toBe(300);
  });
});

describe("getLegacyPinOtpPosture", () => {
  it("keeps legacy PIN/OTP enabled for ClawNet auth", () => {
    expect(getLegacyPinOtpPosture(CLAWNET_AUTH_PROVIDER)).toEqual({
      authProvider: CLAWNET_AUTH_PROVIDER,
      usesLegacyPinGate: true,
      usesLegacyOtpRecovery: true,
    });
  });

  it("disables legacy PIN/OTP for standalone first-party sessions", () => {
    expect(getLegacyPinOtpPosture(FIRST_PARTY_AUTH_PROVIDER)).toEqual({
      authProvider: FIRST_PARTY_AUTH_PROVIDER,
      usesLegacyPinGate: false,
      usesLegacyOtpRecovery: false,
    });
  });
});

// ─── hashPin ─────────────────────────────────────────────────────────────────

describe("hashPin", () => {
  it('returns "salt:hash" format with correct lengths', () => {
    const result = hashPin("1234");
    const parts = result.split(":");
    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatch(/^[0-9a-f]{32}$/); // 16 bytes → 32 hex chars
    expect(parts[1]).toMatch(/^[0-9a-f]{64}$/); // 32 bytes → 64 hex chars
  });

  it("two calls with same pin produce different salts", () => {
    const h1 = hashPin("test");
    const h2 = hashPin("test");
    expect(h1.split(":")[0]).not.toBe(h2.split(":")[0]);
  });
});

// ─── verifyPin ───────────────────────────────────────────────────────────────

describe("verifyPin", () => {
  it("returns true for correct pin", () => {
    const stored = hashPin("mysecret");
    expect(verifyPin("mysecret", stored)).toBe(true);
  });

  it("returns false for wrong pin", () => {
    const stored = hashPin("correct");
    expect(verifyPin("wrong", stored)).toBe(false);
  });

  it("returns false for malformed stored hash (no colon)", () => {
    expect(verifyPin("1234", "nocolon")).toBe(false);
  });

  it("returns false for empty stored hash", () => {
    expect(verifyPin("1234", "")).toBe(false);
  });
});

// ─── verifyOtp ───────────────────────────────────────────────────────────────

describe("verifyOtp", () => {
  it('no OTP entry → { ok: false } with "No code pending" message', () => {
    vi.mocked(getOtp).mockReturnValue(null as any);
    expect(verifyOtp("t1", "123456")).toEqual({
      ok: false,
      error: "No code pending. Request a new one.",
    });
  });

  it("expired OTP → { ok: false }, calls deleteOtp", () => {
    vi.mocked(getOtp).mockReturnValue({
      code: "123456",
      attempts: 0,
      expires_at: pastIso(),
    } as any);
    const result = verifyOtp("t1", "123456");
    expect(result).toEqual({
      ok: false,
      error: "Code expired. Request a new one.",
    });
    expect(vi.mocked(deleteOtp)).toHaveBeenCalledWith("t1");
  });

  it("too many attempts (>= 5) → { ok: false }, calls deleteOtp", () => {
    vi.mocked(getOtp).mockReturnValue({
      code: "123456",
      attempts: 5,
      expires_at: futureIso(),
    } as any);
    const result = verifyOtp("t1", "123456");
    expect(result).toEqual({
      ok: false,
      error: "Too many attempts. Request a new one.",
    });
    expect(vi.mocked(deleteOtp)).toHaveBeenCalledWith("t1");
  });

  it("wrong code → { ok: false }, calls incrementOtpAttempts, does NOT call deleteOtp", () => {
    // entry.attempts = 0 before increment; error uses that pre-increment value
    vi.mocked(getOtp).mockReturnValue({
      code: "123456",
      attempts: 0,
      expires_at: futureIso(),
    } as any);
    const result = verifyOtp("t1", "999999");
    expect(result).toEqual({
      ok: false,
      error: "Incorrect code. 4 attempts left.",
    });
    expect(vi.mocked(incrementOtpAttempts)).toHaveBeenCalledWith("t1");
    expect(vi.mocked(deleteOtp)).not.toHaveBeenCalled();
  });

  it("correct code → { ok: true }, calls deleteOtp", () => {
    vi.mocked(getOtp).mockReturnValue({
      code: "123456",
      attempts: 0,
      expires_at: futureIso(),
    } as any);
    const result = verifyOtp("t1", "123456");
    expect(result).toEqual({ ok: true });
    expect(vi.mocked(deleteOtp)).toHaveBeenCalledWith("t1");
  });

  it("code with leading/trailing whitespace → trimmed and matches", () => {
    vi.mocked(getOtp).mockReturnValue({
      code: "123456",
      attempts: 0,
      expires_at: futureIso(),
    } as any);
    const result = verifyOtp("t1", "  123456  ");
    expect(result).toEqual({ ok: true });
  });
});

// ─── isPinVerified ───────────────────────────────────────────────────────────

describe("isPinVerified", () => {
  it("returns true when Cookie header contains pulse_pin_verified=1", () => {
    expect(isPinVerified(mockContext("pulse_pin_verified=1"))).toBe(true);
  });

  it("returns false when cookie header is absent", () => {
    expect(isPinVerified(mockContext())).toBe(false);
  });

  it('returns false when cookie value is not "1"', () => {
    expect(isPinVerified(mockContext("pulse_pin_verified=0"))).toBe(false);
  });

  it("works correctly with multiple cookies in header", () => {
    expect(
      isPinVerified(
        mockContext("session=abc; pulse_pin_verified=1; other=xyz"),
      ),
    ).toBe(true);
  });
});

// ─── deductPulseCredits ─────────────────────────────────────────────────────

describe("deductPulseCredits", () => {
  it("posts the current ClawNet deduction payload and idempotency headers", async () => {
    vi.stubEnv("CLAWNET_API_URL", "https://clawnet.test");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ credits: 98.5 }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    await expect(
      deductPulseCredits("cn-key", 1.5, "pulse:generate_post:gpt-4o-mini"),
    ).resolves.toEqual({
      ok: true,
      remaining: 98.5,
    });

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe("https://clawnet.test/v1/auth/deduct");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      "X-API-Key": "cn-key",
      "Content-Type": "application/json",
    });

    const headers = init?.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toMatch(/^pulse-\d+-[a-z0-9]{8}$/);
    expect(JSON.parse(String(init?.body))).toEqual({
      amount: 1.5,
      reason: "pulse:pulse:generate_post:gpt-4o-mini",
    });
  });

  it("returns ClawNet error messages without throwing on failed deductions", async () => {
    vi.stubEnv("CLAWNET_API_URL", "https://clawnet.test");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "insufficient credits" }), {
            status: 402,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    await expect(
      deductPulseCredits("cn-key", 20, "pulse:thread_generation"),
    ).resolves.toEqual({
      ok: false,
      error: "insufficient credits",
    });
  });
});
