/**
 * Mentions monitoring panel page for PULSE.
 *
 * Shows detected brand mentions with sentiment badges, suggested replies,
 * and actions to approve, generate, or reject replies. Supports filtering
 * by sentiment and triggering a manual scan.
 */

import { loadState, saveState } from '../../core/state.js';
import {
  markMentionReplied,
  generateMentionReply,
  detectMentions,
  getMentionStats,
} from '../../intelligence/mention-detector.js';
import type { DetectedMention } from '../../intelligence/mention-detector.js';
import { getXWriteClient } from '../../platforms/x-write-client.js';
import type { Conversation } from '../../platforms/base.js';

// ─── HTML Escaping ───────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;

  if (diffMs < 0) return 'just now';

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

function platformLabel(platform: string): string {
  const labels: Record<string, string> = {
    x: 'X',
    reddit: 'Reddit',
    hackernews: 'HN',
    producthunt: 'PH',
    linkedin: 'LinkedIn',
    discord: 'Discord',
  };
  return labels[platform] || platform;
}

function sentimentBadgeHtml(sentiment: string): string {
  const map: Record<string, { label: string; cls: string }> = {
    positive: { label: 'POSITIVE', cls: 'badge-sentiment-positive' },
    neutral:  { label: 'NEUTRAL',  cls: 'badge-sentiment-neutral' },
    negative: { label: 'NEGATIVE', cls: 'badge-sentiment-negative' },
    question: { label: 'QUESTION', cls: 'badge-sentiment-question' },
    spam:     { label: 'SPAM',     cls: 'badge-sentiment-spam' },
  };
  const info = map[sentiment] || { label: sentiment.toUpperCase(), cls: 'badge-sentiment-neutral' };
  return `<span class="badge ${info.cls}">${info.label}</span>`;
}

function platformBadgeHtml(platform: string): string {
  return `<span class="badge badge-blue">${esc(platformLabel(platform))}</span>`;
}

// ─── Mention State (read all for display — not just pending) ─────────────────

interface MentionStateData {
  processedIds: string[];
  pendingReplies: DetectedMention[];
  dailyCounts: Record<string, number>;
  lastCheckAt: string;
}

function loadMentionState(): MentionStateData {
  return loadState<MentionStateData>('mentions', {
    processedIds: [],
    pendingReplies: [],
    dailyCounts: {},
    lastCheckAt: '',
  });
}

// ─── Page CSS ────────────────────────────────────────────────────────────────

function pageCss(): string {
  return `
    .stats-bar {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 14px;
      margin-bottom: 24px;
    }

    .filter-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }

    .filter-bar a {
      padding: 6px 14px;
      border-radius: 16px;
      font-size: 0.8rem;
      font-weight: 500;
      color: #8b949e;
      background: #21262d;
      border: 1px solid #30363d;
      transition: background 0.15s, color 0.15s;
    }

    .filter-bar a:hover {
      background: #30363d;
      color: #e6edf3;
      text-decoration: none;
    }

    .filter-bar a.active {
      background: #1f6feb;
      color: #fff;
      border-color: #1f6feb;
    }

    .mention-card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 18px;
      margin-bottom: 14px;
    }

    .mention-header {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 10px;
    }

    .mention-author {
      font-weight: 700;
      color: #f0f6fc;
      font-size: 0.9rem;
    }

    .mention-time {
      color: #484f58;
      font-size: 0.75rem;
      margin-left: auto;
    }

    .mention-text {
      color: #8b949e;
      font-style: italic;
      font-size: 0.85rem;
      border-left: 3px solid #30363d;
      padding: 8px 12px;
      margin: 10px 0;
      background: #0d1117;
      border-radius: 0 6px 6px 0;
    }

    .mention-url {
      font-size: 0.75rem;
      margin-bottom: 10px;
      display: block;
    }

    .reply-card {
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 12px 14px;
      margin-top: 12px;
    }

    .reply-label {
      color: #8b949e;
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 6px;
    }

    .reply-text {
      color: #e6edf3;
      font-size: 0.85rem;
      line-height: 1.5;
    }

    .mention-actions {
      display: flex;
      gap: 8px;
      margin-top: 12px;
      flex-wrap: wrap;
    }

    .mention-actions form { display: inline; }

    .badge-sentiment-positive { background: #238636; color: #fff; }
    .badge-sentiment-neutral  { background: #1f6feb; color: #fff; }
    .badge-sentiment-negative { background: #da3633; color: #fff; }
    .badge-sentiment-question { background: #9e6a03; color: #fff; }
    .badge-sentiment-spam     { background: #484f58; color: #8b949e; }

    .scan-form {
      margin-bottom: 24px;
    }
  `;
}

// ─── renderPage ──────────────────────────────────────────────────────────────

export async function renderPage(query?: URLSearchParams): Promise<string> {
  const filter = query?.get('filter') || 'all';
  const stats = getMentionStats();
  const state = loadMentionState();

  // Get all mentions (newest first)
  let mentions = [...state.pendingReplies].reverse();

  // Apply sentiment filter
  if (filter !== 'all') {
    mentions = mentions.filter(m => m.sentiment === filter);
  }

  // ── Stats bar ──

  const statsHtml = `
    <div class="stats-bar">
      <div class="card">
        <h3>Total Mentions</h3>
        <div class="val">${stats.total}</div>
      </div>
      <div class="card">
        <h3>Positive</h3>
        <div class="val" style="color: #3fb950;">${stats.bySentiment['positive'] ?? 0}</div>
      </div>
      <div class="card">
        <h3>Neutral</h3>
        <div class="val" style="color: #58a6ff;">${stats.bySentiment['neutral'] ?? 0}</div>
      </div>
      <div class="card">
        <h3>Negative</h3>
        <div class="val" style="color: #f85149;">${stats.bySentiment['negative'] ?? 0}</div>
      </div>
      <div class="card">
        <h3>Questions</h3>
        <div class="val" style="color: #d29922;">${stats.bySentiment['question'] ?? 0}</div>
      </div>
      <div class="card">
        <h3>Avg Response</h3>
        <div class="val">${stats.avgResponseTimeMinutes}m</div>
      </div>
    </div>
  `;

  // ── Scan button ──

  const scanHtml = `
    <div class="scan-form">
      <form method="POST" action="/mentions">
        <input type="hidden" name="action" value="scan">
        <button type="submit" class="btn btn-primary">Scan Now</button>
      </form>
    </div>
  `;

  // ── Filter bar ──

  const filters = ['all', 'positive', 'negative', 'question', 'neutral'] as const;
  const filterLabels: Record<string, string> = {
    all: 'All',
    positive: 'Positive',
    negative: 'Negative',
    question: 'Question',
    neutral: 'Neutral',
  };

  const filterHtml = `
    <div class="filter-bar">
      ${filters.map(f =>
        `<a href="/mentions?filter=${f}" class="${filter === f ? 'active' : ''}">${filterLabels[f]}</a>`
      ).join('\n      ')}
    </div>
  `;

  // ── Mention cards ──

  let cardsHtml: string;

  if (mentions.length === 0) {
    cardsHtml = `
      <div class="empty-state">
        <div class="icon">@</div>
        <h3>No Mentions${filter !== 'all' ? ` (${filterLabels[filter]})` : ''}</h3>
        <p>No mentions found${filter !== 'all' ? ' for this filter' : ''}. Click "Scan Now" to detect new mentions.</p>
      </div>
    `;
  } else {
    cardsHtml = mentions.map(m => renderMentionCard(m)).join('\n');
  }

  return `
    <style>${pageCss()}</style>
    ${statsHtml}
    ${scanHtml}
    ${filterHtml}
    ${cardsHtml}
  `;
}

// ─── Mention Card Renderer ──────────────────────────────────────────────────

function renderMentionCard(m: DetectedMention): string {
  const sentimentBadge = sentimentBadgeHtml(m.sentiment);
  const platBadge = platformBadgeHtml(m.platform);
  const timeAgo = relativeTime(m.detectedAt);

  // Reply section
  let replySection = '';

  if (m.suggestedReply) {
    replySection = `
      <div class="reply-card">
        <div class="reply-label">Suggested Reply</div>
        <div class="reply-text">${esc(m.suggestedReply)}</div>
      </div>
    `;
    // Only show approve/reject buttons if the mention hasn't been skipped or replied
    if (m.status !== 'skipped' && m.status !== 'replied') {
      replySection += `
        <div class="mention-actions">
          <form method="POST" action="/mentions">
            <input type="hidden" name="action" value="approve-reply">
            <input type="hidden" name="mentionId" value="${esc(m.id)}">
            <button type="submit" class="btn btn-primary">Approve</button>
          </form>
          <form method="POST" action="/mentions">
            <input type="hidden" name="action" value="reject-reply">
            <input type="hidden" name="mentionId" value="${esc(m.id)}">
            <button type="submit" class="btn btn-danger">Reject</button>
          </form>
        </div>
      `;
    }
  } else if (m.status === 'pending' || m.status === 'queued') {
    replySection = `
      <div class="mention-actions">
        <form method="POST" action="/mentions">
          <input type="hidden" name="action" value="generate-reply">
          <input type="hidden" name="mentionId" value="${esc(m.id)}">
          <button type="submit" class="btn btn-secondary">Generate Reply</button>
        </form>
      </div>
    `;
  }

  return `
    <div class="mention-card">
      <div class="mention-header">
        ${sentimentBadge}
        <span class="mention-author">@${esc(m.author)}</span>
        ${platBadge}
        <span class="mention-time">${esc(timeAgo)}</span>
      </div>
      <div class="mention-text">${esc(m.text)}</div>
      <a class="mention-url" href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.url)}</a>
      ${replySection}
    </div>
  `;
}

// ─── handlePost ──────────────────────────────────────────────────────────────

export async function handlePost(
  action: string,
  body: Record<string, string>,
): Promise<{ redirect?: string; json?: unknown }> {
  switch (action) {
    // ── Scan for new mentions ──
    case 'scan': {
      await detectMentions();
      return { redirect: '/mentions' };
    }

    // ── Generate a reply for a specific mention ──
    case 'generate-reply': {
      const mentionId = body.mentionId;
      if (!mentionId) return { redirect: '/mentions' };

      const state = loadMentionState();
      const mention = state.pendingReplies.find(m => m.id === mentionId);
      if (!mention) return { redirect: '/mentions' };

      const reply = await generateMentionReply(mention);
      if (reply) {
        mention.suggestedReply = reply;
        // Enforce caps before saving
        if (state.processedIds.length > 2000) {
          state.processedIds = state.processedIds.slice(-2000);
        }
        if (state.pendingReplies.length > 100) {
          state.pendingReplies = state.pendingReplies.slice(-100);
        }
        saveState('mentions', state);
      }

      return { redirect: '/mentions' };
    }

    // ── Approve and post the reply to X ──
    case 'approve-reply': {
      const mentionId = body.mentionId;
      if (!mentionId) return { redirect: '/mentions' };

      const state = loadMentionState();
      const mention = state.pendingReplies.find(m => m.id === mentionId);
      if (!mention || !mention.suggestedReply) return { redirect: '/mentions' };

      const conversation: Conversation = {
        id: mention.id,
        platform: mention.platform,
        url: mention.url,
        text: mention.text,
        author: mention.author,
        topicId: '',
        createdAt: mention.detectedAt,
        engagement: { likes: 0, replies: 0, reposts: 0 },
      };

      const result = await getXWriteClient().reply(conversation, mention.suggestedReply);
      if (!result.ok) {
        console.error('[Mentions Panel] Reply failed:', result.error ?? 'unknown error');
        // Don't mark as replied on failure
        return { redirect: '/mentions' };
      }
      markMentionReplied(mention.id);

      return { redirect: '/mentions' };
    }

    // ── Reject / skip a mention ──
    case 'reject-reply': {
      const mentionId = body.mentionId;
      if (!mentionId) return { redirect: '/mentions' };

      const state = loadMentionState();
      const mention = state.pendingReplies.find(m => m.id === mentionId);
      if (mention) {
        mention.status = 'skipped';
        // Enforce caps before saving
        if (state.processedIds.length > 2000) {
          state.processedIds = state.processedIds.slice(-2000);
        }
        if (state.pendingReplies.length > 100) {
          state.pendingReplies = state.pendingReplies.slice(-100);
        }
        saveState('mentions', state);
      }

      return { redirect: '/mentions' };
    }

    default:
      return { redirect: '/mentions' };
  }
}
