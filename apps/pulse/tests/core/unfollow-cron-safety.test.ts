import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  loadState: vi.fn(),
  saveState: vi.fn(),
  xUnfollow: vi.fn(),
}));

vi.mock("../../src/core/persona.js", () => ({
  getConfig: mocks.getConfig,
}));

vi.mock("../../src/core/state.js", () => ({
  loadState: mocks.loadState,
  saveState: mocks.saveState,
}));

vi.mock("../../src/platforms/x-follow.js", () => ({
  xUnfollow: mocks.xUnfollow,
}));

const { runUnfollowCron } = await import("../../src/core/unfollow-cron.js");

const originalEnv = {
  HOSTED_DB_PATH: process.env.HOSTED_DB_PATH,
  NODE_ENV: process.env.NODE_ENV,
  PULSE_ALLOW_FOLLOW_CHURN: process.env.PULSE_ALLOW_FOLLOW_CHURN,
};

function buildState() {
  return {
    kols: [],
    records: [
      {
        username: "alice",
        platformId: "user_1",
        signal: "reply",
        confidence: 88,
        followedAt: "2026-05-01T00:00:00.000Z",
        unfollowAt: "2026-05-02T00:00:00.000Z",
        status: "active" as const,
      },
    ],
  };
}

describe("unfollow cron safety gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.HOSTED_DB_PATH = originalEnv.HOSTED_DB_PATH;
    process.env.NODE_ENV = originalEnv.NODE_ENV;
    process.env.PULSE_ALLOW_FOLLOW_CHURN = originalEnv.PULSE_ALLOW_FOLLOW_CHURN;
    mocks.getConfig.mockReturnValue({ autoFollow: { enabled: true } });
    mocks.loadState.mockReturnValue(buildState());
    mocks.xUnfollow.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    process.env.HOSTED_DB_PATH = originalEnv.HOSTED_DB_PATH;
    process.env.NODE_ENV = originalEnv.NODE_ENV;
    process.env.PULSE_ALLOW_FOLLOW_CHURN = originalEnv.PULSE_ALLOW_FOLLOW_CHURN;
  });

  it("stays disabled by default in hosted production", async () => {
    process.env.HOSTED_DB_PATH = "/tmp/pulse-hosted.db";
    process.env.NODE_ENV = "production";
    delete process.env.PULSE_ALLOW_FOLLOW_CHURN;

    await expect(runUnfollowCron()).resolves.toEqual({ unfollowed: 0 });
    expect(mocks.xUnfollow).not.toHaveBeenCalled();
    expect(mocks.saveState).not.toHaveBeenCalled();
  });

  it("runs when hosted production opt-in is explicit", async () => {
    process.env.HOSTED_DB_PATH = "/tmp/pulse-hosted.db";
    process.env.NODE_ENV = "production";
    process.env.PULSE_ALLOW_FOLLOW_CHURN = "true";

    await expect(runUnfollowCron()).resolves.toEqual({ unfollowed: 1 });
    expect(mocks.xUnfollow).toHaveBeenCalledWith("user_1");
    expect(mocks.saveState).toHaveBeenCalled();
  });
});
