/**
 * Dashboard Page — the landing page for PULSE's web panel.
 *
 * Redesigned for non-technical Gumroad clients. Answers four questions:
 *   1. "Is my bot running? What did it do today?"  -> Automation Status Bar
 *   2. "Do I need to do anything?"                 -> Action Items
 *   3. "How am I doing?"                           -> Today's Performance
 *   4. "What's next?"                              -> Primary CTA
 *
 * Removed: voice score, approval streak, category breakdowns, raw charts.
 * Moved:   voice score -> Settings > Voice, streak -> internal only.
 */

import { loadState } from '../../core/state.js';
import { getAutopostQueue, getAutopostStats } from '../../modes/autopost.js';
import { detectMentions, getMentionStats } from '../../intelligence/mention-detector.js';
import { getActions } from '../../core/state.js';
import { getConfig } from '../../core/persona.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function friendlyDuration(ms: number): string {
  if (ms <= 0) return 'now';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'less than a minute';
  if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  const hours = Math.floor(minutes / 60);
  const remainMin = minutes % 60;
  if (remainMin === 0) return `${hours} hour${hours !== 1 ? 's' : ''}`;
  return `${hours}h ${remainMin}m`;
}

const ACTION_TYPE_LABELS: Record<string, { verb: string; bg: string; fg: string }> = {
  post:    { verb: 'Published post',  bg: '#238636', fg: '#fff' },
  reply:   { verb: 'Replied to',      bg: '#1f6feb', fg: '#fff' },
  like:    { verb: 'Liked',           bg: '#9e6a03', fg: '#fff' },
  repost:  { verb: 'Reposted',        bg: '#bc8cff', fg: '#0d1117' },
  comment: { verb: 'Commented on',    bg: '#58a6ff', fg: '#0d1117' },
};

const PLATFORM_LABELS: Record<string, { label: string; color: string }> = {
  x:           { label: 'X',        color: '#e6edf3' },
  reddit:      { label: 'Reddit',   color: '#ff4500' },
  hackernews:  { label: 'HN',       color: '#ff6600' },
  producthunt: { label: 'PH',       color: '#da552f' },
  linkedin:    { label: 'LinkedIn', color: '#0a66c2' },
  discord:     { label: 'Discord',  color: '#5865f2' },
};

// ─── Data Loaders ────────────────────────────────────────────────────────────

function getPendingCount(): number {
  return getAutopostQueue().length;
}

function getUnreadMentionCount(): number {
  interface MentionState {
    pendingReplies: Array<{ status: string }>;
  }
  const state = loadState<MentionState>('mentions', { pendingReplies: [] });
  return state.pendingReplies.filter(m => m.status === 'pending').length;
}

function getOpportunityCount(): number {
  try {
    const { getOpportunityFeed } = require('../../core/opportunity-engine.js');
    return getOpportunityFeed({ status: 'new' }).length;
  } catch {
    return 0;
  }
}

/** Is the automation engine currently active (not paused)? */
function isAutomationActive(): boolean {
  interface AutopostState { pausedUntil: string | null }
  const state = loadState<AutopostState>('autopost', { pausedUntil: null });
  if (!state.pausedUntil) return true;
  return new Date(state.pausedUntil).getTime() < Date.now();
}

/** Compute time until next scheduled task based on scheduler state + config intervals. */
function getNextScheduledAction(): { task: string; inMs: number } | null {
  interface ScheduleState { lastRun: Record<string, string> }
  const schedState = loadState<ScheduleState>('schedule', {
    lastRun: { outreach: '', content: '', monitor: '', adaptation: '' },
  });

  const config = getConfig();
  const now = Date.now();

  const tasks: Array<{ task: string; label: string; nextAt: number }> = [];

  // Outreach: based on outreachIntervalHours
  if (schedState.lastRun.outreach) {
    const next = new Date(schedState.lastRun.outreach).getTime()
      + config.schedule.outreachIntervalHours * 3_600_000;
    tasks.push({ task: 'outreach', label: 'Reply scan', nextAt: next });
  }

  // Content: runs once per day
  if (schedState.lastRun.content) {
    const lastDate = schedState.lastRun.content.slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    if (lastDate === today) {
      // Already ran today, next is tomorrow 00:00
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tasks.push({ task: 'content', label: 'Content generation', nextAt: tomorrow.getTime() });
    }
  }

  // Monitor: every 6 hours
  if (schedState.lastRun.monitor) {
    const next = new Date(schedState.lastRun.monitor).getTime() + 6 * 3_600_000;
    tasks.push({ task: 'monitor', label: 'Mention scan', nextAt: next });
  }

  if (tasks.length === 0) return null;

  // Find the soonest upcoming task
  tasks.sort((a, b) => a.nextAt - b.nextAt);
  const soonest = tasks[0];
  return { task: soonest.label, inMs: Math.max(0, soonest.nextAt - now) };
}

/** Sum engagement (likes + replies) on actions that are our own posts today. */
function getTodayEngagement(): number {
  const todayKey = new Date().toISOString().slice(0, 10);
  const actions = getActions(todayKey);
  let total = 0;
  for (const a of actions) {
    if (a.platform === 'system') continue;
    if (a.engagement) {
      total += (a.engagement.likes ?? 0) + (a.engagement.replies ?? 0);
    }
  }
  return total;
}

// ─── Today's summary text (human-readable) ──────────────────────────────────

function buildTodaySummary(): string {
  const todayKey = new Date().toISOString().slice(0, 10);
  const todayActions = getActions(todayKey).filter(a => a.platform !== 'system');

  if (todayActions.length === 0) return 'No activity yet today';

  const counts: Record<string, number> = {};
  for (const a of todayActions) {
    counts[a.type] = (counts[a.type] ?? 0) + 1;
  }

  const parts: string[] = [];
  if (counts.reply)   parts.push(`${counts.reply} repl${counts.reply === 1 ? 'y' : 'ies'} sent`);
  if (counts.post)    parts.push(`${counts.post} post${counts.post === 1 ? '' : 's'} published`);
  if (counts.like)    parts.push(`${counts.like} like${counts.like === 1 ? '' : 's'}`);
  if (counts.repost)  parts.push(`${counts.repost} repost${counts.repost === 1 ? '' : 's'}`);
  if (counts.comment) parts.push(`${counts.comment} comment${counts.comment === 1 ? '' : 's'}`);

  return parts.join(', ');
}

// ─── CSS ─────────────────────────────────────────────────────────────────────

function pageCss(): string {
  return `
    /* ── Section 1: Automation Status Bar ── */

    .auto-status-bar {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 16px 20px;
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 10px;
      margin-bottom: 24px;
      flex-wrap: wrap;
    }

    .auto-status-indicator {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-shrink: 0;
    }

    .status-dot {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .status-dot.active {
      background: #3fb950;
      box-shadow: 0 0 8px rgba(63, 185, 80, 0.6);
    }

    .status-dot.paused {
      background: #d29922;
      box-shadow: 0 0 8px rgba(210, 153, 34, 0.4);
    }

    .status-label {
      font-size: 0.95rem;
      font-weight: 600;
      color: #e6edf3;
    }

    .status-label .status-word {
      font-weight: 700;
    }

    .status-label .status-word.active { color: #3fb950; }
    .status-label .status-word.paused { color: #d29922; }

    .auto-status-divider {
      width: 1px;
      height: 28px;
      background: #30363d;
      flex-shrink: 0;
    }

    .auto-status-summary {
      flex: 1;
      min-width: 200px;
    }

    .auto-status-summary .summary-main {
      color: #c9d1d9;
      font-size: 0.9rem;
      margin-bottom: 2px;
    }

    .auto-status-summary .summary-next {
      color: #8b949e;
      font-size: 0.8rem;
    }

    .auto-status-toggle {
      flex-shrink: 0;
    }

    .toggle-btn {
      padding: 6px 16px;
      border-radius: 6px;
      font-size: 0.8rem;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid;
      transition: background 0.15s, border-color 0.15s;
    }

    .toggle-btn.pause {
      background: transparent;
      color: #d29922;
      border-color: #d29922;
    }

    .toggle-btn.pause:hover {
      background: #d2992215;
    }

    .toggle-btn.resume {
      background: #238636;
      color: #fff;
      border-color: #238636;
    }

    .toggle-btn.resume:hover {
      background: #2ea043;
    }

    /* ── Section 2: Action Items ── */

    .action-items-section {
      margin-bottom: 24px;
    }

    .action-items-grid {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 14px;
    }

    .action-item {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 10px;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      transition: border-color 0.15s, background 0.15s;
    }

    .action-item:hover {
      background: #1c2129;
      border-color: #484f58;
    }

    .action-item.has-items {
      border-left: 4px solid #d29922;
    }

    .action-item-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .action-item-count {
      font-size: 2rem;
      font-weight: 700;
      color: #f0f6fc;
      line-height: 1;
    }

    .action-item-count.zero {
      color: #3fb950;
      font-size: 1.6rem;
    }

    .action-item-label {
      color: #c9d1d9;
      font-size: 0.9rem;
      font-weight: 500;
    }

    .action-item-sublabel {
      color: #8b949e;
      font-size: 0.8rem;
    }

    .action-item-link {
      display: inline-block;
      padding: 6px 14px;
      background: #21262d;
      color: #e6edf3;
      border: 1px solid #30363d;
      border-radius: 6px;
      font-size: 0.8rem;
      font-weight: 500;
      text-decoration: none;
      text-align: center;
      transition: background 0.15s;
      align-self: flex-start;
    }

    .action-item-link:hover {
      background: #30363d;
      text-decoration: none;
    }

    .all-clear-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: #3fb950;
      font-size: 0.8rem;
      font-weight: 500;
    }

    /* ── Section 3: Today's Performance ── */

    .perf-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 14px;
      margin-bottom: 24px;
    }

    .perf-card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 10px;
      padding: 20px;
      text-align: center;
    }

    .perf-number {
      font-size: 2.4rem;
      font-weight: 700;
      color: #f0f6fc;
      line-height: 1.1;
      margin-bottom: 6px;
    }

    .perf-label {
      color: #8b949e;
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      font-weight: 600;
    }

    /* ── Section 5: Recent Activity ── */

    .activity-list {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 10px;
      overflow: hidden;
      margin-bottom: 24px;
    }

    .activity-list-header {
      padding: 14px 18px;
      border-bottom: 1px solid #30363d;
      color: #8b949e;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-weight: 600;
    }

    .activity-item {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 12px 18px;
      border-bottom: 1px solid #21262d;
      font-size: 0.85rem;
    }

    .activity-item:last-child { border-bottom: none; }

    .activity-time {
      color: #484f58;
      font-size: 0.75rem;
      min-width: 52px;
      flex-shrink: 0;
      padding-top: 2px;
    }

    .activity-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
      margin-top: 5px;
    }

    .activity-body {
      flex: 1;
      min-width: 0;
    }

    .activity-headline {
      color: #e6edf3;
      font-size: 0.85rem;
      margin-bottom: 2px;
    }

    .activity-headline .platform-tag {
      display: inline-block;
      padding: 1px 6px;
      border-radius: 3px;
      font-size: 0.7rem;
      font-weight: 600;
      background: #21262d;
      margin-left: 4px;
      vertical-align: middle;
    }

    .activity-snippet {
      color: #8b949e;
      font-size: 0.8rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .empty-activity {
      padding: 40px 20px;
      text-align: center;
      color: #484f58;
      font-size: 0.9rem;
    }

    .empty-activity .empty-icon {
      font-size: 2rem;
      margin-bottom: 8px;
      opacity: 0.5;
    }

    /* ── Section Label ── */

    .section-label {
      color: #8b949e;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-weight: 600;
      margin-bottom: 10px;
    }

    /* ── Primary CTA ── */

    .primary-cta {
      background: linear-gradient(135deg, #238636 0%, #2ea043 100%);
      border: 1px solid #238636;
      border-radius: 10px;
      padding: 20px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 24px;
    }

    .primary-cta-text {
      color: #fff;
      font-size: 0.95rem;
      font-weight: 500;
    }

    .primary-cta-text strong {
      font-weight: 700;
    }

    .primary-cta-btn {
      display: inline-block;
      padding: 10px 24px;
      background: #fff;
      color: #238636;
      border: none;
      border-radius: 6px;
      font-size: 0.9rem;
      font-weight: 700;
      cursor: pointer;
      text-decoration: none;
      white-space: nowrap;
      transition: background 0.15s;
      flex-shrink: 0;
    }

    .primary-cta-btn:hover {
      background: #f0f6fc;
      text-decoration: none;
    }

    /* ── Responsive ── */

    @media (max-width: 768px) {
      .action-items-grid { grid-template-columns: 1fr; }
      .perf-grid { grid-template-columns: 1fr 1fr; }
      .auto-status-bar { flex-direction: column; align-items: flex-start; }
      .auto-status-divider { width: 100%; height: 1px; }
      .primary-cta { flex-direction: column; text-align: center; }
    }
  `;
}

// ─── Render ──────────────────────────────────────────────────────────────────

export async function renderPage(query?: URLSearchParams): Promise<string> {
  // ── Gather data ──
  const pendingCount = getPendingCount();
  const mentionCount = getUnreadMentionCount();
  const draftCount   = getOpportunityCount();
  const autoStats    = getAutopostStats();
  const mentionStats = getMentionStats();
  const active       = isAutomationActive();
  const todaySummary = buildTodaySummary();
  const nextAction   = getNextScheduledAction();

  // Today's actions (non-system)
  const todayKey = new Date().toISOString().slice(0, 10);
  const todayActions = getActions(todayKey).filter(a => a.platform !== 'system');
  const repliesToday = todayActions.filter(a => a.type === 'reply').length;
  const postsToday   = todayActions.filter(a => a.type === 'post').length;
  const mentionsToday = (() => {
    interface MState { pendingReplies: Array<{ detectedAt: string }> }
    const s = loadState<MState>('mentions', { pendingReplies: [] });
    return s.pendingReplies.filter(m => m.detectedAt >= todayKey).length;
  })();
  const engagementToday = getTodayEngagement();

  // Recent activity (last 10 non-system)
  const allActions = getActions();
  const recentActions = allActions
    .filter(a => a.platform !== 'system')
    .slice(-10)
    .reverse();

  // Total action items needing attention
  const totalItems = pendingCount + mentionCount + draftCount;

  // ── Build Section 1: Automation Status Bar ──
  const statusDotClass = active ? 'active' : 'paused';
  const statusWord = active ? 'Active' : 'Paused';
  const statusWordClass = active ? 'active' : 'paused';

  const nextActionHtml = nextAction
    ? `Next: ${esc(nextAction.task)} in ${esc(friendlyDuration(nextAction.inMs))}`
    : 'Scheduler idle';

  const toggleBtnHtml = active
    ? `<form method="POST" style="margin:0;"><input type="hidden" name="action" value="toggle-automation"><button type="submit" class="toggle-btn pause">Pause</button></form>`
    : `<form method="POST" style="margin:0;"><input type="hidden" name="action" value="toggle-automation"><button type="submit" class="toggle-btn resume">Resume</button></form>`;

  const automationBar = `
    <div class="auto-status-bar">
      <div class="auto-status-indicator">
        <span class="status-dot ${statusDotClass}"></span>
        <span class="status-label">Automation <span class="status-word ${statusWordClass}">${statusWord}</span></span>
      </div>
      <div class="auto-status-divider"></div>
      <div class="auto-status-summary">
        <div class="summary-main">${esc(todaySummary)}</div>
        <div class="summary-next">${nextActionHtml}</div>
      </div>
      <div class="auto-status-toggle">${toggleBtnHtml}</div>
    </div>`;

  // ── Build Section 2: Action Items ──
  const allClearHtml = `<span class="all-clear-badge">&#10003; All caught up</span>`;

  const pendingCardBody = pendingCount > 0
    ? `<div class="action-item-top">
         <span class="action-item-count">${pendingCount}</span>
       </div>
       <div class="action-item-label">Post${pendingCount !== 1 ? 's' : ''} to review</div>
       <a href="/queue?tab=feed" class="action-item-link">Review now</a>`
    : `<div class="action-item-top">
         <span class="action-item-count zero">&#10003;</span>
       </div>
       <div class="action-item-label">Posts to review</div>
       ${allClearHtml}`;

  const mentionCardBody = mentionCount > 0
    ? `<div class="action-item-top">
         <span class="action-item-count">${mentionCount}</span>
       </div>
       <div class="action-item-label">Mention${mentionCount !== 1 ? 's' : ''} need${mentionCount === 1 ? 's' : ''} response</div>
       <a href="/queue?tab=mentions" class="action-item-link">View mentions</a>`
    : `<div class="action-item-top">
         <span class="action-item-count zero">&#10003;</span>
       </div>
       <div class="action-item-label">Mentions to respond</div>
       ${allClearHtml}`;

  const draftCardBody = draftCount > 0
    ? `<div class="action-item-top">
         <span class="action-item-count">${draftCount}</span>
       </div>
       <div class="action-item-label">Conversation${draftCount !== 1 ? 's' : ''} to engage with</div>
       <a href="/queue?tab=outreach" class="action-item-link">View conversations</a>`
    : `<div class="action-item-top">
         <span class="action-item-count zero">&#10003;</span>
       </div>
       <div class="action-item-label">Conversations to engage with</div>
       ${allClearHtml}`;

  const actionItemsHtml = `
    <div class="action-items-section">
      <div class="section-label">Needs Your Attention${totalItems > 0 ? ` (${totalItems})` : ''}</div>
      <div class="action-items-grid">
        <div class="action-item${pendingCount > 0 ? ' has-items' : ''}">
          ${pendingCardBody}
        </div>
        <div class="action-item${mentionCount > 0 ? ' has-items' : ''}">
          ${mentionCardBody}
        </div>
        <div class="action-item${draftCount > 0 ? ' has-items' : ''}">
          ${draftCardBody}
        </div>
      </div>
    </div>`;

  // ── Build Section 3: Today's Performance ──
  const perfHtml = `
    <div class="section-label">Today's Performance</div>
    <div class="perf-grid">
      <div class="perf-card">
        <div class="perf-number">${repliesToday}</div>
        <div class="perf-label">Replies Sent</div>
      </div>
      <div class="perf-card">
        <div class="perf-number">${postsToday}</div>
        <div class="perf-label">Posts Published</div>
      </div>
      <div class="perf-card">
        <div class="perf-number">${mentionsToday}</div>
        <div class="perf-label">Mentions Detected</div>
      </div>
      <div class="perf-card">
        <div class="perf-number">${engagementToday}</div>
        <div class="perf-label">Engagement Received</div>
      </div>
    </div>`;

  // ── Build Section 4: Primary CTA ──
  // Determine what the most useful next action is
  let ctaHtml = '';
  if (pendingCount > 0) {
    ctaHtml = `
      <div class="primary-cta">
        <div class="primary-cta-text"><strong>${pendingCount} post${pendingCount !== 1 ? 's' : ''} waiting for your approval.</strong> Review them to keep your content pipeline flowing.</div>
        <a href="/queue?tab=feed" class="primary-cta-btn">Review Posts</a>
      </div>`;
  } else if (mentionCount > 0) {
    ctaHtml = `
      <div class="primary-cta">
        <div class="primary-cta-text"><strong>${mentionCount} mention${mentionCount !== 1 ? 's' : ''} waiting for a response.</strong> Stay engaged with your audience.</div>
        <a href="/queue?tab=mentions" class="primary-cta-btn">View Mentions</a>
      </div>`;
  } else if (autoStats.todayCount === 0 && active) {
    ctaHtml = `
      <div class="primary-cta">
        <div class="primary-cta-text"><strong>No posts published today yet.</strong> Head to the Create page to draft new content.</div>
        <a href="/queue?tab=feed" class="primary-cta-btn">Create Content</a>
      </div>`;
  } else if (!active) {
    ctaHtml = `
      <div class="primary-cta" style="background:linear-gradient(135deg,#d29922 0%,#e3b341 100%);border-color:#d29922;">
        <div class="primary-cta-text"><strong>Automation is paused.</strong> Resume to keep your content and engagement running.</div>
        <form method="POST" style="margin:0;flex-shrink:0;"><input type="hidden" name="action" value="toggle-automation"><button type="submit" class="primary-cta-btn" style="color:#d29922;border:none;cursor:pointer;">Resume</button></form>
      </div>`;
  }
  // If everything is clear and posts have been made, no CTA needed.

  // ── Build Section 6: Recent Activity ──
  let activityHtml: string;
  if (recentActions.length === 0) {
    activityHtml = `<div class="empty-activity">
      <div class="empty-icon">---</div>
      No activity yet. Generate your first post to get started.
    </div>`;
  } else {
    activityHtml = recentActions.map(a => {
      const meta = ACTION_TYPE_LABELS[a.type] ?? { verb: a.type, bg: '#30363d', fg: '#c9d1d9' };
      const plat = PLATFORM_LABELS[a.platform] ?? { label: a.platform, color: '#8b949e' };

      // Build a human-readable headline
      let headline = meta.verb;
      if (a.type === 'reply' && a.targetUrl) {
        headline += ` a conversation`;
      } else if (a.type === 'post') {
        headline += ` about ${esc(a.topicId.replace(/_/g, ' '))}`;
      }

      const snippet = a.content.length > 100 ? a.content.slice(0, 100) + '...' : a.content;

      return `<div class="activity-item">
        <span class="activity-time">${esc(relativeTime(a.timestamp))}</span>
        <span class="activity-dot" style="background:${meta.bg}"></span>
        <div class="activity-body">
          <div class="activity-headline">${headline} <span class="platform-tag" style="color:${plat.color}">${esc(plat.label)}</span></div>
          <div class="activity-snippet">${esc(snippet)}</div>
        </div>
      </div>`;
    }).join('\n');
  }

  // ── Assemble page ──
  return `
  <style>${pageCss()}</style>

  <!-- Section 1: Automation Status Bar -->
  ${automationBar}

  <!-- Section 2: Primary CTA (contextual) -->
  ${ctaHtml}

  <!-- Section 3: Action Items -->
  ${actionItemsHtml}

  <!-- Section 4: Today's Performance -->
  ${perfHtml}

  <!-- Section 5: Recent Activity -->
  <div class="section-label">Recent Activity</div>
  <div class="activity-list">
    <div class="activity-list-header">Last 10 actions</div>
    ${activityHtml}
  </div>`;
}

// ─── Action Handler ──────────────────────────────────────────────────────────

export async function handlePost(
  action: string,
  body: Record<string, string>,
): Promise<{ redirect?: string; json?: unknown }> {
  switch (action) {
    case 'toggle-automation': {
      interface AutopostState { pausedUntil: string | null }
      const state = loadState<AutopostState>('autopost', { pausedUntil: null });
      const currentlyActive = !state.pausedUntil || new Date(state.pausedUntil).getTime() < Date.now();

      if (currentlyActive) {
        // Pause: set pausedUntil far in the future (manual resume required)
        const { saveState: save } = await import('../../core/state.js');
        const fullState = loadState<Record<string, unknown>>('autopost', {});
        fullState.pausedUntil = new Date(Date.now() + 365 * 86_400_000).toISOString();
        save('autopost', fullState);
      } else {
        // Resume: clear pausedUntil
        const { saveState: save } = await import('../../core/state.js');
        const fullState = loadState<Record<string, unknown>>('autopost', {});
        fullState.pausedUntil = null;
        save('autopost', fullState);
      }
      return { redirect: '/queue' };
    }

    case 'scan-mentions': {
      // Fire-and-forget — redirect immediately to mentions page
      detectMentions().catch((err) => {
        console.error('[dashboard] Scan mentions error:', err);
      });
      return { redirect: '/queue?tab=mentions' };
    }

    case 'run-outreach': {
      // Fire-and-forget — use opportunity engine to discover new conversations
      import('../../core/opportunity-engine.js')
        .then((mod) => mod.discoverOpportunities())
        .catch((err) => {
          console.error('[dashboard] Discover opportunities error:', err);
        });
      return { redirect: '/queue?tab=outreach' };
    }

    default:
      return { redirect: '/queue' };
  }
}
