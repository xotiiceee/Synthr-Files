/**
 * Post Review Page — review, approve, edit, reject, and defer pending autopost drafts.
 *
 * Renders a dark-themed card list of pending posts with inline editing,
 * category badges, voice scores, risk flags, and one-click actions.
 */

import { loadState, saveState } from '../../core/state.js';
import { recordDecision } from '../../core/autopilot.js';
import { getAutopostQueue, approveAutopost, rejectAutopost, editAutopost, publishApproved, runAutopost } from '../../modes/autopost.js';
import type { AutopostEntry } from '../../modes/autopost.js';

// ─── Generate State ─────────────────────────────────────────────────────────

/** Track background generate status so the page can show feedback. */
let generateStatus: 'idle' | 'running' | 'done' | 'error' = 'idle';
let generateMessage = '';

// ─── Helpers ────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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

const CATEGORY_COLORS: Record<string, string> = {
  news_commentary: '#58a6ff',
  product_tips: '#3fb950',
  industry_insights: '#bc8cff',
  engagement: '#d29922',
  curated_reshares: '#8b949e',
  milestones: '#e3b341',
};

const CATEGORY_LABELS: Record<string, string> = {
  news_commentary: 'NEWS',
  product_tips: 'TIPS',
  industry_insights: 'INSIGHTS',
  engagement: 'ENGAGE',
  curated_reshares: 'RESHARE',
  milestones: 'MILESTONE',
};

function categoryBadge(cat: string): string {
  const color = CATEGORY_COLORS[cat] ?? '#8b949e';
  const label = CATEGORY_LABELS[cat] ?? cat.toUpperCase();
  return `<span style="background:${color};color:#0d1117;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;letter-spacing:0.5px">${esc(label)}</span>`;
}

function voiceScoreBadge(score: number): string {
  const color = score >= 90 ? '#3fb950' : score >= 70 ? '#d29922' : '#f85149';
  return `<span style="color:${color};font-weight:600;font-size:13px" title="Voice alignment score">${score}%</span>`;
}

function formatBadge(format: string): string {
  return `<span style="background:#30363d;color:#c9d1d9;padding:2px 6px;border-radius:3px;font-size:11px">${esc(format)}</span>`;
}

function riskBadges(flags: string[]): string {
  if (!flags.length) return '';
  return flags.map(f =>
    `<span style="background:#f8514933;color:#f85149;padding:2px 6px;border-radius:3px;font-size:11px;font-weight:600">${esc(f)}</span>`
  ).join(' ');
}

function getStreakCount(): number {
  interface AutopostState {
    streakCount: number;
  }
  const state = loadState<AutopostState>('autopost', { streakCount: 0 });
  return state.streakCount;
}

// ─── Render ─────────────────────────────────────────────────────────────────

export async function renderPage(query?: URLSearchParams): Promise<string> {
  const pending = getAutopostQueue();
  const streakCount = getStreakCount();

  const cards = pending.map(entry => renderCard(entry)).join('\n');

  // Check for approved entries in the full queue (not just pending)
  const fullQueue = loadState<AutopostEntry[]>('autopost-queue', []);
  const hasApproved = fullQueue.some(e => e.status === 'approved');

  // Build status banner based on generate state or query param
  let statusBanner = '';
  const qsStatus = query?.get('status');
  if (generateStatus === 'running' || qsStatus === 'generating') {
    statusBanner = `<div id="gen-banner" style="background:#1f6feb22;border:1px solid #1f6feb;border-radius:8px;padding:12px 16px;margin-bottom:16px;color:#58a6ff;font-size:14px;display:flex;align-items:center;gap:8px">
      <span style="display:inline-block;width:14px;height:14px;border:2px solid #58a6ff;border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite"></span>
      Generating new post... This takes 15-60 seconds.
    </div>
    <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
    <script>
    (function poll() {
      setTimeout(function() {
        fetch(window.location.pathname, { method: 'POST', headers: {'Content-Type':'application/x-www-form-urlencoded'}, body: 'action=check-status' })
          .then(function(r) { return r.json(); })
          .then(function(d) {
            if (d.status === 'done' || d.status === 'error') { window.location.href = window.location.pathname; }
            else { poll(); }
          })
          .catch(function() { poll(); });
      }, 3000);
    })();
    </script>`;
  } else if (generateStatus === 'done') {
    // Don't escape — message may contain <a> links (e.g., "Increase limit in Settings →")
    statusBanner = `<div style="background:#23863622;border:1px solid #238636;border-radius:8px;padding:12px 16px;margin-bottom:16px;color:#3fb950;font-size:14px">
      ${generateMessage || 'Post generated successfully.'}
    </div>`;
    generateStatus = 'idle';
    generateMessage = '';
  } else if (generateStatus === 'error') {
    statusBanner = `<div style="background:#da363322;border:1px solid #da3633;border-radius:8px;padding:12px 16px;margin-bottom:16px;color:#f85149;font-size:14px">
      ${generateMessage || 'Unknown error.'}
    </div>`;
    generateStatus = 'idle';
    generateMessage = '';
  }

  return `
  <style>
    .summary-bar {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 16px 20px;
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      margin-bottom: 24px;
      flex-wrap: wrap;
    }
    .summary-stat { font-size: 14px; color: #8b949e; }
    .summary-stat strong { color: #c9d1d9; font-size: 18px; }
    .summary-spacer { flex: 1; }
    .review-card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 16px;
    }
    .card-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;
      flex-wrap: wrap;
    }
    .card-meta {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 13px;
      color: #8b949e;
      margin-bottom: 12px;
    }
    .card-content {
      background: #0d1117;
      border: 1px solid #21262d;
      border-radius: 6px;
      padding: 14px;
      font-size: 14px;
      white-space: pre-wrap;
      word-wrap: break-word;
      margin-bottom: 14px;
      line-height: 1.6;
    }
    .thread-tweet {
      background: #0d1117;
      border: 1px solid #21262d;
      border-radius: 6px;
      padding: 12px;
      margin-bottom: 8px;
      font-size: 14px;
      white-space: pre-wrap;
      word-wrap: break-word;
      line-height: 1.6;
    }
    .thread-num { color: #58a6ff; font-weight: 600; font-size: 12px; margin-bottom: 4px; }
    .quote-link { display: inline-block; color: #58a6ff; font-size: 13px; margin-bottom: 12px; text-decoration: none; }
    .quote-link:hover { text-decoration: underline; }
    .risk-row { display: flex; gap: 6px; margin-bottom: 12px; flex-wrap: wrap; }
    .review-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .btn-approve { background: #3fb950; color: #0d1117; border: none; }
    .btn-reject { background: #f85149; color: #fff; border: none; }
    .btn-edit { background: #58a6ff; color: #0d1117; border: none; }
    .btn-defer { background: #30363d; color: #c9d1d9; border: none; }
    .btn-publish { background: #58a6ff; color: #0d1117; border: none; }
    .btn-cancel { background: #21262d; color: #c9d1d9; border: none; }
    .btn-save { background: #3fb950; color: #0d1117; border: none; }
    .edit-area {
      display: none;
      margin-top: 12px;
      padding: 14px;
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 6px;
    }
    .edit-area textarea {
      width: 100%;
      background: #161b22;
      color: #c9d1d9;
      border: 1px solid #30363d;
      border-radius: 4px;
      padding: 10px;
      font-size: 14px;
      line-height: 1.6;
      margin-bottom: 10px;
    }
    .reject-area input { width: 220px; margin-right: 6px; }
    .reject-area input:focus { border-color: #f85149; }
  </style>

  ${statusBanner}

  <div class="summary-bar">
    <div class="summary-stat"><strong>${pending.length}</strong> pending post${pending.length !== 1 ? 's' : ''}</div>
    <div class="summary-stat">Approval streak: <strong>${streakCount}</strong>/20</div>
    <form method="POST" style="display:flex;gap:6px;align-items:center;margin-left:16px;">
      <input type="hidden" name="action" value="generate" />
      <select name="category" style="background:#0d1117;color:#c9d1d9;border:1px solid #30363d;border-radius:6px;padding:4px 8px;font-size:13px;"${generateStatus === 'running' ? ' disabled' : ''}>
        <option value="">Any category</option>
        <option value="news_commentary">News</option>
        <option value="product_tips">Tips</option>
        <option value="industry_insights">Insights</option>
        <option value="engagement">Engagement</option>
        <option value="curated_reshares">Quote-tweet</option>
        <option value="milestones">Milestone</option>
      </select>
      <button type="submit" class="btn" style="background:${generateStatus === 'running' ? '#30363d' : '#238636'};white-space:nowrap;"${generateStatus === 'running' ? ' disabled' : ''}>${generateStatus === 'running' ? 'Generating...' : 'Generate'}</button>
    </form>
    <div class="summary-spacer"></div>
    ${hasApproved ? `
    <form method="POST" style="margin:0">
      <input type="hidden" name="action" value="publish-all">
      <button type="submit" class="btn btn-publish">Publish All Approved</button>
    </form>` : ''}
  </div>

  ${pending.length === 0 ? `
  <div class="empty-state">
    <h3>No pending posts</h3>
    <p>All caught up. New drafts will appear here when autopost generates them.</p>
  </div>` : cards}

  <script>
    function showEdit(id) {
      document.getElementById('edit-' + id).style.display = 'block';
    }

    function hideEdit(id) {
      document.getElementById('edit-' + id).style.display = 'none';
    }

    function submitEdit(id) {
      var textarea = document.querySelector('#edit-' + id + ' textarea');
      var form = document.createElement('form');
      form.method = 'POST';
      form.style.display = 'none';

      var actionInput = document.createElement('input');
      actionInput.name = 'action';
      actionInput.value = 'edit';
      form.appendChild(actionInput);

      var idInput = document.createElement('input');
      idInput.name = 'id';
      idInput.value = id;
      form.appendChild(idInput);

      var contentInput = document.createElement('input');
      contentInput.name = 'content';
      contentInput.value = textarea.value;
      form.appendChild(contentInput);

      document.body.appendChild(form);
      form.submit();
    }

    function showReject(id) {
      document.getElementById('reject-' + id).style.display = 'inline-flex';
    }

    function submitReject(id) {
      var reasonInput = document.querySelector('#reject-' + id + ' input');
      var form = document.createElement('form');
      form.method = 'POST';
      form.style.display = 'none';

      var actionInput = document.createElement('input');
      actionInput.name = 'action';
      actionInput.value = 'reject';
      form.appendChild(actionInput);

      var idInput = document.createElement('input');
      idInput.name = 'id';
      idInput.value = id;
      form.appendChild(idInput);

      var reasonField = document.createElement('input');
      reasonField.name = 'reason';
      reasonField.value = reasonInput ? reasonInput.value : '';
      form.appendChild(reasonField);

      document.body.appendChild(form);
      form.submit();
    }
  </script>`;
}

// ─── Card Renderer ──────────────────────────────────────────────────────────

function renderCard(entry: AutopostEntry): string {
  const contentHtml = entry.isThread && entry.threadTweets?.length
    ? renderThread(entry.threadTweets)
    : `<div class="card-content">${esc(entry.content)}</div>`;

  const quoteHtml = entry.quoteTweetUrl
    ? `<a class="quote-link" href="${esc(entry.quoteTweetUrl)}" target="_blank" rel="noopener">Quoting: ${esc(entry.quoteTweetUrl)}</a>`
    : '';

  const riskHtml = entry.riskFlags.length
    ? `<div class="risk-row">${riskBadges(entry.riskFlags)}</div>`
    : '';

  const editContent = entry.isThread && entry.threadTweets?.length
    ? entry.threadTweets.map((t, i) => `${i + 1}/ ${t}`).join('\n\n')
    : entry.content;

  return `<div class="review-card">
  <div class="card-header">
    ${categoryBadge(entry.category)}
    ${formatBadge(entry.format)}
    ${entry.isThread ? formatBadge('thread') : ''}
    ${voiceScoreBadge(entry.voiceScore)}
  </div>
  <div class="card-meta">
    <span>${esc(entry.platform)}</span>
    <span>${esc(relativeTime(entry.createdAt))}</span>
  </div>
  ${riskHtml}
  ${quoteHtml}
  ${contentHtml}
  <div class="review-actions">
    <form method="POST" style="margin:0;display:inline">
      <input type="hidden" name="action" value="approve">
      <input type="hidden" name="id" value="${esc(entry.id)}">
      <button type="submit" class="btn btn-approve">Approve</button>
    </form>
    <button type="button" class="btn btn-edit" onclick="showEdit('${esc(entry.id)}')">Edit</button>
    <button type="button" class="btn btn-reject" onclick="showReject('${esc(entry.id)}')">Reject</button>
    <form method="POST" style="margin:0;display:inline">
      <input type="hidden" name="action" value="defer">
      <input type="hidden" name="id" value="${esc(entry.id)}">
      <button type="submit" class="btn btn-defer">Defer 6h</button>
    </form>
  </div>
  <div id="reject-${esc(entry.id)}" class="reject-area" style="display:none;align-items:center;gap:6px;margin-top:8px">
    <input type="text" placeholder="Reason (optional)">
    <button type="button" class="btn btn-reject" onclick="submitReject('${esc(entry.id)}')">Confirm Reject</button>
    <button type="button" class="btn btn-cancel" onclick="this.parentElement.style.display='none'">Cancel</button>
  </div>
  <div id="edit-${esc(entry.id)}" class="edit-area">
    <textarea rows="${Math.max(4, editContent.split('\n').length + 1)}">${esc(editContent)}</textarea>
    <div style="display:flex;gap:8px">
      <button type="button" class="btn btn-save" onclick="submitEdit('${esc(entry.id)}')">Save &amp; Approve</button>
      <button type="button" class="btn btn-cancel" onclick="hideEdit('${esc(entry.id)}')">Cancel</button>
    </div>
  </div>
</div>`;
}

function renderThread(tweets: string[]): string {
  return `<div style="margin-bottom:14px">${tweets.map((tweet, i) =>
    `<div class="thread-tweet">
      <div class="thread-num">Tweet ${i + 1}/${tweets.length}</div>
      ${esc(tweet)}
    </div>`
  ).join('\n')}</div>`;
}

// ─── Action Handler ─────────────────────────────────────────────────────────

export async function handlePost(
  action: string,
  body: Record<string, string>,
): Promise<{ redirect?: string; json?: unknown }> {
  switch (action) {
    case 'approve': {
      const id = body.id;
      if (!id) return { redirect: '/queue?tab=feed' };
      const entry = getAutopostQueue().find(e => e.id === id);
      if (entry) {
        recordDecision('approve', {
          voiceScore: entry.voiceScore,
          category: entry.category,
          format: entry.format,
        });
      }
      approveAutopost(id);
      await publishApproved({ force: true });
      return { redirect: '/queue?tab=feed' };
    }

    case 'reject': {
      const id = body.id;
      if (!id) return { redirect: '/queue?tab=feed' };
      const entry = getAutopostQueue().find(e => e.id === id);
      if (entry) {
        recordDecision('reject', {
          voiceScore: entry.voiceScore,
          category: entry.category,
          format: entry.format,
        });
      }
      const reason = body.reason || undefined;
      rejectAutopost(id, reason);
      return { redirect: '/queue?tab=feed' };
    }

    case 'edit': {
      const id = body.id;
      const content = body.content;
      if (!id || content === undefined) return { redirect: '/queue?tab=feed' };
      const entry = getAutopostQueue().find(e => e.id === id);
      if (entry) {
        recordDecision('edit', {
          voiceScore: entry.voiceScore,
          category: entry.category,
          format: entry.format,
        });
      }
      editAutopost(id, content);
      approveAutopost(id);
      await publishApproved({ force: true });
      return { redirect: '/queue?tab=feed' };
    }

    case 'defer': {
      const id = body.id;
      if (!id) return { redirect: '/queue?tab=feed' };
      const queue = loadState<AutopostEntry[]>('autopost-queue', []);
      const entry = queue.find(e => e.id === id);
      if (entry) {
        entry.deferredUntil = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
        saveState('autopost-queue', queue);
      }
      return { redirect: '/queue?tab=feed' };
    }

    case 'publish-all': {
      await publishApproved({ force: true });
      return { redirect: '/queue?tab=feed' };
    }

    case 'check-status': {
      return { json: { status: generateStatus, message: generateMessage } };
    }

    case 'generate': {
      if (generateStatus === 'running') {
        return { redirect: '/queue?tab=feed&status=generating' };
      }
      const category = body.category || undefined;
      generateStatus = 'running';
      generateMessage = '';
      // Fire-and-forget — don't block the HTTP response
      runAutopost({ force: true, category })
        .then((r) => {
          generateStatus = 'done';
          if (r.queued > 0) {
            generateMessage = `Post generated and queued for review (${r.category} on ${r.platform}).`;
          } else if (r.published > 0) {
            generateMessage = `Post generated and auto-published (${r.category} on ${r.platform}).`;
          } else if (r.generated === 0) {
            if (r.reason?.startsWith('limit_')) {
              const [, used, max] = r.reason.split('_');
              generateMessage = `Daily post limit reached (${used}/${max} today). <a href="/settings" style="color:#58a6ff;">Increase limit in Settings →</a>`;
            } else if (r.reason?.startsWith('paused_')) {
              const mins = r.reason.split('_')[1];
              generateMessage = `Autopost is paused (${mins} minutes remaining). <a href="/settings" style="color:#58a6ff;">Manage in Settings →</a>`;
            } else {
              generateMessage = 'No post generated — LLM may be unavailable. Check your API key in <a href="/settings" style="color:#58a6ff;">Settings</a>.';
            }
          } else {
            generateMessage = `Generated ${r.generated} candidate(s) but none passed quality checks. Try again.`;
          }
        })
        .catch((err) => {
          generateStatus = 'error';
          generateMessage = err instanceof Error ? err.message : String(err);
          console.error('Generate error:', err);
        });
      return { redirect: '/queue?tab=feed&status=generating' };
    }

    default:
      return { redirect: '/queue?tab=feed' };
  }
}
