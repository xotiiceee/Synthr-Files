/**
 * Unified Prompt Builder — single source of identity for all LLM calls.
 *
 * Replaces the overlapping persona prompt + voice block + brand profile context
 * with one coherent identity block. Used by both content generator and reply
 * generator for consistent brand voice across all output.
 *
 * The prompt has two parts:
 * 1. Identity (who you are) — from brand profile, stable
 * 2. Context (what you know) — from domain knowledge + knowledge notes, topic-matched
 */

import { loadBrandProfile, buildStyleRulesForPlatform } from './brand-profile.js';
import { getKnowledgeContext } from './knowledge-context.js';
import { loadRuntimeAgentState as loadAgentState } from '../core/runtime-agent-state.js';

// ─── Identity Block ─────────────────────────────────────────────────────────

/**
 * Build the complete identity block for any LLM call.
 * This is the "who you are" part — same for posts and replies.
 */
export function buildIdentityBlock(): string {
  const profile = loadBrandProfile();
  const parts: string[] = [];

  // Core identity
  if (profile.identity.name) {
    parts.push(`You are the voice of ${profile.identity.name}.`);
  }
  if (profile.identity.tagline) {
    parts.push(profile.identity.tagline);
  }
  if (profile.identity.description) {
    parts.push(profile.identity.description);
  }

  // Key facts (exact numbers — never inflate)
  if (profile.identity.keyFacts.length > 0) {
    parts.push(`\nKey facts (use these exact numbers, never round up or inflate):`);
    for (const fact of profile.identity.keyFacts) {
      parts.push(`- ${fact}`);
    }
  }

  // Stance — what the brand believes (auto-derived from what it builds)
  if (profile.stance) {
    parts.push(`\nBrand stance: ${profile.stance}`);
  }

  // Voice
  parts.push('');
  if (profile.voice.toneNotes) {
    parts.push(`Voice: ${profile.voice.toneNotes}`);
  }
  if (profile.voice.signatures.length > 0) {
    parts.push(`Signature phrases: ${profile.voice.signatures.join(', ')}`);
  }
  if (profile.voice.neverSay.length > 0) {
    parts.push(`Never say: ${profile.voice.neverSay.join(', ')}`);
  }

  // Learned patterns
  if (profile.learned.topPerformers.length > 0) {
    parts.push(`\nWhat resonates with your audience: ${profile.learned.topPerformers.join(', ')}`);
  }
  if (profile.learned.bottomPerformers.length > 0) {
    parts.push(`What doesn't land: ${profile.learned.bottomPerformers.join(', ')}`);
  }
  if (profile.learned.insights.length > 0) {
    for (const insight of profile.learned.insights.slice(0, 3)) {
      parts.push(`- ${insight}`);
    }
  }

  return parts.join('\n');
}

// ─── Rules Block ────────────────────────────────────────────────────────────

/**
 * Build rules from the brand profile's contentRules.
 * Only enabled rules are included. Users can toggle any rule off in Settings.
 */
function buildRulesBlock(): string {
  const profile = loadBrandProfile();
  const rules = profile.contentRules ?? [];
  const enabled = rules.filter(r => r.enabled);

  if (enabled.length === 0) return '- Write naturally, no specific constraints.';

  return enabled.map(r => `- ${r.text}`).join('\n');
}

// ─── Context Block ──────────────────────────────────────────────────────────

/**
 * Build the topic-matched context block.
 * Combines domain knowledge (from auto-research) with knowledge notes.
 */
export function buildContextBlock(topic: string): string {
  const parts: string[] = [];
  const safeTopic = topic || '';

  // Domain knowledge from auto-research
  try {
    const domain = loadAgentState<{ chunks?: Array<{ topic: string; content: string; tags: string[] }> }>('domain-knowledge', {});
    if (domain.chunks && domain.chunks.length > 0) {
      const topicWords = new Set(safeTopic.toLowerCase().split(/\s+/).filter(w => w.length > 3));
      const matched = domain.chunks.filter(c =>
        c.tags.some(t => topicWords.has(t.toLowerCase())) || topicWords.size === 0
      );
      const toInclude = matched.length > 0 ? matched : domain.chunks.slice(0, 3);
      if (toInclude.length > 0) {
        parts.push('Niche intelligence:');
        for (const c of toInclude) {
          parts.push(`- ${c.content}`);
        }
      }
    }
  } catch {}

  // Knowledge notes (topic-matched)
  const knowledgeNotes = getKnowledgeContext(safeTopic || undefined);
  if (knowledgeNotes) {
    parts.push(knowledgeNotes);
  }

  return parts.length > 0 ? `\n${parts.join('\n')}\n` : '';
}

// ─── Complete Prompt Assembly ────────────────────────────────────────────────

/**
 * Build the complete system prompt for content generation.
 * Identity + context + style rules + task.
 */
export function buildContentPrompt(opts: {
  topic: string;
  platform: string;
  contentType: string;
  typeGuidance: string;
  format: string;
  formatInstruction: string;
}): string {
  const identity = buildIdentityBlock();
  const context = buildContextBlock(opts.topic);
  const style = buildStyleRulesForPlatform(opts.platform);

  // Build the guidance section — DNA guidance if available, otherwise minimal
  const guidanceSection = opts.typeGuidance
    ? `\n${opts.typeGuidance}\n`
    : '';

  return `${identity}
${context}
Write an original ${opts.platform} post about the topic described below.
Write as someone who works in this space — sharing a real insight, observation, or opinion. Not a lecture, not a pitch, not a generic take. Something a real person in this field would actually post.
${opts.platform === 'x' ? 'CRITICAL: Maximum 280 characters. Count carefully. Most good tweets are 150-250 chars.' : ''}

Topic: ${opts.topic || 'something relevant to the brand and niche'}
${guidanceSection}
FORMAT: ${opts.format}
${opts.formatInstruction}

Style: ${style}

Rules (set by the brand owner — follow these exactly):
${buildRulesBlock()}
- Follow the style rules above
- Just output the post text, nothing else

Post:`;
}

/**
 * Build the complete system prompt for reply generation.
 * Identity + context + platform voice.
 */
export function buildReplySystemPrompt(opts: {
  conversationText: string;
  platform: string;
  platformVoice: { systemPromptAddition: string; formatRules: string[]; doNot: string[] };
}): string {
  const identity = buildIdentityBlock();
  const context = buildContextBlock(opts.conversationText);
  const style = buildStyleRulesForPlatform(opts.platform);

  return `${identity}
${context}
Style: ${style}
Platform (${opts.platform.toUpperCase()}): ${opts.platformVoice.systemPromptAddition}
Format rules: ${opts.platformVoice.formatRules.join('. ')}
Do NOT: ${opts.platformVoice.doNot.join(', ')}`;
}
