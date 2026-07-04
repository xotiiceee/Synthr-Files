/**
 * Legacy credit billing provider for Hosted Pulse.
 *
 * Standalone production resolves billing through configured providers and uses
 * Stripe entitlements plus durable usage events. This module remains the
 * ClawNet rollback/provider path.
 *
 * Pass-through pricing — credits reflect actual API cost. ClawNet earns on
 * credit package sales, not per-action margin.
 *
 * Floor: 0.5 credits per LLM call minimum (covers server overhead
 * even when the underlying API cost is near-zero).
 *
 * Non-LLM actions (search, follow) use flat costs — no model multiplier.
 */

import {
  buildBillingOperationIdempotencyKey,
  deduct,
} from "./billing-operations.js";
import { getHostedDb } from "./db.js";
import { getBillingProvider } from "./billing-provider.js";

// ─── Content Models ─────────────────────────────────────────────────────────

export interface ContentModel {
  id: string;
  provider: string;
  model: string;
  label: string;
  desc: string;
  maxTokensCap: number;
  /** Credit cost per action type (pass-through, 0.5cr floor) */
  costs: {
    post: number;
    reply: number;
    thread: number;
  };
}

export const CONTENT_MODELS: Record<string, ContentModel> = {
  "llama-3.3-70b": {
    id: "llama-3.3-70b",
    provider: "groq",
    model: "llama-3.3-70b-versatile",
    label: "Llama 3.3 70B",
    desc: "Fast, cheapest",
    maxTokensCap: 2000,
    costs: { post: 0.9, reply: 0.5, thread: 1.7 },
  },
  "gpt-4o-mini": {
    id: "gpt-4o-mini",
    provider: "openai",
    model: "gpt-4o-mini",
    label: "GPT-4o Mini",
    desc: "Good balance of cost and quality",
    maxTokensCap: 2000,
    costs: { post: 0.9, reply: 0.5, thread: 1.7 },
  },
  "claude-haiku": {
    id: "claude-haiku",
    provider: "anthropic",
    model: "claude-haiku-4-5-20251001",
    label: "Claude Haiku",
    desc: "High quality, fast",
    maxTokensCap: 2000,
    costs: { post: 3.5, reply: 1.7, thread: 7.0 },
  },
  "gpt-4o": {
    id: "gpt-4o",
    provider: "openai",
    model: "gpt-4o",
    label: "GPT-4o",
    desc: "Very high quality",
    maxTokensCap: 4000,
    costs: { post: 10.0, reply: 5.0, thread: 15.5 },
  },
  "claude-sonnet": {
    id: "claude-sonnet",
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    label: "Claude Sonnet",
    desc: "Best quality",
    maxTokensCap: 4000,
    costs: { post: 20.0, reply: 10.0, thread: 30.5 },
  },
};

export const DEFAULT_CONTENT_MODEL = "llama-3.3-70b";

// ─── Chat Models (per-message pricing, pass-through + 0.5cr floor) ──────────
// Chat messages cost more than content because: longer system prompt (~2k tokens),
// conversation history grows, and max output is 1000 tokens vs 300 for posts.

export interface ChatModel {
  id: string;
  provider: string;
  model: string;
  label: string;
  credits: number;
  desc: string;
}

export const CHAT_MODELS: Record<string, ChatModel> = {
  "llama-3.1-8b": {
    id: "llama-3.1-8b",
    provider: "groq",
    model: "llama-3.1-8b-instant",
    credits: 0.2,
    label: "Llama 3.1 8B",
    desc: "Cheapest",
  },
  "gpt-4o-mini": {
    id: "gpt-4o-mini",
    provider: "openai",
    model: "gpt-4o-mini",
    credits: 0.5,
    label: "GPT-4o Mini",
    desc: "Best value",
  },
  "llama-3.3-70b": {
    id: "llama-3.3-70b",
    provider: "groq",
    model: "llama-3.3-70b-versatile",
    credits: 0.9,
    label: "Llama 3.3 70B",
    desc: "Fast, good quality",
  },
  "claude-haiku": {
    id: "claude-haiku",
    provider: "anthropic",
    model: "claude-haiku-4-5-20251001",
    credits: 3.5,
    label: "Claude Haiku 4.5",
    desc: "High quality",
  },
  "gpt-4o": {
    id: "gpt-4o",
    provider: "openai",
    model: "gpt-4o",
    credits: 8.7,
    label: "GPT-4o",
    desc: "Very high quality",
  },
  "claude-sonnet": {
    id: "claude-sonnet",
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    credits: 12.0,
    label: "Claude Sonnet 4",
    desc: "Best quality",
  },
};

export const DEFAULT_CHAT_MODEL = "gpt-4o-mini";

// ─── Action Costs ───────────────────────────────────────────────────────────

/** Non-LLM actions — flat cost, no model multiplier */
export const FLAT_COSTS = {
  search_query: 1,
  discover_opportunities: 3,
  auto_follow: 1,
  voice_calibration: 10,
  content_calendar: 4,
} as const;

/** Map action names to model cost keys */
const ACTION_TO_COST_KEY: Record<string, keyof ContentModel["costs"]> = {
  generate_post: "post",
  generate_reply: "reply",
  thread_generation: "thread",
};

// Legacy exports for backwards compat
export const BASE_COSTS = {
  generate_post: 0.9,
  generate_reply: 0.5,
  thread_generation: 1.7,
  ...FLAT_COSTS,
} as const;

export type PulseAction = keyof typeof BASE_COSTS | keyof typeof FLAT_COSTS;
export const PULSE_COSTS = BASE_COSTS;

// ─── Per-Token Pricing (actual API costs) ───────────────────────────────────
// Used for dynamic billing: actual tokens × price (pass-through)

export const TOKEN_PRICING: Record<string, { input: number; output: number }> =
  {
    // Groq
    "groq:llama-3.3-70b-versatile": { input: 0.59, output: 0.79 }, // per 1M tokens
    "groq:llama-3.1-8b-instant": { input: 0.05, output: 0.08 },
    // OpenAI
    "openai:gpt-4o-mini": { input: 0.15, output: 0.6 },
    "openai:gpt-4o": { input: 2.5, output: 10.0 },
    // Anthropic
    "anthropic:claude-haiku-4-5-20251001": { input: 1.0, output: 5.0 },
    "anthropic:claude-sonnet-4-20250514": { input: 3.0, output: 15.0 },
  };

const MARKUP = 1.0; // pass-through
const MIN_CHARGE = 0.5; // Floor: 0.5 credits
const CREDITS_PER_USD = 1000; // 1 credit = $0.001

/**
 * Calculate credit cost from actual token usage.
 * Formula: (inputTokens × inputPrice + outputTokens × outputPrice) / 1M × CREDITS_PER_USD
 * Floor: 0.5 credits minimum.
 */
export function calculateDynamicCost(usage: {
  inputTokens: number;
  outputTokens: number;
  provider: string;
  model: string;
}): number {
  const key = `${usage.provider}:${usage.model}`;
  const pricing = TOKEN_PRICING[key];

  if (!pricing) {
    // Unknown model — charge minimum
    return MIN_CHARGE;
  }

  const inputCostUsd = (usage.inputTokens / 1_000_000) * pricing.input;
  const outputCostUsd = (usage.outputTokens / 1_000_000) * pricing.output;
  const totalUsd = (inputCostUsd + outputCostUsd) * MARKUP;
  const credits = totalUsd * CREDITS_PER_USD;

  // Round to 1 decimal, enforce floor
  return Math.max(MIN_CHARGE, Math.round(credits * 10) / 10);
}

// ─── Parameter Limits ───────────────────────────────────────────────────────

export const PARAM_LIMITS = {
  temperature: { min: 0, max: 1.5, default: 0.7 },
  maxTokens: {
    generate_post: { min: 50, max: 500, default: 300 },
    generate_reply: { min: 50, max: 300, default: 200 },
    thread_generation: { min: 200, max: 2000, default: 1500 },
    voice_calibration: { min: 200, max: 1000, default: 500 },
    content_calendar: { min: 200, max: 2000, default: 1500 },
  },
} as const;

// ─── Cost Calculation ───────────────────────────────────────────────────────

/**
 * Calculate credit cost for an action with a specific model.
 * LLM actions use per-model pass-through pricing.
 * Non-LLM actions use flat costs.
 */
export function calculateCost(action: string, modelId?: string): number {
  // Check if it's a flat-cost action (no model involved)
  if (action in FLAT_COSTS) {
    return (FLAT_COSTS as any)[action];
  }

  // LLM action — look up model-specific cost
  const costKey = ACTION_TO_COST_KEY[action];
  if (!costKey) return 1; // Unknown action, minimum charge

  const model = modelId
    ? CONTENT_MODELS[modelId]
    : CONTENT_MODELS[DEFAULT_CONTENT_MODEL];
  if (!model) return 1;

  return model.costs[costKey];
}

/**
 * Clamp LLM parameters to safe ranges.
 */
export function clampParams(
  action: string,
  params: { temperature?: number; maxTokens?: number },
  modelId?: string,
): { temperature: number; maxTokens: number } {
  const temp = Math.max(
    PARAM_LIMITS.temperature.min,
    Math.min(
      PARAM_LIMITS.temperature.max,
      params.temperature ?? PARAM_LIMITS.temperature.default,
    ),
  );

  const actionLimits = (PARAM_LIMITS.maxTokens as any)[action] ?? {
    min: 50,
    max: 500,
    default: 300,
  };
  const modelCap = modelId
    ? (CONTENT_MODELS[modelId]?.maxTokensCap ?? 2000)
    : 2000;
  const effectiveMax = Math.min(actionLimits.max, modelCap);

  const maxTokens = Math.max(
    actionLimits.min,
    Math.min(effectiveMax, params.maxTokens ?? actionLimits.default),
  );

  return {
    temperature: Math.round(temp * 100) / 100,
    maxTokens: Math.round(maxTokens),
  };
}

/**
 * Resolve a model ID to provider + model string for the LLM layer.
 */
export function resolveModel(
  modelId?: string,
): { provider: string; model: string } | null {
  if (!modelId) return null;
  const m = CONTENT_MODELS[modelId];
  if (!m) return null;
  return { provider: m.provider, model: m.model };
}

// ─── Billing ────────────────────────────────────────────────────────────────

/**
 * Legacy credit billing provider for Pulse actions.
 * Model-aware: uses per-model pass-through pricing.
 */
export async function billPulseAction(
  apiKey: string,
  action: string,
  modelId: string | undefined,
  options: {
    tenantId: string;
    operationId: string;
    metadata?: Record<string, unknown>;
  },
): Promise<{ ok: boolean; cost: number; remaining?: number; error?: string }> {
  const cost = calculateCost(action, modelId);
  const reason = `pulse:${action}${modelId ? `:${modelId}` : ""}`;
  const provider = getBillingProvider();

  const result = await deduct({
    tenantId: options.tenantId,
    apiKey: provider.name === "stripe" ? options.tenantId : apiKey,
    amount: cost,
    reason,
    idempotencyKey: buildBillingOperationIdempotencyKey({
      tenantId: options.tenantId,
      action,
      operationId: options.operationId,
    }),
    metadata: {
      action,
      modelId: modelId ?? "",
      operationId: options.operationId,
      ...options.metadata,
    },
  });

  if (!result.ok) {
    return {
      ok: false,
      cost,
      error:
        result.error ||
        `Insufficient usage entitlement (need ${cost}). Manage your plan in Settings.`,
    };
  }

  return { ok: true, cost, remaining: result.remaining };
}

/**
 * Check if user has enough credits for an action with a specific model.
 */
export async function canAfford(
  apiKey: string,
  action: string,
  modelId?: string,
  options?: { tenantId?: string },
): Promise<boolean> {
  const provider = getBillingProvider();
  const subject =
    provider.name === "stripe" ? (options?.tenantId ?? apiKey) : apiKey;
  return provider.canAfford(subject, calculateCost(action, modelId));
}

/**
 * Get the user's current credit balance.
 */
export async function getBalance(
  apiKey: string,
  options?: { tenantId?: string },
): Promise<number> {
  const provider = getBillingProvider();
  const subject =
    provider.name === "stripe" ? (options?.tenantId ?? apiKey) : apiKey;
  const bal = await provider.checkBalance(subject);
  const freeTierMax = parseInt(process.env.FREE_TIER_CREDITS ?? "0", 10) || 0;

  if (freeTierMax > 0 && bal <= 0) {
    const tenantId = options?.tenantId ?? apiKey;
    const row = getHostedDb()
      .prepare("SELECT encrypted_value FROM tenant_secrets WHERE tenant_id = ? AND key_name = ?")
      .get(tenantId, "free_credits") as { encrypted_value: string } | undefined;

    if (!row) {
      getHostedDb()
        .prepare("INSERT INTO tenant_secrets (tenant_id, key_name, encrypted_value, iv, auth_tag) VALUES (?, ?, ?, ?, ?)")
        .run(tenantId, "free_credits", String(freeTierMax), "free", "free");
      return freeTierMax;
    }
    return parseInt(row.encrypted_value, 10) || 0;
  }

  return bal;
}

export function deductFreeTierCredits(tenantId: string, amount: number): number {
  const freeTierMax = parseInt(process.env.FREE_TIER_CREDITS ?? "0", 10) || 0;
  if (freeTierMax <= 0) return 0;

  const row = getHostedDb()
    .prepare("SELECT encrypted_value FROM tenant_secrets WHERE tenant_id = ? AND key_name = ?")
    .get(tenantId, "free_credits") as { encrypted_value: string } | undefined;

  const current = row ? parseInt(row.encrypted_value, 10) || 0 : freeTierMax;
  const newBalance = Math.max(0, current - amount);

  getHostedDb()
    .prepare("UPDATE tenant_secrets SET encrypted_value = ? WHERE tenant_id = ? AND key_name = ?")
    .run(String(newBalance), tenantId, "free_credits");

  return newBalance;
}

/**
 * Return the credit cost for an action + model without deducting.
 * Delegates to calculateCost — no logic duplication.
 */
export function getActionCost(action: string, modelId: string): number {
  return calculateCost(action, modelId || undefined);
}
