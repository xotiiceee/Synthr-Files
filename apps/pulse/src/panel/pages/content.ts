/**
 * Content page — combines Review + Feed with sub-tab routing.
 * Thin router that delegates to review.ts and feed.ts page modules.
 */

import * as reviewPage from './review.js';
import * as feedPage from './feed.js';
import { getAutopostQueue } from '../../modes/autopost.js';

// ─── Sub-tab CSS ────────────────────────────────────────────────────────────

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

// ─── Review actions that should delegate to reviewPage ──────────────────────

const REVIEW_ACTIONS = new Set([
  'approve', 'reject', 'edit', 'defer', 'publish-all', 'generate',
]);

// ─── Render ─────────────────────────────────────────────────────────────────

export async function renderPage(query?: URLSearchParams): Promise<string> {
  const tab = query?.get('tab') || 'review';
  const pending = getAutopostQueue().length;

  // Build sub-tab bar
  const tabs = [
    { key: 'review',    label: 'Review',    badge: pending > 0 ? pending : null },
    { key: 'published', label: 'Published', badge: null },
    { key: 'all',       label: 'All Posts', badge: null },
  ];

  const tabBar = `
<style>${SUB_TAB_CSS}</style>
<div class="sub-tabs">
  ${tabs.map(t => {
    const active = t.key === tab ? ' active' : '';
    const badge = t.badge !== null
      ? `<span class="sub-tab-badge">${t.badge}</span>`
      : '';
    return `<a href="/content?tab=${t.key}" class="sub-tab${active}">${t.label}${badge}</a>`;
  }).join('\n  ')}
</div>`;

  // Delegate to the appropriate page module
  let body: string;
  switch (tab) {
    case 'published':
      body = await feedPage.renderPage(new URLSearchParams('filter=posted'));
      break;
    case 'all':
      body = await feedPage.renderPage(query);
      break;
    case 'review':
    default:
      body = await reviewPage.renderPage(query);
      break;
  }

  return tabBar + body;
}

// ─── Action Handler ─────────────────────────────────────────────────────────

export async function handlePost(
  action: string,
  body: Record<string, string>,
): Promise<{ redirect?: string; json?: unknown }> {
  if (REVIEW_ACTIONS.has(action)) {
    const result = await reviewPage.handlePost(action, body);
    // Rewrite review redirects to stay on the content page
    // If the action came from the "all" tab, redirect back there
    const returnTab = body._tab || 'review';
    if (result.redirect && result.redirect.startsWith('/review')) {
      const extra = result.redirect.slice('/review'.length);
      result.redirect = `/content?tab=${returnTab}` + (extra.startsWith('?') ? '&' + extra.slice(1) : extra);
    }
    return result;
  }

  return { redirect: '/content' };
}
