import { describe, expect, it } from "vitest";

import { cleanupSqliteFiles, createTempHostedDbPath } from "./temp-db.js";

const dbPath = createTempHostedDbPath("pulse-account-safety");
process.env.HOSTED_DB_PATH = dbPath;

const {
  checkRateBucket,
  clearSafetyControl,
  closeCircuitBreaker,
  consumeRateBucket,
  getHostedFollowChurnDecision,
  getHostedAutopilotWriteDecision,
  getCircuitBreaker,
  getRateBucket,
  getRateBucketEventByIdempotencyKey,
  getSafetyControl,
  isAccountAllowed,
  openCircuitBreaker,
  pauseHostedAutopilot,
  recordCircuitBreakerEvent,
  resumeHostedAutopilot,
  syncHostedAutopilotPauseFromCircuitBreakers,
  setSafetyControl,
} = await import("../../hosted/account-safety.js");

describe("account safety repository", () => {
  it("persists rate buckets with idempotent consumption and window rollover", () => {
    const first = consumeRateBucket({
      scopeType: "account",
      scopeId: "acct_rate",
      bucketKey: "write_15m",
      limit: 2,
      windowMs: 15 * 60 * 1000,
      now: "2026-05-26T10:00:00.000Z",
      idempotencyKey: "bucket:acct_rate:1",
    });

    expect(first).toEqual({
      allowed: true,
      limit: 2,
      used: 1,
      remaining: 1,
      retryAfterMs: 0,
      windowStartedAt: "2026-05-26T10:00:00.000Z",
      windowEndsAt: "2026-05-26T10:15:00.000Z",
    });

    expect(
      consumeRateBucket({
        scopeType: "account",
        scopeId: "acct_rate",
        bucketKey: "write_15m",
        limit: 2,
        windowMs: 15 * 60 * 1000,
        now: "2026-05-26T10:01:00.000Z",
        idempotencyKey: "bucket:acct_rate:1",
      }),
    ).toEqual({
      ...first,
      retryAfterMs: 14 * 60 * 1000,
    });

    const exhausted = consumeRateBucket({
      scopeType: "account",
      scopeId: "acct_rate",
      bucketKey: "write_15m",
      limit: 2,
      windowMs: 15 * 60 * 1000,
      now: "2026-05-26T10:02:00.000Z",
      idempotencyKey: "bucket:acct_rate:2",
      cost: 2,
    });

    expect(exhausted).toEqual({
      allowed: false,
      limit: 2,
      used: 3,
      remaining: 0,
      retryAfterMs: 13 * 60 * 1000,
      windowStartedAt: "2026-05-26T10:00:00.000Z",
      windowEndsAt: "2026-05-26T10:15:00.000Z",
    });
    const finalAllowed = consumeRateBucket({
      scopeType: "account",
      scopeId: "acct_final_slot",
      bucketKey: "write_15m",
      limit: 2,
      windowMs: 15 * 60 * 1000,
      now: "2026-05-26T10:02:00.000Z",
      idempotencyKey: "bucket:acct_final_slot:1",
      cost: 2,
    });
    expect(finalAllowed).toMatchObject({
      allowed: true,
      used: 2,
      remaining: 0,
      retryAfterMs: 0,
    });
    expect(
      checkRateBucket({
        scopeType: "account",
        scopeId: "acct_final_slot",
        bucketKey: "write_15m",
        limit: 2,
        windowMs: 15 * 60 * 1000,
        now: "2026-05-26T10:03:00.000Z",
      }),
    ).toMatchObject({
      allowed: false,
      used: 2,
      remaining: 0,
      retryAfterMs: 14 * 60 * 1000,
    });
    expect(
      getRateBucketEventByIdempotencyKey("bucket:acct_rate:2"),
    ).toMatchObject({
      scope_id: "acct_rate",
      bucket_key: "write_15m",
      resulting_used_count: 3,
    });
    expect(
      checkRateBucket({
        scopeType: "account",
        scopeId: "acct_rate",
        bucketKey: "write_15m",
        limit: 2,
        windowMs: 15 * 60 * 1000,
        now: "2026-05-26T10:03:00.000Z",
      }),
    ).toEqual({
      allowed: false,
      limit: 2,
      used: 3,
      remaining: 0,
      retryAfterMs: 12 * 60 * 1000,
      windowStartedAt: "2026-05-26T10:00:00.000Z",
      windowEndsAt: "2026-05-26T10:15:00.000Z",
    });

    expect(
      checkRateBucket({
        scopeType: "account",
        scopeId: "acct_rate",
        bucketKey: "write_15m",
        limit: 2,
        windowMs: 15 * 60 * 1000,
        now: "2026-05-26T10:16:00.000Z",
      }),
    ).toEqual({
      allowed: true,
      limit: 2,
      used: 0,
      remaining: 2,
      retryAfterMs: 0,
      windowStartedAt: "2026-05-26T10:16:00.000Z",
      windowEndsAt: "2026-05-26T10:31:00.000Z",
    });
    expect(
      getRateBucket({
        scopeType: "account",
        scopeId: "acct_rate",
        bucketKey: "write_15m",
      }),
    ).toMatchObject({
      scope_id: "acct_rate",
      used_count: 3,
      window_ends_at: "2026-05-26T10:15:00.000Z",
    });
  });

  it("tracks global kill switches and brand pauses in allow decisions", () => {
    expect(
      isAccountAllowed({
        brandId: "brand_a",
        accountId: "acct_a",
        now: "2026-05-26T11:00:00.000Z",
      }),
    ).toMatchObject({
      allowed: true,
      reasons: [],
    });

    setSafetyControl({
      scopeType: "global",
      controlType: "kill_switch",
      reason: "manual outage stop",
      source: "ops",
      metadata: { operator: "test" },
      now: "2026-05-26T11:01:00.000Z",
    });
    setSafetyControl({
      scopeType: "brand",
      scopeId: "brand_a",
      controlType: "pause",
      reason: "brand review",
      source: "approver",
      now: "2026-05-26T11:02:00.000Z",
    });

    const blocked = isAccountAllowed({
      brandId: "brand_a",
      accountId: "acct_a",
      now: "2026-05-26T11:03:00.000Z",
    });

    expect(blocked.allowed).toBe(false);
    expect(blocked.reasons).toEqual([
      "global:kill_switch:manual outage stop",
      "brand:pause:brand review",
    ]);
    expect(getSafetyControl("global", undefined, "kill_switch")).toMatchObject({
      is_active: 1,
      metadata: JSON.stringify({ operator: "test" }),
    });

    clearSafetyControl({
      scopeType: "brand",
      scopeId: "brand_a",
      controlType: "pause",
      now: "2026-05-26T11:04:00.000Z",
    });
    clearSafetyControl({
      scopeType: "global",
      controlType: "kill_switch",
      now: "2026-05-26T11:05:00.000Z",
    });

    expect(
      isAccountAllowed({
        brandId: "brand_a",
        accountId: "acct_a",
        now: "2026-05-26T11:06:00.000Z",
      }),
    ).toMatchObject({
      allowed: true,
      reasons: [],
    });
    expect(getSafetyControl("brand", "brand_a", "pause")).toMatchObject({
      is_active: 0,
      cleared_at: "2026-05-26T11:04:00.000Z",
    });
  });

  it("opens circuit breakers from repeated safety events and supports manual recovery", () => {
    const first = recordCircuitBreakerEvent({
      scopeType: "account",
      scopeId: "acct_cb",
      breakerKey: "rate_429",
      eventType: "http_429",
      statusCode: 429,
      source: "x-write-client",
      message: "first 429",
      thresholdCount: 2,
      thresholdWindowMs: 5 * 60 * 1000,
      openMs: 60 * 1000,
      now: "2026-05-26T12:00:00.000Z",
      idempotencyKey: "cb:acct_cb:1",
    });

    expect(first.opened).toBe(false);
    expect(first.recentEventCount).toBe(1);
    expect(getCircuitBreaker("account", "acct_cb", "rate_429")).toBeNull();

    const second = recordCircuitBreakerEvent({
      scopeType: "account",
      scopeId: "acct_cb",
      breakerKey: "rate_429",
      eventType: "http_429",
      statusCode: 429,
      source: "x-write-client",
      message: "second 429",
      thresholdCount: 2,
      thresholdWindowMs: 5 * 60 * 1000,
      openMs: 60 * 1000,
      now: "2026-05-26T12:00:30.000Z",
      idempotencyKey: "cb:acct_cb:2",
    });

    expect(second.opened).toBe(true);
    expect(second.recentEventCount).toBe(2);
    expect(second.breaker).toMatchObject({
      state: "open",
      scope_id: "acct_cb",
      breaker_key: "rate_429",
      open_until: "2026-05-26T12:01:30.000Z",
      threshold_count: 2,
    });
    expect(
      isAccountAllowed({
        accountId: "acct_cb",
        now: "2026-05-26T12:01:00.000Z",
      }),
    ).toMatchObject({
      allowed: false,
      reasons: ["account:circuit_breaker:rate_429:second 429"],
    });

    expect(
      isAccountAllowed({
        accountId: "acct_cb",
        now: "2026-05-26T12:02:00.000Z",
      }),
    ).toMatchObject({
      allowed: true,
      reasons: [],
    });

    openCircuitBreaker({
      scopeType: "brand",
      scopeId: "brand_cb",
      breakerKey: "anomaly",
      source: "monitor",
      reason: "suspicious posting pattern",
      now: "2026-05-26T12:03:00.000Z",
    });
    expect(
      isAccountAllowed({
        brandId: "brand_cb",
        accountId: "acct_other",
        now: "2026-05-26T12:04:00.000Z",
      }),
    ).toMatchObject({
      allowed: false,
      reasons: ["brand:circuit_breaker:anomaly:suspicious posting pattern"],
    });

    closeCircuitBreaker({
      scopeType: "brand",
      scopeId: "brand_cb",
      breakerKey: "anomaly",
      source: "monitor",
      reason: "manual recovery",
      now: "2026-05-26T12:05:00.000Z",
    });
    expect(getCircuitBreaker("brand", "brand_cb", "anomaly")).toMatchObject({
      state: "closed",
      closed_at: "2026-05-26T12:05:00.000Z",
    });
    expect(
      isAccountAllowed({
        brandId: "brand_cb",
        accountId: "acct_other",
        now: "2026-05-26T12:06:00.000Z",
      }),
    ).toMatchObject({
      allowed: true,
      reasons: [],
    });
  });

  it("requires explicit hosted follow-churn opt-in even when auto-follow is enabled", () => {
    const originalFlag = process.env.PULSE_ALLOW_FOLLOW_CHURN;
    delete process.env.PULSE_ALLOW_FOLLOW_CHURN;

    expect(
      getHostedFollowChurnDecision({
        brandId: "brand_follow",
        accountId: "acct_follow",
        config: { autoFollow: { enabled: true } },
        now: "2026-05-26T13:00:00.000Z",
      }),
    ).toMatchObject({
      allowed: false,
      configEnabled: true,
      runtimeOptIn: false,
      reasons: ["follow_churn_not_opted_in"],
    });

    process.env.PULSE_ALLOW_FOLLOW_CHURN = "1";

    expect(
      getHostedFollowChurnDecision({
        brandId: "brand_follow",
        accountId: "acct_follow",
        config: { autoFollow: { enabled: true } },
        now: "2026-05-26T13:01:00.000Z",
      }),
    ).toMatchObject({
      allowed: true,
      configEnabled: true,
      runtimeOptIn: true,
      reasons: [],
    });

    if (originalFlag === undefined) delete process.env.PULSE_ALLOW_FOLLOW_CHURN;
    else process.env.PULSE_ALLOW_FOLLOW_CHURN = originalFlag;
  });

  it("includes account safety blocks in hosted follow-churn decisions", () => {
    const originalFlag = process.env.PULSE_ALLOW_FOLLOW_CHURN;
    process.env.PULSE_ALLOW_FOLLOW_CHURN = "true";
    setSafetyControl({
      scopeType: "brand",
      scopeId: "brand_follow_blocked",
      controlType: "pause",
      reason: "manual review",
      source: "approver",
      now: "2026-05-26T13:02:00.000Z",
    });

    expect(
      getHostedFollowChurnDecision({
        brandId: "brand_follow_blocked",
        accountId: "acct_follow_blocked",
        config: { autoFollow: { enabled: true } },
        now: "2026-05-26T13:03:00.000Z",
      }),
    ).toMatchObject({
      allowed: false,
      reasons: ["brand:pause:manual review"],
    });

    clearSafetyControl({
      scopeType: "brand",
      scopeId: "brand_follow_blocked",
      controlType: "pause",
      now: "2026-05-26T13:04:00.000Z",
    });
    if (originalFlag === undefined) delete process.env.PULSE_ALLOW_FOLLOW_CHURN;
    else process.env.PULSE_ALLOW_FOLLOW_CHURN = originalFlag;
  });

  it("blocks hosted autopilot writes unless full auto is explicitly enabled", () => {
    expect(
      getHostedAutopilotWriteDecision({
        brandId: "brand_auto_default",
        accountId: "acct_auto_default",
        config: null,
        now: "2026-05-26T13:05:00.000Z",
      }),
    ).toMatchObject({
      allowed: false,
      mode: "off",
      fullAutoEnabled: false,
      reasons: ["autopilot_write_not_enabled:off"],
    });

    expect(
      getHostedAutopilotWriteDecision({
        brandId: "brand_auto_semi",
        accountId: "acct_auto_semi",
        config: { autopilot: { mode: "semi" } },
        now: "2026-05-26T13:06:00.000Z",
      }),
    ).toMatchObject({
      allowed: false,
      mode: "semi",
      fullAutoEnabled: false,
      reasons: ["autopilot_write_not_enabled:semi"],
    });

    expect(
      getHostedAutopilotWriteDecision({
        brandId: "brand_auto_full",
        accountId: "acct_auto_full",
        config: { autopilot: { mode: "full" } },
        now: "2026-05-26T13:07:00.000Z",
      }),
    ).toMatchObject({
      allowed: true,
      mode: "full",
      fullAutoEnabled: true,
      reasons: [],
    });
  });

  it("includes account safety blocks in hosted autopilot write decisions", () => {
    setSafetyControl({
      scopeType: "brand",
      scopeId: "brand_auto_blocked",
      controlType: "pause",
      reason: "manual review",
      source: "approver",
      now: "2026-05-26T13:08:00.000Z",
    });

    expect(
      getHostedAutopilotWriteDecision({
        brandId: "brand_auto_blocked",
        accountId: "acct_auto_blocked",
        config: { autopilot: { mode: "full" } },
        now: "2026-05-26T13:09:00.000Z",
      }),
    ).toMatchObject({
      allowed: false,
      mode: "full",
      fullAutoEnabled: true,
      reasons: ["brand:pause:manual review"],
    });

    clearSafetyControl({
      scopeType: "brand",
      scopeId: "brand_auto_blocked",
      controlType: "pause",
      now: "2026-05-26T13:10:00.000Z",
    });
  });

  it("pauses and resumes hosted autopilot without clearing manual brand pauses", () => {
    const paused = pauseHostedAutopilot({
      brandId: "brand_auto_reversible",
      accountId: "acct_auto_reversible",
      actorId: "operator_1",
      reason: "operator review",
      source: "ops",
      metadata: { ticketId: "ticket_123" },
      now: "2026-05-26T13:11:00.000Z",
    });

    expect(paused).toMatchObject({
      scope_type: "brand",
      scope_id: "brand_auto_reversible",
      control_type: "autopilot_pause",
      is_active: 1,
      reason: "operator review",
      source: "ops",
      metadata: JSON.stringify({
        actorId: "operator_1",
        accountId: "acct_auto_reversible",
        ticketId: "ticket_123",
      }),
    });
    expect(
      getHostedAutopilotWriteDecision({
        brandId: "brand_auto_reversible",
        accountId: "acct_auto_reversible",
        config: { autopilot: { mode: "full" } },
        now: "2026-05-26T13:12:00.000Z",
      }),
    ).toMatchObject({
      allowed: false,
      mode: "full",
      fullAutoEnabled: true,
      reasons: ["brand:autopilot_pause:operator review"],
    });

    setSafetyControl({
      scopeType: "brand",
      scopeId: "brand_auto_reversible",
      controlType: "pause",
      reason: "manual brand pause",
      source: "approver",
      now: "2026-05-26T13:13:00.000Z",
    });
    const resumed = resumeHostedAutopilot({
      brandId: "brand_auto_reversible",
      now: "2026-05-26T13:14:00.000Z",
    });

    expect(resumed).toMatchObject({
      control_type: "autopilot_pause",
      is_active: 0,
      cleared_at: "2026-05-26T13:14:00.000Z",
    });
    expect(
      getSafetyControl("brand", "brand_auto_reversible", "pause"),
    ).toMatchObject({
      is_active: 1,
      reason: "manual brand pause",
    });
    expect(
      getHostedAutopilotWriteDecision({
        brandId: "brand_auto_reversible",
        accountId: "acct_auto_reversible",
        config: { autopilot: { mode: "full" } },
        now: "2026-05-26T13:15:00.000Z",
      }),
    ).toMatchObject({
      allowed: false,
      reasons: ["brand:pause:manual brand pause"],
    });

    clearSafetyControl({
      scopeType: "brand",
      scopeId: "brand_auto_reversible",
      controlType: "pause",
      now: "2026-05-26T13:16:00.000Z",
    });
    expect(
      getHostedAutopilotWriteDecision({
        brandId: "brand_auto_reversible",
        accountId: "acct_auto_reversible",
        config: { autopilot: { mode: "full" } },
        now: "2026-05-26T13:17:00.000Z",
      }),
    ).toMatchObject({
      allowed: true,
      reasons: [],
    });
  });

  it("auto-pauses hosted autopilot when an X write circuit breaker is active", () => {
    openCircuitBreaker({
      scopeType: "account",
      scopeId: "acct_auto_breaker",
      breakerKey: "x_write_post",
      source: "x-write-client",
      reason: "X API 429: too many requests",
      now: "2026-05-26T13:18:00.000Z",
    });

    expect(
      getHostedAutopilotWriteDecision({
        brandId: "brand_auto_breaker",
        accountId: "acct_auto_breaker",
        config: { autopilot: { mode: "full" } },
        now: "2026-05-26T13:19:00.000Z",
      }),
    ).toMatchObject({
      allowed: false,
      mode: "full",
      fullAutoEnabled: true,
      reasons: expect.arrayContaining([
        "brand:autopilot_pause:automatic pause after x_write_post circuit breaker",
        "account:circuit_breaker:x_write_post:X API 429: too many requests",
      ]),
    });
    expect(
      getSafetyControl("brand", "brand_auto_breaker", "autopilot_pause"),
    ).toMatchObject({
      is_active: 1,
      source: "account-safety:auto-pause",
      reason: "automatic pause after x_write_post circuit breaker",
      metadata: JSON.stringify({
        accountId: "acct_auto_breaker",
        trigger: "x_write_circuit_breaker",
        breakerKey: "x_write_post",
        breakerScopeType: "account",
        breakerScopeId: "acct_auto_breaker",
        breakerReason: "X API 429: too many requests",
      }),
    });

    const replayed = syncHostedAutopilotPauseFromCircuitBreakers({
      brandId: "brand_auto_breaker",
      accountId: "acct_auto_breaker",
      now: "2026-05-26T13:20:00.000Z",
    });
    expect(replayed).toMatchObject({
      is_active: 1,
      reason: "automatic pause after x_write_post circuit breaker",
    });

    expect(
      resumeHostedAutopilot({
        brandId: "brand_auto_breaker",
        now: "2026-05-26T13:21:00.000Z",
      }),
    ).toMatchObject({
      is_active: 0,
      cleared_at: "2026-05-26T13:21:00.000Z",
    });
    expect(
      getHostedAutopilotWriteDecision({
        brandId: "brand_auto_breaker",
        accountId: "acct_auto_breaker",
        config: { autopilot: { mode: "full" } },
        now: "2026-05-26T13:22:00.000Z",
      }),
    ).toMatchObject({
      allowed: false,
      reasons: expect.arrayContaining([
        "brand:autopilot_pause:automatic pause after x_write_post circuit breaker",
      ]),
    });
  });
});

process.on("exit", () => {
  cleanupSqliteFiles(dbPath);
});
