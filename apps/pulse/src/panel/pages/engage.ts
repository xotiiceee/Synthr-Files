/**
 * Engage page — combines Mentions + Outreach with sub-tab routing.
 * Thin router that delegates to mentions.ts and outreach.ts page modules.
 */

import * as mentionsPage from './mentions.js';
import * as outreachPage from './outreach.js';
import { loadState } from '../../core/state.js';
import { getOpportunityFeed } from '../../core/opportunity-engine.js';

// ─── Sub-tab CSS (same as content.ts) ───────────────────────────────────────

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

// ─── Types ──────────────────────────────────────────────────────────────────

interface MentionStateData {
  processedIds: string[];
  pendingReplies: Array<{ status: string }>;
  dailyCounts: Record<string, number>;
  lastCheckAt: string;
}

// ─── Mention / Outreach actions ─────────────────────────────────────────────

const MENTION_ONLY_ACTIONS = new Set([
  'scan', 'approve-reply', 'reject-reply',
]);

const OUTREACH_ONLY_ACTIONS = new Set([
  'discover', 'post-reply', 'skip',
  'edit-reply', 'regenerate',
]);

// Actions shared between both tabs — routed by body.tab
const SHARED_ACTIONS = new Set([
  'generate-reply', 'check-status',
]);

// ─── Render ─────────────────────────────────────────────────────────────────

export async function renderPage(query?: URLSearchParams): Promise<string> {
  const tab = query?.get('tab') || 'mentions';

  // Badge counts
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

  // Build sub-tab bar
  const tabs = [
    { key: 'mentions', label: 'Mentions', badge: mentionsPending > 0 ? mentionsPending : null },
    { key: 'outreach', label: 'Outreach', badge: newOpportunities > 0 ? newOpportunities : null },
  ];

  const tabBar = `
<style>${SUB_TAB_CSS}</style>
<div class="sub-tabs">
  ${tabs.map(t => {
    const active = t.key === tab ? ' active' : '';
    const badge = t.badge !== null
      ? `<span class="sub-tab-badge">${t.badge}</span>`
      : '';
    return `<a href="/engage?tab=${t.key}" class="sub-tab${active}">${t.label}${badge}</a>`;
  }).join('\n  ')}
</div>`;

  // Delegate to the appropriate page module
  let body: string;
  switch (tab) {
    case 'outreach':
      body = await outreachPage.renderPage(query);
      break;
    case 'mentions':
    default:
      body = await mentionsPage.renderPage(query);
      break;
  }

  return tabBar + body;
}

// ─── Action Handler ─────────────────────────────────────────────────────────

export async function handlePost(
  action: string,
  body: Record<string, string>,
): Promise<{ redirect?: string; json?: unknown }> {
  // Determine target tab: explicit body.tab, or infer from action
  const tab = body.tab
    || (MENTION_ONLY_ACTIONS.has(action) ? 'mentions' : undefined)
    || (OUTREACH_ONLY_ACTIONS.has(action) ? 'outreach' : undefined)
    || (SHARED_ACTIONS.has(action) ? undefined : undefined); // needs body.tab

  if (tab === 'mentions' || (!tab && MENTION_ONLY_ACTIONS.has(action))) {
    const result = await mentionsPage.handlePost(action, body);
    if (result.json !== undefined) return result;
    return { ...result, redirect: result.redirect || '/engage?tab=mentions' };
  }

  if (tab === 'outreach' || OUTREACH_ONLY_ACTIONS.has(action)) {
    const result = await outreachPage.handlePost(action, body);
    if (result.json !== undefined) return result;
    return { ...result, redirect: result.redirect || '/engage?tab=outreach' };
  }

  // Shared actions without explicit tab — default to mentions for backwards compat
  if (SHARED_ACTIONS.has(action)) {
    const result = await mentionsPage.handlePost(action, body);
    if (result.json !== undefined) return result;
    return { ...result, redirect: result.redirect || '/engage?tab=mentions' };
  }

  return { redirect: '/engage' };
}
