/**
 * Swipe File Generator.
 * Saves best-performing content as reusable templates — a "greatest hits" collection.
 * Analyzes past actions, extracts patterns, and generates variations using LLM.
 */

import fs from 'fs';
import path from 'path';
import { getActions, generateId } from '../core/state.js';
import { askLLM } from '../core/llm.js';
import { getConfig, getPersonaPrompt } from '../core/persona.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SwipeFile {
  generatedAt: string;
  entries: SwipeEntry[];
  patterns: string[];
}

export interface SwipeEntry {
  id: string;
  platform: string;
  type: 'reply' | 'post' | 'thread';
  content: string;
  engagementScore: number;
  topic: string;
  whyItWorked: string;
  template: string;
  variations: string[];
  createdAt: string;
}

// ─── File Path ───────────────────────────────────────────────────────────────

const SWIPE_FILE_PATH = path.join(process.cwd(), 'data', 'swipe-file.json');

function ensureDataDir(): void {
  const dir = path.dirname(SWIPE_FILE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function computeEngagementScore(engagement?: {
  likes: number;
  replies: number;
  reposts: number;
}): number {
  if (!engagement) return 0;
  // Replies are worth 3x, reposts 2x, likes 1x
  return engagement.likes + engagement.replies * 3 + engagement.reposts * 2;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Load existing swipe file from data/swipe-file.json.
 * Returns empty swipe file if none exists.
 */
export function getSwipeFile(): SwipeFile {
  ensureDataDir();
  try {
    if (fs.existsSync(SWIPE_FILE_PATH)) {
      return JSON.parse(fs.readFileSync(SWIPE_FILE_PATH, 'utf-8'));
    }
  } catch {
    /* corrupted — return default */
  }
  return { generatedAt: '', entries: [], patterns: [] };
}

function saveSwipeFile(swipe: SwipeFile): void {
  ensureDataDir();
  const tmp = SWIPE_FILE_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(swipe, null, 2));
  fs.renameSync(tmp, SWIPE_FILE_PATH);
}

/**
 * Manually add an entry to the swipe file.
 */
export function addToSwipeFile(entry: SwipeEntry): void {
  const swipe = getSwipeFile();
  swipe.entries.push(entry);
  swipe.generatedAt = new Date().toISOString();
  saveSwipeFile(swipe);
  console.log(`  [Swipe] Added entry ${entry.id} (${entry.type}/${entry.platform})`);
}

/**
 * Analyze all past actions, find top performers by engagement,
 * extract patterns, and save as reusable templates.
 *
 * Flow:
 * 1. Get all actions, sort by engagement score (descending)
 * 2. Take top 20 performers
 * 3. Ask LLM to analyze each: why did it work? What's the pattern? Generate a template.
 * 4. Ask LLM to extract 5-10 overall patterns across all top performers
 * 5. Generate 2-3 variations of each entry
 * 6. Save to data/swipe-file.json
 */
export async function buildSwipeFile(): Promise<SwipeFile> {
  const config = getConfig();
  const persona = getPersonaPrompt();
  const actions = getActions();

  // 1. Sort by engagement, take top 20
  const scored = actions
    .filter((a) => (a.type === 'reply' || a.type === 'post') && a.content.length > 20)
    .map((a) => ({
      ...a,
      score: computeEngagementScore(a.engagement),
    }))
    .sort((a, b) => b.score - a.score);

  const topActions = scored.slice(0, 20);

  if (topActions.length === 0) {
    console.log('  [Swipe] No actions to analyze — run outreach first');
    return { generatedAt: new Date().toISOString(), entries: [], patterns: [] };
  }

  // 2-3. Analyze each top performer in batches (to stay within token limits)
  const entries: SwipeEntry[] = [];
  const batchSize = 5;

  for (let i = 0; i < topActions.length; i += batchSize) {
    const batch = topActions.slice(i, i + batchSize);

    const batchSummary = batch
      .map(
        (a, idx) =>
          `[${idx + 1}] Platform: ${a.platform} | Type: ${a.type} | Engagement: ${a.score}\nContent: "${a.content}"\nTopic: ${a.topicId}`
      )
      .join('\n\n');

    const prompt = `You are a content strategist analyzing top-performing social media content for a "${config.persona.niche}" brand.

PERSONA: ${persona}

Analyze these top-performing posts and respond in EXACTLY this JSON format (no markdown):
{
  "analyses": [
    {
      "index": 1,
      "whyItWorked": "1-2 sentence analysis",
      "template": "abstracted reusable template like: [specific observation] + [concrete tip] + [question]",
      "variations": ["variation 1 of the content", "variation 2", "variation 3"]
    }
  ]
}

TOP PERFORMING CONTENT:
${batchSummary}

For each post:
- whyItWorked: Be specific about the rhetorical technique, format, or topic that drove engagement
- template: Abstract the pattern into a fill-in-the-blank template anyone could use
- variations: Write 2-3 new versions that follow the same pattern but with different specific content

Keep variations in the brand voice. Same structure, different words and specifics.`;

    const raw = await askLLM(prompt, { maxTokens: 1500, temperature: 0.6 });
    if (!raw) continue;

    try {
      const parsed = JSON.parse(raw);
      const analyses = parsed.analyses ?? [];

      for (const analysis of analyses) {
        const idx = (analysis.index ?? 1) - 1;
        const action = batch[idx];
        if (!action) continue;

        entries.push({
          id: generateId(),
          platform: action.platform,
          type: action.type as 'reply' | 'post',
          content: action.content,
          engagementScore: action.score,
          topic: action.topicId,
          whyItWorked: analysis.whyItWorked ?? 'High engagement content',
          template: analysis.template ?? action.content,
          variations: Array.isArray(analysis.variations) ? analysis.variations : [],
          createdAt: action.timestamp,
        });
      }
    } catch {
      console.log(`  [Swipe] Failed to parse batch ${i / batchSize + 1}, skipping`);
    }
  }

  // 4. Extract overall patterns across all top performers
  let patterns: string[] = [];

  if (entries.length >= 3) {
    const patternSummary = entries
      .slice(0, 15)
      .map(
        (e) =>
          `[${e.platform}/${e.type}] Score: ${e.engagementScore} — "${e.content.slice(0, 100)}..." Why: ${e.whyItWorked}`
      )
      .join('\n');

    const patternPrompt = `You are a content strategist. Analyze these top-performing posts from a "${config.persona.niche}" brand and extract 5-10 PATTERNS that explain why they worked.

TOP CONTENT:
${patternSummary}

Respond with ONLY a JSON array of pattern strings, like:
["Questions at the end get 3x more engagement", "Posts under 100 chars outperform longer ones"]

Be specific and data-driven. Reference actual patterns you see. No generic advice.`;

    const patternRaw = await askLLM(patternPrompt, {
      maxTokens: 500,
      temperature: 0.4,
    });

    if (patternRaw) {
      try {
        const parsed = JSON.parse(patternRaw);
        if (Array.isArray(parsed)) {
          patterns = parsed.filter((p) => typeof p === 'string');
        }
      } catch {
        console.log('  [Swipe] Failed to parse patterns response');
      }
    }
  }

  // 5-6. Build and save
  const swipeFile: SwipeFile = {
    generatedAt: new Date().toISOString(),
    entries,
    patterns,
  };

  saveSwipeFile(swipeFile);
  console.log(
    `  [Swipe] Built swipe file: ${entries.length} entries, ${patterns.length} patterns`
  );

  return swipeFile;
}

/**
 * Take a swipe file entry and generate a new variation using LLM.
 * Same pattern, different words.
 */
export async function generateFromSwipe(entryId: string): Promise<string> {
  const swipe = getSwipeFile();
  const entry = swipe.entries.find((e) => e.id === entryId);
  if (!entry) {
    console.log(`  [Swipe] Entry ${entryId} not found`);
    return '';
  }

  const config = getConfig();
  const persona = getPersonaPrompt();

  const prompt = `You are writing social media content for a "${config.persona.niche}" brand.

PERSONA: ${persona}
PLATFORM: ${entry.platform}

ORIGINAL HIGH-PERFORMING POST:
"${entry.content}"

WHY IT WORKED: ${entry.whyItWorked}
TEMPLATE PATTERN: ${entry.template}

Write a NEW version of this post that follows the EXACT same pattern and structure but with completely different specific content and examples. Keep the same tone, length, and rhetorical techniques.

EXISTING VARIATIONS (don't repeat these):
${entry.variations.map((v) => `- "${v}"`).join('\n') || 'None yet'}

Respond with ONLY the new post text. No explanation, no quotes, no markdown.`;

  const raw = await askLLM(prompt, { maxTokens: 300, temperature: 0.8 });
  if (!raw) return '';

  const variation = raw.trim();

  // Save the new variation back to the swipe file
  entry.variations.push(variation);
  saveSwipeFile(swipe);

  return variation;
}
