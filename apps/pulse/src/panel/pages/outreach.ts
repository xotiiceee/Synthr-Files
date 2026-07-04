/**
 * Outreach page — browsable opportunity feed.
 *
 * Users discover conversations from others, choose which to reply to,
 * get AI-generated reply suggestions, and post directly to X.
 * Skipped opportunities record a reason for learning.
 */

import {
  discoverOpportunities,
  getOpportunityFeed,
  generateReplyForOpportunity,
  skipOpportunity,
  markOpportunityReplied,
  markOpportunityQuoteTweeted,
  startEngagement,
  cleanupOpportunities,
  updateOpportunitySuggestedReply,
  type Opportunity,
} from '../../core/opportunity-engine.js';
import { getXWriteClient } from '../../platforms/x-write-client.js';
import type { Conversation } from '../../platforms/base.js';

// ─── Discover State (fire-and-forget polling) ────────────────────────────────

let discoverStatus: 'idle' | 'running' | 'done' | 'error' = 'idle';
let discoverMessage = '';

// ─── Reply Generation State (per-opportunity) ───────────────────────────────

const generatingReplies = new Map<string, 'running' | 'done' | 'error'>();
const generatingErrors = new Map<string, string>();

// ─── HTML Escaping ──────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
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

function relevanceColor(score: number): string {
  if (score >= 80) return '#3fb950';
  if (score >= 60) return '#d29922';
  if (score >= 40) return '#db6d28';
  return '#8b949e';
}

function relevanceBadge(score: number): string {
  const color = relevanceColor(score);
  return `<span style="color:${color};font-weight:700;font-size:13px">${score}/100</span>`;
}

const TOPIC_COLORS: Record<string, string> = {
  ai:         '#8b5cf6',
  agents:     '#6366f1',
  crypto:     '#f59e0b',
  solana:     '#14f195',
  defi:       '#06b6d4',
  web3:       '#ec4899',
  devtools:   '#3b82f6',
  saas:       '#10b981',
  startup:    '#f97316',
  api:        '#6366f1',
  automation: '#84cc16',
  payments:   '#eab308',
};

function topicColor(topicId: string): string {
  const lower = topicId.toLowerCase();
  for (const [key, color] of Object.entries(TOPIC_COLORS)) {
    if (lower.includes(key)) return color;
  }
  let hash = 0;
  for (let i = 0; i < topicId.length; i++) {
    hash = ((hash << 5) - hash + topicId.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 55%)`;
}

// ─── Page CSS ───────────────────────────────────────────────────────────────

function pageCss(): string {
  return `
    .opp-stats-bar {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 14px;
      margin-bottom: 20px;
    }

    .opp-stat-card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 14px 16px;
      display: flex;
      flex-direction: column;
    }

    .opp-stat-card h3 {
      color: #8b949e;
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 4px;
    }

    .opp-stat-card .stat-val {
      font-size: 1.6rem;
      font-weight: 700;
      color: #f0f6fc;
    }

    .opp-stat-card .stat-sub {
      color: #8b949e;
      font-size: 0.72rem;
      margin-top: 2px;
    }

    .opp-stat-card.has-btn {
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
    }

    .opp-filter-bar {
      display: flex;
      gap: 12px;
      align-items: center;
      flex-wrap: wrap;
      margin-bottom: 20px;
      padding: 12px 16px;
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
    }

    .opp-filter-bar label {
      color: #8b949e;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-right: 4px;
    }

    .opp-filter-bar select {
      background: #0d1117;
      color: #e6edf3;
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 6px 10px;
      font-size: 0.82rem;
    }

    .opp-card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 18px;
      margin-bottom: 14px;
      transition: border-color 0.15s, opacity 0.3s;
    }

    .opp-card.status-new {
      border-color: #58a6ff;
      border-width: 1px;
      box-shadow: 0 0 0 1px rgba(88, 166, 255, 0.15);
    }

    .opp-card.status-replied {
      border-color: #238636;
    }

    .opp-card.status-engaging {
      border-color: #d29922;
      border-width: 1px;
      box-shadow: 0 0 0 1px rgba(210, 153, 34, 0.15);
    }

    .opp-card.status-skipped {
      opacity: 0.5;
    }

    .opp-card.status-skipped .opp-text {
      text-decoration: line-through;
    }

    .opp-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 10px;
      flex-wrap: wrap;
    }

    .opp-author {
      color: #58a6ff;
      font-weight: 600;
      font-size: 0.85rem;
      text-decoration: none;
    }

    .opp-author:hover {
      text-decoration: underline;
    }

    .opp-time {
      color: #484f58;
      font-size: 0.78rem;
    }

    .opp-topic-badge {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 12px;
      font-size: 0.7rem;
      font-weight: 600;
      color: #fff;
    }

    .opp-posted-badge {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 12px;
      font-size: 0.7rem;
      font-weight: 600;
      background: #238636;
      color: #fff;
    }

    .opp-skipped-badge {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 12px;
      font-size: 0.7rem;
      font-weight: 600;
      background: #484f58;
      color: #c9d1d9;
    }

    .opp-relevance {
      margin-left: auto;
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 0.78rem;
      color: #8b949e;
    }

    .opp-text {
      color: #c9d1d9;
      font-size: 0.88rem;
      line-height: 1.55;
      margin-bottom: 14px;
      padding: 10px 14px;
      background: #0d1117;
      border-radius: 6px;
      border-left: 3px solid #30363d;
    }

    .opp-actions {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }

    .opp-actions form {
      display: inline;
    }

    .opp-reply-section {
      margin-top: 14px;
      padding: 14px;
      background: #1c2333;
      border: 1px solid #30363d;
      border-radius: 6px;
    }

    .opp-reply-label {
      color: #58a6ff;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 8px;
      padding-bottom: 6px;
      border-bottom: 1px solid #30363d;
    }

    .opp-reply-text {
      color: #e6edf3;
      font-size: 0.88rem;
      line-height: 1.55;
      white-space: pre-wrap;
      margin-bottom: 12px;
    }

    .opp-reply-actions {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }

    .opp-reply-actions form {
      display: inline;
    }

    .opp-edit-area {
      width: 100%;
      min-height: 100px;
      background: #0d1117;
      color: #e6edf3;
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 10px 12px;
      font-size: 0.85rem;
      font-family: inherit;
      line-height: 1.5;
      resize: vertical;
      margin-bottom: 10px;
    }

    .opp-edit-area:focus {
      border-color: #58a6ff;
      outline: none;
    }

    .opp-skip-reasons {
      display: inline-flex;
      gap: 4px;
      flex-wrap: wrap;
    }

    .opp-skip-btn {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 4px;
      font-size: 0.75rem;
      cursor: pointer;
      background: #21262d;
      color: #c9d1d9;
      border: 1px solid #30363d;
      transition: background 0.15s;
    }

    .opp-skip-btn:hover {
      background: #30363d;
    }

    .opp-spinner {
      display: inline-block;
      width: 14px;
      height: 14px;
      border: 2px solid #58a6ff;
      border-top-color: transparent;
      border-radius: 50%;
      animation: opp-spin 0.8s linear infinite;
      vertical-align: middle;
      margin-right: 6px;
    }

    @keyframes opp-spin { to { transform: rotate(360deg); } }

    .opp-pagination {
      display: flex;
      justify-content: center;
      gap: 8px;
      margin-top: 24px;
    }

    .opp-pagination a {
      padding: 6px 14px;
      border-radius: 6px;
      font-size: 0.82rem;
      background: #21262d;
      color: #c9d1d9;
      border: 1px solid #30363d;
      text-decoration: none;
    }

    .opp-pagination a:hover {
      background: #30363d;
    }

    .opp-pagination a.active-page {
      background: #1f6feb;
      color: #fff;
      border-color: #1f6feb;
    }

    .opp-view-link {
      display: inline-block;
      color: #8b949e;
      font-size: 0.78rem;
      text-decoration: none;
    }

    .opp-view-link:hover {
      color: #58a6ff;
      text-decoration: underline;
    }

    .opp-empty {
      text-align: center;
      padding: 60px 20px;
      color: #8b949e;
    }

    .opp-empty h3 {
      color: #e6edf3;
      font-size: 1.1rem;
      margin-bottom: 8px;
    }

    .opp-empty p {
      font-size: 0.9rem;
      margin-bottom: 16px;
    }

    /* ── Touch targets ── */

    .opp-actions .btn, .opp-reply-actions .btn, .opp-reply-actions a.btn {
      min-height: 36px;
      min-width: 36px;
    }

    /* ── Dropdown ── */

    .dropdown-menu {
      display: none;
      position: absolute;
      right: 0;
      top: 100%;
      background: #1c2128;
      border: 1px solid #30363d;
      border-radius: 6px;
      min-width: 160px;
      z-index: 50;
      box-shadow: 0 8px 24px rgba(0,0,0,0.4);
      padding: 4px 0;
      margin-top: 4px;
    }
    .dropdown-menu.show { display: block; }
    .dropdown-item {
      display: block;
      width: 100%;
      padding: 8px 14px;
      background: none;
      border: none;
      color: #c9d1d9;
      font-size: 0.82rem;
      text-align: left;
      cursor: pointer;
      text-decoration: none;
    }
    .dropdown-item:hover { background: #21262d; }

    /* ── Mobile ── */

    @media (max-width: 640px) {
      .opp-actions, .opp-reply-actions {
        flex-direction: column;
        gap: 8px;
      }
      .opp-actions .btn, .opp-reply-actions .btn, .opp-reply-actions a.btn {
        width: 100%;
        text-align: center;
        padding: 10px 16px;
        font-size: 0.88rem;
      }
      .settings-grid {
        grid-template-columns: 1fr !important;
      }
      .dropdown-menu {
        position: fixed;
        left: 16px;
        right: 16px;
        bottom: 16px;
        top: auto;
        border-radius: 12px;
      }
    }

    @media (max-width: 1024px) {
      .settings-grid {
        grid-template-columns: 1fr !important;
      }
    }
  `;
}

// ─── renderPage ─────────────────────────────────────────────────────────────

export async function renderPage(query?: URLSearchParams): Promise<string> {
  const filter = query?.get('filter') || 'all';
  const sort = query?.get('sort') || 'relevant';
  const pageNum = Math.max(1, parseInt(query?.get('page') || '1', 10));
  const editingId = query?.get('edit') ?? null;
  const showSkipId = query?.get('skip-reasons') ?? null;
  const PAGE_SIZE = 20;

  // Load feed
  const allOpportunities = getOpportunityFeed({
    status: filter === 'all' ? undefined : filter as 'new' | 'replied' | 'skipped' | 'engaging',
  });

  // Sort after fetching (getOpportunityFeed returns newest-first by default)
  if (sort === 'relevant') {
    allOpportunities.sort((a, b) => b.relevanceScore - a.relevanceScore);
  }
  // 'newest' is already the default sort from getOpportunityFeed
  // 'engagement' — sort by relevance as a proxy (no engagement count on Opportunity)

  // Compute stats
  const totalOpps = allOpportunities.length;
  const newCount = allOpportunities.filter(o => o.status === 'new').length;
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayIso = todayStart.toISOString();
  const repliedToday = getOpportunityFeed({ status: 'replied' }).filter(
    o => o.repliedAt && o.repliedAt >= todayIso,
  ).length;
  const skippedCount = allOpportunities.filter(o => o.status === 'skipped').length;

  // Paginate
  const totalPages = Math.max(1, Math.ceil(totalOpps / PAGE_SIZE));
  const safePage = Math.min(pageNum, totalPages);
  const startIdx = (safePage - 1) * PAGE_SIZE;
  const pageItems = allOpportunities.slice(startIdx, startIdx + PAGE_SIZE);

  // Run cleanup (synchronous)
  cleanupOpportunities();

  // ── Stats Bar ──
  const statsHtml = `
    <div class="opp-stats-bar">
      <div class="opp-stat-card">
        <h3>Opportunities</h3>
        <div class="stat-val">${totalOpps}</div>
        <div class="stat-sub">${newCount} new</div>
      </div>
      <div class="opp-stat-card">
        <h3>Replied Today</h3>
        <div class="stat-val">${repliedToday}</div>
        <div class="stat-sub">conversations joined</div>
      </div>
      <div class="opp-stat-card">
        <h3>Skipped</h3>
        <div class="stat-val">${skippedCount}</div>
        <div class="stat-sub">filtered out</div>
      </div>
      <div class="opp-stat-card has-btn">
        <div>
          <h3>Discover</h3>
          <div class="stat-sub">scan for new conversations</div>
        </div>
        <form method="POST" action="/queue" style="margin:0;">
          <input type="hidden" name="action" value="discover">
          <input type="hidden" name="tab" value="outreach">
          <button type="submit" class="btn btn-primary" style="padding:8px 18px;font-size:0.82rem;white-space:nowrap;"${discoverStatus === 'running' ? ' disabled' : ''}>
            ${discoverStatus === 'running' ? 'Scanning...' : 'Discover'}
          </button>
        </form>
      </div>
    </div>
  `;

  // ── Discover Status Banner ──
  let discoverBanner = '';
  const qsStatus = query?.get('status');
  if (discoverStatus === 'running' || qsStatus === 'discovering') {
    discoverBanner = `<div style="background:#1f6feb22;border:1px solid #1f6feb;border-radius:8px;padding:12px 16px;margin-bottom:16px;color:#58a6ff;font-size:14px;display:flex;align-items:center;gap:8px">
      <span class="opp-spinner"></span>
      Scanning for conversations... This takes 15-60 seconds.
    </div>
    <script>
    (function poll(attempt) {
      var delay = Math.min(2000 * Math.pow(1.5, attempt), 10000);
      if (attempt > 30) {
        var s = document.querySelector('.opp-spinner');
        if (s && s.parentElement) s.parentElement.insertAdjacentHTML('afterend',
          '<div style="color:#d29922;font-size:13px;margin-top:8px;">Taking longer than expected. <a href="'+window.location.pathname+'?tab=outreach">Refresh</a></div>');
        return;
      }
      setTimeout(function() {
        fetch(window.location.pathname, { method: 'POST', headers: {'Content-Type':'application/x-www-form-urlencoded'}, body: 'action=check-status&tab=outreach' })
          .then(function(r) { return r.json(); })
          .then(function(d) {
            if (d.status === 'done' || d.status === 'error') { window.location.href = window.location.pathname + '?tab=outreach'; }
            else { poll(attempt + 1); }
          })
          .catch(function() { poll(attempt + 1); });
      }, delay);
    })(0);
    </script>`;
  } else if (discoverStatus === 'done') {
    discoverBanner = `<div style="background:#23863622;border:1px solid #238636;border-radius:8px;padding:12px 16px;margin-bottom:16px;color:#3fb950;font-size:14px">
      ${esc(discoverMessage || 'Discovery scan complete.')}
    </div>`;
    discoverStatus = 'idle';
    discoverMessage = '';
  } else if (discoverStatus === 'error') {
    discoverBanner = `<div style="background:#da363322;border:1px solid #da3633;border-radius:8px;padding:12px 16px;margin-bottom:16px;color:#f85149;font-size:14px">
      Discovery failed: ${esc(discoverMessage || 'Unknown error.')}
    </div>`;
    discoverStatus = 'idle';
    discoverMessage = '';
  }

  // ── Status Banner (from query param redirects) ──
  let statusBanner = '';
  const msg = query?.get('msg');
  if (msg === 'reply_posted') {
    statusBanner = `<div style="background:#23863622;border:1px solid #238636;border-radius:8px;padding:12px 16px;margin-bottom:16px;color:#3fb950;font-size:14px">
      Reply posted successfully!
    </div>`;
  } else if (msg === 'reply_failed') {
    const errorDetail = decodeURIComponent(query?.get('error') || 'Unknown error');
    statusBanner = `<div style="background:#da363322;border:1px solid #da3633;border-radius:8px;padding:12px 16px;margin-bottom:16px;color:#f85149;font-size:14px">
      Reply failed: ${esc(errorDetail)}
    </div>`;
  } else if (msg === 'no_reply') {
    statusBanner = `<div style="background:#d2992222;border:1px solid #d29922;border-radius:8px;padding:12px 16px;margin-bottom:16px;color:#e3b341;font-size:14px">
      No reply text found. Generate a reply first.
    </div>`;
  } else if (msg === 'quote_tweeted') {
    statusBanner = `<div style="background:#23863622;border:1px solid #238636;border-radius:8px;padding:12px 16px;margin-bottom:16px;color:#3fb950;font-size:14px">
      Quote tweet posted (direct reply not available on the configured X API tier).
    </div>`;
  } else if (msg === 'engaging_started') {
    statusBanner = `<div style="background:#d2992222;border:1px solid #d29922;border-radius:8px;padding:12px 16px;margin-bottom:16px;color:#e3b341;font-size:14px">
      Engage-first started: liked + followed. Direct reply will be retried in 24h.
    </div>`;
  } else if (msg === 'discovered') {
    statusBanner = `<div style="background:#23863622;border:1px solid #238636;border-radius:8px;padding:12px 16px;margin-bottom:16px;color:#3fb950;font-size:14px">
      Found new conversations
    </div>`;
  }

  // ── Filter Bar ──
  const filterBar = `
    <div class="opp-filter-bar">
      <label>Status:</label>
      <select onchange="window.location.href='/queue?tab=outreach&sort=${esc(sort)}&filter='+this.value">
        <option value="all"${filter === 'all' ? ' selected' : ''}>All</option>
        <option value="new"${filter === 'new' ? ' selected' : ''}>New</option>
        <option value="engaging"${filter === 'engaging' ? ' selected' : ''}>Engaging</option>
        <option value="replied"${filter === 'replied' ? ' selected' : ''}>Replied</option>
        <option value="skipped"${filter === 'skipped' ? ' selected' : ''}>Skipped</option>
      </select>

      <label style="margin-left:12px;">Sort:</label>
      <select onchange="window.location.href='/queue?tab=outreach&filter=${esc(filter)}&sort='+this.value">
        <option value="relevant"${sort === 'relevant' ? ' selected' : ''}>Most Relevant</option>
        <option value="newest"${sort === 'newest' ? ' selected' : ''}>Newest</option>
        <option value="engagement"${sort === 'engagement' ? ' selected' : ''}>Most Engagement</option>
      </select>
    </div>
  `;

  // ── Opportunity Cards ──
  let cardsHtml = '';
  if (pageItems.length === 0) {
    cardsHtml = `
      <div class="opp-empty">
        <h3>No Opportunities Yet</h3>
        <p>Click "Discover" above to scan for relevant conversations.</p>
        <p style="color:#8b949e;font-size:0.82rem;margin-top:8px;">
          Pulse will search X for conversations matching your topics.<br>
          You'll review and approve replies before posting.
        </p>
      </div>
    `;
  } else {
    for (const opp of pageItems) {
      cardsHtml += renderCard(opp, editingId, showSkipId, filter, sort);
    }
  }

  // ── Pagination ──
  let paginationHtml = '';
  if (totalPages > 1) {
    const baseUrl = `/queue?tab=outreach&filter=${esc(filter)}&sort=${esc(sort)}`;
    const links: string[] = [];
    if (safePage > 1) {
      links.push(`<a href="${baseUrl}&page=${safePage - 1}">Prev</a>`);
    }
    const start = Math.max(1, safePage - 3);
    const end = Math.min(totalPages, safePage + 3);
    for (let p = start; p <= end; p++) {
      const cls = p === safePage ? ' class="active-page"' : '';
      links.push(`<a href="${baseUrl}&page=${p}"${cls}>${p}</a>`);
    }
    if (safePage < totalPages) {
      links.push(`<a href="${baseUrl}&page=${safePage + 1}">Next</a>`);
    }
    paginationHtml = `<div class="opp-pagination">${links.join('')}</div>`;
  }

  return `
    <style>${pageCss()}</style>
    ${statsHtml}
    ${statusBanner}
    ${discoverBanner}
    ${filterBar}
    ${cardsHtml}
    ${paginationHtml}
    <script>
    document.addEventListener('click', function(e) {
      if (!e.target.closest('.dropdown')) {
        document.querySelectorAll('.dropdown-menu.show').forEach(function(m) { m.classList.remove('show'); });
      }
    });
    </script>
  `;
}

// ─── Card Renderer ──────────────────────────────────────────────────────────

function renderCard(
  opp: Opportunity,
  editingId: string | null,
  showSkipId: string | null,
  filter: string,
  sort: string,
): string {
  const statusClass = `status-${opp.status}`;
  const bgColor = topicColor(opp.topicId);
  const authorProfileUrl = `https://x.com/${opp.author.replace(/^@/, '')}`;
  const isGenerating = generatingReplies.get(opp.id) === 'running';
  const genError = generatingErrors.get(opp.id);
  const isEditing = editingId === opp.id;
  const showingSkipReasons = showSkipId === opp.id;
  const baseUrl = `/queue?tab=outreach&filter=${esc(filter)}&sort=${esc(sort)}`;

  // Header: author, time, topic, status badges
  let statusBadge = '';
  if (opp.status === 'replied' && opp.repliedAt) {
    statusBadge = `<a href="${esc(opp.url)}" target="_blank" rel="noopener" class="opp-posted-badge" style="text-decoration:none;">Posted</a>`;
  } else if (opp.status === 'replied') {
    statusBadge = `<span class="opp-posted-badge">Posted</span>`;
  } else if (opp.status === 'engaging') {
    const engageAge = opp.engageStartedAt
      ? Math.round((Date.now() - new Date(opp.engageStartedAt).getTime()) / 3600_000)
      : 0;
    const retryIn = Math.max(0, 24 - engageAge);
    statusBadge = `<span style="background:#d29922;color:#000;padding:2px 8px;border-radius:4px;font-size:0.75rem;font-weight:600;">Engaging (${retryIn > 0 ? retryIn + 'h until retry' : 'ready to retry'})</span>`;
  } else if (opp.status === 'skipped') {
    statusBadge = `<span class="opp-skipped-badge">Skipped${opp.skipReason ? ': ' + esc(opp.skipReason) : ''}</span>`;
  }

  const headerHtml = `
    <div class="opp-header">
      <a href="${esc(authorProfileUrl)}" target="_blank" rel="noopener" class="opp-author">@${esc(opp.author)}</a>
      <span class="opp-time">${esc(relativeTime(opp.discoveredAt))}</span>
      <span class="opp-topic-badge" style="background:${bgColor};">${esc(opp.topicId)}</span>
      ${statusBadge}
      <div class="opp-relevance">
        Relevance: ${relevanceBadge(opp.relevanceScore)}
      </div>
    </div>
  `;

  // Conversation text (Serper snippets are ~160 chars — show note if truncated)
  const isTruncated = opp.text.endsWith('...') || opp.text.endsWith('…');
  const textHtml = `<div class="opp-text">${esc(opp.text)}${isTruncated ? ` <a href="${esc(opp.url)}" target="_blank" rel="noopener" style="color:#58a6ff;font-size:0.78rem;white-space:nowrap;">read full post →</a>` : ''}</div>`;

  // Generate error banner (if any)
  let errorBanner = '';
  if (genError) {
    errorBanner = `<div style="background:#da363322;border:1px solid #da3633;border-radius:6px;padding:8px 12px;margin-bottom:10px;color:#f85149;font-size:13px">
      Reply generation failed: ${esc(genError)}
    </div>`;
    generatingErrors.delete(opp.id);
  }

  // Actions or reply section
  let actionsHtml = '';

  if ((opp.status === 'new' || opp.status === 'selected') && !opp.suggestedReply && !isGenerating) {
    // No reply yet — show Reply / Skip / View on X
    actionsHtml = `
      ${errorBanner}
      <div class="opp-actions">
        <form method="POST" action="/queue">
          <input type="hidden" name="action" value="generate-reply">
          <input type="hidden" name="tab" value="outreach">
          <input type="hidden" name="id" value="${esc(opp.id)}">
          <button type="submit" class="btn btn-primary">Reply to this</button>
        </form>
        ${renderSkipButton(opp.id, showingSkipReasons, baseUrl)}
        <a href="${esc(opp.url)}" target="_blank" rel="noopener" class="opp-view-link">View on X</a>
      </div>
    `;
  } else if (isGenerating) {
    // Generating reply spinner
    actionsHtml = `
      <div class="opp-actions">
        <span style="color:#58a6ff;font-size:0.85rem;"><span class="opp-spinner"></span> Generating reply...</span>
        <a href="${esc(opp.url)}" target="_blank" rel="noopener" class="opp-view-link">View on X</a>
      </div>
      <script>
      (function pollReply(attempt) {
        var delay = Math.min(2000 * Math.pow(1.5, attempt), 10000);
        if (attempt > 15) {
          var s = document.querySelector('.opp-spinner');
          if (s && s.parentElement) s.parentElement.insertAdjacentHTML('afterend',
            '<div style="color:#d29922;font-size:13px;margin-top:8px;">Taking longer than expected. <a href="'+window.location.pathname+'?tab=outreach&filter=${esc(filter)}&sort=${esc(sort)}">Refresh</a></div>');
          return;
        }
        setTimeout(function() {
          fetch(window.location.pathname, { method: 'POST', headers: {'Content-Type':'application/x-www-form-urlencoded'}, body: 'action=check-status&tab=outreach&id=${esc(opp.id)}' })
            .then(function(r) { return r.json(); })
            .then(function(d) {
              if (d.replyStatus === 'done' || d.replyStatus === 'error') { window.location.href = window.location.pathname + '?tab=outreach&filter=${esc(filter)}&sort=${esc(sort)}'; }
              else { pollReply(attempt + 1); }
            })
            .catch(function() { pollReply(attempt + 1); });
        }, delay);
      })(0);
      </script>
    `;
  } else if (opp.suggestedReply && (opp.status === 'new' || opp.status === 'selected')) {
    // Reply generated — show it with Post / Edit / Regenerate / Cancel
    if (isEditing) {
      actionsHtml = `
        ${errorBanner}
        <div class="opp-reply-section">
          <div class="opp-reply-label">Your Reply</div>
          <form method="POST" action="/queue">
            <input type="hidden" name="action" value="edit-reply">
            <input type="hidden" name="tab" value="outreach">
            <input type="hidden" name="id" value="${esc(opp.id)}">
            <textarea name="replyText" class="opp-edit-area">${esc(opp.suggestedReply)}</textarea>
            <div style="display:flex;gap:8px;">
              <button type="submit" class="btn btn-primary">Save Edit</button>
              <a href="${baseUrl}" class="btn btn-secondary" style="text-decoration:none;">Cancel</a>
            </div>
          </form>
        </div>
      `;
    } else {
      const tweetIdMatch = opp.url.match(/\/status\/(\d+)/);
      const tweetId = tweetIdMatch ? tweetIdMatch[1] : '';
      const postOnSiteUrl = tweetId
        ? `https://x.com/intent/tweet?in_reply_to=${tweetId}&text=${encodeURIComponent(opp.suggestedReply!)}`
        : '';
      actionsHtml = `
        ${errorBanner}
        <div class="opp-reply-section">
          <div class="opp-reply-label">Your Reply</div>
          <div class="opp-reply-text">${esc(opp.suggestedReply)}</div>
          <div class="opp-reply-actions">
            ${postOnSiteUrl ? `<a href="${esc(postOnSiteUrl)}" target="_blank" rel="noopener" class="btn btn-primary" style="text-decoration:none;">Post on Site</a>` : ''}
            <button type="button" class="btn btn-secondary"
              onclick="navigator.clipboard.writeText(this.dataset.text).then(()=>{this.textContent='Copied!';setTimeout(()=>this.textContent='Copy',2000);})"
              data-text="${esc(opp.suggestedReply)}">Copy</button>
            <div class="dropdown" style="position:relative;display:inline-block;">
              <button type="button" class="btn btn-secondary" onclick="this.nextElementSibling.classList.toggle('show')">More &#9662;</button>
              <div class="dropdown-menu">
                <form method="POST" action="/queue">
                  <input type="hidden" name="action" value="post-reply">
                  <input type="hidden" name="tab" value="outreach">
                  <input type="hidden" name="id" value="${esc(opp.id)}">
                  <button type="submit" class="dropdown-item">Post via API</button>
                </form>
                <form method="POST" action="/queue">
                  <input type="hidden" name="action" value="quote-tweet">
                  <input type="hidden" name="tab" value="outreach">
                  <input type="hidden" name="id" value="${esc(opp.id)}">
                  <button type="submit" class="dropdown-item">Quote Tweet</button>
                </form>
                <form method="POST" action="/queue">
                  <input type="hidden" name="action" value="engage-first">
                  <input type="hidden" name="tab" value="outreach">
                  <input type="hidden" name="id" value="${esc(opp.id)}">
                  <button type="submit" class="dropdown-item" style="color:#d29922;">Engage First</button>
                </form>
                <a href="${baseUrl}&edit=${esc(opp.id)}" class="dropdown-item">Edit Reply</a>
                <form method="POST" action="/queue">
                  <input type="hidden" name="action" value="skip">
                  <input type="hidden" name="tab" value="outreach">
                  <input type="hidden" name="id" value="${esc(opp.id)}">
                  <button type="submit" class="dropdown-item" style="color:#f85149;">Skip</button>
                </form>
              </div>
            </div>
          </div>
          <div style="display:flex;gap:6px;margin-top:8px;">
            <form method="POST" action="/queue" style="display:flex;gap:6px;flex:1;">
              <input type="hidden" name="action" value="regenerate">
              <input type="hidden" name="tab" value="outreach">
              <input type="hidden" name="id" value="${esc(opp.id)}">
              <input type="text" name="feedback" placeholder="Feedback: make it shorter, more casual..."
                style="flex:1;padding:5px 8px;background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:4px;font-size:0.78rem;">
              <button type="submit" class="btn btn-secondary" style="white-space:nowrap;">Regenerate</button>
            </form>
          </div>
        </div>
      `;
    }
  } else if (opp.status === 'replied') {
    // Already posted
    actionsHtml = `
      <div class="opp-actions">
        ${opp.repliedAt ? `<a href="${esc(opp.url)}" target="_blank" rel="noopener" class="opp-view-link">View reply on X</a>` : ''}
        <a href="${esc(opp.url)}" target="_blank" rel="noopener" class="opp-view-link">View original</a>
      </div>
    `;
  } else if (opp.status === 'skipped') {
    // Skipped — show minimal actions
    actionsHtml = `
      <div class="opp-actions">
        <a href="${esc(opp.url)}" target="_blank" rel="noopener" class="opp-view-link">View on X</a>
      </div>
    `;
  } else if (opp.status === 'engaging') {
    // Engaging — liked + followed, waiting for follow-back
    const engageAge = opp.engageStartedAt
      ? Math.round((Date.now() - new Date(opp.engageStartedAt).getTime()) / 3600_000)
      : 0;
    const canRetry = engageAge >= 24;
    actionsHtml = `
      <div class="opp-reply-section" style="border-color:#d29922;">
        <div class="opp-reply-label" style="color:#d29922;">Engage-First Active</div>
        <p style="margin:4px 0 8px;color:#8b949e;font-size:0.82rem;">
          Liked + followed ${engageAge}h ago. ${canRetry ? 'Follow-back window reached — try replying now.' : `Will retry reply in ~${24 - engageAge}h when they may follow back.`}
        </p>
        ${opp.suggestedReply ? `<div class="opp-reply-text" style="margin-bottom:8px;">${esc(opp.suggestedReply)}</div>` : ''}
        <div class="opp-reply-actions">
          ${opp.suggestedReply ? (() => {
            const engTweetIdMatch = opp.url.match(/\/status\/(\d+)/);
            const engTweetId = engTweetIdMatch ? engTweetIdMatch[1] : '';
            const engPostUrl = engTweetId
              ? `https://x.com/intent/tweet?in_reply_to=${engTweetId}&text=${encodeURIComponent(opp.suggestedReply!)}`
              : '';
            return (engPostUrl ? `<a href="${esc(engPostUrl)}" target="_blank" rel="noopener" class="btn btn-primary" style="text-decoration:none;" title="Opens X with reply pre-filled — just click Reply">Post on Site</a>` : '')
              + `<button type="button" class="btn btn-secondary"
                  onclick="navigator.clipboard.writeText(this.dataset.text).then(()=>{this.textContent='Copied!';setTimeout(()=>this.textContent='Copy',2000);})"
                  data-text="${esc(opp.suggestedReply)}">Copy</button>`;
          })() : ''}
          ${canRetry ? `
            <form method="POST" action="/queue">
              <input type="hidden" name="action" value="post-reply">
              <input type="hidden" name="tab" value="outreach">
              <input type="hidden" name="id" value="${esc(opp.id)}">
              <button type="submit" class="btn btn-secondary" title="Post via X API">Retry via API</button>
            </form>
          ` : ''}
          <form method="POST" action="/queue">
            <input type="hidden" name="action" value="quote-tweet">
            <input type="hidden" name="tab" value="outreach">
            <input type="hidden" name="id" value="${esc(opp.id)}">
            <button type="submit" class="btn btn-secondary">Quote Tweet Instead</button>
          </form>
          <a href="${esc(opp.url)}" target="_blank" rel="noopener" class="opp-view-link">View on X</a>
        </div>
      </div>
    `;
  } else {
    // Fallback for any other status — always show action buttons
    actionsHtml = `
      <div class="opp-actions">
        <form method="POST" action="/queue">
          <input type="hidden" name="action" value="generate-reply">
          <input type="hidden" name="tab" value="outreach">
          <input type="hidden" name="id" value="${esc(opp.id)}">
          <button type="submit" class="btn btn-primary">Reply to this</button>
        </form>
        <a href="${esc(opp.url)}" target="_blank" rel="noopener" class="opp-view-link">View on X</a>
      </div>
    `;
  }

  return `
    <div class="opp-card ${statusClass}">
      ${headerHtml}
      ${textHtml}
      ${actionsHtml}
    </div>
  `;
}

// ─── Skip Button with Reason Dropdown ───────────────────────────────────────

function renderSkipButton(
  oppId: string,
  showReasons: boolean,
  baseUrl: string,
): string {
  if (showReasons) {
    const reasons = ['Irrelevant', 'Wrong tone', 'Spam', 'Not interested'];
    return `
      <span class="opp-skip-reasons">
        ${reasons.map(reason => `
          <form method="POST" action="/queue" style="display:inline;">
            <input type="hidden" name="action" value="skip">
            <input type="hidden" name="tab" value="outreach">
            <input type="hidden" name="id" value="${esc(oppId)}">
            <input type="hidden" name="reason" value="${esc(reason.toLowerCase())}">
            <button type="submit" class="opp-skip-btn">${esc(reason)}</button>
          </form>
        `).join('')}
        <a href="${baseUrl}" class="opp-skip-btn" style="text-decoration:none;">Cancel</a>
      </span>
    `;
  }

  return `<a href="${baseUrl}&skip-reasons=${esc(oppId)}" class="btn btn-secondary" style="text-decoration:none;">Skip</a>`;
}

// ─── handlePost ─────────────────────────────────────────────────────────────

export async function handlePost(
  action: string,
  body: Record<string, string>,
): Promise<{ redirect?: string; json?: unknown }> {
  // ── Check Status (for auto-poll) ──
  if (action === 'check-status') {
    const oppId = body.id;
    if (oppId) {
      // Per-opportunity reply generation status
      const replyStatus = generatingReplies.get(oppId) || 'idle';
      return { json: { status: discoverStatus, replyStatus } };
    }
    return { json: { status: discoverStatus, message: discoverMessage } };
  }

  // ── Discover Opportunities (fire-and-forget) ──
  if (action === 'discover') {
    if (discoverStatus === 'running') {
      return { redirect: '/queue?tab=outreach&status=discovering' };
    }
    discoverStatus = 'running';
    discoverMessage = '';
    discoverOpportunities()
      .then((result) => {
        discoverStatus = 'done';
        discoverMessage = `Found ${result.length} new opportunities.`;
      })
      .catch((err) => {
        discoverStatus = 'error';
        discoverMessage = err instanceof Error ? err.message : String(err);
        console.error('[Outreach Panel] Discover failed:', discoverMessage);
      });
    return { redirect: '/queue?tab=outreach&status=discovering' };
  }

  // ── Generate Reply ──
  if (action === 'generate-reply') {
    const oppId = body.id;
    if (!oppId) return { redirect: '/queue?tab=outreach' };

    generatingReplies.set(oppId, 'running');
    generateReplyForOpportunity(oppId)
      .then(() => {
        generatingReplies.set(oppId, 'done');
        // Clean up after a short delay so the poll can catch it
        setTimeout(() => generatingReplies.delete(oppId), 10_000);
      })
      .catch((err) => {
        generatingReplies.set(oppId, 'error');
        generatingErrors.set(oppId, err instanceof Error ? err.message : String(err));
        console.error('[Outreach Panel] Generate reply failed:', err);
        setTimeout(() => generatingReplies.delete(oppId), 10_000);
      });
    return { redirect: '/queue?tab=outreach' };
  }

  // ── Post Reply ──
  if (action === 'post-reply') {
    const oppId = body.id;
    if (!oppId) return { redirect: '/queue?tab=outreach&msg=no_reply' };

    const allOpps = getOpportunityFeed({});
    const opp = allOpps.find(o => o.id === oppId);
    if (!opp || !opp.suggestedReply) return { redirect: '/queue?tab=outreach&msg=no_reply' };

    // Extract tweet ID from URL
    const tweetIdMatch = opp.url.match(/\/status\/(\d+)/);
    const tweetId = tweetIdMatch ? tweetIdMatch[1] : opp.id;

    const conversation: Conversation = {
      id: tweetId,
      platform: 'x',
      url: opp.url,
      text: opp.text,
      author: opp.author,
      topicId: opp.topicId,
      createdAt: opp.discoveredAt,
      engagement: { likes: 0, replies: 0, reposts: 0 },
    };

    try {
      const result = await getXWriteClient().reply(conversation, opp.suggestedReply) as any;
      if (!result.ok) {
        // Check if this is an X API tier reply restriction — try engage-first flow
        const errMsg = result.error ?? 'unknown error';
        const isReplyBlocked = /not (allowed|permitted)/i.test(errMsg)
          || /reply.*restricted/i.test(errMsg)
          || /403/i.test(errMsg);

        if (isReplyBlocked) {
          // Start engage-first flow: like + follow, retry later
          console.log('[Outreach Panel] Reply blocked — starting engage-first flow');
          await startEngagement(oppId);
          return { redirect: '/queue?tab=outreach&msg=engaging_started' };
        }

        const reason = encodeURIComponent(errMsg);
        console.error('[Outreach Panel] Post reply failed:', errMsg);
        return { redirect: `/queue?tab=outreach&msg=reply_failed&error=${reason}` };
      }

      // Check if the reply method used a quote tweet fallback
      if (result.fallback === 'quote_tweet') {
        markOpportunityQuoteTweeted(oppId, opp.suggestedReply!, result.url ?? '');
        return { redirect: '/queue?tab=outreach&msg=quote_tweeted' };
      }

      markOpportunityReplied(oppId, opp.suggestedReply!);
    } catch (err) {
      const reason = encodeURIComponent(err instanceof Error ? err.message : String(err));
      console.error('[Outreach Panel] Post reply failed:', err instanceof Error ? err.message : String(err));
      return { redirect: `/queue?tab=outreach&msg=reply_failed&error=${reason}` };
    }

    return { redirect: '/queue?tab=outreach&msg=reply_posted' };
  }

  // ── Quote Tweet (manual fallback button) ──
  if (action === 'quote-tweet') {
    const oppId = body.id;
    if (!oppId) return { redirect: '/queue?tab=outreach&msg=no_reply' };

    const allOpps2 = getOpportunityFeed({});
    const opp2 = allOpps2.find(o => o.id === oppId);
    if (!opp2 || !opp2.suggestedReply) return { redirect: '/queue?tab=outreach&msg=no_reply' };

    const tweetIdMatch2 = opp2.url.match(/\/status\/(\d+)/);
    const tweetId2 = tweetIdMatch2 ? tweetIdMatch2[1] : opp2.id;

    try {
      const qtResult = await getXWriteClient().post({
        text: opp2.suggestedReply,
        type: 'post',
        metadata: { quoteTweetId: tweetId2 },
      });
      if (!qtResult.ok) {
        const reason = encodeURIComponent(qtResult.error ?? 'unknown error');
        return { redirect: `/queue?tab=outreach&msg=reply_failed&error=${reason}` };
      }
      markOpportunityQuoteTweeted(oppId, opp2.suggestedReply!, qtResult.url ?? '');
    } catch (err) {
      const reason = encodeURIComponent(err instanceof Error ? err.message : String(err));
      return { redirect: `/queue?tab=outreach&msg=reply_failed&error=${reason}` };
    }

    return { redirect: '/queue?tab=outreach&msg=quote_tweeted' };
  }

  // ── Engage First (manual trigger) ──
  if (action === 'engage-first') {
    const oppId = body.id;
    if (!oppId) return { redirect: '/queue?tab=outreach' };

    await startEngagement(oppId);
    return { redirect: '/queue?tab=outreach&msg=engaging_started' };
  }

  // ── Skip ──
  if (action === 'skip') {
    const oppId = body.id;
    const reason = body.reason || 'not interested';
    if (!oppId) return { redirect: '/queue?tab=outreach' };

    skipOpportunity(oppId, reason);
    return { redirect: '/queue?tab=outreach' };
  }

  // ── Edit Reply ──
  if (action === 'edit-reply') {
    const oppId = body.id;
    const newText = body.replyText;
    if (!oppId || newText === undefined) return { redirect: '/queue?tab=outreach' };

    // Update the suggested reply in the opportunity
    const allOpps = getOpportunityFeed({});
    const opp = allOpps.find(o => o.id === oppId);
    if (opp) {
      // Persist via the engine (it manages its own state)
      updateOpportunitySuggestedReply(oppId, newText.trim());
    }
    return { redirect: '/queue?tab=outreach' };
  }

  // ── Regenerate ──
  if (action === 'regenerate') {
    const oppId = body.id;
    const feedback = body.feedback?.trim() || '';
    if (!oppId) return { redirect: '/queue?tab=outreach' };

    generatingReplies.set(oppId, 'running');
    generateReplyForOpportunity(oppId, feedback || undefined)
      .then(() => {
        generatingReplies.set(oppId, 'done');
        setTimeout(() => generatingReplies.delete(oppId), 10_000);
      })
      .catch((err) => {
        generatingReplies.set(oppId, 'error');
        generatingErrors.set(oppId, err instanceof Error ? err.message : String(err));
        console.error('[Outreach Panel] Regenerate reply failed:', err);
        setTimeout(() => generatingReplies.delete(oppId), 10_000);
      });
    return { redirect: '/queue?tab=outreach' };
  }

  return { redirect: '/queue?tab=outreach' };
}
