import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  cleanupSqliteFiles,
  createTempHostedDbPath,
} from "../hosted/temp-db.js";

const dbPath = createTempHostedDbPath("pulse-x-rate-counter-platform");
process.env.HOSTED_DB_PATH = dbPath;

const { runInContext } = await import("../../hosted/context.js");
const { createRuntimeXRateCounterRepository } =
  await import("../../hosted/repositories/runtime-x-rate-counters.js");
const { getXMonthlyPostLimit, x } = await import("../../src/platforms/x.js");

const counters = createRuntimeXRateCounterRepository();

function tenantContext(tenantId: string) {
  return {
    tenantId,
    dataDir: `/tmp/${tenantId}`,
    configPath: `/tmp/${tenantId}/pulse.yaml`,
    secrets: {
      X_API_KEY: "consumer-key",
      X_API_SECRET: "consumer-secret",
      X_ACCESS_TOKEN: "access-token",
      X_ACCESS_TOKEN_SECRET: "access-secret",
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-26T12:00:00.000Z"));
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ data: { id: "tweet_123" } }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
    ),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete process.env.X_MONTHLY_POST_LIMIT;
});

afterAll(() => {
  cleanupSqliteFiles(dbPath);
});

describe("X platform hosted rate counters", () => {
  it("uses an explicit monthly post limit when configured", () => {
    expect(getXMonthlyPostLimit({ X_MONTHLY_POST_LIMIT: "3000" })).toBe(3000);
    expect(getXMonthlyPostLimit({ X_MONTHLY_POST_LIMIT: "bad" })).toBe(1500);
    expect(getXMonthlyPostLimit({})).toBe(1500);
  });

  it("records successful hosted posts in the tenant-scoped SQL monthly counter", async () => {
    await runInContext(tenantContext("tn_x_counter_a"), async () => {
      await expect(
        x.post({ text: "first", type: "post" }),
      ).resolves.toMatchObject({
        ok: true,
        postId: "tweet_123",
      });
      await expect(
        x.reply(
          {
            id: "root_1",
            platform: "x",
            url: "https://x.com/i/status/root_1",
            text: "Root",
            author: "founder",
            topicId: "topic_1",
            createdAt: "2026-05-26T00:00:00.000Z",
            engagement: { likes: 0, replies: 0, reposts: 0 },
          },
          "reply",
        ),
      ).resolves.toMatchObject({
        ok: true,
        postId: "tweet_123",
      });
    });

    await runInContext(tenantContext("tn_x_counter_b"), async () => {
      await expect(
        x.post({ text: "other tenant", type: "post" }),
      ).resolves.toMatchObject({
        ok: true,
        postId: "tweet_123",
      });
    });

    expect(
      counters.getPostCount({
        tenantId: "tn_x_counter_a",
        monthKey: "2026-05",
      }),
    ).toBe(2);
    expect(
      counters.getPostCount({
        tenantId: "tn_x_counter_b",
        monthKey: "2026-05",
      }),
    ).toBe(1);
  });

  it("blocks hosted writes at the configured monthly post limit", async () => {
    process.env.X_MONTHLY_POST_LIMIT = "1";

    await runInContext(tenantContext("tn_x_counter_limited"), async () => {
      await expect(
        x.post({ text: "first", type: "post" }),
      ).resolves.toMatchObject({
        ok: true,
        postId: "tweet_123",
      });
      await expect(
        x.post({ text: "second", type: "post" }),
      ).resolves.toMatchObject({
        ok: false,
        error:
          "Configured X monthly post limit reached (1/month). Remaining: 0",
      });
    });
  });
});
