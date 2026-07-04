import { describe, expect, it } from "vitest";

import { cleanupSqliteFiles, createTempHostedDbPath } from "./temp-db.js";

const dbPath = createTempHostedDbPath("pulse-spend-ledger");
process.env.HOSTED_DB_PATH = dbPath;

const {
  checkActionCooldown,
  getActionCooldownBucket,
  getActionCooldownEventByIdempotencyKey,
  getDailySpendTotal,
  getMonthlySpendTotal,
  getSpendEventByIdempotencyKey,
  recordActionCooldown,
  recordSpend,
} = await import("../../hosted/spend-ledger.js");

describe("spend ledger repository", () => {
  it("tracks daily and monthly spend totals with idempotent event writes", () => {
    const first = recordSpend({
      tenantId: "tn_daily",
      amount: 12.5,
      idempotencyKey: "spend:tn_daily:1",
      now: "2026-05-26T10:00:00.000Z",
      metadata: { route: "generate_post" },
    });
    const duplicate = recordSpend({
      tenantId: "tn_daily",
      amount: 999,
      idempotencyKey: "spend:tn_daily:1",
      now: "2026-05-26T10:01:00.000Z",
    });
    recordSpend({
      tenantId: "tn_daily",
      amount: 7.25,
      idempotencyKey: "spend:tn_daily:2",
      now: "2026-05-26T12:00:00.000Z",
    });
    recordSpend({
      tenantId: "tn_daily",
      amount: 20,
      idempotencyKey: "spend:tn_daily:3",
      now: "2026-06-01T00:00:00.000Z",
    });

    expect(duplicate).toEqual(first);
    expect(getSpendEventByIdempotencyKey("spend:tn_daily:1")).toEqual(first);
    expect(JSON.parse(first.metadata)).toEqual({ route: "generate_post" });
    expect(
      getDailySpendTotal({
        tenantId: "tn_daily",
        date: "2026-05-26T23:59:59.000Z",
      }),
    ).toBe(19.75);
    expect(
      getMonthlySpendTotal({
        tenantId: "tn_daily",
        date: "2026-05-15T00:00:00.000Z",
      }),
    ).toBe(19.75);
    expect(
      getMonthlySpendTotal({
        tenantId: "tn_daily",
        date: "2026-06-15T00:00:00.000Z",
      }),
    ).toBe(20);
  });

  it("checks and records cooldown buckets", () => {
    expect(
      checkActionCooldown({
        tenantId: "tn_cooldown",
        action: "autopilot_post",
        now: "2026-05-26T12:00:00.000Z",
      }),
    ).toEqual({
      allowed: true,
      retryAfterMs: 0,
      availableAt: null,
    });

    const bucket = recordActionCooldown({
      tenantId: "tn_cooldown",
      action: "autopilot_post",
      cooldownMs: 30_000,
      now: "2026-05-26T12:00:00.000Z",
      idempotencyKey: "cooldown:tn_cooldown:post:1",
    });

    expect(bucket).toMatchObject({
      tenant_id: "tn_cooldown",
      action: "autopilot_post",
      available_at: "2026-05-26T12:00:30.000Z",
      last_recorded_at: "2026-05-26T12:00:00.000Z",
    });
    expect(
      checkActionCooldown({
        tenantId: "tn_cooldown",
        action: "autopilot_post",
        now: "2026-05-26T12:00:10.000Z",
      }),
    ).toEqual({
      allowed: false,
      retryAfterMs: 20_000,
      availableAt: "2026-05-26T12:00:30.000Z",
    });
    expect(
      recordActionCooldown({
        tenantId: "tn_cooldown",
        action: "autopilot_post",
        cooldownMs: 30_000,
        now: "2026-05-26T12:00:05.000Z",
        idempotencyKey: "cooldown:tn_cooldown:post:1",
      }),
    ).toEqual(bucket);
    expect(
      getActionCooldownEventByIdempotencyKey("cooldown:tn_cooldown:post:1"),
    ).toMatchObject({
      tenant_id: "tn_cooldown",
      action: "autopilot_post",
      cooldown_ms: 30_000,
      available_at: "2026-05-26T12:00:30.000Z",
    });
    expect(
      checkActionCooldown({
        tenantId: "tn_cooldown",
        action: "autopilot_post",
        now: "2026-05-26T12:00:30.000Z",
      }),
    ).toEqual({
      allowed: true,
      retryAfterMs: 0,
      availableAt: "2026-05-26T12:00:30.000Z",
    });
  });

  it("isolates spend totals and cooldown buckets by tenant and action", () => {
    recordSpend({
      tenantId: "tn_a",
      amount: 3,
      idempotencyKey: "spend:tn_a:a",
      now: "2026-05-26T09:00:00.000Z",
    });
    recordSpend({
      tenantId: "tn_b",
      amount: 8,
      idempotencyKey: "spend:tn_b:a",
      now: "2026-05-26T09:00:00.000Z",
    });

    recordActionCooldown({
      tenantId: "tn_a",
      action: "autopilot_post",
      cooldownMs: 30_000,
      now: "2026-05-26T13:00:00.000Z",
    });
    recordActionCooldown({
      tenantId: "tn_a",
      action: "autopilot_reply",
      cooldownMs: 10_000,
      now: "2026-05-26T13:00:00.000Z",
    });
    recordActionCooldown({
      tenantId: "tn_b",
      action: "autopilot_post",
      cooldownMs: 45_000,
      now: "2026-05-26T13:00:00.000Z",
    });

    expect(
      getDailySpendTotal({
        tenantId: "tn_a",
        date: "2026-05-26T09:30:00.000Z",
      }),
    ).toBe(3);
    expect(
      getDailySpendTotal({
        tenantId: "tn_b",
        date: "2026-05-26T09:30:00.000Z",
      }),
    ).toBe(8);
    expect(
      checkActionCooldown({
        tenantId: "tn_a",
        action: "autopilot_post",
        now: "2026-05-26T13:00:20.000Z",
      }),
    ).toEqual({
      allowed: false,
      retryAfterMs: 10_000,
      availableAt: "2026-05-26T13:00:30.000Z",
    });
    expect(
      checkActionCooldown({
        tenantId: "tn_a",
        action: "autopilot_reply",
        now: "2026-05-26T13:00:20.000Z",
      }),
    ).toEqual({
      allowed: true,
      retryAfterMs: 0,
      availableAt: "2026-05-26T13:00:10.000Z",
    });
    expect(
      checkActionCooldown({
        tenantId: "tn_b",
        action: "autopilot_post",
        now: "2026-05-26T13:00:20.000Z",
      }),
    ).toEqual({
      allowed: false,
      retryAfterMs: 25_000,
      availableAt: "2026-05-26T13:00:45.000Z",
    });
    expect(getActionCooldownBucket("tn_a", "autopilot_post")).toMatchObject({
      tenant_id: "tn_a",
      action: "autopilot_post",
      available_at: "2026-05-26T13:00:30.000Z",
    });
  });
});

process.on("exit", () => {
  cleanupSqliteFiles(dbPath);
});
