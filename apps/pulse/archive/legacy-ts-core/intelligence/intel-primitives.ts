/**
 * Pure, driveable x402 intelligence primitives.
 * Extracted per strategy to provide real composition layer.
 * runIntelResearch passthroughs assembly meta (real from knowledge/X).
 * runGoalDecompose derives meta from the paid cost using CREDITS_PER_USD (no hard 0 in handler).
 */

import { assembleChatIntelContext } from './chat-intel-context.js';
import { decomposeGoal, type GoalPlan } from '../core/knowledge-store.js';
import type { IntelMeta } from '../core/knowledge-store.js';
import { CREDITS_PER_USD } from '../../hosted/billing.js';

export interface IntelPrimitiveResult {
  result: any;
  meta: IntelMeta;
}

export async function runIntelResearch(params: { query: string; brandId: string; paidCostUsd?: number }): Promise<IntelPrimitiveResult> {
  const { query, brandId, paidCostUsd = 0.001 } = params;
  const ctx = await assembleChatIntelContext(brandId, query);
  const result = {
    query,
    xIntelBlock: ctx.xIntelBlock,
    ghBlock: ctx.ghBlock,
    knowledgeBlock: ctx.knowledgeBlock,
    note: ctx.intelNote,
  };
  const kmeta = ctx.knowledgeMeta || ctx.xIntelMeta;
  const trace = kmeta?.decision_trace || `research_${query.length}`;
  const meta: IntelMeta = {
    ...(kmeta || {}),
    cache_hit: !!kmeta,
    data_cost_usdc: paidCostUsd,  // override with paid cost after kmeta spread (fixes research cost=0)
    savings_usdc: kmeta?.savings_usdc ?? 0,
    decision_trace: trace,
    source: kmeta ? (ctx.knowledgeMeta ? 'knowledge' : 'x-intel') : 'intel-assembly',
    query_purpose: 'research',
  } as any;
  return { result, meta };
}

export function runGoalDecompose(params: { goal: string; brandId: string; paidCostUsd?: number }): IntelPrimitiveResult {
  const { goal, brandId, paidCostUsd = 0.0005 } = params;
  const plan: GoalPlan = decomposeGoal(goal);
  // derive meta from the route's paid cost using the billing conversion
  // data_cost_usdc is the effective USD paid for this intel unit (thin)
  const dataCost = paidCostUsd;
  const credits = dataCost * CREDITS_PER_USD;
  const meta: IntelMeta = {
    cache_hit: false,
    data_cost_usdc: dataCost,
    would_have_cost_usdc: dataCost,
    savings_usdc: 0,
    decision_trace: `decompose_len${goal.length}_steps${plan.steps.length}_credits${credits.toFixed(1)}`,
    source: 'planner-contract',
    query_purpose: 'goal',
  } as any;
  const result = { ...plan, brandId };
  return { result, meta };
}