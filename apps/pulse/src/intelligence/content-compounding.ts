/**
 * Content Compounding — creates narrative arcs that make people follow for the story.
 *
 * Instead of standalone posts, links related content into story arcs:
 * "We're trying X" → "Update on X" → "X worked, here's the numbers"
 *
 * Also surfaces high-performing posts from 60+ days ago for recycling/remixing.
 */

import { loadState, saveState } from '../core/state.js';
import { askLLMWithSystem } from '../core/llm.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface NarrativeArc {
  id: string;
  title: string;                    // e.g., "Our experiment with X"
  topic: string;
  posts: Array<{
    post_id: string;
    date: string;
    content: string;
    engagement_score: number;
    arc_position: 'opener' | 'update' | 'result' | 'reflection';
  }>;
  status: 'active' | 'completed' | 'abandoned';
  started_at: string;
  last_update: string;
  next_suggested_at?: string;       // when to post the next update
}

export interface RecyclablePost {
  post_id: string;
  original_date: string;
  content: string;
  engagement_score: number;
  category: string;
  days_since: number;
  remix_suggestion?: string;
}

interface CompoundingState {
  arcs: NarrativeArc[];
  posted_content_hashes: Array<{ hash: string; date: string; engagement: number; category: string; content: string; post_id: string }>;
  last_recycle_check: string;
}

const DEFAULT_STATE: CompoundingState = {
  arcs: [],
  posted_content_hashes: [],
  last_recycle_check: '',
};

// ─── Narrative Arcs ─────────────────────────────────────────────────────────

/**
 * Start a new narrative arc.
 */
export function startNarrativeArc(title: string, topic: string, firstPost: { post_id: string; content: string; engagement_score?: number }): NarrativeArc {
  const state = loadState<CompoundingState>('content-compounding', DEFAULT_STATE);

  const arc: NarrativeArc = {
    id: `arc-${Date.now().toString(36)}`,
    title,
    topic,
    posts: [{
      post_id: firstPost.post_id,
      date: new Date().toISOString(),
      content: firstPost.content.slice(0, 500),
      engagement_score: firstPost.engagement_score || 0,
      arc_position: 'opener',
    }],
    status: 'active',
    started_at: new Date().toISOString(),
    last_update: new Date().toISOString(),
    next_suggested_at: new Date(Date.now() + 3 * 86400000).toISOString(), // suggest update in 3 days
  };

  state.arcs.push(arc);
  if (state.arcs.length > 20) state.arcs = state.arcs.slice(-20);
  saveState('content-compounding', state);

  return arc;
}

/**
 * Add an update to an existing arc.
 */
export function addToArc(arcId: string, post: { post_id: string; content: string; engagement_score?: number; position?: NarrativeArc['posts'][0]['arc_position'] }): boolean {
  const state = loadState<CompoundingState>('content-compounding', DEFAULT_STATE);
  const arc = state.arcs.find(a => a.id === arcId);
  if (!arc || arc.status !== 'active') return false;

  arc.posts.push({
    post_id: post.post_id,
    date: new Date().toISOString(),
    content: post.content.slice(0, 500),
    engagement_score: post.engagement_score || 0,
    arc_position: post.position || 'update',
  });

  arc.last_update = new Date().toISOString();

  // Suggest next update based on arc length
  if (arc.posts.length >= 4) {
    arc.next_suggested_at = undefined; // arc is mature, let it end naturally
  } else {
    arc.next_suggested_at = new Date(Date.now() + (3 + arc.posts.length) * 86400000).toISOString();
  }

  saveState('content-compounding', state);
  return true;
}

/**
 * Get active arcs that need an update (past their next_suggested_at).
 */
export function getArcsNeedingUpdate(): NarrativeArc[] {
  const state = loadState<CompoundingState>('content-compounding', DEFAULT_STATE);
  const now = new Date().toISOString();

  return state.arcs.filter(a =>
    a.status === 'active' &&
    a.next_suggested_at &&
    a.next_suggested_at <= now
  );
}

/**
 * Generate a follow-up post for a narrative arc using LLM.
 */
export async function generateArcUpdate(arc: NarrativeArc): Promise<string | null> {
  const previousPosts = arc.posts.map(p => `[${p.arc_position}] ${p.content}`).join('\n\n');

  const systemPrompt = `You are continuing a narrative arc on social media. The brand has been telling a story across multiple posts. Write the next update that references previous posts naturally.`;

  const userPrompt = `Narrative arc: "${arc.title}"
Topic: ${arc.topic}

Previous posts in this arc:
${previousPosts}

This is post #${arc.posts.length + 1} in the arc. Write a natural follow-up that:
1. References the previous posts ("Last week I shared..." or "Update on...")
2. Adds new information, progress, or reflection
3. Makes followers feel like they're following a story
4. Max 280 characters for X

Position: ${arc.posts.length >= 3 ? 'result or reflection' : 'update'}`;

  return askLLMWithSystem(systemPrompt, userPrompt, { maxTokens: 150, temperature: 0.7 });
}

// ─── Content Recycling ──────────────────────────────────────────────────────

/**
 * Record a posted piece of content for future recycling.
 */
export function recordPostedContent(post_id: string, content: string, category: string, engagement?: number): void {
  const state = loadState<CompoundingState>('content-compounding', DEFAULT_STATE);

  const hash = simpleHash(content);
  state.posted_content_hashes.push({
    hash,
    date: new Date().toISOString(),
    engagement: engagement || 0,
    category,
    content: content.slice(0, 500),
    post_id,
  });

  // Keep last 500 posts
  if (state.posted_content_hashes.length > 500) {
    state.posted_content_hashes = state.posted_content_hashes.slice(-500);
  }

  saveState('content-compounding', state);
}

/**
 * Find high-performing posts from 60+ days ago that could be recycled or remixed.
 */
export function getRecyclablePosts(minDaysAgo: number = 60, minEngagement: number = 10): RecyclablePost[] {
  const state = loadState<CompoundingState>('content-compounding', DEFAULT_STATE);
  const now = Date.now();
  const cutoff = now - minDaysAgo * 86400000;

  return state.posted_content_hashes
    .filter(p => {
      const postDate = new Date(p.date).getTime();
      return postDate < cutoff && p.engagement >= minEngagement;
    })
    .map(p => ({
      post_id: p.post_id,
      original_date: p.date,
      content: p.content,
      engagement_score: p.engagement,
      category: p.category,
      days_since: Math.round((now - new Date(p.date).getTime()) / 86400000),
    }))
    .sort((a, b) => b.engagement_score - a.engagement_score)
    .slice(0, 10);
}

/**
 * Generate a remixed version of an old high-performing post.
 */
export async function remixPost(originalContent: string): Promise<string | null> {
  const systemPrompt = `You are remixing a high-performing social media post. Keep the core idea but make it feel fresh — new angle, updated phrasing, different hook. It should not look like a copy.`;

  const userPrompt = `Original post (from 2+ months ago, performed well):
"${originalContent}"

Write a remixed version that:
1. Keeps the same core insight
2. Uses a completely different hook/opening
3. Feels fresh and current
4. Max 280 characters for X`;

  return askLLMWithSystem(systemPrompt, userPrompt, { maxTokens: 150, temperature: 0.8 });
}

/**
 * Check if proposed content is too similar to recent posts.
 */
export function isDuplicateContent(newContent: string, daysWindow: number = 14): boolean {
  const state = loadState<CompoundingState>('content-compounding', DEFAULT_STATE);
  const cutoff = new Date(Date.now() - daysWindow * 86400000).toISOString();
  const newHash = simpleHash(newContent);
  const newWords = new Set(newContent.toLowerCase().split(/\s+/));

  for (const p of state.posted_content_hashes) {
    if (p.date < cutoff) continue;

    // Exact hash match
    if (p.hash === newHash) return true;

    // Word overlap check (>70% overlap = too similar)
    const oldWords = new Set(p.content.toLowerCase().split(/\s+/));
    const overlap = [...newWords].filter(w => oldWords.has(w) && w.length > 3).length;
    const similarity = overlap / Math.max(newWords.size, 1);
    if (similarity > 0.7) return true;
  }

  return false;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function simpleHash(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash.toString(36);
}

export function getCompoundingState(): CompoundingState {
  return loadState<CompoundingState>('content-compounding', DEFAULT_STATE);
}

export function getActiveArcs(): NarrativeArc[] {
  const state = loadState<CompoundingState>('content-compounding', DEFAULT_STATE);
  return state.arcs.filter(a => a.status === 'active');
}

export function completeArc(arcId: string): void {
  const state = loadState<CompoundingState>('content-compounding', DEFAULT_STATE);
  const arc = state.arcs.find(a => a.id === arcId);
  if (arc) {
    arc.status = 'completed';
    saveState('content-compounding', state);
  }
}
