/**
 * Auto-Follow Decision Engine.
 * Evaluates engagement signals and decides which users to follow.
 * Integrates with CRM for lead tracking.
 */

import { getConfig } from "./persona.js";
import { xFollow, checkFollowRateLimit } from "../platforms/x-follow.js";
import { loadState, saveState } from "./state.js";

interface FollowRecord {
  username: string;
  platformId: string;
  signal: string;
  confidence: number;
  followedAt: string;
  unfollowAt: string | null;
  status: "active" | "unfollowed";
}

interface FollowEngineState {
  records: FollowRecord[];
  kols: string[];
}

const STATE_KEY = "follow-engine";

export interface FollowChurnExecutionDecision {
  allowed: boolean;
  reason:
    | "auto_follow_disabled"
    | "hosted_production_default_disabled"
    | "enabled";
  configEnabled: boolean;
  hostedRuntime: boolean;
  hostedProduction: boolean;
  runtimeOptIn: boolean;
}

function isTruthyFlag(value: string | undefined): boolean {
  if (!value) return false;
  switch (value.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
      return true;
    default:
      return false;
  }
}

function isHostedRuntime(): boolean {
  return Boolean(process.env.HOSTED_DB_PATH || process.env.PULSE_URL);
}

function getFollowConfig() {
  const config = getConfig() as any;
  return (
    config.autoFollow ?? {
      enabled: false,
      dailyCap: 15,
      minConfidence: 70,
      minFollowerCount: 50,
      autoUnfollowDays: 14,
      signals: { repost: true, reply: true, tag: true, mention_positive: true },
    }
  );
}

function getEngineState(): FollowEngineState {
  return loadState<FollowEngineState>(STATE_KEY, { records: [], kols: [] });
}

export function getFollowChurnExecutionDecision(
  config: any = getConfig(),
): FollowChurnExecutionDecision {
  const configEnabled = config?.autoFollow?.enabled === true;
  const hostedRuntime = isHostedRuntime();
  const hostedProduction =
    hostedRuntime && process.env.NODE_ENV === "production";
  const runtimeOptIn = isTruthyFlag(process.env.PULSE_ALLOW_FOLLOW_CHURN);

  if (!configEnabled) {
    return {
      allowed: false,
      reason: "auto_follow_disabled",
      configEnabled,
      hostedRuntime,
      hostedProduction,
      runtimeOptIn,
    };
  }

  if (hostedProduction && !runtimeOptIn) {
    return {
      allowed: false,
      reason: "hosted_production_default_disabled",
      configEnabled,
      hostedRuntime,
      hostedProduction,
      runtimeOptIn,
    };
  }

  return {
    allowed: true,
    reason: "enabled",
    configEnabled,
    hostedRuntime,
    hostedProduction,
    runtimeOptIn,
  };
}

/**
 * Check if we should auto-follow this user.
 */
export async function shouldAutoFollow(candidate: {
  username: string;
  platformId: string;
  signal: string;
  confidence: number;
  followerCount?: number;
}): Promise<boolean> {
  const config = getConfig() as any;
  const gate = getFollowChurnExecutionDecision(config);
  if (!gate.allowed) return false;
  const cfg = config.autoFollow ?? getFollowConfig();

  // Check signal type is enabled
  const signalKey = candidate.signal.replace(
    "-",
    "_",
  ) as keyof typeof cfg.signals;
  if (cfg.signals && cfg.signals[signalKey] === false) return false;

  // Confidence check
  if (candidate.confidence < (cfg.minConfidence ?? 70)) return false;

  // Follower count check
  if (
    candidate.followerCount !== undefined &&
    candidate.followerCount < (cfg.minFollowerCount ?? 50)
  )
    return false;

  // Already following?
  const state = getEngineState();
  if (
    state.records.some(
      (r) => r.username === candidate.username && r.status === "active",
    )
  )
    return false;

  // Rate limit check
  const { ok } = checkFollowRateLimit(cfg.dailyCap ?? 15);
  return ok;
}

/**
 * Execute auto-follow for a user.
 */
export async function autoFollowUser(candidate: {
  username: string;
  platformId: string;
  signal: string;
  confidence: number;
}): Promise<{ ok: boolean; error?: string }> {
  const config = getConfig() as any;
  const gate = getFollowChurnExecutionDecision(config);
  if (!gate.allowed) {
    return { ok: false, error: gate.reason };
  }

  const result = await xFollow(candidate.platformId);
  if (!result.ok) return result;

  const cfg = config.autoFollow ?? getFollowConfig();
  const state = getEngineState();

  state.records.push({
    username: candidate.username,
    platformId: candidate.platformId,
    signal: candidate.signal,
    confidence: candidate.confidence,
    followedAt: new Date().toISOString(),
    unfollowAt: cfg.autoUnfollowDays
      ? new Date(
          Date.now() + (cfg.autoUnfollowDays ?? 14) * 86400000,
        ).toISOString()
      : null,
    status: "active",
  });

  // Cap at 1000 records
  if (state.records.length > 1000) state.records = state.records.slice(-1000);
  saveState(STATE_KEY, state);

  // CRM integration (best-effort)
  try {
    const { upsertLead } = await import("../crm/leads.js");
    const { logInteraction } = await import("../crm/interactions.js");
    const lead = upsertLead({
      platform: "x",
      platformId: candidate.platformId,
      username: candidate.username,
      profileUrl: `https://x.com/${candidate.username}`,
    });
    if (lead?.id) {
      logInteraction({
        leadId: lead.id,
        platform: "x",
        type: "follow",
        url: `https://x.com/${candidate.username}`,
      });
    }
  } catch {
    /* CRM is best-effort */
  }

  return { ok: true };
}

/**
 * Get all follow records (most recent first).
 */
export function getFollowRecords(): FollowRecord[] {
  return getEngineState().records.slice().reverse();
}

/**
 * Get KOL whitelist.
 */
export function getKolList(): string[] {
  return getEngineState().kols;
}

/**
 * Add a KOL to the whitelist.
 */
export function addKol(username: string): void {
  const state = getEngineState();
  const clean = username.replace(/^@/, "").trim();
  if (clean && !state.kols.includes(clean)) {
    state.kols.push(clean);
    saveState(STATE_KEY, state);
  }
}

/**
 * Remove a KOL from the whitelist.
 */
export function removeKol(username: string): void {
  const state = getEngineState();
  const clean = username.replace(/^@/, "").trim();
  state.kols = state.kols.filter((k) => k !== clean);
  saveState(STATE_KEY, state);
}

/**
 * Get follow-back rate and other metrics.
 */
export function getFollowMetrics(): {
  total: number;
  active: number;
  unfollowed: number;
  bySignal: Record<string, number>;
} {
  const state = getEngineState();
  const bySignal: Record<string, number> = {};
  let active = 0;
  let unfollowed = 0;

  for (const r of state.records) {
    if (r.status === "active") active++;
    else unfollowed++;
    bySignal[r.signal] = (bySignal[r.signal] || 0) + 1;
  }

  return { total: state.records.length, active, unfollowed, bySignal };
}
