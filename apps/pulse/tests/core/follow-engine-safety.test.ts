import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  xFollow: vi.fn(),
  checkFollowRateLimit: vi.fn(() => ({ ok: true, remaining: 15 })),
  loadState: vi.fn(() => ({ records: [], kols: [] })),
  saveState: vi.fn(),
}));

vi.mock("../../src/core/persona.js", () => ({
  getConfig: mocks.getConfig,
}));

vi.mock("../../src/platforms/x-follow.js", () => ({
  xFollow: mocks.xFollow,
  checkFollowRateLimit: mocks.checkFollowRateLimit,
}));

vi.mock("../../src/core/state.js", () => ({
  loadState: mocks.loadState,
  saveState: mocks.saveState,
}));

const { autoFollowUser, shouldAutoFollow } =
  await import("../../src/core/follow-engine.js");

const originalEnv = {
  HOSTED_DB_PATH: process.env.HOSTED_DB_PATH,
  NODE_ENV: process.env.NODE_ENV,
  PULSE_ALLOW_FOLLOW_CHURN: process.env.PULSE_ALLOW_FOLLOW_CHURN,
};

function baseConfig() {
  return {
    autoFollow: {
      enabled: true,
      dailyCap: 15,
      minConfidence: 70,
      minFollowerCount: 50,
      autoUnfollowDays: 14,
      signals: {
        repost: true,
        reply: true,
        tag: true,
        mention_positive: true,
      },
    },
  };
}

describe("follow-engine safety gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.HOSTED_DB_PATH = originalEnv.HOSTED_DB_PATH;
    process.env.NODE_ENV = originalEnv.NODE_ENV;
    process.env.PULSE_ALLOW_FOLLOW_CHURN = originalEnv.PULSE_ALLOW_FOLLOW_CHURN;
    mocks.getConfig.mockReturnValue(baseConfig());
    mocks.xFollow.mockResolvedValue({ ok: true });
    mocks.checkFollowRateLimit.mockReturnValue({ ok: true, remaining: 15 });
    mocks.loadState.mockReturnValue({ records: [], kols: [] });
  });

  afterEach(() => {
    process.env.HOSTED_DB_PATH = originalEnv.HOSTED_DB_PATH;
    process.env.NODE_ENV = originalEnv.NODE_ENV;
    process.env.PULSE_ALLOW_FOLLOW_CHURN = originalEnv.PULSE_ALLOW_FOLLOW_CHURN;
  });

  it("disables follow execution by default in hosted production", async () => {
    process.env.HOSTED_DB_PATH = "/tmp/pulse-hosted.db";
    process.env.NODE_ENV = "production";
    delete process.env.PULSE_ALLOW_FOLLOW_CHURN;

    await expect(
      shouldAutoFollow({
        username: "alice",
        platformId: "user_1",
        signal: "reply",
        confidence: 90,
        followerCount: 100,
      }),
    ).resolves.toBe(false);

    await expect(
      autoFollowUser({
        username: "alice",
        platformId: "user_1",
        signal: "reply",
        confidence: 90,
      }),
    ).resolves.toEqual({
      ok: false,
      error: "hosted_production_default_disabled",
    });

    expect(mocks.xFollow).not.toHaveBeenCalled();
  });

  it("allows explicit hosted production opt-in", async () => {
    process.env.HOSTED_DB_PATH = "/tmp/pulse-hosted.db";
    process.env.NODE_ENV = "production";
    process.env.PULSE_ALLOW_FOLLOW_CHURN = "1";

    await expect(
      shouldAutoFollow({
        username: "alice",
        platformId: "user_1",
        signal: "reply",
        confidence: 90,
        followerCount: 100,
      }),
    ).resolves.toBe(true);

    await expect(
      autoFollowUser({
        username: "alice",
        platformId: "user_1",
        signal: "reply",
        confidence: 90,
      }),
    ).resolves.toEqual({ ok: true });

    expect(mocks.xFollow).toHaveBeenCalledWith("user_1");
    expect(mocks.saveState).toHaveBeenCalled();
  });
});
