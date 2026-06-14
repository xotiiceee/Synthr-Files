/**
 * Content repurposer.
 * Takes one piece of content and drafts platform-adapted variants for the
 * configured target surfaces. Publishing remains subject to each platform's
 * launch posture and approval mode.
 */

import { askLLM } from '../core/llm.js';
import { getPersonaPrompt, getEnabledPlatforms } from '../core/persona.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RepurposedContent {
  original: { text: string; platform: string };
  versions: Array<{
    platform: string;
    text: string;
    charCount: number;
    format: string; // "tweet", "thread", "long-form", "comment", "post"
    hashtags?: string[];
    notes?: string; // "Add image", "Post in r/fitness", etc.
  }>;
}

export interface RepurposeOptions {
  targetPlatforms?: string[];
}

// ─── Platform Adaptation Rules ───────────────────────────────────────────────

const PLATFORM_RULES: Record<string, { format: string; instruction: string }> = {
  x: {
    format: 'tweet',
    instruction: 'Compress to a single punchy tweet under 280 characters. Include 1-2 relevant hashtags. Make it scroll-stopping.',
  },
  'x-thread': {
    format: 'thread',
    instruction: 'Expand into a 5-7 tweet thread. Number each tweet (1/, 2/, etc.). First tweet is the hook. Each tweet under 280 chars. Last tweet has a takeaway.',
  },
  reddit: {
    format: 'long-form',
    instruction: 'Rewrite as a Reddit post. 2-4 paragraphs, conversational tone. Add context and personal angle. No hashtags. No marketing speak. Suggest an appropriate subreddit in the notes.',
  },
  linkedin: {
    format: 'post',
    instruction: 'Rewrite as a LinkedIn post. Professional but personal tone. Use line breaks for readability. Start with a strong hook. Include 3-5 numbered insights or takeaways. Max 1300 characters.',
  },
  discord: {
    format: 'comment',
    instruction: 'Rewrite as a casual Discord message. Short, direct, friendly. Max 400 characters. Can include 1-2 emoji if natural.',
  },
  hackernews: {
    format: 'comment',
    instruction: 'Rewrite as a Hacker News comment. Technical, opinionated, substantive. No marketing, no emoji, no hashtags. Lead with an insight backed by data or experience.',
  },
};

// ─── Repurpose Single Content ────────────────────────────────────────────────

/**
 * Take original content from one platform and generate versions for all other enabled platforms.
 * Returns null if LLM fails entirely.
 */
export async function repurposeContent(
  text: string,
  sourcePlatform: string,
  options: RepurposeOptions = {}
): Promise<RepurposedContent | null> {
  const personaPrompt = getPersonaPrompt();

  // Determine target platforms (enabled minus source, or explicit draft targets).
  const enabledPlatforms = getEnabledPlatforms();
  const requestedTargets =
    options.targetPlatforms?.map((p) => p.trim()).filter(Boolean) ?? [];
  const basePlatforms =
    requestedTargets.length > 0
      ? requestedTargets.filter((p) => p === "x-thread" || enabledPlatforms.includes(p))
      : enabledPlatforms;
  const targets: string[] = [];

  for (const p of basePlatforms) {
    if (p === sourcePlatform) continue;
    targets.push(p);
    // If X is a target (and not the source), also generate a thread version
    if (p === 'x') {
      targets.push('x-thread');
    }
  }

  // If source is x, add a thread draft by default.
  if (
    sourcePlatform === 'x' &&
    requestedTargets.length === 0 &&
    !targets.includes('x-thread')
  ) {
    targets.push('x-thread');
  }

  if (targets.length === 0) {
    console.log('  [Repurpose] No target platforms enabled');
    return null;
  }

  const platformInstructions = targets
    .map((p) => {
      const rule = PLATFORM_RULES[p];
      if (!rule) return null;
      return `### ${p.toUpperCase()}\nFormat: ${rule.format}\n${rule.instruction}`;
    })
    .filter(Boolean)
    .join('\n\n');

  const prompt = `${personaPrompt}

You are repurposing content from ${sourcePlatform} to other platforms. Adapt the message, tone, and format for each platform while keeping the core idea.

ORIGINAL CONTENT (from ${sourcePlatform}):
"""
${text}
"""

Generate a version for each platform below. Return ONLY valid JSON (no markdown fences). Format:
[{"platform":"x","text":"...","hashtags":["#tag1"],"notes":"optional notes"},{"platform":"x-thread","text":"1/ First tweet\\n\\n2/ Second tweet\\n\\n3/ Third","notes":"7 tweets total"}]

${platformInstructions}

Rules:
- Adapt tone and length per platform — don't just copy-paste
- Keep the core message and value intact
- For x-thread, separate tweets with double newlines and number them
- Include "notes" only if there's something actionable (subreddit suggestion, "add image", etc.)
- Hashtags only for platforms that use them (x, linkedin)

JSON array:`;

  const response = await askLLM(prompt, { maxTokens: 3000, temperature: 0.75 });
  if (!response) return null;

  let versions: Array<{
    platform: string;
    text: string;
    hashtags?: string[];
    notes?: string;
  }>;

  try {
    let jsonStr = response.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) jsonStr = fenceMatch[1].trim();
    // Find the array in case of surrounding text
    const arrMatch = jsonStr.match(/\[[\s\S]*\]/);
    if (arrMatch) jsonStr = arrMatch[0];
    versions = JSON.parse(jsonStr);
    if (!Array.isArray(versions)) throw new Error('not an array');
  } catch (err) {
    console.log(`  [Repurpose] Failed to parse LLM response: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }

  const result: RepurposedContent = {
    original: { text, platform: sourcePlatform },
    versions: versions.map((v) => {
      const rule = PLATFORM_RULES[v.platform];
      return {
        platform: v.platform,
        text: v.text,
        charCount: v.text.length,
        format: rule?.format ?? 'post',
        hashtags: v.hashtags,
        notes: v.notes,
      };
    }),
  };

  return result;
}

// ─── Batch Repurpose ─────────────────────────────────────────────────────────

/**
 * Process multiple pieces of content sequentially.
 */
export async function repurposeBatch(
  items: Array<{ text: string; platform: string }>
): Promise<RepurposedContent[]> {
  const results: RepurposedContent[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    console.log(`  [Repurpose] Processing ${i + 1}/${items.length} (from ${item.platform})...`);
    const result = await repurposeContent(item.text, item.platform);
    if (result) results.push(result);
    // Rate limit between calls
    if (i < items.length - 1) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  return results;
}
