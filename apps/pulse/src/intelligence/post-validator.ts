/**
 * Post Validator — catches bad posts before they go live.
 *
 * Rule-based validation (no LLM needed, instant):
 * - Check numbers against brand profile key facts
 * - Check neverSay words
 * - Check character limits
 * - Check for common LLM slop patterns
 * - Check for accidental self-promotion in replies
 *
 * Returns pass/fail with reasons. The caller decides what to do.
 */

import { loadBrandProfile } from './brand-profile.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ValidationResult {
  pass: boolean;
  issues: string[];
  warnings: string[];
}

// ─── Patterns ───────────────────────────────────────────────────────────────

const LLM_SLOP_PATTERNS = [
  /^(great|nice|good|awesome|amazing|excellent)\s+(point|take|thread|post|question)/i,
  /^(here'?s?|this is)\s+(my|a)\s+(take|reply|response|thought)/i,
  /^as an? (ai|language model|assistant)/i,
  /\bI'?d be happy to\b/i,
  /\bin conclusion\b/i,
  /\blet me (explain|break|share|unpack)\b/i,
  /\bI hope (this|that) helps\b/i,
  /\bfeel free to\b/i,
  /\bI appreciate (your|the) (question|input|feedback)\b/i,
  /\bthanks for (asking|sharing|your)\b/i,
  /\bthat'?s? a (great|good|excellent|fantastic) question\b/i,
  /\bhere'?s? what I think\b/i,
  /\bdelve (into|deeper)\b/i,
  /\btap into\b/i,
  /\bleverage (the|your|our)\b/i,
  /\bgame[- ]?changer\b/i,
  /\bunlock (the|your|new)\b/i,
];

const PLATFORM_CHAR_LIMITS: Record<string, number> = {
  x: 280,
  reddit: 10000,
  hackernews: 10000,
  linkedin: 3000,
  discord: 2000,
  producthunt: 500,
};

// ─── Validation ─────────────────────────────────────────────────────────────

/**
 * Validate a post before publishing. Instant, no API calls.
 */
export function validatePost(
  text: string,
  platform: string = 'x',
  type: 'post' | 'reply' = 'post',
): ValidationResult {
  const issues: string[] = [];
  const warnings: string[] = [];
  const profile = loadBrandProfile();

  // ── Character limit ─────────────────────────────────────────────────────
  const limit = PLATFORM_CHAR_LIMITS[platform] ?? 280;
  if (text.length > limit) {
    issues.push(`Over ${platform} character limit (${text.length}/${limit})`);
  }

  // ── Too short ───────────────────────────────────────────────────────────
  if (text.length < 15) {
    issues.push('Too short — likely generation failure');
  }

  // ── NeverSay words ──────────────────────────────────────────────────────
  for (const word of profile.voice.neverSay) {
    if (text.toLowerCase().includes(word.toLowerCase())) {
      issues.push(`Contains banned phrase: "${word}"`);
    }
  }

  // ── LLM slop patterns (global + brand-configurable) ─────────────────
  const allowedSlop = new Set((profile.styleRules as any).allowedSlopPatterns ?? []);
  const extraSlop = ((profile.styleRules as any).extraSlopPatterns ?? [])
    .map((p: string) => { try { return new RegExp(p, 'i'); } catch { return null; } })
    .filter(Boolean) as RegExp[];

  const allPatterns = [...LLM_SLOP_PATTERNS, ...extraSlop];
  for (const pattern of allPatterns) {
    if (pattern.test(text)) {
      // Check if this pattern is explicitly allowed for this brand
      if (allowedSlop.has(pattern.source)) continue;
      warnings.push('Contains common LLM phrasing — may sound robotic');
      break;
    }
  }

  // ── Number inflation check ──────────────────────────────────────────────
  // Look for large numbers in the text and cross-reference with key facts
  const numberMatches = text.match(/\b\d{1,3}(,\d{3})+\b|\b\d{4,}\b/g);
  if (numberMatches && profile.identity.keyFacts.length > 0) {
    for (const num of numberMatches) {
      const cleanNum = num.replace(/,/g, '');
      const numVal = parseInt(cleanNum);
      if (numVal > 1000) {
        // Check if this number appears in key facts
        const inFacts = profile.identity.keyFacts.some(f => f.includes(cleanNum) || f.includes(num));
        if (!inFacts) {
          warnings.push(`Large number "${num}" not found in brand key facts — verify accuracy`);
        }
      }
    }
  }

  // ── Style rule violations ───────────────────────────────────────────────
  if (!profile.styleRules.useHashtags && /#\w+/.test(text)) {
    warnings.push('Contains hashtags but brand profile has useHashtags: false');
  }

  if (!profile.styleRules.usePolls && /[A-D]\)\s/g.test(text)) {
    warnings.push('Looks like poll format but brand profile has usePolls: false');
  }

  // ── Emoji enforcement ──────────────────────────────────────────────────
  const emojiCount = (text.match(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu) ?? []).length;
  if (profile.styleRules.emojiUsage === 'none' && emojiCount > 0) {
    warnings.push(`Contains ${emojiCount} emoji but brand profile has emojiUsage: none`);
  } else if (profile.styleRules.emojiUsage === 'minimal' && emojiCount > 1) {
    warnings.push(`${emojiCount} emoji exceeds "minimal" limit (max 1)`);
  }

  // ── Story opener enforcement ───────────────────────────────────────────
  if (!profile.styleRules.useStoryOpeners && /^(when I was|I (once|recently|just)|the other day|so I was|I remember when)/i.test(text)) {
    warnings.push('Starts with story opener but brand profile has useStoryOpeners: false');
  }

  // ── Reply-specific checks ──────────────────────────────────────────────
  if (type === 'reply') {
    // Check for self-promotion in replies (usually bad)
    if (/https?:\/\//i.test(text)) {
      warnings.push('Reply contains URL — may look promotional in a conversation');
    }
  }

  return {
    pass: issues.length === 0,
    issues,
    warnings,
  };
}
