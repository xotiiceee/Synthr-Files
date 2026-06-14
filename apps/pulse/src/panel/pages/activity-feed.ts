/**
 * Unified Activity Feed — merges Activity + Performance + Mentions into one page.
 *
 * Two sections:
 *   1. Timeline (top)  — filterable stream of posts, replies, mentions, follows
 *   2. Performance Summary (bottom, collapsible) — stats cards + engagement chart
 */

import { loadState, getActions } from '../../core/state.js';
import { getQueue, getQueueStats } from '../../intelligence/approval-queue.js';
import type { ApprovalQueueItem } from '../../intelligence/approval-queue.js';
import type { AutopostEntry } from '../../modes/autopost.js';
import type { ActionRecord } from '../../core/state.js';
import type { DetectedMention } from '../../intelligence/mention-detector.js';
import type { PostPerformance } from '../../intelligence/learning-engine.js';

// ─── Types ──────────────────────────────────────────────────────────────────

type ActivityType = 'post' | 'reply' | 'mention' | 'follow' | 'generated';
type ActivityStatus = 'posted' | 'draft' | 'pending' | 'rejected';

interface TimelineItem {
  id: string;
  type: ActivityType;
  status: ActivityStatus;
  content: string;
  timestamp: string;
  platform: string;
  engagement?: { likes: number; replies: number; reposts: number };
  author?: string;
  url?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function timeAgo(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  if (diff < 0) return 'just now';

  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 3) + '...';
}

function totalEngagement(e?: { likes: number; replies: number; reposts: number }): number {
  if (!e) return 0;
  return e.likes + e.replies + e.reposts;
}

// ─── Data Collection ────────────────────────────────────────────────────────

function collectTimelineItems(): TimelineItem[] {
  const items: TimelineItem[] = [];
  const seen = new Set<string>();

  // 1. Published posts from autopost state
  const autoState = loadState<{ postHistory: AutopostEntry[] }>('autopost', { postHistory: [] });
  const autoQueue = loadState<AutopostEntry[]>('autopost-queue', []);

  for (const entry of [...autoState.postHistory, ...autoQueue]) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);

    let status: ActivityStatus;
    switch (entry.status) {
      case 'posted':   status = 'posted'; break;
      case 'pending':
      case 'approved': status = 'pending'; break;
      case 'rejected': status = 'rejected'; break;
      default:         status = 'draft'; break;
    }

    items.push({
      id: entry.id,
      type: 'post',
      status,
      content: entry.content,
      timestamp: entry.postedAt || entry.createdAt,
      platform: entry.platform,
      engagement: entry.engagement,
    });
  }

  // 2. Approval queue items (generated drafts)
  try {
    const queueItems = getQueue();
    for (const qi of queueItems) {
      if (seen.has(qi.id)) continue;
      seen.add(qi.id);

      let status: ActivityStatus;
      switch (qi.status) {
        case 'posted':   status = 'posted'; break;
        case 'pending':  status = 'pending'; break;
        case 'rejected': status = 'rejected'; break;
        default:         status = 'draft'; break;
      }

      const type: ActivityType = qi.type === 'mention_reply' ? 'reply' : 'generated';

      items.push({
        id: qi.id,
        type,
        status,
        content: qi.content,
        timestamp: qi.reviewedAt || qi.createdAt,
        platform: qi.platform,
        author: qi.mentionAuthor,
        url: qi.mentionUrl,
      });
    }
  } catch {
    // approval queue may not exist yet
  }

  // 3. Mentions
  const mentionState = loadState<{
    processedIds: string[];
    pendingReplies: DetectedMention[];
  }>('mentions', { processedIds: [], pendingReplies: [] });

  for (const m of mentionState.pendingReplies) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);

    items.push({
      id: m.id,
      type: 'mention',
      status: m.status === 'replied' ? 'posted' : 'pending',
      content: m.text,
      timestamp: m.detectedAt,
      platform: m.platform,
      author: m.author,
      url: m.url,
    });
  }

  // 4. Action log entries (replies, follows, etc.)
  const actions = getActions();
  for (const a of actions) {
    if (a.platform === 'system') continue;
    const actionId = `action-${a.id}`;
    if (seen.has(actionId)) continue;
    seen.add(actionId);

    let type: ActivityType;
    switch (a.type) {
      case 'reply':
      case 'comment': type = 'reply'; break;
      case 'post':    type = 'post'; break;
      default:        type = 'follow'; break; // likes/reposts treated as engagement actions
    }

    items.push({
      id: actionId,
      type,
      status: 'posted',
      content: a.content || a.targetText || '',
      timestamp: a.timestamp,
      platform: a.platform,
      engagement: a.engagement,
    });
  }

  return items;
}

function filterByPeriod(items: TimelineItem[], period: string): TimelineItem[] {
  if (period === 'all') return items;

  const periodMs: Record<string, number> = {
    '1d':  1 * 86_400_000,
    '7d':  7 * 86_400_000,
    '30d': 30 * 86_400_000,
  };

  const cutoff = Date.now() - (periodMs[period] ?? 7 * 86_400_000);
  return items.filter(i => new Date(i.timestamp).getTime() >= cutoff);
}

function filterByType(items: TimelineItem[], filter: string): TimelineItem[] {
  const typeMap: Record<string, ActivityType[]> = {
    posts:    ['post', 'generated'],
    replies:  ['reply'],
    mentions: ['mention'],
    follows:  ['follow'],
  };

  const types = typeMap[filter];
  if (!types) return items;
  return items.filter(i => types.includes(i.type));
}

// ─── Performance Data ───────────────────────────────────────────────────────

interface PerfSummary {
  totalPosts: number;
  totalEngagement: number;
  avgEngagementRate: number;
  topPost: { content: string; engagement: number } | null;
  dailyEngagement: Array<{ date: string; engagement: number }>;
}

function computePerfSummary(items: TimelineItem[]): PerfSummary {
  const posts = items.filter(i => (i.type === 'post' || i.type === 'generated') && i.status === 'posted');
  const totalPosts = posts.length;

  let totalEng = 0;
  let topPost: { content: string; engagement: number } | null = null;
  const dailyMap: Record<string, number> = {};

  for (const p of posts) {
    const eng = totalEngagement(p.engagement);
    totalEng += eng;

    if (!topPost || eng > topPost.engagement) {
      topPost = { content: p.content, engagement: eng };
    }

    const dayKey = p.timestamp.slice(0, 10);
    dailyMap[dayKey] = (dailyMap[dayKey] ?? 0) + eng;
  }

  // Also count engagement from learning state
  const learningState = loadState<{
    performances: PostPerformance[];
  }>('learning', { performances: [] });

  for (const perf of learningState.performances) {
    const eng = totalEngagement(perf.engagement);
    totalEng += eng;
    if (!topPost || eng > topPost.engagement) {
      topPost = { content: perf.content, engagement: eng };
    }
    const dayKey = perf.postedAt.slice(0, 10);
    dailyMap[dayKey] = (dailyMap[dayKey] ?? 0) + eng;
  }

  const adjustedTotalPosts = totalPosts + learningState.performances.length;

  const dailyEngagement = Object.entries(dailyMap)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-14)
    .map(([date, engagement]) => ({ date, engagement }));

  return {
    totalPosts: adjustedTotalPosts,
    totalEngagement: totalEng,
    avgEngagementRate: adjustedTotalPosts > 0 ? Math.round((totalEng / adjustedTotalPosts) * 10) / 10 : 0,
    topPost,
    dailyEngagement,
  };
}

// ─── Type Icons & Badges ────────────────────────────────────────────────────

const TYPE_CONFIG: Record<ActivityType, { icon: string; label: string; bg: string; fg: string }> = {
  post:      { icon: '\u{1F4DD}', label: 'Post',      bg: '#238636', fg: '#fff' },
  reply:     { icon: '\u{1F4AC}', label: 'Reply',     bg: '#1f6feb', fg: '#fff' },
  mention:   { icon: '\u{1F4E2}', label: 'Mention',   bg: '#8b5cf6', fg: '#fff' },
  follow:    { icon: '\u{1F464}', label: 'Follow',    bg: '#ec4899', fg: '#fff' },
  generated: { icon: '\u{1F916}', label: 'Generated', bg: '#06b6d4', fg: '#fff' },
};

const STATUS_CONFIG: Record<ActivityStatus, { label: string; bg: string; fg: string }> = {
  posted:   { label: 'Posted',   bg: '#23863633', fg: '#3fb950' },
  draft:    { label: 'Draft',    bg: '#30363d',   fg: '#8b949e' },
  pending:  { label: 'Pending',  bg: '#d2992233', fg: '#d29922' },
  rejected: { label: 'Rejected', bg: '#da363333', fg: '#f85149' },
};

// ─── CSS ────────────────────────────────────────────────────────────────────

const PAGE_CSS = `
/* ── Filter Bar ── */
.af-filter-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}
.af-filter-bar a {
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 0.8rem;
  font-weight: 500;
  color: #c9d1d9;
  background: #21262d;
  border: 1px solid #30363d;
  text-decoration: none;
  transition: background 0.15s, color 0.15s;
}
.af-filter-bar a:hover { background: #30363d; color: #e6edf3; }
.af-filter-bar a.active { background: #1f6feb; border-color: #1f6feb; color: #fff; }

.af-period-select {
  margin-left: auto;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 0.8rem;
  font-weight: 500;
  color: #c9d1d9;
  background: #21262d;
  border: 1px solid #30363d;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
}
.af-period-select:focus { outline: 1px solid #58a6ff; border-color: #58a6ff; }

/* ── Timeline Items ── */
.af-timeline-item {
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 8px;
  padding: 14px 16px;
  margin-bottom: 10px;
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
.af-timeline-item:hover { border-color: #484f58; }

.af-item-icon {
  font-size: 1.2rem;
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
}

.af-item-body {
  flex: 1;
  min-width: 0;
}

.af-item-header {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 6px;
}

.af-type-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.af-status-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.af-timestamp {
  color: #484f58;
  font-size: 0.72rem;
  margin-left: auto;
  white-space: nowrap;
}

.af-author {
  color: #58a6ff;
  font-weight: 600;
  font-size: 0.82rem;
}

.af-platform {
  color: #8b949e;
  font-size: 0.72rem;
}

.af-content {
  color: #c9d1d9;
  font-size: 0.85rem;
  line-height: 1.5;
  word-break: break-word;
}

.af-engagement {
  display: flex;
  gap: 14px;
  margin-top: 8px;
  color: #8b949e;
  font-size: 0.75rem;
}
.af-engagement span { display: flex; align-items: center; gap: 3px; }

/* ── Empty State ── */
.af-empty {
  text-align: center;
  padding: 60px 20px;
  color: #484f58;
}
.af-empty-icon {
  font-size: 2.5rem;
  margin-bottom: 12px;
  opacity: 0.5;
}
.af-empty h3 { color: #8b949e; font-size: 1rem; margin-bottom: 6px; }
.af-empty p { color: #484f58; font-size: 0.85rem; }

/* ── Performance Section ── */
.af-perf-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 0;
  margin-top: 24px;
  border-top: 1px solid #21262d;
  cursor: pointer;
  color: #8b949e;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 600;
  user-select: none;
}
.af-perf-toggle:hover { color: #e6edf3; }
.af-perf-toggle .arrow { transition: transform 0.2s; }

.af-perf-content {
  overflow: hidden;
  transition: max-height 0.3s ease;
}

.af-stat-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 20px;
}
.af-stat-card {
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 8px;
  padding: 16px;
}
.af-stat-card .label {
  color: #8b949e;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 6px;
}
.af-stat-card .value {
  font-size: 1.6rem;
  font-weight: 700;
  color: #f0f6fc;
}
.af-stat-card .sub {
  color: #8b949e;
  font-size: 0.72rem;
  margin-top: 4px;
}

.af-top-post {
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 8px;
  padding: 14px 16px;
  margin-bottom: 20px;
}
.af-top-post-label {
  color: #8b949e;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 8px;
}
.af-top-post-content {
  color: #e6edf3;
  font-size: 0.85rem;
  line-height: 1.5;
}
.af-top-post-eng {
  color: #3fb950;
  font-size: 0.75rem;
  margin-top: 6px;
}

/* ── Chart ── */
.af-chart-wrap {
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 20px;
}
.af-chart-label {
  color: #8b949e;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 12px;
}
.af-bar-chart {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  height: 120px;
}
.af-bar {
  flex: 1;
  background: #58a6ff;
  border-radius: 3px 3px 0 0;
  min-width: 8px;
  transition: height 0.3s ease;
  position: relative;
}
.af-bar:hover { background: #79c0ff; }
.af-bar-label {
  position: absolute;
  bottom: -18px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 0.6rem;
  color: #484f58;
  white-space: nowrap;
}

/* ── Responsive ── */
@media (max-width: 768px) {
  .af-stat-grid { grid-template-columns: 1fr 1fr; }
  .af-filter-bar { gap: 6px; }
  .af-period-select { margin-left: 0; margin-top: 8px; width: 100%; }
}
@media (max-width: 480px) {
  .af-stat-grid { grid-template-columns: 1fr; }
}
`;

// ─── Client-side JS (minimal — toggle + dropdown) ───────────────────────────

const PAGE_JS = `
<script>
(function() {
  // Period dropdown navigation
  var sel = document.getElementById('af-period');
  if (sel) {
    sel.addEventListener('change', function() {
      var url = new URL(window.location.href);
      if (this.value === '7d') {
        url.searchParams.delete('period');
      } else {
        url.searchParams.set('period', this.value);
      }
      window.location.href = url.toString();
    });
  }

  // Performance section toggle
  var toggle = document.getElementById('af-perf-toggle');
  var content = document.getElementById('af-perf-content');
  var arrow = document.getElementById('af-perf-arrow');
  if (toggle && content) {
    toggle.addEventListener('click', function() {
      var open = content.style.maxHeight !== '0px';
      content.style.maxHeight = open ? '0px' : '2000px';
      if (arrow) arrow.style.transform = open ? 'rotate(0deg)' : 'rotate(180deg)';
    });
  }
})();
</script>`;

// ─── Render ─────────────────────────────────────────────────────────────────

export async function renderPage(query?: URLSearchParams): Promise<string> {
  const filter = query?.get('filter') || 'all';
  const period = query?.get('period') || '7d';

  // Collect all timeline items
  let items = collectTimelineItems();

  // Apply period filter
  items = filterByPeriod(items, period);

  // Apply type filter
  const filteredItems = filterByType(items, filter);

  // Sort newest first
  filteredItems.sort((a, b) =>
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  // Cap to 100 items
  const displayItems = filteredItems.slice(0, 100);

  // Performance summary (computed from period-filtered, all-type items)
  const perf = computePerfSummary(items);

  // Build href helper
  const buildHref = (f: string, p: string): string => {
    const params = new URLSearchParams();
    if (f !== 'all') params.set('filter', f);
    if (p !== '7d') params.set('period', p);
    const qs = params.toString();
    return `/activity${qs ? '?' + qs : ''}`;
  };

  // ── Filter Bar ──
  const filterOptions = [
    { key: 'all',      label: 'All' },
    { key: 'posts',    label: 'Posts' },
    { key: 'replies',  label: 'Replies' },
    { key: 'mentions', label: 'Mentions' },
    { key: 'follows',  label: 'Follows' },
  ];

  const periodOptions = [
    { value: '1d',  label: '1 day' },
    { value: '7d',  label: '7 days' },
    { value: '30d', label: '30 days' },
    { value: 'all', label: 'All time' },
  ];

  const filterBarHtml = `
<div class="af-filter-bar">
  ${filterOptions.map(f => {
    const active = f.key === filter ? ' active' : '';
    return `<a href="${buildHref(f.key, period)}" class="${active}">${f.label}</a>`;
  }).join('\n  ')}
  <select id="af-period" class="af-period-select">
    ${periodOptions.map(p =>
      `<option value="${p.value}"${p.value === period ? ' selected' : ''}>${p.label}</option>`
    ).join('\n    ')}
  </select>
</div>`;

  // ── Timeline Items ──
  let timelineHtml: string;

  if (displayItems.length === 0) {
    timelineHtml = `
<div class="af-empty">
  <div class="af-empty-icon">\u{1F4CB}</div>
  <h3>No activity yet</h3>
  <p>Generate your first post from the Create tab.</p>
</div>`;
  } else {
    timelineHtml = displayItems.map(item => renderTimelineItem(item)).join('\n');
  }

  // ── Performance Summary (collapsible) ──
  const perfHtml = renderPerfSummary(perf);

  return `
<style>${PAGE_CSS}</style>

<!-- Timeline -->
${filterBarHtml}
${timelineHtml}

<!-- Performance Summary -->
${perfHtml}

${PAGE_JS}`;
}

// ─── Timeline Item Renderer ─────────────────────────────────────────────────

function renderTimelineItem(item: TimelineItem): string {
  const tc = TYPE_CONFIG[item.type];
  const sc = STATUS_CONFIG[item.status];

  const contentPreview = esc(truncate(item.content, 100));

  const authorHtml = item.author
    ? `<span class="af-author">@${esc(item.author)}</span>`
    : '';

  let engagementHtml = '';
  if (item.engagement && totalEngagement(item.engagement) > 0) {
    const e = item.engagement;
    engagementHtml = `
    <div class="af-engagement">
      ${e.likes > 0 ? `<span>\u2764\uFE0F ${e.likes}</span>` : ''}
      ${e.replies > 0 ? `<span>\u{1F4AC} ${e.replies}</span>` : ''}
      ${e.reposts > 0 ? `<span>\u{1F501} ${e.reposts}</span>` : ''}
    </div>`;
  }

  return `
<div class="af-timeline-item">
  <div class="af-item-icon" style="background:${tc.bg}22">${tc.icon}</div>
  <div class="af-item-body">
    <div class="af-item-header">
      <span class="af-type-badge" style="background:${tc.bg};color:${tc.fg}">${tc.label}</span>
      <span class="af-status-badge" style="background:${sc.bg};color:${sc.fg}">${sc.label}</span>
      ${authorHtml}
      <span class="af-platform">${esc(item.platform)}</span>
      <span class="af-timestamp">${esc(timeAgo(item.timestamp))}</span>
    </div>
    <div class="af-content">${contentPreview}</div>
    ${engagementHtml}
  </div>
</div>`;
}

// ─── Performance Summary Renderer ───────────────────────────────────────────

function renderPerfSummary(perf: PerfSummary): string {
  // Stat cards
  const statCards = `
<div class="af-stat-grid">
  <div class="af-stat-card">
    <div class="label">Total Posts</div>
    <div class="value">${perf.totalPosts}</div>
    <div class="sub">This period</div>
  </div>
  <div class="af-stat-card">
    <div class="label">Total Engagement</div>
    <div class="value">${perf.totalEngagement}</div>
    <div class="sub">Likes + replies + reposts</div>
  </div>
  <div class="af-stat-card">
    <div class="label">Avg Engagement</div>
    <div class="value">${perf.avgEngagementRate}</div>
    <div class="sub">Per post</div>
  </div>
  <div class="af-stat-card">
    <div class="label">Top Post</div>
    <div class="value" style="font-size:1rem;font-weight:500">${perf.topPost ? esc(truncate(perf.topPost.content, 40)) : '--'}</div>
    <div class="sub">${perf.topPost ? `${perf.topPost.engagement} engagements` : 'No data yet'}</div>
  </div>
</div>`;

  // Top post detail card
  let topPostHtml = '';
  if (perf.topPost && perf.topPost.engagement > 0) {
    topPostHtml = `
<div class="af-top-post">
  <div class="af-top-post-label">Top Performing Post</div>
  <div class="af-top-post-content">${esc(truncate(perf.topPost.content, 280))}</div>
  <div class="af-top-post-eng">${perf.topPost.engagement} total engagements</div>
</div>`;
  }

  // Bar chart (CSS-only, no Chart.js dependency needed)
  let chartHtml = '';
  if (perf.dailyEngagement.length > 0) {
    const maxEng = Math.max(1, ...perf.dailyEngagement.map(d => d.engagement));
    const bars = perf.dailyEngagement.map(d => {
      const height = Math.max(2, Math.round((d.engagement / maxEng) * 100));
      const dayLabel = d.date.slice(5); // MM-DD
      return `<div class="af-bar" style="height:${height}%" title="${esc(d.date)}: ${d.engagement}"><span class="af-bar-label">${esc(dayLabel)}</span></div>`;
    }).join('\n      ');

    chartHtml = `
<div class="af-chart-wrap">
  <div class="af-chart-label">Engagement Over Time</div>
  <div class="af-bar-chart" style="padding-bottom:20px">
    ${bars}
  </div>
</div>`;
  }

  return `
<div class="af-perf-toggle" id="af-perf-toggle">
  <span class="arrow" id="af-perf-arrow" style="transform:rotate(180deg)">\u25B2</span>
  <span>Performance Summary</span>
</div>
<div class="af-perf-content" id="af-perf-content" style="max-height:2000px">
  ${statCards}
  ${topPostHtml}
  ${chartHtml}
</div>`;
}

// ─── Post Handler ───────────────────────────────────────────────────────────

export async function handlePost(
  action: string,
  body: Record<string, string>,
): Promise<{ redirect?: string }> {
  return { redirect: '/activity-feed' };
}
