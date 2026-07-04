/**
 * Content creation engine — fully adaptive, zero hardcoded guidance.
 *
 * The system learns what to post from:
 * - Content DNA (approvals, rejections, edits, engagement)
 * - Knowledge notes (brand facts, niche knowledge)
 * - Auto-research (niche intelligence, community voice)
 * - Content themes (extracted from notes or researched)
 *
 * No hardcoded "educational/personal/engagement/promotional" labels.
 * The LLM gets brand identity + niche context + learned DNA and
 * figures out the right voice and angle for each post.
 */

import { askLLM, askLLMWithUsage, type LLMUsage } from '../core/llm.js';
import { getConfig } from '../core/persona.js';
import {
  pickPostFormat,
  getFormatInstruction,
  humanizeText,
  type PostFormat,
} from './human-behavior.js';
import { loadBrandProfile } from './brand-profile.js';
import { buildContentPrompt } from './prompt-builder.js';
import { buildDNAGuidance, pickAngle } from './content-dna.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ContentDay {
  date: string;
  posts: Array<{
    platform: string;
    theme: string;
    type: string;
    draft: string;
  }>;
}

// ─── Post Generation ─────────────────────────────────────────────────────────

/**
 * Generate a single original post for a platform.
 *
 * No hardcoded content types or type guidance. Instead:
 * - Theme comes from content themes / angles / niche research
 * - Style guidance comes from Content DNA (learned from outcomes)
 * - Brand identity comes from brand profile + knowledge notes
 */
export async function generatePost(
  theme: string,
  platform: string,
  llmOverrides?: { provider?: string; model?: string; temperature?: number; maxTokens?: number },
): Promise<{ text: string; type: string; format: PostFormat; imageContext?: { tags: string[] }; usage?: LLMUsage } | null> {
  const format = pickPostFormat();
  const formatInstruction = getFormatInstruction(format);

  // Get learned guidance from Content DNA (empty for new users — no assumptions)
  const dnaGuidance = buildDNAGuidance();

  // Try to pick an angle for variety
  const angle = pickAngle();

  const prompt = buildContentPrompt({
    topic: theme,
    platform,
    contentType: angle || 'general',
    typeGuidance: dnaGuidance || 'Write naturally about this topic as someone who works in the space. Share a real insight, observation, or opinion — not a generic take.',
    format,
    formatInstruction,
  });

  const llmResult = await askLLMWithUsage(prompt, {
    maxTokens: llmOverrides?.maxTokens ?? 500,
    temperature: llmOverrides?.temperature ?? 0.85,
    ...(llmOverrides?.provider ? { provider: llmOverrides.provider } : {}),
    ...(llmOverrides?.model ? { model: llmOverrides.model } : {}),
  });

  if (!llmResult) return null;

  let text = llmResult.text.trim();
  // Strip surrounding quotes
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    text = text.slice(1, -1);
  }

  // Apply anti-detection humanization
  text = humanizeText(text, platform);

  // Build image tags from theme keywords
  const imageTags = (theme || '').toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 3)
    .slice(0, 8);

  return {
    text,
    type: angle || 'general',
    format,
    imageContext: { tags: imageTags },
    usage: llmResult.usage,
  };
}

// ─── Thread Generation ───────────────────────────────────────────────────────

/**
 * Generate an X thread (array of tweets) on a theme.
 * Returns null if LLM fails.
 */
export async function generateThread(theme: string): Promise<string[] | null> {
  const dnaGuidance = buildDNAGuidance();

  const prompt = buildContentPrompt({
    topic: theme,
    platform: 'x',
    contentType: 'thread',
    typeGuidance: dnaGuidance || 'Share an in-depth perspective. Be specific with examples, data, or personal experience.',
    format: 'thread',
    formatInstruction: `Write as an X (Twitter) thread:
- 5-7 tweets, each under 280 characters
- Number each tweet (1/, 2/, etc.)
- First tweet is the hook — make it compelling enough to click "Show thread"
- Last tweet should have a takeaway or call to action
- Each tweet should stand on its own but build on the narrative
- No generic advice like "work hard" or "stay consistent"
Return ONLY the tweets, one per line, numbered. No other text.`,
  });

  const response = await askLLM(prompt, { maxTokens: 1500, temperature: 0.8 });

  if (!response) return null;

  const tweets = response
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && /^\d+[/.)]\s*/.test(line))
    .map((line) => line.replace(/^\d+[/.)]\s*/, '').trim());

  if (tweets.length < 3) {
    console.log('  [Content] Thread too short — LLM returned fewer than 3 tweets');
    return null;
  }

  return tweets;
}

// ─── Content Calendar ────────────────────────────────────────────────────────

/**
 * Generate a multi-day content calendar with drafts for each post.
 * Uses LLM to plan themes, then generates drafts for each slot.
 */
export async function generateContentCalendar(days: number): Promise<ContentDay[]> {
  const config = getConfig();
  const postsPerDay = config.schedule.contentPostsPerDay || 2;
  const profile = loadBrandProfile();
  const themes = profile.contentThemes?.length > 0 ? profile.contentThemes : config.contentThemes;

  const enabledPlatforms = Object.entries(config.platforms)
    .filter(([, s]) => s.enabled)
    .map(([name]) => name);

  const { buildIdentityBlock } = await import('./prompt-builder.js');
  const identity = buildIdentityBlock();

  const planPrompt = `${identity}

Plan a ${days}-day content calendar.

Available themes: ${themes.length > 0 ? themes.join(', ') : 'anything related to the niche'}
Available platforms: ${enabledPlatforms.join(', ')}
Posts per day: ${postsPerDay}

Return ONLY a valid JSON array (no markdown fences). Each element:
{"date":"day 1","posts":[{"platform":"x","theme":"specific angle or topic"}]}

Generate exactly ${days} days with ${postsPerDay} posts each. Vary angles across the week — mix technical insights, observations, opinions, and specific details from the brand knowledge.`;

  const planResponse = await askLLM(planPrompt, { maxTokens: 2000, temperature: 0.7 });

  if (!planResponse) {
    console.log('  [Content] LLM unavailable — cannot generate calendar');
    return [];
  }

  let plan: Array<{ date: string; posts: Array<{ platform: string; theme: string; type?: string }> }>;

  try {
    let jsonStr = planResponse.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) jsonStr = fenceMatch[1].trim();
    plan = JSON.parse(jsonStr);
    if (!Array.isArray(plan)) throw new Error('not an array');
  } catch (err) {
    console.log(`  [Content] Failed to parse calendar plan: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }

  const calendar: ContentDay[] = [];
  const startDate = new Date();

  for (let i = 0; i < plan.length && i < days; i++) {
    const dayDate = new Date(startDate);
    dayDate.setDate(dayDate.getDate() + i);
    const dateStr = dayDate.toISOString().slice(0, 10);

    const dayPosts: ContentDay['posts'] = [];

    for (const slot of plan[i].posts ?? []) {
      const draft = await generatePost(slot.theme, slot.platform);
      dayPosts.push({
        platform: slot.platform,
        theme: slot.theme,
        type: slot.type ?? 'general',
        draft: draft?.text ?? `[Draft pending: ${slot.theme}]`,
      });
    }

    calendar.push({ date: dateStr, posts: dayPosts });
  }

  return calendar;
}
