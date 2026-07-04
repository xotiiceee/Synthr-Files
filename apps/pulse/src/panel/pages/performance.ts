/**
 * Performance Page — stats, trends, and autopilot insights.
 *
 * Single page showing:
 *   1. Summary cards (posts/replies this week, total actions, autopilot accuracy)
 *   2. Daily activity table (last 7 days)
 *   3. Top categories (CSS bar chart)
 *   4. Autopilot insights (if enabled)
 */

import { loadState, getActions } from '../../core/state.js';
import { getAutopilotState, getAutopilotSummary } from '../../core/autopilot.js';

// ─── Types ──────────────────────────────────────────────────────────────────

interface AutopostEntry {
  id: string;
  category: string;
  format: string;
  content: string;
  platform: string;
  status: 'pending' | 'approved' | 'rejected' | 'posted' | 'expired';
  createdAt: string;
  postedAt?: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  news_commentary:   '#8b5cf6',
  product_tips:      '#06b6d4',
  industry_insights: '#f59e0b',
  engagement:        '#ec4899',
  curated_reshares:  '#10b981',
  milestones:        '#f97316',
};

const CATEGORY_LABELS: Record<string, string> = {
  news_commentary:   'News Commentary',
  product_tips:      'Product Tips',
  industry_insights: 'Industry Insights',
  engagement:        'Engagement',
  curated_reshares:  'Curated Reshares',
  milestones:        'Milestones',
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function dateKey(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

function friendlyDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `${days[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()}`;
}

// ─── Data Loaders ───────────────────────────────────────────────────────────

function getWeekActions(): { posts: number; replies: number } {
  const weekAgo = dateKey(6);
  const actions = getActions(weekAgo).filter(a => a.platform !== 'system');
  let posts = 0;
  let replies = 0;
  for (const a of actions) {
    if (a.type === 'post') posts++;
    if (a.type === 'reply') replies++;
  }
  return { posts, replies };
}

function getDailyBreakdown(): Array<{
  date: string;
  posts: number;
  replies: number;
  likes: number;
  reposts: number;
  total: number;
}> {
  const rows: Array<{
    date: string;
    posts: number;
    replies: number;
    likes: number;
    reposts: number;
    total: number;
  }> = [];

  for (let i = 6; i >= 0; i--) {
    const key = dateKey(i);
    const dayActions = getActions(key).filter(
      a => a.platform !== 'system' && a.timestamp.startsWith(key),
    );
    let posts = 0, replies = 0, likes = 0, reposts = 0;
    for (const a of dayActions) {
      if (a.type === 'post') posts++;
      else if (a.type === 'reply') replies++;
      else if (a.type === 'like') likes++;
      else if (a.type === 'repost') reposts++;
    }
    rows.push({ date: key, posts, replies, likes, reposts, total: posts + replies + likes + reposts });
  }
  return rows;
}

function getCategoryCounts(): Array<{ category: string; count: number; color: string }> {
  const state = loadState<{ postHistory: AutopostEntry[] }>('autopost', { postHistory: [] });
  const queue = loadState<AutopostEntry[]>('autopost-queue', []);

  const counts: Record<string, number> = {};
  const seen = new Set<string>();

  for (const entry of [...state.postHistory, ...queue]) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    counts[entry.category] = (counts[entry.category] ?? 0) + 1;
  }

  const categories = Object.keys(CATEGORY_COLORS);
  const result: Array<{ category: string; count: number; color: string }> = [];
  for (const cat of categories) {
    result.push({
      category: cat,
      count: counts[cat] ?? 0,
      color: CATEGORY_COLORS[cat] ?? '#8b949e',
    });
  }
  result.sort((a, b) => b.count - a.count);
  return result;
}

// ─── CSS ────────────────────────────────────────────────────────────────────

function pageCss(): string {
  return `
    /* ── Summary Cards ── */

    .perf-summary-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin-bottom: 28px;
    }

    .perf-stat {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 16px;
    }

    .perf-stat .label {
      color: #8b949e;
      font-size: 0.72rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 6px;
    }

    .perf-stat .value {
      font-size: 1.8rem;
      font-weight: 700;
      color: #f0f6fc;
    }

    .perf-stat .sub {
      color: #8b949e;
      font-size: 0.72rem;
      margin-top: 4px;
    }

    /* ── Section Label ── */

    .perf-section-label {
      color: #8b949e;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-weight: 600;
      margin-bottom: 10px;
    }

    /* ── Daily Activity Table ── */

    .daily-table-wrap {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 10px;
      overflow: hidden;
      margin-bottom: 28px;
    }

    .daily-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.85rem;
    }

    .daily-table th {
      background: #21262d;
      color: #8b949e;
      font-size: 0.72rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-weight: 600;
      padding: 10px 14px;
      text-align: left;
      border-bottom: 1px solid #30363d;
    }

    .daily-table th:not(:first-child) {
      text-align: center;
    }

    .daily-table td {
      padding: 10px 14px;
      color: #c9d1d9;
      border-bottom: 1px solid #21262d;
    }

    .daily-table td:not(:first-child) {
      text-align: center;
      font-variant-numeric: tabular-nums;
    }

    .daily-table tr:last-child td {
      border-bottom: none;
    }

    .daily-table tr.today-row {
      background: #1c2129;
    }

    .daily-table tr.today-row td:first-child {
      color: #58a6ff;
      font-weight: 600;
    }

    .daily-table .total-col {
      color: #f0f6fc;
      font-weight: 600;
    }

    .daily-table .zero {
      color: #484f58;
    }

    /* ── Category Bars ── */

    .category-chart {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 10px;
      padding: 18px;
      margin-bottom: 28px;
    }

    .cat-row {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 10px;
    }

    .cat-row:last-child {
      margin-bottom: 0;
    }

    .cat-label {
      width: 140px;
      flex-shrink: 0;
      color: #c9d1d9;
      font-size: 0.82rem;
      text-align: right;
    }

    .cat-bar-track {
      flex: 1;
      height: 22px;
      background: #21262d;
      border-radius: 4px;
      overflow: hidden;
      position: relative;
    }

    .cat-bar-fill {
      height: 100%;
      border-radius: 4px;
      transition: width 0.3s ease;
      min-width: 2px;
    }

    .cat-count {
      width: 36px;
      flex-shrink: 0;
      color: #8b949e;
      font-size: 0.82rem;
      font-variant-numeric: tabular-nums;
    }

    /* ── Autopilot Insights ── */

    .autopilot-section {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 10px;
      padding: 20px;
      margin-bottom: 28px;
    }

    .autopilot-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }

    .autopilot-item {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .autopilot-item .ap-label {
      color: #8b949e;
      font-size: 0.72rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      font-weight: 600;
    }

    .autopilot-item .ap-value {
      color: #e6edf3;
      font-size: 0.95rem;
      font-weight: 500;
    }

    .ap-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 600;
    }

    .ap-badge.complete { background: #23863633; color: #3fb950; }
    .ap-badge.in-progress { background: #d2992233; color: #d29922; }
    .ap-badge.disabled { background: #30363d; color: #8b949e; }

    .ap-pref-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 4px;
    }

    .ap-pref-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .ap-pref-label {
      color: #c9d1d9;
      font-size: 0.85rem;
    }

    /* ── Responsive ── */

    @media (max-width: 768px) {
      .perf-summary-grid { grid-template-columns: 1fr 1fr; }
      .cat-label { width: 100px; font-size: 0.75rem; }
      .autopilot-grid { grid-template-columns: 1fr; }
    }
  `;
}

// ─── Render ─────────────────────────────────────────────────────────────────

export async function renderPage(query?: URLSearchParams): Promise<string> {
  // ── Gather data ──
  const weekActions = getWeekActions();
  const allActions = getActions();
  const totalActions = allActions.filter(a => a.platform !== 'system').length;
  const autopilotState = getAutopilotState();
  const autopilotSummary = getAutopilotSummary();
  const dailyRows = getDailyBreakdown();
  const categoryCounts = getCategoryCounts();
  const todayKey = new Date().toISOString().slice(0, 10);

  // Autopilot accuracy
  const approvalRate = autopilotSummary.stats.totalDecisions > 0
    ? autopilotSummary.stats.approvalRate
    : 0;
  const approvalDisplay = autopilotSummary.stats.totalDecisions > 0
    ? `${approvalRate}%`
    : '--';

  // ── Section 1: Summary Cards ──
  const summaryHtml = `
    <div class="perf-summary-grid">
      <div class="perf-stat">
        <div class="label">Posts This Week</div>
        <div class="value">${weekActions.posts}</div>
        <div class="sub">Last 7 days</div>
      </div>
      <div class="perf-stat">
        <div class="label">Replies This Week</div>
        <div class="value">${weekActions.replies}</div>
        <div class="sub">Last 7 days</div>
      </div>
      <div class="perf-stat">
        <div class="label">Total Actions</div>
        <div class="value">${totalActions}</div>
        <div class="sub">All time</div>
      </div>
      <div class="perf-stat">
        <div class="label">Autopilot Accuracy</div>
        <div class="value">${approvalDisplay}</div>
        <div class="sub">${autopilotSummary.stats.totalDecisions > 0 ? `${autopilotSummary.stats.totalDecisions} decisions` : 'No decisions yet'}</div>
      </div>
    </div>`;

  // ── Section 2: Daily Activity Table ──
  const tableRows = dailyRows.map(row => {
    const isToday = row.date === todayKey;
    const cls = isToday ? ' class="today-row"' : '';
    const label = isToday ? `${friendlyDate(row.date)} (today)` : friendlyDate(row.date);
    const cell = (n: number) => n === 0 ? '<span class="zero">0</span>' : `${n}`;
    return `<tr${cls}>
      <td>${esc(label)}</td>
      <td>${cell(row.posts)}</td>
      <td>${cell(row.replies)}</td>
      <td>${cell(row.likes)}</td>
      <td>${cell(row.reposts)}</td>
      <td class="total-col">${cell(row.total)}</td>
    </tr>`;
  }).join('\n');

  const dailyHtml = `
    <div class="perf-section-label">Daily Activity (Last 7 Days)</div>
    <div class="daily-table-wrap">
      <table class="daily-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Posts</th>
            <th>Replies</th>
            <th>Likes</th>
            <th>Reposts</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
    </div>`;

  // ── Section 3: Top Categories ──
  const maxCount = Math.max(1, ...categoryCounts.map(c => c.count));
  const catBars = categoryCounts.map(c => {
    const pct = Math.round((c.count / maxCount) * 100);
    const label = CATEGORY_LABELS[c.category] ?? c.category.replace(/_/g, ' ');
    return `<div class="cat-row">
      <div class="cat-label">${esc(label)}</div>
      <div class="cat-bar-track">
        <div class="cat-bar-fill" style="width:${pct}%;background:${c.color}"></div>
      </div>
      <div class="cat-count">${c.count}</div>
    </div>`;
  }).join('\n');

  const categoryHtml = `
    <div class="perf-section-label">Top Categories</div>
    <div class="category-chart">
      ${categoryCounts.every(c => c.count === 0)
        ? '<div style="text-align:center;color:#484f58;padding:20px 0;font-size:0.9rem;">No posts yet. Categories will appear here as you create content.</div>'
        : catBars}
    </div>`;

  // ── Section 4: Autopilot Insights ──
  let autopilotHtml = '';
  if (autopilotSummary.enabled) {
    // Calibration status
    const calProgress = autopilotSummary.calibrationProgress;
    let calBadge: string;
    if (calProgress.complete) {
      calBadge = '<span class="ap-badge complete">Complete</span>';
    } else {
      calBadge = `<span class="ap-badge in-progress">${calProgress.current}/${calProgress.required} decisions</span>`;
    }

    // Approval rate trend description
    let approvalTrend: string;
    if (autopilotSummary.stats.totalDecisions === 0) {
      approvalTrend = 'No decisions recorded yet';
    } else if (approvalRate >= 80) {
      approvalTrend = `${approvalRate}% -- strong alignment with your preferences`;
    } else if (approvalRate >= 60) {
      approvalTrend = `${approvalRate}% -- learning your style, improving`;
    } else {
      approvalTrend = `${approvalRate}% -- still calibrating to your taste`;
    }

    // Learned preferences count
    const topicCount = Object.keys(autopilotState.topicScores).length;
    const catCount = Object.keys(autopilotState.categoryScores).length;
    const fmtCount = Object.keys(autopilotState.formatScores).length;
    const totalPrefs = topicCount + catCount + fmtCount;

    // Top approved / rejected category
    const catScores = autopilotState.categoryScores;
    const catEntries = Object.entries(catScores);
    let topApproved = '--';
    let topRejected = '--';
    if (catEntries.length > 0) {
      catEntries.sort((a, b) => b[1] - a[1]);
      const best = catEntries[0];
      if (best[1] > 0) {
        topApproved = CATEGORY_LABELS[best[0]] ?? best[0].replace(/_/g, ' ');
      }
      const worst = catEntries[catEntries.length - 1];
      if (worst[1] < 0) {
        topRejected = CATEGORY_LABELS[worst[0]] ?? worst[0].replace(/_/g, ' ');
      }
    }

    const topApprovedColor = catEntries.length > 0 && catEntries[0][1] > 0
      ? (CATEGORY_COLORS[catEntries[0][0]] ?? '#3fb950')
      : '#3fb950';
    const topRejectedColor = catEntries.length > 0 && catEntries[catEntries.length - 1][1] < 0
      ? (CATEGORY_COLORS[catEntries[catEntries.length - 1][0]] ?? '#f85149')
      : '#f85149';

    autopilotHtml = `
      <div class="perf-section-label">Autopilot Insights</div>
      <div class="autopilot-section">
        <div class="autopilot-grid">
          <div class="autopilot-item">
            <div class="ap-label">Calibration Status</div>
            <div class="ap-value">${calBadge}</div>
          </div>
          <div class="autopilot-item">
            <div class="ap-label">Approval Rate</div>
            <div class="ap-value">${esc(approvalTrend)}</div>
          </div>
          <div class="autopilot-item">
            <div class="ap-label">Learned Preferences</div>
            <div class="ap-value">Your bot has learned ${totalPrefs} preference${totalPrefs !== 1 ? 's' : ''}</div>
          </div>
          <div class="autopilot-item">
            <div class="ap-label">Category Preferences</div>
            <div class="ap-value">
              <div class="ap-pref-row">
                <span class="ap-pref-dot" style="background:${topApprovedColor}"></span>
                <span class="ap-pref-label">Top approved: ${esc(topApproved)}</span>
              </div>
              <div class="ap-pref-row">
                <span class="ap-pref-dot" style="background:${topRejectedColor}"></span>
                <span class="ap-pref-label">Top rejected: ${esc(topRejected)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>`;
  }

  // ── Assemble page ──
  return `
  <style>${pageCss()}</style>

  <!-- Section 1: Summary Cards -->
  ${summaryHtml}

  <!-- Section 2: Daily Activity -->
  ${dailyHtml}

  <!-- Section 3: Top Categories -->
  ${categoryHtml}

  <!-- Section 4: Autopilot Insights -->
  ${autopilotHtml}`;
}

// ─── Action Handler ─────────────────────────────────────────────────────────

export async function handlePost(
  action: string,
  body: Record<string, string>,
): Promise<{ redirect?: string }> {
  return { redirect: '/performance' };
}
