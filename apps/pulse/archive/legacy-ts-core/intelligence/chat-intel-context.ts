/**
 * Pure, testable intel assembly for chat.
 * Extracted per strategy to decouple AC3 observables (blocks + note + meta) from LLM.
 * Drive this after pushGitHubToIntelGateway for verif step 3 without sim or LLM dependency.
 */

import { getCheapBrandIntelForChat, logXIntelMeasurement, searchKnowledge, type IntelMeta } from '../core/x-intel-gateway.js';
import { getGitHubContextForChat } from '../core/github-intel.js';
import type { KnowledgeItem } from '../core/knowledge-store.js';

export interface ChatIntelContext {
  xIntelBlock: string;
  ghBlock: string;
  knowledgeBlock: string;
  xIntelMeta: IntelMeta | null;
  knowledgeMeta: IntelMeta | null;
  intelNote: string;
  // Convenience: the suffix to append to SYSTEM_PROMPT + other context for the LLM prompt
  fullSystemSuffix: string;
}

/**
 * Assemble combined X + GitHub + knowledge intel for a brand + user query.
 * Uses the real shipped retrievals.
 * Replaces bare catch {} with log + rethrow so failures are observable.
 */
export async function assembleChatIntelContext(brandId: string, userMessage: string): Promise<ChatIntelContext> {
  const currentBrand = brandId; // caller should pass the resolved tenantId-style key

  // X intel (async)
  let xIntelBlock = '';
  let xIntelMeta: IntelMeta | null = null;
  try {
    const intel = await getCheapBrandIntelForChat(currentBrand, userMessage, { purpose: 'chat' });
    if (intel.contextSnippet) {
      xIntelBlock = `\n\n${intel.contextSnippet}\n`;
    }
    xIntelMeta = intel.meta;
    logXIntelMeasurement(intel.meta, `chat:${userMessage.slice(0, 60)}`);
  } catch (e) {
    console.error('[chat-intel-context] X intel retrieval failed', e);
    throw e;
  }

  // GitHub linkage (async, now real via knowledge store)
  let ghBlock = '';
  try {
    ghBlock = await getGitHubContextForChat(currentBrand, userMessage);
  } catch (e) {
    console.error('[chat-intel-context] GitHub context retrieval failed', e);
    throw e;
  }

  // Unified GitHub/knowledge semantic (sync pure after extraction)
  let knowledgeBlock = '';
  let knowledgeMeta: IntelMeta | null = null;
  try {
    const k = searchKnowledge(currentBrand, userMessage, 3);
    if (k.items?.length) {
      knowledgeBlock = '\n\nRelevant GitHub/Knowledge context:\n' + k.items.map((it: KnowledgeItem) => `- ${it.content?.slice(0, 200)}`).join('\n');
      knowledgeMeta = k.meta;
      console.log(`[intel] Used GitHub knowledge semantic hits for chat (brand ${currentBrand}, cost $${k.meta.data_cost_usdc}, savings $${k.meta.savings_usdc}, trace=${k.meta.decision_trace})`);
    }
  } catch (e) {
    console.error('[chat-intel-context] knowledge search failed', e);
    throw e;
  }

  const fullSystemSuffix = (xIntelBlock + ghBlock + knowledgeBlock).trim();

  // Precompute the observability note (AC3) — always available when metas exist
  let intelNote = '';
  if (xIntelMeta || knowledgeMeta) {
    const totalSave = ((xIntelMeta?.savings_usdc || 0) + (knowledgeMeta?.savings_usdc || 0)).toFixed(4);
    intelNote = `\n\n[used X + GitHub intel, cost $0 (saved $${totalSave})]`;
  }

  return {
    xIntelBlock,
    ghBlock,
    knowledgeBlock,
    xIntelMeta,
    knowledgeMeta,
    intelNote,
    fullSystemSuffix,
  };
}
