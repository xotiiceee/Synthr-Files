import { describe, expect, it } from "vitest";

import { cleanupSqliteFiles, createTempHostedDbPath } from "./temp-db.js";

const dbPath = createTempHostedDbPath("pulse-limits");
process.env.HOSTED_DB_PATH = dbPath;

// limits.ts imports spend-ledger.ts at load time; HOSTED_DB_PATH must be set first
const {
  recordSpend,
  checkSpendCap,
  checkMonthlySpendCap,
  getDailySpend,
  getMonthlySpendTotal,
  getUsageProjection,
  checkActionCooldown,
} = await import("../../hosted/limits.js");

// Shared repo for test setup with deterministic dates
const { spendLedgerRepository } = await import("../../hosted/spend-ledger.js");

describe("hosted limits (persistent spend ledger)", () => {
  it("recordSpend accumulates into daily cap check", () => {
    recordSpend("tn_lim_daily", 50);
    recordSpend("tn_lim_daily", 30);

    const result = checkSpendCap("tn_lim_daily", 200);
    expect(result.spent).toBe(80);
    expect(result.cap).toBe(200);
    expect(result.remaining).toBe(120);
    expect(result.allowed).toBe(true);
  });

  it("checkSpendCap blocks when spend exceeds cap", () => {
    recordSpend("tn_lim_over", 500);
    recordSpend("tn_lim_over", 100);

    const result = checkSpendCap("tn_lim_over", 400);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("checkSpendCap clamps to MAX_DAILY_SPEND_CAP", () => {
    const result = checkSpendCap("tn_lim_maxcap", 99999);
    expect(result.cap).toBe(2000);
  });

  it("recordSpend accumulates into monthly cap check", () => {
    recordSpend("tn_lim_monthly", 1000);
    recordSpend("tn_lim_monthly", 500);

    const result = checkMonthlySpendCap("tn_lim_monthly", 5000);
    expect(result.spent).toBe(1500);
    expect(result.cap).toBe(5000);
    expect(result.allowed).toBe(true);
  });

  it("checkMonthlySpendCap clamps to MAX_MONTHLY_SPEND_CAP", () => {
    const result = checkMonthlySpendCap("tn_lim_maxmonth", 999999);
    expect(result.cap).toBe(50000);
  });

  it("getDailySpend returns accumulated daily total", () => {
    recordSpend("tn_lim_getd", 12.5);
    recordSpend("tn_lim_getd", 7.5);
    expect(getDailySpend("tn_lim_getd")).toBe(20);
  });

  it("getMonthlySpendTotal returns accumulated monthly total", () => {
    recordSpend("tn_lim_getm", 100);
    recordSpend("tn_lim_getm", 200);
    expect(getMonthlySpendTotal("tn_lim_getm")).toBe(300);
  });

  it("getDailySpend returns 0 for unknown tenant", () => {
    expect(getDailySpend("tn_lim_unknown_xyz")).toBe(0);
  });

  it("spend totals are isolated by tenant", () => {
    recordSpend("tn_lim_iso_a", 100);
    recordSpend("tn_lim_iso_b", 200);
    expect(getDailySpend("tn_lim_iso_a")).toBe(100);
    expect(getDailySpend("tn_lim_iso_b")).toBe(200);
  });

  it("getUsageProjection computes avg daily spend over last 7 days", () => {
    const tid = "tn_lim_proj";
    spendLedgerRepository.recordSpend({
      tenantId: tid,
      amount: 10,
      idempotencyKey: "proj:1",
      now: "2026-05-20T12:00:00.000Z",
    });
    spendLedgerRepository.recordSpend({
      tenantId: tid,
      amount: 20,
      idempotencyKey: "proj:2",
      now: "2026-05-21T12:00:00.000Z",
    });
    spendLedgerRepository.recordSpend({
      tenantId: tid,
      amount: 30,
      idempotencyKey: "proj:3",
      now: "2026-05-22T12:00:00.000Z",
    });

    // window 2026-05-16 to 2026-05-22: 3 days with spend (10+20+30=60, avg=20)
    const result = getUsageProjection(
      tid,
      200,
      new Date("2026-05-22T23:59:59.000Z"),
    );
    expect(result.avgDailySpend).toBe(20);
    expect(result.daysRemaining).toBe(10);
    expect(result.burnRate).toBe("low");
  });

  it("getUsageProjection excludes data older than 7 days", () => {
    const tid = "tn_lim_proj_old";
    // 2026-05-14 is 8 days before 2026-05-22 — outside window
    spendLedgerRepository.recordSpend({
      tenantId: tid,
      amount: 50,
      idempotencyKey: "old:1",
      now: "2026-05-14T12:00:00.000Z",
    });
    // 2026-05-20 is inside window
    spendLedgerRepository.recordSpend({
      tenantId: tid,
      amount: 10,
      idempotencyKey: "old:2",
      now: "2026-05-20T12:00:00.000Z",
    });

    const result = getUsageProjection(
      tid,
      100,
      new Date("2026-05-22T23:59:59.000Z"),
    );
    expect(result.avgDailySpend).toBe(10);
    expect(result.daysRemaining).toBe(10);
  });

  it("getUsageProjection returns no-data sentinel for new tenant", () => {
    const result = getUsageProjection("tn_lim_proj_empty_xyz", 1000);
    expect(result.avgDailySpend).toBe(0);
    expect(result.daysRemaining).toBeNull();
    expect(result.burnRate).toBe("low");
  });

  it("getUsageProjection reports high burn rate above 100 avg", () => {
    const tid = "tn_lim_proj_high";
    spendLedgerRepository.recordSpend({
      tenantId: tid,
      amount: 150,
      idempotencyKey: "high:1",
      now: "2026-05-22T12:00:00.000Z",
    });

    const result = getUsageProjection(
      tid,
      1000,
      new Date("2026-05-22T23:59:59.000Z"),
    );
    expect(result.burnRate).toBe("high");
    expect(result.avgDailySpend).toBe(150);
  });

  it("getUsageProjection reports moderate burn rate between 30 and 100", () => {
    const tid = "tn_lim_proj_mod";
    spendLedgerRepository.recordSpend({
      tenantId: tid,
      amount: 50,
      idempotencyKey: "mod:1",
      now: "2026-05-22T12:00:00.000Z",
    });

    const result = getUsageProjection(
      tid,
      500,
      new Date("2026-05-22T23:59:59.000Z"),
    );
    expect(result.burnRate).toBe("moderate");
  });

  it("checkActionCooldown: first call allowed, immediate repeat blocked", () => {
    const first = checkActionCooldown("tn_lim_cool", "autopilot_post");
    expect(first.allowed).toBe(true);
    expect(first.retryAfterMs).toBe(0);

    const second = checkActionCooldown("tn_lim_cool", "autopilot_post");
    expect(second.allowed).toBe(false);
    expect(second.retryAfterMs).toBeGreaterThan(0);
    expect(second.retryAfterMs).toBeLessThanOrEqual(30_000);
  });

  it("checkActionCooldown is isolated by tenant", () => {
    const a = checkActionCooldown("tn_lim_cool_a", "autopilot_post");
    const b = checkActionCooldown("tn_lim_cool_b", "autopilot_post");
    expect(a.allowed).toBe(true);
    expect(b.allowed).toBe(true);
  });

  it("checkActionCooldown is isolated by action", () => {
    const post = checkActionCooldown("tn_lim_cool_act", "autopilot_post");
    const reply = checkActionCooldown("tn_lim_cool_act", "autopilot_reply");
    expect(post.allowed).toBe(true);
    expect(reply.allowed).toBe(true);
  });
});

process.on("exit", () => {
  cleanupSqliteFiles(dbPath);
});
