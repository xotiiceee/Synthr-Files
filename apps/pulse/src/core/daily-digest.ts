/**
 * Daily Digest — summarizes yesterday's autopilot activity.
 * Called by cron at configured time (default 9am local).
 */

import { loadState, saveState, getActions } from './state.js';
import { getConfig } from './persona.js';
import { getAutopilotState } from './autopilot.js';
import type { AutopostEntry } from '../modes/autopost.js';

export interface DigestData {
  date: string;  // ISO date string (YYYY-MM-DD)
  postsPublished: number;
  repliesSent: number;
  mentionsHandled: number;
  topPerformer?: {
    content: string;
    category: string;
    voiceScore: number;
  };
  itemsNeedingReview: number;
  insight: string;
  generatedAt: string;
}

interface MentionDigestState {
  dailyCounts?: Record<string, number>;
  pendingReplies?: Array<{
    status?: string;
    detectedAt?: string;
    replyAfter?: string;
  }>;
}

/**
 * Generate digest data for a given date (defaults to yesterday).
 */
export function generateDigest(dateStr?: string): DigestData {
  const targetDate = dateStr || getYesterday();

  // Load post history
  const state = loadState<{ postHistory: AutopostEntry[] }>('autopost', { postHistory: [] });
  const queue = loadState<AutopostEntry[]>('autopost-queue', []);

  // Filter to target date
  const allEntries = [...state.postHistory, ...queue];
  const dayEntries = allEntries.filter(e =>
    e.createdAt?.startsWith(targetDate) || e.postedAt?.startsWith(targetDate)
  );

  const posted = dayEntries.filter(e => e.status === 'posted');
  const replies = posted.filter(e => e.format === 'reply' || e.format === 'reply-story');
  const pending = queue.filter(e => e.status === 'pending');

  // Find top performer (highest voice score among posted)
  const topPost = posted.sort((a, b) => (b.voiceScore || 0) - (a.voiceScore || 0))[0];

  // Generate a rotating insight
  const insight = generateInsight(posted, dayEntries);
  const mentionsHandled = countMentionsHandled(targetDate);

  const digest: DigestData = {
    date: targetDate,
    postsPublished: posted.length - replies.length,
    repliesSent: replies.length,
    mentionsHandled,
    topPerformer: topPost ? {
      content: topPost.content.slice(0, 140) + (topPost.content.length > 140 ? '...' : ''),
      category: topPost.category,
      voiceScore: topPost.voiceScore,
    } : undefined,
    itemsNeedingReview: pending.length,
    insight,
    generatedAt: new Date().toISOString(),
  };

  // Save digest
  const digests = loadState<DigestData[]>('daily-digests', []);
  digests.unshift(digest);
  // Keep last 30 digests
  if (digests.length > 30) digests.length = 30;
  saveState('daily-digests', digests);

  return digest;
}

function countMentionsHandled(dateStr: string): number {
  const mentionState = loadState<MentionDigestState>('mentions', {});
  const countedByPipeline = mentionState.dailyCounts?.[dateStr] ?? 0;
  const repliedOnDate =
    mentionState.pendingReplies?.filter((mention) => {
      if (mention.status !== 'replied') return false;
      return (
        mention.replyAfter?.startsWith(dateStr) ||
        mention.detectedAt?.startsWith(dateStr)
      );
    }).length ?? 0;

  return Math.max(countedByPipeline, repliedOnDate);
}

function getYesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function generateInsight(posted: AutopostEntry[], all: AutopostEntry[]): string {
  const insights = [
    () => {
      const categories = posted.reduce((acc, e) => {
        acc[e.category] = (acc[e.category] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      const top = Object.entries(categories).sort((a, b) => b[1] - a[1])[0];
      return top ? `Your most active category was ${top[0].replace(/_/g, ' ')} (${top[1]} posts).` : '';
    },
    () => {
      const avg = posted.reduce((s, e) => s + (e.voiceScore || 0), 0) / (posted.length || 1);
      return `Average voice alignment was ${Math.round(avg)}/100.`;
    },
    () => posted.length > 0
      ? `You published ${posted.length} piece${posted.length !== 1 ? 's' : ''} of content.`
      : 'No content was published. Consider generating some drafts.',
  ];

  // Rotate based on day of year
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000);
  const fn = insights[dayOfYear % insights.length];
  return fn() || 'Autopilot is learning from your preferences.';
}

/**
 * Render digest as HTML email content.
 */
export function renderDigestEmail(digest: DigestData): string {
  const config = getConfig();
  const brandName = config.persona.brandName || 'PULSE';

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="background:#0d1117;color:#e6edf3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;padding:32px;">
  <div style="max-width:480px;margin:0 auto;background:#161b22;border:1px solid #30363d;border-radius:12px;padding:24px;">
    <h2 style="color:#58a6ff;margin:0 0 16px;">PULSE Daily Digest</h2>
    <p style="color:#8b949e;font-size:14px;margin:0 0 20px;">${brandName} — ${digest.date}</p>

    <p style="font-size:16px;margin:0 0 20px;">
      Yesterday: <strong>${digest.postsPublished} posts</strong> published,
      <strong>${digest.repliesSent} replies</strong> sent.
    </p>

    ${digest.topPerformer ? `
    <div style="background:#0d1117;border:1px solid #21262d;border-radius:8px;padding:14px;margin:0 0 16px;">
      <div style="color:#8b949e;font-size:12px;margin-bottom:6px;">TOP PERFORMER</div>
      <p style="font-size:14px;margin:0 0 6px;">${digest.topPerformer.content}</p>
      <span style="color:#58a6ff;font-size:12px;">voice ${digest.topPerformer.voiceScore}/100</span>
    </div>` : ''}

    ${digest.itemsNeedingReview > 0 ? `
    <p style="color:#d29922;font-size:14px;margin:0 0 16px;">
      ${digest.itemsNeedingReview} draft${digest.itemsNeedingReview !== 1 ? 's' : ''} waiting for your review.
    </p>` : ''}

    <p style="color:#8b949e;font-size:13px;font-style:italic;margin:0 0 20px;">
      ${digest.insight}
    </p>

    <div style="text-align:center;margin-top:20px;">
      <span style="color:#484f58;font-size:12px;">Sent by PULSE Autopilot</span>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Check if digest should be sent now (called by cron).
 */
export function shouldSendDigest(): boolean {
  const config = getConfig();
  const ap = config.autopilot;
  if (!ap?.enabled || !ap.dailyDigest?.enabled) return false;

  const state = getAutopilotState();
  const today = new Date().toISOString().slice(0, 10);
  if (state.lastDigestSent === today) return false;

  return true;
}
