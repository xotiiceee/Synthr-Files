/**
 * Feed page — shows recent autopost entries with stats and filtering.
 * Read-only view of post history and queue.
 */

import { loadState } from '../../core/state.js';
import { getAutopostStats } from '../../modes/autopost.js';
import type { AutopostEntry } from '../../modes/autopost.js';

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

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  posted:   { bg: '#238636', fg: '#fff' },
  pending:  { bg: '#9e6a03', fg: '#fff' },
  rejected: { bg: '#da3633', fg: '#fff' },
  approved: { bg: '#1f6feb', fg: '#fff' },
  expired:  { bg: '#484f58', fg: '#c9d1d9' },
};

const CATEGORY_COLORS: Record<string, string> = {
  news_commentary:   '#8b5cf6',
  product_tips:      '#06b6d4',
  industry_insights: '#f59e0b',
  engagement:        '#ec4899',
  curated_reshares:  '#10b981',
  milestones:        '#f97316',
};

// ─── Render ──────────────────────────────────────────────────────────────────

export async function renderPage(query?: URLSearchParams): Promise<string> {
  const stats = getAutopostStats();
  const state = loadState<{ postHistory: AutopostEntry[] }>('autopost', { postHistory: [] });
  const queue = loadState<AutopostEntry[]>('autopost-queue', []);

  // Merge and deduplicate entries
  const seen = new Set<string>();
  const allEntries: AutopostEntry[] = [];
  for (const entry of [...state.postHistory, ...queue]) {
    if (!seen.has(entry.id)) {
      seen.add(entry.id);
      allEntries.push(entry);
    }
  }

  // Sort newest first
  allEntries.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // Filter by status
  const filter = query?.get('filter') ?? 'all';
  const filtered = filter === 'all'
    ? allEntries
    : allEntries.filter(e => e.status === filter);

  // Stats bar
  const posted = stats.byStatus['posted'] ?? 0;
  const pending = stats.byStatus['pending'] ?? 0;
  const rejected = stats.byStatus['rejected'] ?? 0;
  const approved = stats.byStatus['approved'] ?? 0;

  return `
<style>
  .feed-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 20px; }
  .feed-stat { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; }
  .feed-stat .label { color: #8b949e; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }
  .feed-stat .value { font-size: 1.8rem; font-weight: 700; color: #f0f6fc; }
  .feed-stat .sub { color: #8b949e; font-size: 0.72rem; margin-top: 4px; }
  .feed-filters { display: flex; gap: 8px; margin-bottom: 20px; flex-wrap: wrap; }
  .feed-filters a {
    padding: 6px 14px; border-radius: 6px; font-size: 0.8rem; font-weight: 500;
    color: #c9d1d9; background: #21262d; border: 1px solid #30363d; text-decoration: none;
  }
  .feed-filters a:hover { background: #30363d; }
  .feed-filters a.active { background: #1f6feb; border-color: #1f6feb; color: #fff; }
  .feed-card {
    background: #161b22; border: 1px solid #30363d; border-radius: 8px;
    padding: 16px; margin-bottom: 12px;
  }
  .feed-card-header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
  .feed-badge {
    display: inline-block; padding: 2px 10px; border-radius: 12px;
    font-size: 0.72rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em;
  }
  .feed-card-content {
    color: #e6edf3; font-size: 0.88rem; line-height: 1.55;
    white-space: pre-wrap; word-break: break-word; margin-bottom: 10px;
  }
  .feed-card-meta { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; color: #8b949e; font-size: 0.75rem; }
  .feed-card-meta .voice { color: #58a6ff; font-weight: 600; }
  .feed-thread-count { color: #8b949e; font-size: 0.75rem; font-style: italic; }
  .feed-quote-url { color: #58a6ff; font-size: 0.75rem; word-break: break-all; }
  .feed-risk { display: inline-block; padding: 2px 8px; border-radius: 4px; background: #da363322; color: #f85149; font-size: 0.7rem; margin-right: 4px; }
  .feed-empty { text-align: center; padding: 40px 20px; color: #484f58; font-size: 0.9rem; }
  .feed-status-row { display: flex; gap: 12px; flex-wrap: wrap; }
  .feed-status-chip { font-size: 0.75rem; font-weight: 600; }
  .feed-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 10px; padding-top: 10px; border-top: 1px solid #21262d; }
  .feed-actions .btn { padding: 5px 14px; border-radius: 6px; font-size: 0.78rem; font-weight: 600; cursor: pointer; border: none; }
  .feed-actions .btn-approve { background: #3fb950; color: #0d1117; }
  .feed-actions .btn-approve:hover { background: #2ea043; }
  .feed-actions .btn-edit { background: #58a6ff; color: #0d1117; }
  .feed-actions .btn-edit:hover { background: #79c0ff; }
  .feed-actions .btn-reject { background: #f85149; color: #fff; }
  .feed-actions .btn-reject:hover { background: #da3633; }
  .feed-actions .btn-defer { background: #30363d; color: #c9d1d9; }
  .feed-actions .btn-defer:hover { background: #484f58; }
  .feed-actions .btn-cancel { background: #21262d; color: #c9d1d9; border: none; }
  .feed-actions .btn-save { background: #3fb950; color: #0d1117; }
  .feed-edit-area { display: none; margin-top: 10px; padding: 12px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; }
  .feed-edit-area textarea { width: 100%; background: #161b22; color: #c9d1d9; border: 1px solid #30363d; border-radius: 4px; padding: 10px; font-size: 0.85rem; line-height: 1.6; margin-bottom: 8px; resize: vertical; }
  .feed-reject-area { display: none; align-items: center; gap: 6px; margin-top: 8px; }
  .feed-reject-area input { background: #0d1117; color: #c9d1d9; border: 1px solid #30363d; border-radius: 4px; padding: 5px 10px; font-size: 0.8rem; width: 200px; }
  .feed-reject-area input:focus { border-color: #f85149; outline: none; }
</style>

<!-- Stats Bar -->
<div class="feed-stats">
  <div class="feed-stat">
    <div class="label">Total Posts</div>
    <div class="value">${stats.totalPosts}</div>
    <div class="sub">all time</div>
  </div>
  <div class="feed-stat">
    <div class="label">Today</div>
    <div class="value">${stats.todayCount}</div>
    <div class="sub">${stats.dailyLimit} daily limit</div>
  </div>
  <div class="feed-stat">
    <div class="label">Avg Voice Score</div>
    <div class="value">${stats.avgVoiceScore}<span style="font-size:0.9rem;color:#8b949e">/100</span></div>
  </div>
  <div class="feed-stat">
    <div class="label">By Status</div>
    <div class="feed-status-row">
      <span class="feed-status-chip" style="color:#238636">${posted} posted</span>
      <span class="feed-status-chip" style="color:#9e6a03">${pending} pending</span>
      <span class="feed-status-chip" style="color:#da3633">${rejected} rejected</span>
      <span class="feed-status-chip" style="color:#1f6feb">${approved} approved</span>
    </div>
  </div>
</div>

<!-- Filters -->
<div class="feed-filters">
  <a href="/queue?tab=feed" class="${filter === 'all' ? 'active' : ''}">All (${allEntries.length})</a>
  <a href="/queue?tab=feed&filter=posted" class="${filter === 'posted' ? 'active' : ''}">Posted (${posted})</a>
  <a href="/queue?tab=feed&filter=pending" class="${filter === 'pending' ? 'active' : ''}">Pending (${pending})</a>
  <a href="/queue?tab=feed&filter=rejected" class="${filter === 'rejected' ? 'active' : ''}">Rejected (${rejected})</a>
  <a href="/queue?tab=feed&filter=approved" class="${filter === 'approved' ? 'active' : ''}">Approved (${approved})</a>
</div>

<!-- Post List -->
${filtered.length === 0
  ? '<div class="feed-empty">No posts match this filter.</div>'
  : filtered.map(entry => renderCard(entry)).join('\n')}

<script>
function feedShowEdit(id) {
  document.getElementById('feed-edit-' + id).style.display = 'block';
}
function feedHideEdit(id) {
  document.getElementById('feed-edit-' + id).style.display = 'none';
}
function feedSubmitEdit(id) {
  var textarea = document.querySelector('#feed-edit-' + id + ' textarea');
  var form = document.createElement('form');
  form.method = 'POST';
  form.style.display = 'none';
  var a = document.createElement('input'); a.name = 'action'; a.value = 'edit'; form.appendChild(a);
  var b = document.createElement('input'); b.name = 'id'; b.value = id; form.appendChild(b);
  var c = document.createElement('input'); c.name = 'content'; c.value = textarea.value; form.appendChild(c);
  var t = document.createElement('input'); t.name = '_tab'; t.value = 'all'; form.appendChild(t);
  document.body.appendChild(form);
  form.submit();
}
function feedShowReject(id) {
  document.getElementById('feed-reject-' + id).style.display = 'inline-flex';
}
function feedSubmitReject(id) {
  var reasonInput = document.querySelector('#feed-reject-' + id + ' input');
  var form = document.createElement('form');
  form.method = 'POST';
  form.style.display = 'none';
  var a = document.createElement('input'); a.name = 'action'; a.value = 'reject'; form.appendChild(a);
  var b = document.createElement('input'); b.name = 'id'; b.value = id; form.appendChild(b);
  var c = document.createElement('input'); c.name = 'reason'; c.value = reasonInput ? reasonInput.value : ''; form.appendChild(c);
  var t = document.createElement('input'); t.name = '_tab'; t.value = 'all'; form.appendChild(t);
  document.body.appendChild(form);
  form.submit();
}
</script>
`;
}

// ─── Card Renderer ───────────────────────────────────────────────────────────

function renderCard(entry: AutopostEntry): string {
  const sc = STATUS_COLORS[entry.status] ?? { bg: '#30363d', fg: '#c9d1d9' };
  const catColor = CATEGORY_COLORS[entry.category] ?? '#8b949e';
  const catLabel = entry.category.replace(/_/g, ' ');

  let extras = '';

  // Thread info
  if (entry.isThread && entry.threadTweets?.length) {
    extras += `<span class="feed-thread-count">${entry.threadTweets.length}-tweet thread</span>`;
  }

  // Quote-tweet URL
  if (entry.quoteTweetUrl) {
    extras += `<span class="feed-quote-url">QT: ${esc(entry.quoteTweetUrl)}</span>`;
  }

  // Risk flags
  const risks = (entry.riskFlags ?? []).length > 0
    ? entry.riskFlags.map(f => `<span class="feed-risk">${esc(f)}</span>`).join('')
    : '';

  // Inline actions for pending/approved posts
  const isPending = entry.status === 'pending' || entry.status === 'approved';
  const actionsHtml = isPending ? `
  <div class="feed-actions">
    <form method="POST" style="margin:0;display:inline">
      <input type="hidden" name="action" value="approve">
      <input type="hidden" name="_tab" value="all">
      <input type="hidden" name="id" value="${esc(entry.id)}">
      <button type="submit" class="btn btn-approve">${entry.status === 'approved' ? 'Publish Now' : 'Approve & Post'}</button>
    </form>
    <button type="button" class="btn btn-edit" onclick="feedShowEdit('${esc(entry.id)}')">Edit</button>
    <button type="button" class="btn btn-reject" onclick="feedShowReject('${esc(entry.id)}')">Reject</button>
    <form method="POST" style="margin:0;display:inline">
      <input type="hidden" name="action" value="defer">
      <input type="hidden" name="id" value="${esc(entry.id)}">
      <input type="hidden" name="_tab" value="all">
      <button type="submit" class="btn btn-defer">Defer 6h</button>
    </form>
  </div>
  <div id="feed-reject-${esc(entry.id)}" class="feed-reject-area">
    <input type="text" placeholder="Reason (optional)">
    <button type="button" class="btn btn-reject" onclick="feedSubmitReject('${esc(entry.id)}')">Confirm</button>
    <button type="button" class="btn btn-cancel" onclick="this.parentElement.style.display='none'">Cancel</button>
  </div>
  <div id="feed-edit-${esc(entry.id)}" class="feed-edit-area">
    <textarea rows="${Math.max(3, entry.content.split('\n').length + 1)}">${esc(entry.content)}</textarea>
    <div style="display:flex;gap:8px">
      <button type="button" class="btn btn-save" onclick="feedSubmitEdit('${esc(entry.id)}')">Save & Approve</button>
      <button type="button" class="btn btn-cancel" onclick="feedHideEdit('${esc(entry.id)}')">Cancel</button>
    </div>
  </div>` : '';

  return `
<div class="feed-card">
  <div class="feed-card-header">
    <span class="feed-badge" style="background:${sc.bg};color:${sc.fg}">${esc(entry.status)}</span>
    <span class="feed-badge" style="background:${catColor}22;color:${catColor};border:1px solid ${catColor}44">${esc(catLabel)}</span>
    <span style="color:#8b949e;font-size:0.75rem;margin-left:auto">${esc(entry.platform)}</span>
  </div>
  <div class="feed-card-content">${esc(entry.content)}</div>
  ${extras ? `<div style="margin-bottom:8px">${extras}</div>` : ''}
  ${risks ? `<div style="margin-bottom:8px">${risks}</div>` : ''}
  <div class="feed-card-meta">
    <span class="voice">voice ${entry.voiceScore}/100</span>
    <span>${timeAgo(entry.createdAt)}</span>
    <span>${esc(entry.createdAt.slice(0, 16).replace('T', ' '))}</span>
    ${entry.postedAt ? `<span>posted ${timeAgo(entry.postedAt)}</span>` : ''}
    ${entry.format ? `<span>${esc(entry.format)}</span>` : ''}
  </div>
  ${actionsHtml}
</div>`;
}

// ─── Post Handler — delegates review actions ────────────────────────────────

export async function handlePost(
  action: string,
  body: Record<string, string>,
): Promise<{ redirect?: string }> {
  // Review actions (approve/reject/edit/defer) are handled by content.ts router
  // which delegates to review.ts — this is just a fallback
  return { redirect: '/queue?tab=feed' };
}
