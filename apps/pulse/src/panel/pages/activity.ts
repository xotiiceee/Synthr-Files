/**
 * Activity page — Published posts and system action log.
 *
 * Two sub-tabs:
 *   Published (default) — read-only cards of all posted content
 *   Log — compact rows of system actions
 */

import { loadState } from '../../core/state.js';
import { getAutopostStats } from '../../modes/autopost.js';
import { getActions } from '../../core/state.js';
import type { AutopostEntry } from '../../modes/autopost.js';
import type { ActionRecord } from '../../core/state.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatTimestamp(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ');
}

const CATEGORY_COLORS: Record<string, string> = {
  news_commentary:   '#8b5cf6',
  product_tips:      '#06b6d4',
  industry_insights: '#f59e0b',
  engagement:        '#ec4899',
  curated_reshares:  '#10b981',
  milestones:        '#f97316',
};

const ACTION_TYPE_COLORS: Record<string, { bg: string; fg: string }> = {
  post:    { bg: '#238636', fg: '#fff' },
  reply:   { bg: '#1f6feb', fg: '#fff' },
  like:    { bg: '#ec4899', fg: '#fff' },
  repost:  { bg: '#8b5cf6', fg: '#fff' },
  skip:    { bg: '#484f58', fg: '#c9d1d9' },
  reject:  { bg: '#da3633', fg: '#fff' },
  approve: { bg: '#3fb950', fg: '#0d1117' },
  error:   { bg: '#f85149', fg: '#fff' },
  comment: { bg: '#58a6ff', fg: '#0d1117' },
};

// ─── Sub-tab CSS ─────────────────────────────────────────────────────────────

const SUB_TAB_CSS = `
.sub-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 24px;
  border-bottom: 1px solid #21262d;
}
.sub-tab {
  padding: 10px 18px;
  color: #8b949e;
  font-size: 14px;
  font-weight: 500;
  border-bottom: 2px solid transparent;
  text-decoration: none;
  transition: color 0.15s, border-color 0.15s;
}
.sub-tab:hover { color: #e6edf3; }
.sub-tab.active { color: #f0f6fc; border-bottom-color: #58a6ff; }
.sub-tab-badge {
  background: #da3633;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  padding: 1px 7px;
  border-radius: 10px;
  margin-left: 6px;
}
`;

// ─── Activity-specific CSS ───────────────────────────────────────────────────

const ACTIVITY_CSS = `
.activity-filters {
  display: flex;
  gap: 8px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}
.activity-filters a {
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 0.8rem;
  font-weight: 500;
  color: #c9d1d9;
  background: #21262d;
  border: 1px solid #30363d;
  text-decoration: none;
}
.activity-filters a:hover { background: #30363d; }
.activity-filters a.active { background: #1f6feb; border-color: #1f6feb; color: #fff; }

/* Published cards — same style as feed.ts */
.feed-card {
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 12px;
}
.feed-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.feed-badge {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.feed-card-content {
  color: #e6edf3;
  font-size: 0.88rem;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  margin-bottom: 10px;
}
.feed-card-meta {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  color: #8b949e;
  font-size: 0.75rem;
}
.feed-card-meta .voice { color: #58a6ff; font-weight: 600; }
.feed-empty {
  text-align: center;
  padding: 40px 20px;
  color: #484f58;
  font-size: 0.9rem;
}

/* Auto / Manual badges */
.auto-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  background: #23863622;
  color: #3fb950;
  border: 1px solid #23863644;
}
.manual-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  background: #1f6feb22;
  color: #58a6ff;
  border: 1px solid #1f6feb44;
}

/* Log rows */
.log-table {
  width: 100%;
  border-collapse: collapse;
}
.log-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  font-size: 0.82rem;
  border-left: 3px solid transparent;
}
.log-row:nth-child(odd) { background: #161b22; }
.log-row:nth-child(even) { background: #0d1117; }
.log-row.log-error { border-left-color: #f85149; }
.log-timestamp {
  color: #484f58;
  font-size: 0.72rem;
  white-space: nowrap;
  min-width: 130px;
}
.log-type-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  min-width: 55px;
  text-align: center;
}
.log-content {
  color: #c9d1d9;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.log-platform {
  color: #8b949e;
  font-size: 0.72rem;
  white-space: nowrap;
}
`;

// ─── Render ──────────────────────────────────────────────────────────────────

export async function renderPage(query?: URLSearchParams): Promise<string> {
  const tab = query?.get('tab') || 'published';

  // Count for badges
  const state = loadState<{ postHistory: AutopostEntry[] }>('autopost', { postHistory: [] });
  const queue = loadState<AutopostEntry[]>('autopost-queue', []);
  const allEntries = deduplicateEntries([...state.postHistory, ...queue]);
  const publishedCount = allEntries.filter(e => e.status === 'posted').length;
  const actions = getActions();

  const tabs = [
    { key: 'published', label: 'Published', badge: publishedCount > 0 ? publishedCount : null },
    { key: 'log',       label: 'Log',       badge: null },
  ];

  const tabBar = `
<style>${SUB_TAB_CSS}${ACTIVITY_CSS}</style>
<div class="sub-tabs">
  ${tabs.map(t => {
    const active = t.key === tab ? ' active' : '';
    const badge = t.badge !== null
      ? `<span class="sub-tab-badge">${t.badge}</span>`
      : '';
    return `<a href="/activity?tab=${t.key}" class="sub-tab${active}">${t.label}${badge}</a>`;
  }).join('\n  ')}
</div>`;

  let body: string;
  switch (tab) {
    case 'log':
      body = renderLog(query);
      break;
    case 'published':
    default:
      body = renderPublished(query);
      break;
  }

  return tabBar + body;
}

// ─── Published Tab ───────────────────────────────────────────────────────────

function deduplicateEntries(entries: AutopostEntry[]): AutopostEntry[] {
  const seen = new Set<string>();
  const result: AutopostEntry[] = [];
  for (const entry of entries) {
    if (!seen.has(entry.id)) {
      seen.add(entry.id);
      result.push(entry);
    }
  }
  return result;
}

function renderPublished(query?: URLSearchParams): string {
  const state = loadState<{ postHistory: AutopostEntry[] }>('autopost', { postHistory: [] });
  const queue = loadState<AutopostEntry[]>('autopost-queue', []);

  // Merge, deduplicate, filter to posted only
  const allEntries = deduplicateEntries([...state.postHistory, ...queue]);
  let posted = allEntries.filter(e => e.status === 'posted');

  // Sort newest first
  posted.sort((a, b) => {
    const aTime = a.postedAt || a.createdAt;
    const bTime = b.postedAt || b.createdAt;
    return new Date(bTime).getTime() - new Date(aTime).getTime();
  });

  // Date filter
  const dateFilter = query?.get('date') ?? 'all';
  const now = Date.now();
  if (dateFilter === 'today') {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    posted = posted.filter(e => new Date(e.postedAt || e.createdAt).getTime() >= start.getTime());
  } else if (dateFilter === 'week') {
    posted = posted.filter(e => now - new Date(e.postedAt || e.createdAt).getTime() < 7 * 86_400_000);
  } else if (dateFilter === 'month') {
    posted = posted.filter(e => now - new Date(e.postedAt || e.createdAt).getTime() < 30 * 86_400_000);
  }

  // Platform filter
  const platformFilter = query?.get('platform') ?? 'all';
  if (platformFilter !== 'all') {
    posted = posted.filter(e => e.platform === platformFilter);
  }

  // Collect unique platforms for filter bar
  const allPosted = allEntries.filter(e => e.status === 'posted');
  const platforms = [...new Set(allPosted.map(e => e.platform))].sort();

  const dateLinks = [
    { key: 'all',   label: 'All' },
    { key: 'today', label: 'Today' },
    { key: 'week',  label: 'This Week' },
    { key: 'month', label: 'This Month' },
  ];

  const buildHref = (d: string, p: string) => {
    const params = new URLSearchParams({ tab: 'published' });
    if (d !== 'all') params.set('date', d);
    if (p !== 'all') params.set('platform', p);
    return `/activity?${params.toString()}`;
  };

  return `
<!-- Filters -->
<div class="activity-filters">
  ${dateLinks.map(d => {
    const active = d.key === dateFilter ? ' active' : '';
    return `<a href="${buildHref(d.key, platformFilter)}" class="${active}">${d.label}</a>`;
  }).join('\n  ')}
  <span style="border-left:1px solid #30363d;margin:0 4px"></span>
  <a href="${buildHref(dateFilter, 'all')}" class="${platformFilter === 'all' ? 'active' : ''}">All Platforms</a>
  ${platforms.map(p => {
    const active = p === platformFilter ? ' active' : '';
    return `<a href="${buildHref(dateFilter, p)}" class="${active}">${esc(p)}</a>`;
  }).join('\n  ')}
</div>

<!-- Published Posts -->
${posted.length === 0
  ? '<div class="feed-empty">No posts published yet.</div>'
  : posted.map(entry => renderPublishedCard(entry)).join('\n')}
`;
}

function renderPublishedCard(entry: AutopostEntry): string {
  const catColor = CATEGORY_COLORS[entry.category] ?? '#8b949e';
  const catLabel = entry.category.replace(/_/g, ' ');

  // Determine auto vs manual: entries that were approved before posting are "manual"
  // Since we cannot distinguish from the type alone, treat all autopost entries as AUTO.
  // If the entry went through approval (rejectedReason is absent, status is posted), it's auto.
  const isManual = false; // All autopost entries are auto; manual publishing is not tracked yet
  const modeBadge = isManual
    ? '<span class="manual-badge">Manual</span>'
    : '<span class="auto-badge">Auto</span>';

  const postedTime = entry.postedAt || entry.createdAt;

  return `
<div class="feed-card">
  <div class="feed-card-header">
    ${modeBadge}
    <span class="feed-badge" style="background:${catColor}22;color:${catColor};border:1px solid ${catColor}44">${esc(catLabel)}</span>
    ${entry.format ? `<span class="feed-badge" style="background:#30363d;color:#c9d1d9">${esc(entry.format)}</span>` : ''}
    <span style="color:#8b949e;font-size:0.75rem;margin-left:auto">${esc(entry.platform)}</span>
  </div>
  <div class="feed-card-content">${esc(entry.content)}</div>
  <div class="feed-card-meta">
    <span class="voice">voice ${entry.voiceScore}/100</span>
    <span>${timeAgo(postedTime)}</span>
    <span>${esc(formatTimestamp(postedTime))}</span>
  </div>
</div>`;
}

// ─── Log Tab ─────────────────────────────────────────────────────────────────

function renderLog(query?: URLSearchParams): string {
  let actions = getActions();

  // Sort newest first
  actions = [...actions].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  // Filter by type
  const typeFilter = query?.get('type') ?? 'all';
  const allTypes = [...new Set(actions.map(a => a.type))].sort();

  if (typeFilter !== 'all') {
    actions = actions.filter(a => a.type === typeFilter);
  }

  // Limit to 100
  actions = actions.slice(0, 100);

  const buildHref = (t: string) => {
    const params = new URLSearchParams({ tab: 'log' });
    if (t !== 'all') params.set('type', t);
    return `/activity?${params.toString()}`;
  };

  return `
<!-- Type Filter -->
<div class="activity-filters">
  <a href="${buildHref('all')}" class="${typeFilter === 'all' ? 'active' : ''}">All</a>
  ${allTypes.map(t => {
    const active = t === typeFilter ? ' active' : '';
    return `<a href="${buildHref(t)}" class="${active}">${esc(t)}</a>`;
  }).join('\n  ')}
</div>

<!-- Log Entries -->
${actions.length === 0
  ? '<div class="feed-empty">No actions logged yet.</div>'
  : `<div>${actions.map(a => renderLogRow(a)).join('\n')}</div>`}
`;
}

function renderLogRow(action: ActionRecord): string {
  const colors = ACTION_TYPE_COLORS[action.type] ?? { bg: '#30363d', fg: '#c9d1d9' };
  const isError = (action.type as string) === 'error';

  // Build a brief description
  let description = action.content;
  if (!description && action.targetText) {
    description = action.targetText;
  }
  if (description && description.length > 120) {
    description = description.slice(0, 117) + '...';
  }
  if (!description) description = '—';

  return `
<div class="log-row${isError ? ' log-error' : ''}">
  <span class="log-timestamp">${esc(formatTimestamp(action.timestamp))}</span>
  <span class="log-type-badge" style="background:${colors.bg};color:${colors.fg}">${esc(action.type)}</span>
  <span class="log-content">${esc(description)}</span>
  <span class="log-platform">${esc(action.platform)}</span>
</div>`;
}

// ─── Post Handler ────────────────────────────────────────────────────────────

export async function handlePost(
  action: string,
  body: Record<string, string>,
): Promise<{ redirect?: string }> {
  return { redirect: '/activity' };
}
