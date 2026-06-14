/**
 * Engagement Monitor — the feedback loop.
 *
 * Checks engagement on posts/replies 4-24h after posting via ClawNet.
 * Feeds results into the learning engine so Pulse knows what's working.
 *
 * Flow:
 * 1. Outreach/content modes call trackPostedItem() after each post
 * 2. checkEngagement() runs periodically (cron or manual)
 * 3. For each tracked post in the monitoring window:
 *    - Fetch engagement via ClawNet (twitsh-tweet-replies for reply counts, etc.)
 *    - Call recordEngagement() to feed the learning engine
 *    - Update CRM lead score if someone replied to us
 *    - Flag high-performers for amplification
 * 4. Items expire after 36h (configurable)
 */

import { loadState, saveState, getActions, type ActionRecord } from '../core/state.js';
import { callEndpoint, isClawNetConfigured } from '../core/clawnet-client.js';
import { recordEngagement } from './learning-engine.js';
import { addAmplifyItem } from '../core/asset-library.js';
import { addLearnedInsight, updatePerformancePatterns, adjustContentMix } from './brand-profile.js';

// ─── Types ──────────────────────────────────────────────────────────────────

interface TrackedPost {
  /** Matches ActionRecord.id */
  actionId: string;
  /** Platform post ID (tweet ID, reddit post ID, etc.) */
  postId: string;
  platform: string;
  /** What type of post: reply, thread-reply, post */
  postType: string;
  /** The text we posted */
  text: string;
  /** URL of the post */
  url?: string;
  /** When we posted */
  postedAt: string;
  /** When to stop monitoring */
  expiresAt: string;
  /** Last time we checked engagement */
  lastCheckedAt?: string;
  /** Number of times we've checked */
  checkCount: number;
  /** Most recent engagement snapshot */
  engagement?: { likes: number; replies: number; reposts: number };
  /** Has this been flagged as a high performer? */
  flaggedAsHit: boolean;
  /** Topic ID for learning engine */
  topicId?: string;
  /** Content type stored at generation time — no more inference */
  contentType?: string;
  /** Image asset ID if image was attached — for image+post engagement tracking */
  imageAssetId?: string;
}

interface MonitorState {
  tracked: TrackedPost[];
}

// ─── Constants ──────────────────────────────────────────────────────────────

const MONITOR_WINDOW_HOURS = 36;
const MIN_CHECK_INTERVAL_MS = 4 * 3600_000; // Don't check more than every 4h
const HIGH_PERFORMER_THRESHOLD = 3; // 3x average = high performer
const STATE_KEY = 'engagement-monitor';

// ─── Tracking ───────────────────────────────────────────────────────────────

/**
 * Start tracking a posted item for engagement feedback.
 * Called by outreach/content modes after a successful post.
 */
export function trackPostedItem(opts: {
  actionId: string;
  postId: string;
  platform: string;
  postType: string;
  text: string;
  url?: string;
  topicId?: string;
  contentType?: string;
  imageAssetId?: string;
}): void {
  const state = loadState<MonitorState>(STATE_KEY, { tracked: [] });

  // Don't double-track
  if (state.tracked.some(t => t.postId === opts.postId)) return;

  const monitorHours = MONITOR_WINDOW_HOURS * (0.75 + Math.random() * 0.50);
  state.tracked.push({
    actionId: opts.actionId,
    postId: opts.postId,
    platform: opts.platform,
    postType: opts.postType,
    text: opts.text,
    url: opts.url,
    postedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + monitorHours * 3600_000).toISOString(),
    checkCount: 0,
    flaggedAsHit: false,
    topicId: opts.topicId,
    contentType: opts.contentType,
    imageAssetId: opts.imageAssetId,
  });

  // Cap at 200 tracked posts
  if (state.tracked.length > 200) {
    state.tracked = state.tracked.slice(-200);
  }

  saveState(STATE_KEY, state);
}

// ─── Engagement Checking ────────────────────────────────────────────────────

export interface EngagementCheckResult {
  checked: number;
  updated: number;
  highPerformers: number;
  expired: number;
  errors: number;
}

/**
 * Check engagement on all tracked posts that are due for a check.
 * Runs periodically — call from cron or scheduler.
 */
export async function checkEngagement(): Promise<EngagementCheckResult> {
  const state = loadState<MonitorState>(STATE_KEY, { tracked: [] });
  const now = new Date().toISOString();
  const nowMs = Date.now();
  const result: EngagementCheckResult = { checked: 0, updated: 0, highPerformers: 0, expired: 0, errors: 0 };

  // Expire old items
  const before = state.tracked.length;
  state.tracked = state.tracked.filter(t => t.expiresAt > now);
  result.expired = before - state.tracked.length;

  // Load learned engagement weights (or use defaults that adapt over time)
  let engWeights = { likes: 1, replies: 3, reposts: 5 }; // defaults
  try {
    const { loadBrandProfile } = await import('./brand-profile.js');
    const profile = loadBrandProfile();
    if (profile.learned.engagementWeights) {
      engWeights = profile.learned.engagementWeights;
    }
  } catch {}

  const scorePost = (e: { likes: number; replies: number; reposts: number }) =>
    e.likes * engWeights.likes + e.replies * engWeights.replies + e.reposts * engWeights.reposts;

  // Calculate average engagement across all tracked posts (for high-performer detection)
  const withEngagement = state.tracked.filter(t => t.engagement);
  const avgScore = withEngagement.length > 0
    ? withEngagement.reduce((sum, t) => sum + scorePost(t.engagement!), 0) / withEngagement.length
    : 5; // default baseline

  for (const tracked of state.tracked) {
    // Skip if checked too recently
    if (tracked.lastCheckedAt) {
      const sinceLast = nowMs - new Date(tracked.lastCheckedAt).getTime();
      if (sinceLast < MIN_CHECK_INTERVAL_MS) continue;
    }

    // Skip first check if posted less than 4h ago (let engagement accumulate)
    const sincePosted = nowMs - new Date(tracked.postedAt).getTime();
    if (tracked.checkCount === 0 && sincePosted < MIN_CHECK_INTERVAL_MS) continue;

    result.checked++;

    const engagement = await fetchPostEngagement(tracked.postId, tracked.platform);
    if (!engagement) {
      result.errors++;
      continue;
    }

    tracked.engagement = engagement;
    tracked.lastCheckedAt = new Date().toISOString();
    tracked.checkCount++;
    result.updated++;

    // Feed into learning engine
    recordEngagement(tracked.actionId, tracked.platform, engagement);

    // Update the action record's engagement field
    updateActionEngagement(tracked.actionId, engagement);

    // High performer detection
    const score = scorePost(engagement);

    // Feed into Content DNA
    try {
      const { recordPostEngagement: recordDNA } = await import('./content-dna.js');
      const hour = new Date(tracked.postedAt).getHours();
      recordDNA(tracked.text, tracked.topicId || '', score, hour);
    } catch {}
    if (score >= avgScore * HIGH_PERFORMER_THRESHOLD && !tracked.flaggedAsHit && tracked.url) {
      tracked.flaggedAsHit = true;
      result.highPerformers++;

      // Auto-queue for amplification
      addAmplifyItem({
        tweetUrl: tracked.url,
        tweetText: tracked.text.slice(0, 200),
        maxUses: 3,
        expiresInHours: 12,
      });

      console.log(`  [Engagement] High performer detected: ${score} score (${avgScore.toFixed(0)} avg) — auto-amplifying`);
    }

    console.log(
      `  [Engagement] ${tracked.platform} ${tracked.postType}: ${engagement.likes}L ${engagement.replies}R ${engagement.reposts}RT (score: ${score})`
    );
  }

  // Feed learned patterns into brand profile (every 5+ checks)
  if (result.updated >= 5) {
    try {
      const allScored = state.tracked
        .filter(t => t.engagement)
        .map(t => ({
          topic: t.topicId || t.postType,
          score: (t.engagement!.likes) + (t.engagement!.replies * 3) + (t.engagement!.reposts * 5),
        }));

      if (allScored.length >= 5) {
        // Find top and bottom performing topics
        const byTopic = new Map<string, number[]>();
        for (const s of allScored) {
          const scores = byTopic.get(s.topic) ?? [];
          scores.push(s.score);
          byTopic.set(s.topic, scores);
        }

        const topicAvgs = [...byTopic.entries()]
          .map(([topic, scores]) => ({ topic, avg: scores.reduce((a, b) => a + b, 0) / scores.length }))
          .sort((a, b) => b.avg - a.avg);

        const top = topicAvgs.filter(t => t.avg > avgScore).map(t => t.topic);
        const bottom = topicAvgs.filter(t => t.avg < avgScore * 0.5).map(t => t.topic);
        updatePerformancePatterns(top, bottom);

        // Auto-adjust content mix based on stored content type (no more inference)
        const typeScores: Record<string, { total: number; count: number }> = {};
        for (const t of state.tracked.filter(p => p.engagement && p.postType === 'post' && p.contentType)) {
          const score = scorePost(t.engagement!);
          const ct = t.contentType!;
          if (!typeScores[ct]) typeScores[ct] = { total: 0, count: 0 };
          typeScores[ct].total += score;
          typeScores[ct].count++;
        }
        const avgTypeScores: Record<string, number> = {};
        for (const [type, data] of Object.entries(typeScores)) {
          if (data.count > 0) avgTypeScores[type] = data.total / data.count;
        }
        if (Object.keys(avgTypeScores).length >= 2) {
          adjustContentMix(avgTypeScores);
        }

        // Learn engagement weights: which metric (likes/replies/reposts) correlates with virality?
        // Compare posts with high total engagement to see which metric was most differentiated
        if (withEngagement.length >= 15) {
          try {
            const sorted = [...withEngagement]
              .map(t => t.engagement!)
              .sort((a, b) => (a.likes + a.replies + a.reposts) - (b.likes + b.replies + b.reposts));
            const topHalf = sorted.slice(Math.floor(sorted.length / 2));
            const bottomHalf = sorted.slice(0, Math.floor(sorted.length / 2));

            const avgMetric = (arr: typeof sorted, key: 'likes' | 'replies' | 'reposts') =>
              arr.reduce((s, e) => s + e[key], 0) / (arr.length || 1);

            // Weight = how much more the top performers have of each metric vs bottom
            const likeRatio = (avgMetric(topHalf, 'likes') + 1) / (avgMetric(bottomHalf, 'likes') + 1);
            const replyRatio = (avgMetric(topHalf, 'replies') + 1) / (avgMetric(bottomHalf, 'replies') + 1);
            const repostRatio = (avgMetric(topHalf, 'reposts') + 1) / (avgMetric(bottomHalf, 'reposts') + 1);

            // Normalize so they sum to ~9 (same scale as defaults 1+3+5)
            const total = likeRatio + replyRatio + repostRatio;
            const newWeights = {
              likes: Math.round((likeRatio / total) * 9 * 10) / 10,
              replies: Math.round((replyRatio / total) * 9 * 10) / 10,
              reposts: Math.round((repostRatio / total) * 9 * 10) / 10,
            };

            const { loadBrandProfile, saveBrandProfile } = await import('./brand-profile.js');
            const profile = loadBrandProfile();
            profile.learned.engagementWeights = newWeights;
            saveBrandProfile(profile);
            console.log(`[Engagement] Learned weights: L=${newWeights.likes} R=${newWeights.replies} RT=${newWeights.reposts}`);
          } catch {}
        }
      }
    } catch {
      // Non-critical — learning is best-effort
    }
  }

  saveState(STATE_KEY, state);
  return result;
}

// ─── Platform-Specific Engagement Fetching ──────────────────────────────────

async function fetchPostEngagement(
  postId: string,
  platform: string,
): Promise<{ likes: number; replies: number; reposts: number } | null> {
  if (platform !== 'x') {
    // For non-X platforms, we can't easily check engagement without APIs
    return null;
  }

  if (!isClawNetConfigured()) return null;

  try {
    // Use twitsh-tweet-replies to get reply count + engagement
    const result = await callEndpoint<{
      replies?: unknown[];
      total?: number;
      tweet?: { likes?: number; retweets?: number; replies?: number };
    }>('twitsh-tweet-replies', { tweetId: postId });

    const data = result.data;

    return {
      likes: data.tweet?.likes ?? 0,
      replies: data.total ?? data.replies?.length ?? 0,
      reposts: data.tweet?.retweets ?? 0,
    };
  } catch {
    // Try bulk tweet lookup as fallback
    try {
      const result = await callEndpoint<{
        tweets?: Array<{
          public_metrics?: { like_count?: number; reply_count?: number; retweet_count?: number };
        }>;
      }>('twitsh-bulk-tweets', { tweetIds: postId });

      const tweet = result.data.tweets?.[0];
      if (tweet?.public_metrics) {
        return {
          likes: tweet.public_metrics.like_count ?? 0,
          replies: tweet.public_metrics.reply_count ?? 0,
          reposts: tweet.public_metrics.retweet_count ?? 0,
        };
      }
    } catch {
      // Both endpoints failed
    }
    return null;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function updateActionEngagement(
  actionId: string,
  engagement: { likes: number; replies: number; reposts: number },
): void {
  // Update the action record in the log so analytics can use it
  try {
    const actions = loadState<ActionRecord[]>('actions', [] as any) as unknown as ActionRecord[];
    const action = actions.find((a: ActionRecord) => a.id === actionId);
    if (action) {
      action.engagement = engagement;
      saveState('actions', actions);
    }
  } catch {
    // Non-critical — learning engine already has the data
  }
}

/**
 * Get summary stats for the engagement monitor.
 */
export function getMonitorStats(): {
  tracking: number;
  withEngagement: number;
  avgScore: number;
  highPerformers: number;
} {
  const state = loadState<MonitorState>(STATE_KEY, { tracked: [] });
  const now = new Date().toISOString();
  const active = state.tracked.filter(t => t.expiresAt > now);
  const withEng = active.filter(t => t.engagement);
  const scores = withEng.map(t => {
    const e = t.engagement!;
    // Use simple default weights for stats (profile weights are async)
    return e.likes + e.replies * 3 + e.reposts * 5;
  });

  return {
    tracking: active.length,
    withEngagement: withEng.length,
    avgScore: scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0,
    highPerformers: active.filter(t => t.flaggedAsHit).length,
  };
}
