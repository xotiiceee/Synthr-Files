import { afterAll, describe, expect, it } from "vitest";

import { cleanupSqliteFiles, createTempHostedDbPath } from "./temp-db.js";

const dbPath = createTempHostedDbPath("pulse-runtime-x-rate-counters");
process.env.HOSTED_DB_PATH = dbPath;

const { createRuntimeXRateCounterRepository } =
  await import("../../hosted/repositories/runtime-x-rate-counters.js");

const counters = createRuntimeXRateCounterRepository();

afterAll(() => {
  cleanupSqliteFiles(dbPath);
});

describe("runtime X rate counters", () => {
  it("increments monthly post counters by tenant, account, and month", () => {
    expect(
      counters.getPostCount({
        tenantId: "tn_x_rate",
        accountId: "acct_1",
        monthKey: "2026-05",
      }),
    ).toBe(0);

    counters.incrementPostCount({
      tenantId: "tn_x_rate",
      accountId: "acct_1",
      monthKey: "2026-05",
    });
    const second = counters.incrementPostCount({
      tenantId: "tn_x_rate",
      accountId: "acct_1",
      monthKey: "2026-05",
    });

    expect(second).toMatchObject({
      tenant_id: "tn_x_rate",
      account_id: "acct_1",
      month_key: "2026-05",
      post_count: 2,
    });
    expect(
      counters.getPostCount({
        tenantId: "tn_x_rate",
        accountId: "acct_1",
        monthKey: "2026-06",
      }),
    ).toBe(0);
  });

  it("isolates counters across tenants and accounts", () => {
    counters.incrementPostCount({
      tenantId: "tn_x_rate_a",
      accountId: "acct_shared",
      monthKey: "2026-05",
    });
    counters.incrementPostCount({
      tenantId: "tn_x_rate_b",
      accountId: "acct_shared",
      monthKey: "2026-05",
    });
    counters.incrementPostCount({
      tenantId: "tn_x_rate_a",
      accountId: "acct_other",
      monthKey: "2026-05",
    });

    expect(
      counters.getPostCount({
        tenantId: "tn_x_rate_a",
        accountId: "acct_shared",
        monthKey: "2026-05",
      }),
    ).toBe(1);
    expect(
      counters.getPostCount({
        tenantId: "tn_x_rate_b",
        accountId: "acct_shared",
        monthKey: "2026-05",
      }),
    ).toBe(1);
    expect(
      counters.getPostCount({
        tenantId: "tn_x_rate_a",
        accountId: "acct_other",
        monthKey: "2026-05",
      }),
    ).toBe(1);
  });
});
