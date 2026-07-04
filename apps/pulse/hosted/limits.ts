/**
 * Usage Limits for Hosted Pulse.
 *
 * Credit-based model: no plan tiers, just rate limits + spend caps.
 * Daily + monthly spend caps prevent runaway costs.
 * Spend history enables usage projection ("balance lasts ~X days").
 */

import crypto from "node:crypto";
import { getUsage, type Tenant } from "./db.js";
import { spendLedgerRepository } from "./spend-ledger.js";

// Daily rate limits (prevent abuse, not billing)
const DAILY_LIMITS = {
  llm_calls: 500,
  search_calls: 200,
  outreach_runs: 50,
  content_posts: 20,
  follows: 20,
};

// Spend caps
const DEFAULT_DAILY_SPEND_CAP = 500;
const MAX_DAILY_SPEND_CAP = 2000;
const DEFAULT_MONTHLY_SPEND_CAP = 10000;
const MAX_MONTHLY_SPEND_CAP = 50000;

const ACTION_COOLDOWN_MS = 30_000;

export type LimitResource =
  | "llm_calls"
  | "search_calls"
  | "outreach_runs"
  | "content_posts"
  | "follows";

// ─── Spend Tracking ──────────────────────────────────────────────────────────

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function thisMonth(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

/**
 * Record a credit spend for a tenant.
 * Each call is a distinct event; idempotency is not expected from callers.
 */
export function recordSpend(tenantId: string, credits: number): void {
  spendLedgerRepository.recordSpend({
    tenantId,
    amount: credits,
    idempotencyKey: `auto:${crypto.randomUUID()}`,
  });
}

/**
 * Check daily spend cap.
 */
export function checkSpendCap(
  tenantId: string,
  spendCap?: number,
): { allowed: boolean; spent: number; cap: number; remaining: number } {
  const cap = Math.min(
    spendCap ?? DEFAULT_DAILY_SPEND_CAP,
    MAX_DAILY_SPEND_CAP,
  );
  const spent = spendLedgerRepository.getDailySpendTotal({
    tenantId,
    date: today(),
  });
  const remaining = Math.max(0, cap - spent);
  return {
    allowed: spent < cap,
    spent: Math.round(spent * 10) / 10,
    cap,
    remaining: Math.round(remaining * 10) / 10,
  };
}

/**
 * Check monthly spend cap.
 */
export function checkMonthlySpendCap(
  tenantId: string,
  spendCap?: number,
): { allowed: boolean; spent: number; cap: number; remaining: number } {
  const cap = Math.min(
    spendCap ?? DEFAULT_MONTHLY_SPEND_CAP,
    MAX_MONTHLY_SPEND_CAP,
  );
  const spent = spendLedgerRepository.getMonthlySpendTotal({
    tenantId,
    date: thisMonth(),
  });
  const remaining = Math.max(0, cap - spent);
  return {
    allowed: spent < cap,
    spent: Math.round(spent * 10) / 10,
    cap,
    remaining: Math.round(remaining * 10) / 10,
  };
}

export function getDailySpend(tenantId: string): number {
  return (
    Math.round(
      spendLedgerRepository.getDailySpendTotal({ tenantId, date: today() }) *
        10,
    ) / 10
  );
}

export function getMonthlySpendTotal(tenantId: string): number {
  return (
    Math.round(
      spendLedgerRepository.getMonthlySpendTotal({
        tenantId,
        date: thisMonth(),
      }) * 10,
    ) / 10
  );
}

/**
 * Calculate usage projection — how many days the current balance will last
 * based on average daily spend over the last 7 days (only days with recorded spend).
 */
export function getUsageProjection(
  tenantId: string,
  currentBalance: number,
  now?: Date,
): {
  avgDailySpend: number;
  daysRemaining: number | null; // null = no data or zero spend
  burnRate: string; // "low", "moderate", "high"
} {
  const base = now ?? new Date();
  const days: Array<{ date: string; amount: number }> = [];

  // Collect last 7 days (i=6 is oldest, i=0 is today/base)
  for (let i = 6; i >= 0; i--) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const amount = spendLedgerRepository.getDailySpendTotal({
      tenantId,
      date: dateStr,
    });
    if (amount > 0) days.push({ date: dateStr, amount });
  }

  if (days.length === 0) {
    return { avgDailySpend: 0, daysRemaining: null, burnRate: "low" };
  }

  const totalSpend = days.reduce((sum, h) => sum + h.amount, 0);
  const avgDailySpend = Math.round((totalSpend / days.length) * 10) / 10;

  if (avgDailySpend <= 0) {
    return { avgDailySpend: 0, daysRemaining: null, burnRate: "low" };
  }

  const daysRemaining = Math.round(currentBalance / avgDailySpend);
  const burnRate =
    avgDailySpend > 100 ? "high" : avgDailySpend > 30 ? "moderate" : "low";

  return { avgDailySpend, daysRemaining, burnRate };
}

// ─── Autopilot Action Rate Limits (per-tenant cooldowns) ────────────────────

/**
 * Check if an autopilot action is allowed (cooldown-based) and record if allowed.
 * Prevents spam from rapid button clicks or automated abuse.
 */
export function checkActionCooldown(
  tenantId: string,
  action: string,
): { allowed: boolean; retryAfterMs: number } {
  const status = spendLedgerRepository.checkActionCooldown({
    tenantId,
    action,
  });
  if (!status.allowed) {
    return { allowed: false, retryAfterMs: status.retryAfterMs };
  }
  spendLedgerRepository.recordActionCooldown({
    tenantId,
    action,
    cooldownMs: ACTION_COOLDOWN_MS,
  });
  return { allowed: true, retryAfterMs: 0 };
}

// ─── Rate Limits ────────────────────────────────────────────────────────────

export function checkLimit(
  tenant: Tenant,
  resource: LimitResource,
): { allowed: boolean; used: number; limit: number; message?: string } {
  const daily = getUsage(tenant.id);
  const used = (daily as any)[resource] || 0;
  const limit = DAILY_LIMITS[resource];

  return {
    allowed: used < limit,
    used,
    limit,
    message:
      used >= limit
        ? `Daily ${resource.replace(/_/g, " ")} limit reached (${used}/${limit}). Resets at midnight UTC.`
        : undefined,
  };
}

/**
 * Get full usage summary for dashboard.
 */
export function getUsageSummary(
  tenant: Tenant,
): Record<string, { used: number; limit: number; percent: number }> {
  const daily = getUsage(tenant.id);
  const dailySpendAmt = getDailySpend(tenant.id);
  const monthlySpendAmt = getMonthlySpendTotal(tenant.id);

  const pct = (used: number, limit: number) =>
    limit > 0 ? Math.round((used / limit) * 100) : 0;

  return {
    llm_calls: {
      used: daily.llm_calls,
      limit: DAILY_LIMITS.llm_calls,
      percent: pct(daily.llm_calls, DAILY_LIMITS.llm_calls),
    },
    search_calls: {
      used: daily.search_calls,
      limit: DAILY_LIMITS.search_calls,
      percent: pct(daily.search_calls, DAILY_LIMITS.search_calls),
    },
    outreach_runs: {
      used: daily.outreach_runs,
      limit: DAILY_LIMITS.outreach_runs,
      percent: pct(daily.outreach_runs, DAILY_LIMITS.outreach_runs),
    },
    content_posts: {
      used: daily.content_posts,
      limit: DAILY_LIMITS.content_posts,
      percent: pct(daily.content_posts, DAILY_LIMITS.content_posts),
    },
    follows: {
      used: daily.follows,
      limit: DAILY_LIMITS.follows,
      percent: pct(daily.follows, DAILY_LIMITS.follows),
    },
    daily_spend: {
      used: dailySpendAmt,
      limit: DEFAULT_DAILY_SPEND_CAP,
      percent: pct(dailySpendAmt, DEFAULT_DAILY_SPEND_CAP),
    },
    monthly_spend: {
      used: monthlySpendAmt,
      limit: DEFAULT_MONTHLY_SPEND_CAP,
      percent: pct(monthlySpendAmt, DEFAULT_MONTHLY_SPEND_CAP),
    },
  };
}
