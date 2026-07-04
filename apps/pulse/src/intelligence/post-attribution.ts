/**
 * Post-Performance Attribution — measures what each post ACTUALLY achieved.
 *
 * Instead of guessing "this post's job is profile visits," we MEASURE:
 * - Did follows spike after this post?
 * - Did replies exceed average?
 * - Did profile visits increase?
 * - Did link clicks happen?
 *
 * Then the learning engine knows: "Process posts drive replies.
 * Customer stories drive follows. Industry takes drive profile visits."
 */

import { loadState, saveState } from '../core/state.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PostOutcome {
  post_id: string;
  platform: string;
  category: string;
  posted_at: string;
  outcomes: {
    drove_follows: boolean;       // follow count spiked within 24h
    drove_replies: boolean;       // > 5 replies
    drove_reposts: boolean;       // > 3 reposts
    drove_profile_visits: boolean; // profile visit spike (if trackable)
    drove_link_clicks: boolean;   // link got clicks
  };
  engagement: {
    likes: number;
    replies: number;
    reposts: number;
  };
}

export interface CategoryOutcomeProfile {
  category: string;
  total_posts: number;
  follow_rate: number;           // % of posts that drove follows
  reply_rate: number;            // % of posts that drove replies
  repost_rate: number;           // % of posts that drove reposts
  link_click_rate: number;       // % of posts that drove clicks
  primary_outcome: string;       // what this category is BEST at
}

interface PostAttributionState {
  outcomes: PostOutcome[];
  baseline: {
    avg_likes: number;
    avg_replies: number;
    avg_reposts: number;
  };
  last_baseline_update: string;
}

const DEFAULT_STATE: PostAttributionState = {
  outcomes: [],
  baseline: { avg_likes: 2, avg_replies: 1, avg_reposts: 0 },
  last_baseline_update: '',
};

// ─── Core Functions ─────────────────────────────────────────────────────────

/**
 * Attribute outcomes to a post based on its engagement metrics.
 * Call this ~24h after posting when engagement data is available.
 */
export function attributePostOutcomes(
  postId: string,
  platform: string,
  category: string,
  postedAt: string,
  engagement: { likes: number; replies: number; reposts: number },
  followDelta?: number,         // follow count change since posting
  linkClicks?: number,
): PostOutcome {
  const state = loadState<PostAttributionState>('post-attribution', DEFAULT_STATE);

  const outcome: PostOutcome = {
    post_id: postId,
    platform,
    category,
    posted_at: postedAt,
    outcomes: {
      drove_follows: (followDelta || 0) > 2,
      drove_replies: engagement.replies > Math.max(5, state.baseline.avg_replies * 2),
      drove_reposts: engagement.reposts > Math.max(3, state.baseline.avg_reposts * 2),
      drove_profile_visits: (followDelta || 0) > 0, // proxy — follows imply profile visits
      drove_link_clicks: (linkClicks || 0) > 0,
    },
    engagement,
  };

  state.outcomes.push(outcome);
  if (state.outcomes.length > 500) state.outcomes = state.outcomes.slice(-500);

  // Update rolling baseline every 20 posts
  if (state.outcomes.length % 20 === 0) {
    updateBaseline(state);
  }

  saveState('post-attribution', state);
  return outcome;
}

function updateBaseline(state: PostAttributionState): void {
  const recent = state.outcomes.slice(-50);
  if (recent.length < 10) return;

  state.baseline = {
    avg_likes: recent.reduce((s, o) => s + o.engagement.likes, 0) / recent.length,
    avg_replies: recent.reduce((s, o) => s + o.engagement.replies, 0) / recent.length,
    avg_reposts: recent.reduce((s, o) => s + o.engagement.reposts, 0) / recent.length,
  };
  state.last_baseline_update = new Date().toISOString();
}

/**
 * Get the outcome profile for each content category.
 * This tells you: "Process posts drive replies. Customer stories drive follows."
 */
export function getCategoryOutcomeProfiles(): CategoryOutcomeProfile[] {
  const state = loadState<PostAttributionState>('post-attribution', DEFAULT_STATE);

  const categoryData: Record<string, PostOutcome[]> = {};
  for (const o of state.outcomes) {
    if (!categoryData[o.category]) categoryData[o.category] = [];
    categoryData[o.category].push(o);
  }

  return Object.entries(categoryData)
    .filter(([, outcomes]) => outcomes.length >= 3) // need minimum data
    .map(([category, outcomes]) => {
      const total = outcomes.length;
      const followRate = outcomes.filter(o => o.outcomes.drove_follows).length / total;
      const replyRate = outcomes.filter(o => o.outcomes.drove_replies).length / total;
      const repostRate = outcomes.filter(o => o.outcomes.drove_reposts).length / total;
      const clickRate = outcomes.filter(o => o.outcomes.drove_link_clicks).length / total;

      // Determine primary outcome
      const rates = [
        { outcome: 'follows', rate: followRate },
        { outcome: 'replies', rate: replyRate },
        { outcome: 'reposts', rate: repostRate },
        { outcome: 'link_clicks', rate: clickRate },
      ];
      rates.sort((a, b) => b.rate - a.rate);

      return {
        category,
        total_posts: total,
        follow_rate: Math.round(followRate * 100),
        reply_rate: Math.round(replyRate * 100),
        repost_rate: Math.round(repostRate * 100),
        link_click_rate: Math.round(clickRate * 100),
        primary_outcome: rates[0].rate > 0 ? rates[0].outcome : 'engagement',
      };
    })
    .sort((a, b) => b.total_posts - a.total_posts);
}

/**
 * Get a plain-English summary of what each content type achieves.
 */
export function getOutcomeSummary(): string {
  const profiles = getCategoryOutcomeProfiles();
  if (profiles.length === 0) return 'Not enough data yet. Need at least 3 posts per category.';

  return profiles.map(p =>
    `${p.category}: primarily drives ${p.primary_outcome} (${p.total_posts} posts tracked, ` +
    `${p.follow_rate}% drove follows, ${p.reply_rate}% drove replies, ${p.repost_rate}% drove reposts)`
  ).join('\n');
}

export function getPostAttributionState(): PostAttributionState {
  return loadState<PostAttributionState>('post-attribution', DEFAULT_STATE);
}
