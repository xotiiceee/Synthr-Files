/**
 * Video script generator for YouTube, TikTok, and Instagram Reels.
 * Generates platform-optimized scripts from content themes.
 */

import { askLLM } from '../core/llm.js';
import { getConfig, getPersonaPrompt } from '../core/persona.js';

export interface VideoScript {
  title: string;
  platform: 'youtube' | 'tiktok' | 'reels';
  hook: string; // First 3 seconds — the most important part
  body: string; // Main content
  cta: string; // Call to action
  duration: string; // Estimated duration
  hashtags: string[];
  thumbnail?: string; // YouTube thumbnail text suggestion
}

/**
 * Generate a video script for a specific platform and theme.
 */
export async function generateVideoScript(
  theme: string,
  platform: 'youtube' | 'tiktok' | 'reels'
): Promise<VideoScript | null> {
  const config = getConfig();
  const persona = getPersonaPrompt();

  const platformGuide: Record<string, string> = {
    youtube: `YouTube video (5-10 minutes). Structure: hook (first 10 seconds MUST grab attention) → problem setup → 3-5 main points → recap → CTA (subscribe + link). Include timestamps for description. Conversational but structured.`,
    tiktok: `TikTok video (30-60 seconds). Structure: hook (first 2 seconds — pattern interrupt, bold claim, or question) → ONE key insight delivered fast → surprising detail → CTA. Casual, energetic, direct. No fluff.`,
    reels: `Instagram Reel (30-90 seconds). Structure: hook (first 3 seconds — visual + text overlay idea) → value delivery → brand moment → CTA. Polished but authentic. Include text overlay suggestions in [brackets].`,
  };

  const prompt = `${persona}

Generate a ${platform} video script about: "${theme}"

Platform format: ${platformGuide[platform]}

Return JSON (no markdown fences):
{
  "title": "video title (attention-grabbing, includes keywords)",
  "hook": "exact words for the first 2-5 seconds — this is the MOST important part",
  "body": "the full script, written as spoken words. Include [VISUAL: description] cues where relevant. Break into clear sections.",
  "cta": "the closing call-to-action (what do you want them to do?)",
  "duration": "estimated duration (e.g. '45 seconds', '7 minutes')",
  "hashtags": ["5-8 relevant hashtags"],
  ${platform === 'youtube' ? '"thumbnail": "thumbnail text suggestion (2-5 words, high contrast)",' : ''}
}

Rules:
- Write the script as actual spoken words, not an outline
- The hook must create curiosity or urgency in under 5 seconds
- Include ONE mention of ${config.persona.website || config.persona.brandName} naturally (not forced)
- Sound like a real person, not a corporate video
- ${config.persona.tone} tone
- Include specific numbers, examples, or stories — not vague advice`;

  try {
    const raw = await askLLM(prompt, { maxTokens: 1500, temperature: 0.8 });
    if (!raw) return null;
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned) as Omit<VideoScript, 'platform'>;
    return { ...parsed, platform };
  } catch (err) {
    console.log(`  [Video] Generation failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Generate a batch of video scripts across platforms.
 */
export async function generateVideoScripts(count: number = 5): Promise<VideoScript[]> {
  const config = getConfig();
  const themes = config.contentThemes;
  if (themes.length === 0) {
    console.log('  No content themes configured. Run setup first.');
    return [];
  }

  const platforms: Array<'youtube' | 'tiktok' | 'reels'> = ['youtube', 'tiktok', 'reels'];
  const scripts: VideoScript[] = [];

  // Pick random themes and platforms
  const shuffledThemes = [...themes].sort(() => Math.random() - 0.5);

  for (let i = 0; i < Math.min(count, shuffledThemes.length); i++) {
    const theme = shuffledThemes[i];
    const platform = platforms[i % platforms.length];
    console.log(`  Generating ${platform} script: "${theme.slice(0, 50)}..."`);
    const script = await generateVideoScript(theme, platform);
    if (script) scripts.push(script);

    // Rate limit
    if (i < count - 1) await new Promise(r => setTimeout(r, 2000));
  }

  return scripts;
}

/**
 * Format a video script for terminal display.
 */
export function formatVideoScript(script: VideoScript): string {
  const lines = [
    `\n${'─'.repeat(50)}`,
    `  ${script.platform.toUpperCase()} — ${script.title}`,
    `  Duration: ${script.duration}`,
    `${'─'.repeat(50)}`,
    '',
    '  HOOK:',
    `  ${script.hook}`,
    '',
    '  SCRIPT:',
    ...script.body.split('\n').map(l => `  ${l}`),
    '',
    '  CTA:',
    `  ${script.cta}`,
    '',
    `  Hashtags: ${script.hashtags.join(' ')}`,
  ];
  if (script.thumbnail) {
    lines.push(`  Thumbnail: "${script.thumbnail}"`);
  }
  return lines.join('\n');
}
