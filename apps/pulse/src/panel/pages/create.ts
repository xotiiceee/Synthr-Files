/**
 * Queue page — unified content creation hub with autopilot controls.
 *
 * Combines Drafts (review + all posts), Outreach, and Mentions into a single
 * page with sub-tab routing. Thin router that delegates to existing page
 * modules for rendering and action handling.
 *
 * Autopilot banner at top shows current state: off / calibrating / active.
 */

import * as reviewPage from './review.js';
import * as outreachPage from './outreach.js';
import * as mentionsPage from './mentions.js';
import { getAutopostQueue } from '../../modes/autopost.js';
import { loadState } from '../../core/state.js';
import { getOpportunityFeed } from '../../core/opportunity-engine.js';
import { getConfig, saveConfig } from '../../core/persona.js';

// ─── Sub-tab CSS (same as content.ts / engage.ts) ────────────────────────────

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

// ─── Autopilot CSS ───────────────────────────────────────────────────────────

const AUTOPILOT_CSS = `
.autopilot-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 20px;
  border-radius: 8px;
  margin-bottom: 16px;
}
.autopilot-off {
  background: #21262d;
  border: 1px solid #30363d;
}
.autopilot-calibrating {
  background: #9e6a0322;
  border: 1px solid #9e6a03;
}
.autopilot-on {
  background: #23863622;
  border: 1px solid #238636;
}
.autopilot-status {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
}
.autopilot-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-right: 8px;
}
.autopilot-dot.off { background: #484f58; }
.autopilot-dot.calibrating { background: #d29922; animation: pulse 2s infinite; }
.autopilot-dot.on { background: #3fb950; animation: pulse 2s infinite; }
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
.btn-enable {
  background: #238636;
  color: #fff;
  border: none;
  padding: 6px 16px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
}
.btn-enable:hover { background: #2ea043; }
.btn-pause {
  background: #30363d;
  color: #c9d1d9;
  border: none;
  padding: 6px 16px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
}
.btn-pause:hover { background: #3b434b; }
.calibration-bar {
  height: 4px;
  background: #21262d;
  border-radius: 2px;
  width: 120px;
  margin-top: 4px;
}
.calibration-fill {
  height: 100%;
  background: #d29922;
  border-radius: 2px;
  transition: width 0.3s;
}
.autopilot-setup {
  max-width: 420px;
  margin: 40px auto;
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 12px;
  padding: 32px;
}
.autopilot-setup h2 {
  margin: 0 0 8px;
  font-size: 1.3rem;
  color: #f0f6fc;
}
.autopilot-setup p {
  color: #8b949e;
  margin: 0 0 24px;
  font-size: 0.9rem;
}
.setup-field {
  margin-bottom: 16px;
}
.setup-field label {
  display: block;
  color: #c9d1d9;
  font-size: 0.85rem;
  margin-bottom: 6px;
  font-weight: 500;
}
.setup-field input[type="number"],
.setup-field input[type="time"] {
  background: #0d1117;
  border: 1px solid #30363d;
  color: #f0f6fc;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 0.9rem;
  width: 100%;
  box-sizing: border-box;
}
.setup-field input[type="time"] {
  width: auto;
}
.filter-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 16px;
}
.filter-tab {
  padding: 5px 12px;
  color: #8b949e;
  font-size: 12px;
  font-weight: 500;
  border: 1px solid #30363d;
  border-radius: 20px;
  text-decoration: none;
  background: transparent;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}
.filter-tab:hover { color: #e6edf3; border-color: #484f58; }
.filter-tab.active { color: #f0f6fc; background: #30363d; border-color: #58a6ff; }
`;

// ─── Types ──────────────────────────────────────────────────────────────────

interface MentionStateData {
  processedIds: string[];
  pendingReplies: Array<{ status: string }>;
  dailyCounts: Record<string, number>;
  lastCheckAt: string;
}

// ─── Action routing sets ────────────────────────────────────────────────────

const REVIEW_ACTIONS = new Set([
  'approve', 'reject', 'edit', 'defer', 'publish-all', 'generate', 'check-status',
]);

const OUTREACH_ACTIONS = new Set([
  'discover', 'post-reply', 'skip', 'edit-reply', 'regenerate',
]);

const MENTION_ACTIONS = new Set([
  'scan', 'approve-reply', 'reject-reply', 'generate-reply',
]);

// ─── Autopilot bar rendering ────────────────────────────────────────────────

function renderAutopilotBar(): string {
  const config = getConfig();
  const ap = config.autopilot;

  if (!ap || !ap.enabled) {
    // OFF state
    return `
<div class="autopilot-bar autopilot-off">
  <div class="autopilot-status">
    <span class="autopilot-dot off"></span>
    <span>Autopilot is <strong>off</strong></span>
  </div>
  <form method="POST" style="margin:0">
    <input type="hidden" name="action" value="toggle-autopilot">
    <button type="submit" class="btn btn-enable">Enable Autopilot</button>
  </form>
</div>`;
  }

  const calibrationTarget = 10;
  const decisions = ap.calibrationDecisions || 0;

  if (!ap.calibrationComplete && decisions < calibrationTarget) {
    // CALIBRATING state
    const pct = Math.round((decisions / calibrationTarget) * 100);
    return `
<div class="autopilot-bar autopilot-calibrating">
  <div class="autopilot-status">
    <span class="autopilot-dot calibrating"></span>
    <span>Autopilot — <strong>Calibrating</strong> (${decisions}/${calibrationTarget} decisions)
      <span class="info-tip" role="img" aria-label="Help" style="margin-left:4px;"><span class="info-icon">?</span><span class="tip-text">Each approve, reject, or edit action trains the autopilot. After 10 decisions, it learns your preferences and can auto-approve posts.</span></span>
    </span>
    <div class="calibration-bar"><div class="calibration-fill" style="width:${pct}%"></div></div>
  </div>
  <div style="display:flex;gap:8px;">
    <form method="POST" style="margin:0">
      <input type="hidden" name="action" value="skip-calibration">
      <button type="submit" class="btn btn-secondary" style="font-size:0.78rem;" onclick="if(typeof pulseConfirm==='function'){event.preventDefault();var f=this.closest('form');pulseConfirm('Skip Calibration','Autopilot will use default preferences instead of learning from your decisions.').then(function(ok){if(ok)f.submit();});return false;}return confirm('Skip calibration?');">Skip</button>
    </form>
    <form method="POST" style="margin:0">
      <input type="hidden" name="action" value="toggle-autopilot">
      <button type="submit" class="btn btn-pause">Pause</button>
    </form>
  </div>
</div>`;
  }

  // ACTIVE state
  const postsPerDay = config.autopost?.limits?.profilePostsPerDay ?? 3;
  const repliesPerDay = config.autopost?.limits?.repliesPerDay ?? 10;
  const startHour = ap.activeHours?.start || '09:00';
  const endHour = ap.activeHours?.end || '22:00';
  const startH = startHour.replace(/^0/, '').split(':')[0];
  const endH = endHour.replace(/^0/, '').split(':')[0];

  return `
<div class="autopilot-bar autopilot-on">
  <div class="autopilot-status">
    <span class="autopilot-dot on"></span>
    <span>Autopilot is <strong>active</strong> — ${postsPerDay} posts/day, ${repliesPerDay} replies/day, ${startH}:00-${endH}:00</span>
  </div>
  <form method="POST" style="margin:0">
    <input type="hidden" name="action" value="toggle-autopilot">
    <button type="submit" class="btn btn-pause">Pause</button>
  </form>
</div>`;
}

// ─── Setup screen ───────────────────────────────────────────────────────────

function renderSetupScreen(): string {
  return `
<div class="autopilot-setup">
  <h2>Configure Autopilot</h2>
  <p>Set your daily limits. You can change these anytime in Settings.</p>
  <form method="POST">
    <input type="hidden" name="action" value="setup-autopilot">
    <div class="setup-field">
      <label>Posts per day</label>
      <input type="number" name="postsPerDay" value="3" min="0" max="999">
    </div>
    <div class="setup-field">
      <label>Replies per day</label>
      <input type="number" name="repliesPerDay" value="10" min="0" max="999">
    </div>
    <div class="setup-field">
      <label>Active hours</label>
      <div style="display:flex;gap:8px;align-items:center">
        <input type="time" name="activeStart" value="09:00">
        <span>to</span>
        <input type="time" name="activeEnd" value="22:00">
      </div>
    </div>
    <a href="/settings" style="color:#58a6ff;font-size:0.8rem">Advanced settings →</a>
    <button type="submit" class="btn btn-enable" style="margin-top:16px;width:100%">Start Calibration</button>
  </form>
</div>`;
}

// ─── Filter tabs for Drafts ─────────────────────────────────────────────────

function renderFilterTabs(currentFilter: string): string {
  const filters = [
    { key: 'needs-review', label: 'Needs Review' },
    { key: 'auto-approved', label: 'Auto-approved' },
    { key: 'all', label: 'All' },
  ];

  return `
<div class="filter-tabs">
  ${filters.map(f => {
    const active = f.key === currentFilter ? ' active' : '';
    return `<a href="/create?tab=feed&filter=${f.key}" class="filter-tab${active}">${f.label}</a>`;
  }).join('\n  ')}
</div>`;
}

// ─── Generate Section CSS ───────────────────────────────────────────────────

const GENERATE_CSS = `
.generate-section {
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 20px;
}
.generate-section h3 {
  margin: 0 0 12px;
  font-size: 15px;
  color: #f0f6fc;
  font-weight: 600;
}
.generate-input {
  width: 100%;
  padding: 10px 14px;
  background: #0d1117;
  color: #e6edf3;
  border: 1px solid #30363d;
  border-radius: 6px;
  font-size: 14px;
  margin-bottom: 12px;
  resize: none;
}
.generate-input:focus { outline: none; border-color: #58a6ff; }
.generate-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.btn-generate {
  padding: 8px 16px;
  background: #238636;
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
}
.btn-generate:hover { background: #2ea043; }
.btn-category {
  padding: 6px 14px;
  background: #21262d;
  color: #c9d1d9;
  border: 1px solid #30363d;
  border-radius: 20px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  transition: all 0.15s;
}
.btn-category:hover { background: #30363d; color: #f0f6fc; border-color: #58a6ff; }
.queue-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.queue-header h3 {
  margin: 0;
  font-size: 15px;
  color: #f0f6fc;
  font-weight: 600;
}
.queue-actions {
  display: flex;
  gap: 8px;
}
.btn-small {
  padding: 5px 12px;
  background: #21262d;
  color: #c9d1d9;
  border: 1px solid #30363d;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
}
.btn-small:hover { background: #30363d; }
.empty-state {
  text-align: center;
  padding: 48px 24px;
  color: #8b949e;
}
.empty-state h3 { color: #e6edf3; margin-bottom: 8px; }
.empty-state p { font-size: 14px; margin-bottom: 16px; }
`;

// ─── Render ─────────────────────────────────────────────────────────────────

export async function renderPage(query?: URLSearchParams): Promise<string> {
  const tab = query?.get('tab') || 'feed';
  const filter = query?.get('filter') || 'needs-review';

  // Status banners from redirects
  const msg = query?.get('msg');
  let banner = '';
  if (msg === 'generated') {
    banner = `<div style="background:#23863622;border:1px solid #238636;border-radius:8px;padding:12px 16px;margin-bottom:16px;color:#3fb950;font-size:14px;">Post generated and added to your queue below.</div>`;
  } else if (msg === 'calibration_skipped') {
    banner = `<div style="background:#23863622;border:1px solid #238636;border-radius:8px;padding:12px 16px;margin-bottom:16px;color:#3fb950;font-size:14px;">Calibration skipped. Configure autopilot in the Autopilot tab.</div>`;
  } else if (msg === 'calibration_complete') {
    banner = `<div style="background:#23863622;border:1px solid #238636;border-radius:8px;padding:12px 16px;margin-bottom:16px;color:#3fb950;font-size:14px;">Calibration complete! Your autopilot is now active.</div>`;
  }

  // Generate section at top
  const generateSection = `
<div class="generate-section">
  <h3>Generate Content</h3>
  <form method="POST">
    <input type="hidden" name="action" value="generate">
    <textarea class="generate-input" name="topic" rows="2" placeholder="What do you want to post about? Leave blank for auto-generated content..."></textarea>
    <div class="generate-actions">
      <button type="submit" class="btn-generate">Generate Post</button>
      <button type="submit" name="generateType" value="thread" class="btn-generate" style="background:#21262d;border:1px solid #30363d;">Generate Thread</button>
      <span style="color:#30363d;align-self:center;">|</span>
      <button type="submit" name="category" value="news_commentary" class="btn-category">News</button>
      <button type="submit" name="category" value="product_tips" class="btn-category">Product</button>
      <button type="submit" name="category" value="industry_insights" class="btn-category">Insight</button>
      <button type="submit" name="category" value="engagement" class="btn-category">Engagement</button>
      <button type="submit" name="category" value="milestones" class="btn-category">Milestone</button>
    </div>
  </form>
</div>`;

  // Badge counts
  const pending = getAutopostQueue().length;
  const mentionState = loadState<MentionStateData>('mentions', {
    processedIds: [],
    pendingReplies: [],
    dailyCounts: {},
    lastCheckAt: '',
  });
  const mentionsPending = mentionState.pendingReplies.filter(
    m => m.status === 'pending' || m.status === 'queued',
  ).length;
  const newOpportunities = getOpportunityFeed({ status: 'new' }).length;

  // Sub-tabs for queue section
  const tabs = [
    { key: 'feed',     label: 'Posts',    badge: pending > 0 ? pending : null },
    { key: 'outreach', label: 'Replies',  badge: newOpportunities > 0 ? newOpportunities : null },
    { key: 'mentions', label: 'Mentions', badge: mentionsPending > 0 ? mentionsPending : null },
  ];

  const tabBar = `
<div class="queue-header">
  <h3>Queue</h3>
  <div class="queue-actions">
    <form method="POST" style="margin:0;display:inline"><input type="hidden" name="action" value="publish-all"><button type="submit" class="btn-small" onclick="if(typeof pulseConfirm==='function'){event.preventDefault();var f=this.closest('form');pulseConfirm('Approve All','Publish all pending posts?').then(function(ok){if(ok)f.submit();});return false;}return confirm('Approve all pending posts?')">Approve All</button></form>
  </div>
</div>
<div class="sub-tabs">
  ${tabs.map(t => {
    const active = t.key === tab ? ' active' : '';
    const badge = t.badge !== null
      ? `<span class="sub-tab-badge">${t.badge}</span>`
      : '';
    return `<a href="/create?tab=${t.key}" class="sub-tab${active}">${t.label}${badge}</a>`;
  }).join('\n  ')}
</div>`;

  // Delegate to the appropriate page module
  let body: string;
  switch (tab) {
    case 'outreach':
      body = await outreachPage.renderPage(query);
      break;
    case 'mentions':
      body = await mentionsPage.renderPage(query);
      break;
    case 'feed':
    default:
      body = renderFilterTabs(filter) + await reviewPage.renderPage(query);
      if (pending === 0 && filter === 'needs-review') {
        body = `<div class="empty-state"><h3>No posts to review</h3><p>Generate your first post above, or enable autopilot to have posts created automatically.</p><a href="/autopilot" style="color:#58a6ff;text-decoration:none;">Configure Autopilot →</a></div>`;
      }
      break;
  }

  return `<style>${SUB_TAB_CSS}${AUTOPILOT_CSS}${GENERATE_CSS}</style>` + banner + generateSection + tabBar + body;
}

// ─── Action Handler ─────────────────────────────────────────────────────────

export async function handlePost(
  action: string,
  body: Record<string, string>,
): Promise<{ redirect?: string; json?: unknown }> {

  // ── Autopilot actions ──
  if (action === 'toggle-autopilot') {
    const config = getConfig();
    if (!config.autopilot) {
      config.autopilot = {
        enabled: false,
        calibrationComplete: false,
        calibrationDecisions: 0,
        confidenceThreshold: 75,
        activeHours: { start: '09:00', end: '22:00' },
        dailyDigest: { enabled: true, sendTimeLocal: '09:00' },
      };
    }
    config.autopilot.enabled = !config.autopilot.enabled;
    saveConfig(config);
    // If enabling for first time and no calibration yet, show setup
    if (config.autopilot.enabled && config.autopilot.calibrationDecisions === 0) {
      return { redirect: '/autopilot' };
    }
    return { redirect: '/create' };
  }

  if (action === 'skip-calibration') {
    const config = getConfig();
    if (!config.autopilot) {
      config.autopilot = { enabled: true, calibrationComplete: true, calibrationDecisions: 10, confidenceThreshold: 75, activeHours: { start: '09:00', end: '22:00' }, dailyDigest: { enabled: true, sendTimeLocal: '09:00' } };
    } else {
      config.autopilot.calibrationComplete = true;
      config.autopilot.calibrationDecisions = 10;
    }
    saveConfig(config);
    return { redirect: '/create?msg=calibration_skipped' };
  }

  if (action === 'setup-autopilot') {
    const config = getConfig();
    if (!config.autopilot) {
      config.autopilot = {
        enabled: false,
        calibrationComplete: false,
        calibrationDecisions: 0,
        confidenceThreshold: 75,
        activeHours: { start: '09:00', end: '22:00' },
        dailyDigest: { enabled: true, sendTimeLocal: '09:00' },
      };
    }
    config.autopilot.enabled = true;
    config.autopilot.activeHours = {
      start: body.activeStart || '09:00',
      end: body.activeEnd || '22:00',
    };
    if (!config.autopost) config.autopost = {} as any;
    if (!config.autopost!.limits) config.autopost!.limits = {} as any;
    config.autopost!.limits!.profilePostsPerDay = parseInt(body.postsPerDay) || 3;
    config.autopost!.limits!.repliesPerDay = parseInt(body.repliesPerDay) || 10;
    saveConfig(config);
    return { redirect: '/create' };
  }

  // ── Feed / Review actions ──
  if (REVIEW_ACTIONS.has(action)) {
    const result = await reviewPage.handlePost(action, body);
    // JSON responses (e.g. check-status) pass through unchanged
    if (result.json !== undefined) return result;
    // Rewrite redirects to stay on /create?tab=feed
    const returnTab = body._tab || 'feed';
    if (result.redirect) {
      result.redirect = result.redirect
        .replace(/^\/review/, `/queue?tab=${returnTab}`)
        .replace(/^\/content/, `/queue?tab=${returnTab}`)
        .replace(/^\/queue/, '/create');
    }
    return result;
  }

  // ── Outreach actions ──
  if (OUTREACH_ACTIONS.has(action)) {
    const result = await outreachPage.handlePost(action, body);
    if (result.json !== undefined) return result;
    if (result.redirect) {
      result.redirect = result.redirect
        .replace(/^\/engage\?tab=outreach/, '/create?tab=outreach')
        .replace(/^\/engage/, '/create?tab=outreach')
        .replace(/^\/queue/, '/create');
    }
    return result;
  }

  // ── Mention actions ──
  if (MENTION_ACTIONS.has(action)) {
    const result = await mentionsPage.handlePost(action, body);
    if (result.json !== undefined) return result;
    if (result.redirect) {
      result.redirect = result.redirect
        .replace(/^\/engage\?tab=mentions/, '/create?tab=mentions')
        .replace(/^\/mentions/, '/create?tab=mentions')
        .replace(/^\/queue/, '/create');
    }
    return result;
  }

  // ── Shared actions (generate-reply, check-status) — route by body.tab ──
  if (action === 'generate-reply' || action === 'check-status') {
    const tab = body.tab;
    if (tab === 'outreach') {
      const result = await outreachPage.handlePost(action, body);
      if (result.json !== undefined) return result;
      if (result.redirect) {
        result.redirect = result.redirect
          .replace(/^\/engage\?tab=outreach/, '/create?tab=outreach')
          .replace(/^\/engage/, '/create?tab=outreach')
          .replace(/^\/queue/, '/create');
      }
      return result;
    }
    // Default shared actions to mentions
    const result = await mentionsPage.handlePost(action, body);
    if (result.json !== undefined) return result;
    if (result.redirect) {
      result.redirect = result.redirect
        .replace(/^\/engage\?tab=mentions/, '/create?tab=mentions')
        .replace(/^\/mentions/, '/create?tab=mentions')
        .replace(/^\/queue/, '/create');
    }
    return result;
  }

  return { redirect: '/create' };
}
