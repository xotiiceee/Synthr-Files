/**
 * Brand Profile — single source of truth for who this brand is.
 *
 * Replaces scattered knowledge notes as the primary context for content
 * generation. The profile is structured, LLM-maintained, and user-editable.
 *
 * Three layers:
 * 1. Brand Profile (always loaded, ~1000 tokens) — identity, voice, style rules
 * 2. Domain Knowledge (topic-matched) — opinionated chunks tagged by topic
 * 3. Learned Patterns (from engagement feedback) — what works, what doesn't
 *
 * The content generator reads the profile. The chat system updates it.
 * The engagement monitor feeds "learned" patterns back in.
 * Knowledge notes still exist but are secondary to the profile.
 */

import {
  currentRuntimeAgentId as currentAgentId,
  loadRuntimeAgentState as loadAgentState,
  saveRuntimeAgentState as saveAgentState,
} from '../core/runtime-agent-state.js';
import { getConfig } from '../core/persona.js';
import { loadState } from '../core/state.js';
import { getDataDir } from '../core/state.js';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface BrandProfile {
  /** Core identity — who we are, what we do, key numbers */
  identity: {
    name: string;
    tagline: string;
    description: string;
    /** Key facts the bot must know (will be verified against) */
    keyFacts: string[];
  };
  /** Voice — how we sound */
  voice: {
    /** Words/phrases to never use */
    neverSay: string[];
    /** Words/phrases that are part of the brand voice */
    signatures: string[];
    /** General tone guidance */
    toneNotes: string;
  };
  /** What the brand believes — auto-derived from what it builds, refinable by user */
  stance?: string;
  /** Style rules — customer-controlled preferences */
  styleRules: {
    /** Use hashtags? (default: false for most brands) */
    useHashtags: boolean;
    /** Use poll format? */
    usePolls: boolean;
    /** Use emoji? And how much? */
    emojiUsage: 'none' | 'minimal' | 'moderate' | 'heavy';
    /** Use story-style openers? ("when I was building...") */
    useStoryOpeners: boolean;
    /** Any custom rules the user set */
    customRules: string[];
    /** Additional slop patterns to block (brand-specific) */
    extraSlopPatterns: string[];
    /** Default slop patterns to ALLOW for this brand (override global blocks) */
    allowedSlopPatterns: string[];
  };
  /** Content integrity rules — visible to user, editable, enforced in every post.
   *  Defaults are universal common-sense rules. User can disable/modify any of them. */
  contentRules: Array<{ id: string; text: string; enabled: boolean }>;
  /** Content themes — what topics to post about (seeded by auto-research) */
  contentThemes: string[];
  /** Content mix — what percentage of each type to generate */
  contentMix: {
    educational: number;
    personal: number;
    engagement: number;
    promotional: number;
  };
  /** Learned patterns from engagement feedback */
  learned: {
    /** What content types perform well */
    topPerformers: string[];
    /** What content types flop */
    bottomPerformers: string[];
    /** Best posting times (from engagement data) */
    bestHours: number[];
    /** General observations */
    insights: string[];
    /** Learned engagement scoring weights — replaces hardcoded likes+replies*3+reposts*5 */
    engagementWeights?: { likes: number; replies: number; reposts: number };
    /** Last updated */
    updatedAt?: string;
  };
  /** When the profile was last modified */
  updatedAt: string;
}

// ─── Defaults ───────────────────────────────────────────────────────────────

/** Default content integrity rules — universal common sense.
 *  Users see these in Settings and can toggle/edit any of them. */
export function DEFAULT_CONTENT_RULES(): BrandProfile['contentRules'] {
  return [
    { id: 'no-fabrication', text: 'Never fabricate anecdotes, scenarios, or statistics. Every claim must be real or from brand facts.', enabled: true },
    { id: 'no-self-contradict', text: 'Never argue against the brand\'s own product or core approach.', enabled: true },
    { id: 'no-fake-promises', text: 'Never announce features or capabilities that don\'t exist yet.', enabled: true },
    { id: 'no-unprompted-competitor-trash', text: 'Don\'t trash competitors by name unless the user specifically wants that.', enabled: true },
    { id: 'no-generic-templates', text: 'Avoid generic thought-leadership templates ("isn\'t just X — it\'s Y", "here\'s the thing", "unpopular take:").', enabled: true },
    { id: 'use-real-details', text: 'Use specific details from brand knowledge — real tech names, real numbers, real protocols. Vague posts are worthless.', enabled: true },
    { id: 'builder-perspective', text: 'Post from the perspective of someone who builds the solution, not someone lecturing about problems.', enabled: true },
    { id: 'respect-char-limits', text: 'Strictly respect platform character limits. X = 280 chars max.', enabled: true },
  ];
}

function defaultProfile(): BrandProfile {
  const config = getConfig();
  const persona = config.persona || {} as any;
  const voice = config.humanBehavior?.voice || {} as any;

  return {
    identity: {
      name: persona.brandName || '',
      tagline: persona.tagline || '',
      description: persona.uniqueValue || persona.problemSolved || '',
      keyFacts: [],
    },
    voice: {
      neverSay: persona.neverSay || [],
      signatures: voice.catchphrases || [],
      toneNotes: persona.tone || 'professional',
    },
    styleRules: {
      useHashtags: false,
      usePolls: false,
      emojiUsage: (voice.emojiFrequency as any) || 'none',
      useStoryOpeners: false,
      customRules: [],
      extraSlopPatterns: [],
      allowedSlopPatterns: [],
    },
    contentRules: DEFAULT_CONTENT_RULES(),
    contentThemes: config.contentThemes ?? [],
    contentMix: {
      educational: 0.35,
      personal: 0.25,
      engagement: 0.25,
      promotional: 0.15,
    },
    learned: {
      topPerformers: [],
      bottomPerformers: [],
      bestHours: [],
      insights: [],
    },
    updatedAt: new Date().toISOString(),
  };
}

// ─── Load / Save ────────────────────────────────────────────────────────────

const STATE_KEY = 'brand-profile';

export function loadBrandProfile(agentId?: string): BrandProfile {
  const saved = loadAgentState<BrandProfile | null>(STATE_KEY, null, agentId);
  if (saved && saved.identity) {
    // ── Auto-migrate: backfill any missing fields from defaults ──
    // This means we NEVER need to delete stale profiles when adding new fields.
    let migrated = false;
    if (!saved.contentRules || saved.contentRules.length === 0) {
      saved.contentRules = DEFAULT_CONTENT_RULES();
      migrated = true;
    }
    if (!saved.stance && saved.identity.name && saved.identity.description) {
      saved.stance = `${saved.identity.name} builds ${saved.identity.description.split('.')[0].toLowerCase()}. Posts should reflect belief in this approach and never argue against it.`;
      migrated = true;
    }
    // Search topics are now handled by topic-discovery.ts (LLM-generated)
    // The scheduler calls ensureTopicsExist() on each tick — no sync extraction needed here.
    if (!saved.styleRules.extraSlopPatterns) { saved.styleRules.extraSlopPatterns = []; migrated = true; }
    if (!saved.styleRules.allowedSlopPatterns) { saved.styleRules.allowedSlopPatterns = []; migrated = true; }
    if (!saved.learned.engagementWeights) { saved.learned.engagementWeights = undefined; } // optional, don't force
    if (migrated) {
      saveAgentState(STATE_KEY, saved, agentId);
      console.log(`[BrandProfile] Auto-migrated profile: backfilled missing fields`);
    }

    // Re-sync from config + knowledge notes if profile identity is empty
    if (!saved.identity.name || saved.identity.name === '') {
      try {
        // Try pulse.yaml first
        const config = getConfig();
        const persona = config.persona || {} as any;
        if (persona.brandName && persona.brandName !== 'My Brand') {
          saved.identity.name = persona.brandName;
          if (persona.tagline) saved.identity.tagline = persona.tagline;
          if (persona.uniqueValue || persona.problemSolved) {
            saved.identity.description = persona.uniqueValue || persona.problemSolved || '';
          }
          if (persona.niche) saved.voice.toneNotes = `${saved.voice.toneNotes || ''} Niche: ${persona.niche}`.trim();
        }

        // Extract from knowledge notes if config didn't help
        if (!saved.identity.name) {
          try {
            const aid = agentId || currentAgentId();
            console.log(`[BrandProfile] Identity empty, checking knowledge notes for agent: ${aid}`);
            let notes = loadState<Array<{ title: string; content: string; priority: number }>>(`knowledge-notes-${aid}`, []);
            console.log(`[BrandProfile] Per-agent notes (knowledge-notes-${aid}): ${notes.length} found`);
            if (notes.length === 0) {
              notes = loadState(`knowledge-notes`, []);
              console.log(`[BrandProfile] Shared notes (knowledge-notes): ${notes.length} found`);
            }

            if (notes.length > 0) {
              // Find brand name from note titles or content
              for (const n of notes) {
                const nameMatch = n.title.match(/^([A-Z][A-Za-z0-9]+(?:\s[A-Za-z0-9]+)?)\s+(Overview|Value|Features|Platform)/);
                if (nameMatch && !saved.identity.name) {
                  saved.identity.name = nameMatch[1];
                  console.log(`[BrandProfile] Extracted brand name: ${saved.identity.name}`);
                }
              }

              // Also try: first word of first note title if no pattern match
              if (!saved.identity.name && notes[0]?.title) {
                const firstWord = notes[0].title.split(/\s+/)[0];
                if (firstWord && firstWord.length > 1 && /^[A-Z]/.test(firstWord)) {
                  saved.identity.name = firstWord;
                  console.log(`[BrandProfile] Extracted brand name (fallback): ${saved.identity.name}`);
                }
              }

              // Extract description from the first overview note
              const overviewNote = notes.find(n => /overview|value|about/i.test(n.title));
              if (overviewNote && !saved.identity.description) {
                saved.identity.description = overviewNote.content.slice(0, 300);
              }

              // Extract key facts from all high-priority notes
              const keyFacts: string[] = [];
              for (const n of notes.filter(n => n.priority >= 2)) {
                const sentences = n.content.split(/\.\s+/);
                for (const s of sentences) {
                  if (/\d/.test(s) && s.length > 20 && s.length < 200) {
                    keyFacts.push(s.trim().replace(/\.$/, ''));
                  }
                }
              }
              if (keyFacts.length > 0 && saved.identity.keyFacts.length === 0) {
                saved.identity.keyFacts = keyFacts.slice(0, 15);
              }
            }
          } catch (err) {
            console.error(`[BrandProfile] Knowledge note extraction failed:`, err);
          }
        }

        if (saved.identity.name) {
          // Auto-derive stance from what the brand builds
          if (!saved.stance && saved.identity.name && saved.identity.description) {
            saved.stance = `${saved.identity.name} builds ${saved.identity.description.split('.')[0].toLowerCase()}. Posts should reflect belief in this approach and never argue against it.`;
            console.log(`[BrandProfile] Auto-derived stance: ${saved.stance.slice(0, 100)}`);
          }

          // Also extract content themes from knowledge notes if themes are empty
          if ((!saved.contentThemes || saved.contentThemes.length === 0)) {
            try {
              const aid = agentId || currentAgentId();
              let notes = loadState<Array<{ title: string; content: string }>>(`knowledge-notes-${aid}`, []);
              if (notes.length === 0) notes = loadState(`knowledge-notes`, []);

              if (notes.length > 0) {
                // Extract specific, postable themes from note content
                const themes: string[] = [];
                for (const n of notes) {
                  // Use note titles as theme seeds (they're already topic-focused)
                  const cleanTitle = n.title.replace(/^(Overview|Features|Value Proposition)\s*$/i, '').trim();
                  if (cleanTitle && cleanTitle.length > 3) {
                    themes.push(cleanTitle.toLowerCase());
                  }
                  // Extract specific technologies/concepts mentioned
                  const techMatches = n.content.match(/\b(x402|Soma|Skills Marketplace|circuit breaker|smart cache|orchestrat\w+|credit billing|USDC|Solana|ERC-\d+|libp2p|webhook|API key|rate limit|provenance|birth certificate)/gi);
                  if (techMatches) {
                    for (const t of techMatches) themes.push(t.toLowerCase());
                  }
                }
                // Deduplicate and take top 15
                const unique = [...new Set(themes)].filter(t => t.length > 3).slice(0, 15);
                if (unique.length > 0) {
                  saved.contentThemes = unique;
                  console.log(`[BrandProfile] Auto-extracted ${unique.length} content themes: ${unique.join(', ')}`);

                  // Search topics are handled async by topic-discovery.ts (LLM-generated)
                  // Writes contentThemes to pulse.yaml for the content generator
                  try {
                    const configPath = path.join(getDataDir(), 'pulse.yaml');
                    if (fs.existsSync(configPath)) {
                      const existing = YAML.parse(fs.readFileSync(configPath, 'utf-8')) || {};
                      if (!existing.contentThemes || existing.contentThemes.length === 0) {
                        existing.contentThemes = unique;
                        fs.writeFileSync(configPath, YAML.stringify(existing), 'utf-8');
                      }
                    }
                  } catch {}
                }
              }
            } catch {}
          }

          saveAgentState(STATE_KEY, saved, agentId);
          console.log(`[BrandProfile] Auto-populated: name=${saved.identity.name}, facts=${saved.identity.keyFacts.length}, themes=${saved.contentThemes?.length || 0}, desc=${saved.identity.description?.length || 0} chars`);
        } else {
          console.log(`[BrandProfile] Could not extract brand name from config or notes`);
        }
      } catch {}
    }
    return saved;
  }
  // Initialize from pulse.yaml config on first load
  const profile = defaultProfile();
  saveAgentState(STATE_KEY, profile, agentId);
  return profile;
}

export function saveBrandProfile(profile: BrandProfile, agentId?: string): void {
  profile.updatedAt = new Date().toISOString();
  saveAgentState(STATE_KEY, profile, agentId);
}

/**
 * Initialize a brand profile from agent preset data (hosted mode).
 * Called at agent creation — doesn't read pulse.yaml, uses provided data.
 */
export function initProfileFromAgentData(data: {
  brandName?: string;
  niche?: string;
  website?: string;
  xHandle?: string;
  tone?: string;
  tagline?: string;
}): BrandProfile {
  const profile = defaultProfile();

  if (data.brandName) profile.identity.name = data.brandName;
  if (data.tagline) profile.identity.tagline = data.tagline;
  if (data.tone) profile.voice.toneNotes = data.tone;

  // Niche-aware defaults (before auto-research overrides them)
  const nicheLower = (data.niche || '').toLowerCase();
  if (/meme|degen|nft|crypto.*communit/i.test(nicheLower)) {
    profile.styleRules.useHashtags = true;
    profile.styleRules.emojiUsage = 'heavy';
    profile.styleRules.useStoryOpeners = true;
  } else if (/saas|b2b|enterprise|fintech/i.test(nicheLower)) {
    profile.styleRules.useHashtags = false;
    profile.styleRules.emojiUsage = 'none';
    profile.styleRules.useStoryOpeners = false;
  } else if (/fitness|health|coach|wellness/i.test(nicheLower)) {
    profile.styleRules.useHashtags = true;
    profile.styleRules.emojiUsage = 'moderate';
    profile.styleRules.useStoryOpeners = true;
  } else if (/creator|influencer|personal.*brand/i.test(nicheLower)) {
    profile.styleRules.emojiUsage = 'minimal';
    profile.styleRules.useStoryOpeners = true;
  }

  saveAgentState(STATE_KEY, profile);
  return profile;
}

// ─── Profile → Prompt Context ───────────────────────────────────────────────

/**
 * Build the brand profile context block for injection into LLM prompts.
 * This replaces hardcoded rules — everything comes from the profile.
 */
export function buildProfileContext(): string {
  const profile = loadBrandProfile();
  const parts: string[] = [];

  // Identity
  if (profile.identity.name) {
    parts.push(`Brand: ${profile.identity.name}`);
  }
  if (profile.identity.tagline) {
    parts.push(`Tagline: ${profile.identity.tagline}`);
  }
  if (profile.identity.description) {
    parts.push(`What we do: ${profile.identity.description}`);
  }
  if (profile.identity.keyFacts.length > 0) {
    parts.push(`Key facts (use these exact numbers, never inflate):\n${profile.identity.keyFacts.map(f => `- ${f}`).join('\n')}`);
  }

  // Voice
  if (profile.voice.neverSay.length > 0) {
    parts.push(`Never say: ${profile.voice.neverSay.join(', ')}`);
  }
  if (profile.voice.signatures.length > 0) {
    parts.push(`Brand phrases: ${profile.voice.signatures.join(', ')}`);
  }
  if (profile.voice.toneNotes) {
    parts.push(`Tone: ${profile.voice.toneNotes}`);
  }

  // Style rules (customer-controlled, not hardcoded)
  const rules: string[] = [];
  if (!profile.styleRules.useHashtags) rules.push('Do NOT use hashtags');
  if (profile.styleRules.useHashtags) rules.push('Hashtags OK (max 2, relevant only)');
  if (!profile.styleRules.usePolls) rules.push('Do NOT use poll/multiple-choice format');
  if (profile.styleRules.usePolls) rules.push('Poll format OK when asking genuine questions');
  if (!profile.styleRules.useStoryOpeners) rules.push('Do NOT start with "when I was building..." or "I realized that..."');
  if (profile.styleRules.emojiUsage === 'none') rules.push('No emoji');
  else if (profile.styleRules.emojiUsage === 'minimal') rules.push('Emoji OK but max 1 per post');
  else if (profile.styleRules.emojiUsage === 'moderate') rules.push('Emoji encouraged (2-3 per post)');
  else if (profile.styleRules.emojiUsage === 'heavy') rules.push('Heavy emoji usage — match community energy');

  for (const r of profile.styleRules.customRules) {
    rules.push(r);
  }
  if (rules.length > 0) {
    parts.push(`Style rules:\n${rules.map(r => `- ${r}`).join('\n')}`);
  }

  // Learned patterns (from engagement feedback)
  if (profile.learned.topPerformers.length > 0) {
    parts.push(`What works well: ${profile.learned.topPerformers.join(', ')}`);
  }
  if (profile.learned.bottomPerformers.length > 0) {
    parts.push(`What doesn't work: ${profile.learned.bottomPerformers.join(', ')}`);
  }
  if (profile.learned.insights.length > 0) {
    parts.push(`Learned insights:\n${profile.learned.insights.map(i => `- ${i}`).join('\n')}`);
  }

  return parts.length > 0
    ? `\nBRAND PROFILE:\n${parts.join('\n')}\n`
    : '';
}

/**
 * Build platform-neutral style rules from the profile.
 * Used by content generator instead of hardcoded PLATFORM_STYLE.
 */
export function buildStyleRulesForPlatform(platform: string): string {
  const profile = loadBrandProfile();

  // Platform-specific constraints (these are real platform limits, not preferences)
  const platformLimits: Record<string, string> = {
    x: 'X (Twitter): Max 280 characters. Line breaks for emphasis.',
    reddit: 'Reddit: Longer, thoughtful, conversational. 2-4 paragraphs.',
    hackernews: 'Hacker News: Technical, substantive. Lead with insight.',
    linkedin: 'LinkedIn: Professional. Up to 1300 chars. Hook in first line.',
    discord: 'Discord: Casual, concise. Max 400 chars.',
    producthunt: 'Product Hunt: Focus on the problem being solved. Under 500 chars.',
  };

  let style = platformLimits[platform] ?? platformLimits['x'];

  // Customer-controlled style additions
  if (!profile.styleRules.useHashtags) style += ' No hashtags.';
  if (!profile.styleRules.usePolls) style += ' No poll/list format.';
  if (profile.styleRules.emojiUsage === 'none') style += ' No emoji.';
  if (!profile.styleRules.useStoryOpeners) style += ' No "when I was building..." openers.';

  // Custom rules
  for (const rule of profile.styleRules.customRules) {
    style += ` ${rule}.`;
  }

  return style;
}

// ─── Profile Updates (from chat, engagement feedback, etc.) ─────────────────

/**
 * Update a specific fact in the identity section.
 * Used when chat detects "we have X endpoints" type statements.
 */
export function updateKeyFact(fact: string): void {
  const profile = loadBrandProfile();

  // Replace existing fact if it's about the same topic (simple keyword overlap)
  const factWords = new Set(fact.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const existingIdx = profile.identity.keyFacts.findIndex(f => {
    const existingWords = new Set(f.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    let overlap = 0;
    for (const w of factWords) {
      if (existingWords.has(w)) overlap++;
    }
    return overlap >= 2; // 2+ shared keywords = same topic
  });

  if (existingIdx >= 0) {
    profile.identity.keyFacts[existingIdx] = fact;
  } else {
    profile.identity.keyFacts.push(fact);
    // Cap at 20 key facts
    if (profile.identity.keyFacts.length > 20) {
      profile.identity.keyFacts = profile.identity.keyFacts.slice(-20);
    }
  }

  saveBrandProfile(profile);
}

/**
 * Add a learned insight from engagement feedback.
 */
export function addLearnedInsight(insight: string): void {
  const profile = loadBrandProfile();
  profile.learned.insights.push(insight);
  // Cap at 50 insights — drop oldest
  if (profile.learned.insights.length > 50) {
    profile.learned.insights = profile.learned.insights.slice(-50);
  }
  profile.learned.updatedAt = new Date().toISOString();
  saveBrandProfile(profile);
}

/**
 * Update top/bottom performers from engagement data.
 */
export function updatePerformancePatterns(top: string[], bottom: string[]): void {
  const profile = loadBrandProfile();
  profile.learned.topPerformers = top.slice(0, 10);
  profile.learned.bottomPerformers = bottom.slice(0, 10);
  profile.learned.updatedAt = new Date().toISOString();
  saveBrandProfile(profile);
}

/**
 * Add a custom style rule.
 */
export function addStyleRule(rule: string): void {
  const profile = loadBrandProfile();
  if (!profile.styleRules.customRules.includes(rule)) {
    profile.styleRules.customRules.push(rule);
    saveBrandProfile(profile);
  }
}

/**
 * Auto-adjust content mix based on engagement performance data.
 * Called by engagement monitor when enough data is collected.
 *
 * Algorithm: shift weight toward high-performing types, away from low-performing.
 * Maximum shift: 15% per adjustment. Minimum per type: 5%.
 * This ensures gradual learning, not wild swings.
 */
export function adjustContentMix(typeScores: Record<string, number>): void {
  const profile = loadBrandProfile();
  const mix = profile.contentMix;
  const types = ['educational', 'personal', 'engagement', 'promotional'] as const;

  // Need scores for at least 2 types to adjust
  const scoredTypes = types.filter(t => typeScores[t] != null && typeScores[t] > 0);
  if (scoredTypes.length < 2) return;

  const avgScore = scoredTypes.reduce((sum, t) => sum + typeScores[t], 0) / scoredTypes.length;
  if (avgScore <= 0) return;

  // Calculate adjustment: types above average get boosted, below get reduced
  // Wider range than before: up to ±25% shift, min 2% per type (allows near-elimination)
  const adjustments: Record<string, number> = {};
  for (const t of types) {
    const score = typeScores[t] ?? avgScore; // unknown types stay neutral
    const ratio = score / avgScore;
    adjustments[t] = Math.max(-0.25, Math.min(0.25, (ratio - 1) * 0.30));
  }

  // Apply adjustments — min 2% per type (never fully zero), max 80%
  const newMix = { ...mix };
  for (const t of types) {
    newMix[t] = Math.max(0.02, Math.min(0.80, mix[t] + (adjustments[t] ?? 0)));
  }

  // Normalize to sum to 1.0
  const total = types.reduce((sum, t) => sum + newMix[t], 0);
  for (const t of types) {
    newMix[t] = Math.round((newMix[t] / total) * 100) / 100;
  }

  // Only save if the mix actually changed
  const changed = types.some(t => Math.abs(newMix[t] - mix[t]) > 0.01);
  if (changed) {
    profile.contentMix = newMix;
    saveBrandProfile(profile);
    console.log(`[BrandProfile] Content mix adjusted: edu=${newMix.educational} per=${newMix.personal} eng=${newMix.engagement} promo=${newMix.promotional}`);
  }
}
