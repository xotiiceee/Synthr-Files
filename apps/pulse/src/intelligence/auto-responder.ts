/**
 * Engagement Auto-Responder — generates follow-up replies when people
 * respond to our posts. Conservative by default: suggestions are queued
 * for human approval before sending.
 */

import { askLLM } from '../core/llm.js';
import { getConfig, getPersonaPrompt } from '../core/persona.js';
import { loadState, saveState, generateId } from '../core/state.js';
import { searchPlatform } from '../core/search.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PendingReply {
  id: string;
  platform: string;
  originalPostId: string;
  originalPostText: string;
  replyText: string;           // What they said to us
  replyAuthor: string;
  suggestedResponse: string;   // What we should say back
  status: 'pending' | 'approved' | 'sent' | 'skipped';
  createdAt: string;
}

// ─── State Helpers ───────────────────────────────────────────────────────────

const STATE_KEY = 'auto-replies';

function loadReplies(): PendingReply[] {
  return loadState<PendingReply[]>(STATE_KEY, []);
}

function persistReplies(replies: PendingReply[]): void {
  // Keep last 200 entries to avoid unbounded growth
  if (replies.length > 200) replies.splice(0, replies.length - 200);
  saveState(STATE_KEY, replies);
}

// ─── Platform site mapping ───────────────────────────────────────────────────

const PLATFORM_SITES: Record<string, 'x.com' | 'reddit.com' | 'news.ycombinator.com' | 'producthunt.com' | 'linkedin.com'> = {
  x: 'x.com',
  reddit: 'reddit.com',
  hackernews: 'news.ycombinator.com',
  producthunt: 'producthunt.com',
  linkedin: 'linkedin.com',
};

// ─── Core Functions ──────────────────────────────────────────────────────────

/**
 * Search for replies to our posts on a given platform, generate
 * suggested responses, and store them as pending for approval.
 */
export async function checkForReplies(platform: string): Promise<PendingReply[]> {
  const config = getConfig();
  const handle = config.persona.brandName;
  const site = PLATFORM_SITES[platform];

  if (!site) {
    console.log(`  [AutoReply] Platform "${platform}" has no site: search — skipping`);
    return [];
  }

  // Search for replies / mentions
  let query: string;
  if (platform === 'x') {
    query = `"in reply to @${handle}" OR "@${handle}"`;
  } else if (platform === 'reddit') {
    query = `"${handle}" reply OR response`;
  } else {
    query = `"${handle}"`;
  }

  const results = await searchPlatform(site, query, {
    num: 10,
    timeFilter: 'qdr:d', // Past day
  });

  if (results.length === 0) {
    console.log(`  [AutoReply] No replies found on ${platform}`);
    return [];
  }

  const existing = loadReplies();
  const existingUrls = new Set(existing.map((r) => r.originalPostId));
  const newReplies: PendingReply[] = [];

  for (const result of results) {
    // Deduplicate by URL
    if (existingUrls.has(result.url)) continue;

    const theirText = `${result.title} ${result.snippet}`.trim();
    const suggested = await generateResponse(theirText, platform);
    if (!suggested) continue;

    // Try to extract author from snippet/title patterns
    const authorMatch = result.snippet.match(/@(\w+)/);
    const author = authorMatch ? authorMatch[1] : 'unknown';

    const reply: PendingReply = {
      id: generateId(),
      platform,
      originalPostId: result.url,
      originalPostText: result.snippet,
      replyText: theirText,
      replyAuthor: author,
      suggestedResponse: suggested,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    newReplies.push(reply);
  }

  // Persist all
  if (newReplies.length > 0) {
    const all = [...existing, ...newReplies];
    persistReplies(all);
  }

  console.log(`  [AutoReply] Found ${newReplies.length} new replies on ${platform}`);
  return newReplies;
}

/**
 * Generate a suggested response to someone's reply using LLM + persona.
 * Returns null if no response is appropriate (e.g., spam, off-topic).
 */
export async function generateResponse(
  theirReply: string,
  platform: string
): Promise<string | null> {
  const personaPrompt = getPersonaPrompt();

  const maxLen = platform === 'x' ? '1-2 sentences, under 280 characters' : '2-3 sentences';

  const prompt = `${personaPrompt}

Someone replied to one of your posts on ${platform}:
"${theirReply}"

Write a conversational follow-up reply. Rules:
- Be genuine and conversational
- If appropriate, ask a follow-up question to keep the conversation going
- Thank them if they complimented you
- If their reply is spam, trolling, or completely off-topic, respond with exactly: SKIP
- Keep it ${maxLen}
- Do NOT wrap in quotes

Reply:`;

  const response = await askLLM(prompt, {
    maxTokens: platform === 'x' ? 120 : 200,
    temperature: 0.75,
  });

  if (!response) return null;

  let reply = response.trim();

  // LLM says skip — no response appropriate
  if (reply.toUpperCase() === 'SKIP') return null;

  // Strip wrapping quotes
  if ((reply.startsWith('"') && reply.endsWith('"')) || (reply.startsWith("'") && reply.endsWith("'"))) {
    reply = reply.slice(1, -1);
  }

  return reply;
}

// ─── Approval Workflow ───────────────────────────────────────────────────────

/**
 * Get all pending replies awaiting approval.
 */
export function getPendingReplies(): PendingReply[] {
  return loadReplies().filter((r) => r.status === 'pending');
}

/**
 * Approve a pending reply — marks it ready to send.
 */
export function approvePendingReply(id: string): void {
  const replies = loadReplies();
  const reply = replies.find((r) => r.id === id);
  if (reply && reply.status === 'pending') {
    reply.status = 'approved';
    persistReplies(replies);
    console.log(`  [AutoReply] Approved reply ${id}`);
  }
}

/**
 * Skip a pending reply — will not be sent.
 */
export function skipPendingReply(id: string): void {
  const replies = loadReplies();
  const reply = replies.find((r) => r.id === id);
  if (reply && reply.status === 'pending') {
    reply.status = 'skipped';
    persistReplies(replies);
    console.log(`  [AutoReply] Skipped reply ${id}`);
  }
}
