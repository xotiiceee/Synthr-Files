import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cleanupSqliteFiles, createTempHostedDbPath } from "./temp-db.js";

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  reply: vi.fn(),
  like: vi.fn(),
  isConfigured: vi.fn(),
}));

vi.mock("../../src/platforms/x.js", () => ({
  x: {
    isConfigured: mocks.isConfigured,
    post: mocks.post,
    reply: mocks.reply,
    like: mocks.like,
  },
  uploadMedia: vi.fn(),
  setMediaAltText: vi.fn(),
}));

vi.mock("../../src/platforms/x-follow.js", () => ({
  xFollow: vi.fn(),
  xUnfollow: vi.fn(),
}));

const dbPath = createTempHostedDbPath("pulse-x-write-safety");
process.env.HOSTED_DB_PATH = dbPath;

const { runInContext } = await import("../../hosted/context.js");
const { getCircuitBreaker, setSafetyControl } = await import(
  "../../hosted/account-safety.js"
);
const { installHostedXWriteSafetyHooks } = await import(
  "../../hosted/x-write-safety.js"
);
const { getXWriteClient, withXWriteUsage } = await import(
  "../../src/platforms/x-write-client.js"
);

describe("hosted X write safety hooks", () => {
  let uninstall: (() => void) | null = null;
  const originalPostLimit = process.env.PULSE_X_POSTS_PER_HOUR;
  const originalLikeLimit = process.env.PULSE_X_LIKES_PER_HOUR;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PULSE_X_POSTS_PER_HOUR = "1";
    uninstall = installHostedXWriteSafetyHooks();
  });

  afterEach(() => {
    uninstall?.();
    uninstall = null;
    if (originalPostLimit === undefined) delete process.env.PULSE_X_POSTS_PER_HOUR;
    else process.env.PULSE_X_POSTS_PER_HOUR = originalPostLimit;
    if (originalLikeLimit === undefined) delete process.env.PULSE_X_LIKES_PER_HOUR;
    else process.env.PULSE_X_LIKES_PER_HOUR = originalLikeLimit;
  });

  it("blocks hosted X writes when brand safety controls are active", async () => {
    setSafetyControl({
      scopeType: "brand",
      scopeId: "tn_paused",
      controlType: "pause",
      reason: "operator review",
      source: "test",
    });

    const result = await runInContext(
      {
        tenantId: "tn_paused",
        dataDir: "/tmp/tn_paused",
        configPath: "/tmp/tn_paused/pulse.yaml",
        secrets: {},
      },
      () => getXWriteClient().post({ text: "blocked", type: "post" }),
    );

    expect(result).toMatchObject({
      ok: false,
      error:
        "X write blocked by account safety controls: brand:pause:operator review",
    });
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it("enforces idempotent hosted X write rate buckets from operation ids", async () => {
    mocks.post.mockResolvedValue({ ok: true, postId: "post_1" });

    const first = await runInContext(
      {
        tenantId: "tn_rate",
        dataDir: "/tmp/tn_rate",
        configPath: "/tmp/tn_rate/pulse.yaml",
        secrets: {},
      },
      async () => {
        await getXWriteClient().post(
          withXWriteUsage(
            { text: "first", type: "post" },
            { operationId: "op_1" },
          ),
        );
        await getXWriteClient().post(
          withXWriteUsage(
            { text: "duplicate", type: "post" },
            { operationId: "op_1" },
          ),
        );
        return getXWriteClient().post(
          withXWriteUsage(
            { text: "second", type: "post" },
            { operationId: "op_2" },
          ),
        );
      },
    );

    expect(first).toMatchObject({
      ok: false,
      error: expect.stringContaining("X post hourly safety limit reached"),
    });
    expect(mocks.post).toHaveBeenCalledTimes(2);
  });

  it("enforces hosted X like safety buckets from operation ids", async () => {
    process.env.PULSE_X_LIKES_PER_HOUR = "1";
    mocks.like.mockResolvedValue(true);

    const second = await runInContext(
      {
        tenantId: "tn_like_rate",
        dataDir: "/tmp/tn_like_rate",
        configPath: "/tmp/tn_like_rate/pulse.yaml",
        secrets: {},
      },
      async () => {
        await getXWriteClient().like("post-1", { operationId: "like_1" });
        await getXWriteClient().like("post-1", { operationId: "like_1" });
        return getXWriteClient().like("post-2", { operationId: "like_2" });
      },
    );

    expect(second).toBe(false);
    expect(mocks.like).toHaveBeenCalledTimes(2);
  });

  it("opens a circuit breaker when X write failures indicate account risk", async () => {
    mocks.post.mockResolvedValue({
      ok: false,
      error: "X API 429: too many requests",
    });

    await runInContext(
      {
        tenantId: "tn_circuit",
        dataDir: "/tmp/tn_circuit",
        configPath: "/tmp/tn_circuit/pulse.yaml",
        secrets: {},
      },
      () =>
        getXWriteClient().post(
          withXWriteUsage(
            { text: "fails", type: "post" },
            { operationId: "op_fail" },
          ),
        ),
    );

    expect(
      getCircuitBreaker("account", "tn_circuit", "x_write_post"),
    ).toMatchObject({
      state: "open",
      reason: "X API 429: too many requests",
      source: "x-write-client",
    });
  });
});

process.on("exit", () => {
  cleanupSqliteFiles(dbPath);
});
