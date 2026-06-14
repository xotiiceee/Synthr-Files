/**
 * Autopilot page — central automation hub for Pulse.
 *
 * All automation settings live here: mode selector, schedule, content
 * categories, content rules, publishing, engagement, safety, anti-detection.
 * Sections that require an X API key are locked when no key is configured.
 */

import { getConfig, saveConfig } from '../../core/persona.js';

// ─── HTML Escaping ──────────────────────────────────────────────────────────

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function checked(val: unknown): string {
  return val ? 'checked' : '';
}

function selected(current: unknown, value: string): string {
  return String(current) === value ? 'selected' : '';
}

function tip(text: string): string {
  return `<span class="info-tip" role="img" aria-label="Help"><span class="info-icon">?</span><span class="tip-text">${esc(text)}</span></span>`;
}

// ─── X API key detection ────────────────────────────────────────────────────

function hasXApiKeys(): boolean {
  const config = getConfig();
  // Check env vars and config-level keys
  if (process.env.X_API_KEY || process.env.TWITTER_API_KEY) return true;
  if (process.env.X_API_SECRET || process.env.TWITTER_API_SECRET) return true;
  // Check platforms config
  const xPlatform = config.platforms?.x || config.platforms?.twitter;
  if (xPlatform?.enabled) return true;
  return false;
}

// ─── Resolve current autopilot mode ─────────────────────────────────────────

type AutopilotMode = 'off' | 'semi' | 'full';

function resolveMode(config: ReturnType<typeof getConfig>): AutopilotMode {
  const ap = config.autopilot;
  if (!ap?.enabled) return 'off';
  const autopost = config.autopost;
  if (autopost?.approvalMode === 'auto_all') return 'full';
  return 'semi';
}

// ─── Page CSS ───────────────────────────────────────────────────────────────

function autopilotCss(): string {
  return `
    .info-tip {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: transparent;
      border: 1.5px solid #6e7681;
      color: #6e7681;
      cursor: help;
      margin-left: 5px;
      position: relative;
      vertical-align: middle;
      flex-shrink: 0;
      transition: all 0.15s ease;
    }
    .info-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: 700;
      line-height: 1;
      width: 100%;
      height: 100%;
    }
    .info-tip:hover { background: #58a6ff; border-color: #58a6ff; color: #fff; }
    .info-tip .tip-text {
      display: none;
      position: absolute;
      bottom: calc(100% + 6px);
      left: 50%;
      transform: translateX(-50%);
      background: #1c2128;
      border: 1px solid #444c56;
      color: #c9d1d9;
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 400;
      white-space: normal;
      width: 220px;
      line-height: 1.4;
      z-index: 100;
      text-transform: none;
      letter-spacing: normal;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    }
    .info-tip .tip-text::after {
      content: '';
      position: absolute;
      top: 100%;
      left: 50%;
      transform: translateX(-50%);
      border: 5px solid transparent;
      border-top-color: #444c56;
    }
    .info-tip:hover .tip-text { display: block; }

    .settings-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-bottom: 24px;
    }

    @media (max-width: 900px) {
      .settings-grid { grid-template-columns: 1fr; }
    }

    .settings-card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 20px;
    }

    .settings-card.full-width {
      grid-column: 1 / -1;
    }

    .settings-card h2 {
      font-size: 0.95rem;
      font-weight: 600;
      color: #58a6ff;
      margin-bottom: 16px;
      padding-bottom: 8px;
      border-bottom: 1px solid #21262d;
    }

    .settings-card.locked {
      opacity: 0.5;
      pointer-events: none;
      position: relative;
    }

    .settings-card.disabled {
      opacity: 0.4;
      pointer-events: none;
    }

    .lock-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: #30363d;
      color: #8b949e;
      padding: 4px 10px;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 500;
      margin-left: 8px;
    }

    .form-field {
      margin-bottom: 16px;
    }

    .form-field label {
      display: block;
      color: #8b949e;
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      margin-bottom: 6px;
    }

    .form-field input[type="text"],
    .form-field input[type="number"],
    .form-field select,
    .form-field textarea {
      width: 100%;
      background: #0d1117;
      color: #e6edf3;
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 8px 12px;
      font-size: 0.85rem;
      font-family: inherit;
      outline: none;
      box-sizing: border-box;
    }

    .form-field input:focus,
    .form-field select:focus,
    .form-field textarea:focus {
      border-color: #58a6ff;
    }

    .form-field textarea {
      resize: vertical;
      min-height: 80px;
    }

    .form-field input[type="range"] {
      width: 100%;
      accent-color: #58a6ff;
    }

    .range-row {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .range-row input[type="range"] { flex: 1; }

    .range-val {
      color: #58a6ff;
      font-size: 0.85rem;
      font-weight: 600;
      min-width: 42px;
      text-align: right;
    }

    .toggle-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 0;
      border-bottom: 1px solid #21262d;
    }

    .toggle-row:last-child { border-bottom: none; }

    .toggle-label {
      color: #e6edf3;
      font-size: 0.85rem;
    }

    .toggle-switch {
      position: relative;
      width: 44px;
      height: 24px;
      flex-shrink: 0;
    }

    .toggle-switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }

    .toggle-slider {
      position: absolute;
      inset: 0;
      background: #21262d;
      border-radius: 12px;
      cursor: pointer;
      transition: background 0.2s;
    }

    .toggle-slider::before {
      content: '';
      position: absolute;
      width: 18px;
      height: 18px;
      left: 3px;
      top: 3px;
      background: #8b949e;
      border-radius: 50%;
      transition: transform 0.2s, background 0.2s;
    }

    .toggle-switch input:checked + .toggle-slider {
      background: #238636;
    }

    .toggle-switch input:checked + .toggle-slider::before {
      transform: translateX(20px);
      background: #fff;
    }

    .category-item {
      background: #0d1117;
      border: 1px solid #21262d;
      border-radius: 6px;
      padding: 12px;
      margin-bottom: 10px;
    }

    .category-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }

    .category-name {
      color: #e6edf3;
      font-size: 0.85rem;
      font-weight: 600;
    }

    /* ── Mode Selector (segmented control) ── */

    .mode-selector {
      display: flex;
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 8px;
      overflow: hidden;
      margin-bottom: 24px;
    }

    .mode-option {
      flex: 1;
      text-align: center;
    }

    .mode-option input[type="radio"] {
      display: none;
    }

    .mode-option label {
      display: block;
      padding: 14px 16px;
      cursor: pointer;
      color: #8b949e;
      font-size: 0.9rem;
      font-weight: 500;
      transition: background 0.15s, color 0.15s;
      border-right: 1px solid #30363d;
    }

    .mode-option:last-child label {
      border-right: none;
    }

    .mode-option label:hover {
      background: #161b22;
      color: #e6edf3;
    }

    .mode-option input[type="radio"]:checked + label {
      background: #238636;
      color: #fff;
      font-weight: 600;
    }

    .mode-option input[type="radio"][value="off"]:checked + label {
      background: #484f58;
    }

    .mode-option input[type="radio"][value="semi"]:checked + label {
      background: #9e6a03;
    }

    .mode-desc {
      color: #8b949e;
      font-size: 0.72rem;
      margin-top: 2px;
    }

    /* ── Save bar ── */

    .save-bar {
      position: sticky;
      bottom: 0;
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 16px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 24px;
      z-index: 50;
    }

    .save-bar .save-hint {
      color: #8b949e;
      font-size: 0.82rem;
    }

    .btn-save {
      background: #238636;
      color: #fff;
      border: 1px solid #238636;
      border-radius: 6px;
      padding: 10px 28px;
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s;
    }

    .btn-save:hover { background: #2ea043; }

    .success-banner {
      background: #238636;
      color: #fff;
      padding: 10px 16px;
      border-radius: 6px;
      margin-bottom: 16px;
      font-size: 0.85rem;
    }

    .inline-fields {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }

    @media (max-width: 600px) {
      .inline-fields { grid-template-columns: 1fr; }
    }

    .limits-grid {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 12px;
    }

    @media (max-width: 700px) {
      .limits-grid { grid-template-columns: 1fr 1fr; }
    }
  `;
}

// ─── Category definitions ───────────────────────────────────────────────────

const CATEGORIES = [
  { key: 'news_commentary', label: 'News Commentary', desc: 'React to trending industry news with hot takes and analysis' },
  { key: 'product_tips', label: 'Product Tips', desc: 'Share tips, tutorials, and how-tos for your product' },
  { key: 'industry_insights', label: 'Industry Insights', desc: 'Deep dives, data analysis, and thought leadership' },
  { key: 'engagement', label: 'Engagement', desc: 'Polls, questions, and conversation starters' },
  { key: 'curated_reshares', label: 'Curated Reshares', desc: 'Quote-tweet or reshare relevant content with commentary' },
  { key: 'milestones', label: 'Milestones', desc: 'Celebrate achievements, launches, and community wins' },
] as const;

// ─── Tone options ───────────────────────────────────────────────────────────

const TONES = [
  { value: 'professional', label: 'Professional' },
  { value: 'casual', label: 'Casual' },
  { value: 'witty', label: 'Witty' },
  { value: 'technical', label: 'Technical' },
  { value: 'friendly', label: 'Friendly' },
  { value: 'authoritative', label: 'Authoritative' },
] as const;

// ─── Hour options for schedule ──────────────────────────────────────────────

function hourOptions(selectedHour: number): string {
  let html = '';
  for (let h = 6; h <= 23; h++) {
    const label = h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`;
    const sel = h === selectedHour ? ' selected' : '';
    html += `<option value="${h}"${sel}>${label}</option>`;
  }
  return html;
}

// ─── Render ─────────────────────────────────────────────────────────────────

export async function renderPage(query?: URLSearchParams): Promise<string> {
  const config = getConfig();
  const mode = resolveMode(config);
  const xKeys = hasXApiKeys();
  const isOff = mode === 'off';
  const isSemi = mode === 'semi';

  // Aliases for readability
  const ap = config.autopilot;
  const autopost = config.autopost;
  const safety = autopost?.safety;
  const limits = autopost?.limits;
  const categories = autopost?.categories || {};
  const hb = config.humanBehavior;
  const antiDetection = hb?.antiDetection;
  const timing = hb?.timing;
  const engagement = hb?.engagement;

  // Schedule defaults
  const postsPerDay = limits?.profilePostsPerDay ?? 3;
  const activeStart = ap?.activeHours?.start || '09:00';
  const activeEnd = ap?.activeHours?.end || '22:00';
  const startHour = parseInt(activeStart.split(':')[0], 10) || 9;
  const endHour = parseInt(activeEnd.split(':')[0], 10) || 22;
  const timezone = timing?.timezone || 'UTC';

  // Content rules defaults
  const tone = config.persona?.tone || 'professional';
  const neverSay = (config.persona?.neverSay || []).join(', ');
  const requireFactCheck = safety?.requireFactCheck ?? true;
  const maxThreadLength = safety?.maxThreadLength ?? 4;

  // Publishing defaults
  const approvalMode = autopost?.approvalMode || 'review_all';
  const autoPublish = autopost?.approvalMode === 'auto_all';
  const autoReply = hb?.mentions?.enabled ?? false;

  // Engagement defaults
  const engagementEnabled = engagement?.enabled ?? false;
  const likeRate = engagement?.likeRate ?? 0.3;
  const mentionsEnabled = hb?.mentions?.enabled ?? false;

  // Follow/growth defaults
  const followCfg = config.autoFollow ?? {} as any;
  const followEnabled = followCfg.enabled ?? false;
  const followDailyCap = followCfg.dailyCap ?? 15;
  const followMinConfidence = followCfg.minConfidence ?? 70;
  const followMinFollowers = followCfg.minFollowerCount ?? 50;
  const followAutoUnfollowDays = followCfg.autoUnfollowDays ?? 14;
  const followSignalRepost = followCfg.signals?.repost ?? true;
  const followSignalReply = followCfg.signals?.reply ?? true;
  const followSignalTag = followCfg.signals?.tag ?? true;
  const followSignalMention = followCfg.signals?.mention_positive ?? true;
  const kolList = (followCfg.kols || []).join('\n');

  // Safety defaults
  const bannedTopics = (safety?.bannedTopics || []).join('\n');
  const bannedWords = (safety?.bannedWords || []).join('\n');
  const coolDownEnabled = safety?.coolDownOnNegative?.enabled ?? false;
  const coolDownThreshold = safety?.coolDownOnNegative?.thresholdRatio ?? 0.3;
  const coolDownPauseHours = safety?.coolDownOnNegative?.pauseHours ?? 4;
  const dailyPosts = limits?.profilePostsPerDay ?? 3;
  const dailyReplies = limits?.repliesPerDay ?? 10;
  const dailyReposts = limits?.repostsPerDay ?? 5;
  const dailyLikes = limits?.likesPerDay ?? 20;
  const dailyQuotes = limits?.quoteTweetsPerDay ?? 3;

  // Anti-detection defaults
  const adEnabled = antiDetection?.enabled ?? true;
  const minGap = antiDetection?.minPostGapMinutes ?? 15;
  const maxGap = antiDetection?.maxPostGapMinutes ?? 120;
  const silentDayChance = timing?.silentDayChance ?? 0.05;

  // CSS classes — gray out when Off, lock sections that REQUIRE X API keys.
  const disabledClass = isOff ? ' disabled' : '';
  const publishLockClass = !xKeys ? ' locked' : disabledClass;
  const engageLockClass = !xKeys ? ' locked' : disabledClass;

  // Lock badge HTML
  const lockBadge = `<span class="lock-badge">&#128274; Connect X API to unlock</span>`;

  const successMsg = query?.get('saved') === '1'
    ? '<div class="success-banner">Autopilot settings saved.</div>'
    : '';

  return `
<style>${autopilotCss()}</style>

${successMsg}

<form method="POST" action="/autopilot">
<input type="hidden" name="action" value="save-autopilot">

<!-- ── Mode Selector ── -->
<div class="settings-card full-width" style="margin-bottom:20px;">
  <h2>Autopilot Mode ${tip('Off = manual only. Semi-Auto = generates content on schedule, you review before publishing. Full Auto = generates + publishes automatically.')}</h2>
  <div class="mode-selector">
    <div class="mode-option">
      <input type="radio" name="mode" id="mode-off" value="off" ${mode === 'off' ? 'checked' : ''}>
      <label for="mode-off">
        <strong>Off</strong>
        <div class="mode-desc">Manual only</div>
      </label>
    </div>
    <div class="mode-option">
      <input type="radio" name="mode" id="mode-semi" value="semi" ${mode === 'semi' ? 'checked' : ''}>
      <label for="mode-semi">
        <strong>Semi-Auto</strong>
        <div class="mode-desc">Generate, you review</div>
      </label>
    </div>
    <div class="mode-option">
      <input type="radio" name="mode" id="mode-full" value="full" ${mode === 'full' ? 'checked' : ''}>
      <label for="mode-full">
        <strong>Full Auto</strong>
        <div class="mode-desc">Generate + publish</div>
      </label>
    </div>
  </div>
</div>

<div class="settings-grid">

  <!-- ── Schedule ── -->
  <div class="settings-card${disabledClass}">
    <h2>Schedule ${tip('How many posts per day and during which hours.')}</h2>
    <div class="form-field">
      <label>Posts per day</label>
      <input type="number" name="postsPerDay" value="${postsPerDay}" min="1" max="50">
    </div>
    <div class="inline-fields">
      <div class="form-field">
        <label>Active hours start</label>
        <select name="activeStartHour">
          ${hourOptions(startHour)}
        </select>
      </div>
      <div class="form-field">
        <label>Active hours end</label>
        <select name="activeEndHour">
          ${hourOptions(endHour)}
        </select>
      </div>
    </div>
    <div class="form-field">
      <label>Timezone ${tip('IANA timezone string, e.g. America/New_York')}</label>
      <input type="text" name="timezone" value="${esc(timezone)}" placeholder="UTC">
    </div>
  </div>

  <!-- ── Content Rules ── -->
  <div class="settings-card${disabledClass}">
    <h2>Content Rules ${tip('Control the tone, style, and guardrails for generated content.')}</h2>
    <div class="form-field">
      <label>Tone</label>
      <select name="tone">
        ${TONES.map(t => `<option value="${t.value}" ${selected(tone, t.value)}>${t.label}</option>`).join('')}
      </select>
    </div>
    <div class="form-field">
      <label>Never say ${tip('Comma-separated words or phrases the AI should never use.')}</label>
      <textarea name="neverSay" rows="3" placeholder="e.g., game-changer, synergy, disrupt">${esc(neverSay)}</textarea>
    </div>
    <div class="toggle-row">
      <span class="toggle-label">Require fact-check ${tip('AI will verify claims before including them in posts.')}</span>
      <label class="toggle-switch">
        <input type="checkbox" name="requireFactCheck" value="1" ${checked(requireFactCheck)}>
        <span class="toggle-slider"></span>
      </label>
    </div>
    <div class="form-field" style="margin-top:12px;">
      <label>Max thread length</label>
      <input type="number" name="maxThreadLength" value="${maxThreadLength}" min="1" max="25">
    </div>
  </div>

  <!-- ── Content Categories ── -->
  <div class="settings-card full-width${disabledClass}">
    <h2>Content Categories ${tip('Enable or disable content types and adjust their relative weight. Higher weight = more posts of that type.')}</h2>
    ${CATEGORIES.map(cat => {
      const catConfig = categories[cat.key] || {};
      const enabled = catConfig.enabled !== false;
      const weight = catConfig.weight ?? 1;
      return `
    <div class="category-item">
      <div class="category-header">
        <div>
          <span class="category-name">${cat.label}</span>
          <span style="color:#8b949e;font-size:0.75rem;margin-left:8px;">${cat.desc}</span>
        </div>
        <label class="toggle-switch">
          <input type="checkbox" name="cat_${cat.key}_enabled" value="1" ${checked(enabled)}>
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div class="range-row">
        <span style="color:#8b949e;font-size:0.78rem;min-width:50px;">Weight</span>
        <input type="range" name="cat_${cat.key}_weight" min="0" max="5" step="0.5" value="${weight}"
          oninput="this.nextElementSibling.textContent=this.value">
        <span class="range-val">${weight}</span>
      </div>
    </div>`;
    }).join('')}
  </div>

  <!-- ── Publishing (locked without X API) ── -->
  <div class="settings-card${!xKeys ? ' locked' : disabledClass}">
    <h2>Publishing ${!xKeys ? lockBadge : ''} ${tip('Controls whether posts are auto-published or held for review.')}</h2>
    <div class="toggle-row">
      <span class="toggle-label">Auto-publish posts</span>
      <label class="toggle-switch">
        <input type="checkbox" name="autoPublish" value="1" ${checked(autoPublish)}>
        <span class="toggle-slider"></span>
      </label>
    </div>
    <div class="toggle-row">
      <span class="toggle-label">Auto-reply to mentions</span>
      <label class="toggle-switch">
        <input type="checkbox" name="autoReply" value="1" ${checked(autoReply)}>
        <span class="toggle-slider"></span>
      </label>
    </div>
    <div class="form-field" style="margin-top:12px;">
      <label>Approval mode ${tip('review_all = every post needs approval. review_risky = only flagged posts. auto_all = full autopilot.')}</label>
      <select name="approvalMode">
        <option value="review_all" ${selected(approvalMode, 'review_all')}>Review All</option>
        <option value="review_risky" ${selected(approvalMode, 'review_risky')}>Review Risky Only</option>
        <option value="auto_all" ${selected(approvalMode, 'auto_all')}>Auto All</option>
      </select>
    </div>
  </div>

  <!-- ── Engagement (locked without X API) ── -->
  <div class="settings-card${!xKeys ? ' locked' : disabledClass}">
    <h2>Engagement ${!xKeys ? lockBadge : ''} ${tip('Auto-engage with other accounts to grow your audience.')}</h2>
    <div class="toggle-row">
      <span class="toggle-label">Auto-like relevant posts</span>
      <label class="toggle-switch">
        <input type="checkbox" name="autoLike" value="1" ${checked(engagementEnabled)}>
        <span class="toggle-slider"></span>
      </label>
    </div>
    <div class="form-field" style="margin-top:12px;">
      <label>Like rate ${tip('Probability (0-1) of liking a relevant post. 0.3 = 30% of opportunities.')}</label>
      <div class="range-row">
        <input type="range" name="likeRate" min="0" max="1" step="0.05" value="${likeRate}"
          oninput="this.nextElementSibling.textContent=this.value">
        <span class="range-val">${likeRate}</span>
      </div>
    </div>
    <div class="toggle-row">
      <span class="toggle-label">Monitor mentions ${tip('Periodically check for @mentions and queue replies.')}</span>
      <label class="toggle-switch">
        <input type="checkbox" name="monitorMentions" value="1" ${checked(mentionsEnabled)}>
        <span class="toggle-slider"></span>
      </label>
    </div>
    <div class="form-field" style="margin-top:12px;">
      <label>Monitor keywords ${tip('Comma-separated keywords to track. Pulse will find posts mentioning these and suggest replies.')}</label>
      <textarea name="monitorKeywords" rows="3" placeholder="e.g., your brand name, product terms, competitor names">${esc((config.topics || []).map((t: any) => t.query || t).join('\n'))}</textarea>
    </div>
  </div>

  <!-- ── Growth & Follow ── -->
  <div class="settings-card full-width${!xKeys ? ' locked' : disabledClass}">
    <h2>Growth & Follow ${!xKeys ? lockBadge : ''} ${tip('Auto-follow users who engage with your content. Unfollow non-reciprocators after a cooldown period. KOLs are never unfollowed.')}</h2>
    <div class="toggle-row">
      <span class="toggle-label">Enable auto-follow ${tip('Follow users who repost, reply to, or tag you — based on engagement signals.')}</span>
      <label class="toggle-switch">
        <input type="checkbox" name="followEnabled" value="1" ${checked(followEnabled)}>
        <span class="toggle-slider"></span>
      </label>
    </div>

    <div class="settings-grid" style="margin-top:16px;">
      <div>
        <div class="form-field">
          <label>Daily follow cap ${tip('Max follows per day. Match this to the approved X API write capacity for this account.')}</label>
          <input type="number" name="followDailyCap" value="${followDailyCap}" min="1" max="50">
        </div>
        <div class="form-field">
          <label>Min confidence score ${tip('Only follow users whose engagement signal scores above this threshold (0-100).')}</label>
          <div class="range-row">
            <input type="range" name="followMinConfidence" min="0" max="100" step="5" value="${followMinConfidence}"
              oninput="this.nextElementSibling.textContent=this.value+'%'">
            <span class="range-val">${followMinConfidence}%</span>
          </div>
        </div>
        <div class="form-field">
          <label>Min follower count ${tip('Skip accounts with fewer followers than this — filters out bots and empty accounts.')}</label>
          <input type="number" name="followMinFollowers" value="${followMinFollowers}" min="0" max="10000">
        </div>
      </div>
      <div>
        <div class="form-field">
          <label>Auto-unfollow after (days) ${tip('Unfollow non-reciprocators after this many days. Set 0 to disable auto-unfollow.')}</label>
          <input type="number" name="followAutoUnfollowDays" value="${followAutoUnfollowDays}" min="0" max="90">
        </div>
        <div style="margin-bottom:16px">
          <label style="display:block;color:#8b949e;font-size:0.8rem;text-transform:uppercase;letter-spacing:0.03em;margin-bottom:10px;">Follow signals ${tip('Which engagement types trigger a follow.')}</label>
          <div class="toggle-row">
            <span class="toggle-label">Reposts your content</span>
            <label class="toggle-switch">
              <input type="checkbox" name="followSignalRepost" value="1" ${checked(followSignalRepost)}>
              <span class="toggle-slider"></span>
            </label>
          </div>
          <div class="toggle-row">
            <span class="toggle-label">Replies to your posts</span>
            <label class="toggle-switch">
              <input type="checkbox" name="followSignalReply" value="1" ${checked(followSignalReply)}>
              <span class="toggle-slider"></span>
            </label>
          </div>
          <div class="toggle-row">
            <span class="toggle-label">Tags you in a post</span>
            <label class="toggle-switch">
              <input type="checkbox" name="followSignalTag" value="1" ${checked(followSignalTag)}>
              <span class="toggle-slider"></span>
            </label>
          </div>
          <div class="toggle-row">
            <span class="toggle-label">Positive mentions</span>
            <label class="toggle-switch">
              <input type="checkbox" name="followSignalMention" value="1" ${checked(followSignalMention)}>
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>
      </div>
    </div>

    <div class="form-field">
      <label>KOL whitelist ${tip('One username per line (without @). These accounts will never be auto-unfollowed — use for key opinion leaders, partners, and VIPs.')}</label>
      <textarea name="kolList" rows="3" placeholder="elonmusk&#10;vlogsquad&#10;your_top_fan">${esc(kolList)}</textarea>
    </div>
  </div>

  <!-- ── Safety ── -->
  <div class="settings-card${disabledClass}">
    <h2>Safety ${tip('Guardrails to prevent unwanted content and limit activity.')}</h2>
    <div class="form-field">
      <label>Banned topics ${tip('One per line. Posts touching these topics will be blocked.')}</label>
      <textarea name="bannedTopics" rows="3" placeholder="politics&#10;religion&#10;nsfw">${esc(bannedTopics)}</textarea>
    </div>
    <div class="form-field">
      <label>Banned words ${tip('One per line. Posts containing these exact words will be blocked.')}</label>
      <textarea name="bannedWords" rows="3" placeholder="scam&#10;guaranteed returns">${esc(bannedWords)}</textarea>
    </div>
    <div class="toggle-row">
      <span class="toggle-label">Cool down on negative sentiment ${tip('Pause posting if a recent post gets disproportionately negative engagement.')}</span>
      <label class="toggle-switch">
        <input type="checkbox" name="coolDownEnabled" value="1" ${checked(coolDownEnabled)}>
        <span class="toggle-slider"></span>
      </label>
    </div>
    <div class="inline-fields" style="margin-top:12px;">
      <div class="form-field">
        <label>Negative threshold ratio</label>
        <input type="number" name="coolDownThreshold" value="${coolDownThreshold}" min="0" max="1" step="0.05">
      </div>
      <div class="form-field">
        <label>Pause hours</label>
        <input type="number" name="coolDownPauseHours" value="${coolDownPauseHours}" min="1" max="72">
      </div>
    </div>
  </div>

  <!-- ── Daily Limits ── -->
  <div class="settings-card${disabledClass}">
    <h2>Daily Limits ${tip('Maximum activity per day across all engagement types.')}</h2>
    <div class="limits-grid">
      <div class="form-field">
        <label>Posts</label>
        <input type="number" name="limitPosts" value="${dailyPosts}" min="0" max="100">
      </div>
      <div class="form-field">
        <label>Replies</label>
        <input type="number" name="limitReplies" value="${dailyReplies}" min="0" max="200">
      </div>
      <div class="form-field">
        <label>Reposts</label>
        <input type="number" name="limitReposts" value="${dailyReposts}" min="0" max="100">
      </div>
      <div class="form-field">
        <label>Likes</label>
        <input type="number" name="limitLikes" value="${dailyLikes}" min="0" max="500">
      </div>
      <div class="form-field">
        <label>Quote Tweets</label>
        <input type="number" name="limitQuotes" value="${dailyQuotes}" min="0" max="50">
      </div>
      <div class="form-field">
        <label>Follows</label>
        <input type="number" name="limitFollows" value="${followDailyCap}" min="0" max="50">
      </div>
    </div>
  </div>

  <!-- ── Anti-Detection ── -->
  <div class="settings-card full-width${disabledClass}">
    <h2>Anti-Detection ${tip('Humanize posting patterns to avoid looking automated.')}</h2>
    <div class="toggle-row">
      <span class="toggle-label">Timing variation ${tip('Randomize gaps between posts instead of posting at exact intervals.')}</span>
      <label class="toggle-switch">
        <input type="checkbox" name="adEnabled" value="1" ${checked(adEnabled)}>
        <span class="toggle-slider"></span>
      </label>
    </div>
    <div class="inline-fields" style="margin-top:12px;">
      <div class="form-field">
        <label>Min gap (minutes)</label>
        <input type="number" name="minGap" value="${minGap}" min="1" max="1440">
      </div>
      <div class="form-field">
        <label>Max gap (minutes)</label>
        <input type="number" name="maxGap" value="${maxGap}" min="1" max="1440">
      </div>
    </div>
    <div class="toggle-row" style="margin-top:8px;">
      <span class="toggle-label">Silent days ${tip('Occasionally skip a day entirely to mimic human inconsistency.')}</span>
      <label class="toggle-switch">
        <input type="checkbox" name="silentDays" value="1" ${checked((silentDayChance || 0) > 0)}>
        <span class="toggle-slider"></span>
      </label>
    </div>
    <div class="form-field" style="margin-top:12px;">
      <label>Silent day chance (%) ${tip('Probability of taking a day off. 5 = 5% chance each day.')}</label>
      <input type="number" name="silentDayChance" value="${Math.round((silentDayChance || 0) * 100)}" min="0" max="50">
    </div>
  </div>

</div>

<!-- ── Save Bar ── -->
<div class="save-bar" id="save-bar">
  <span class="save-hint" id="save-hint">Auto-saves when you make changes.</span>
  <button type="submit" class="btn-save" id="save-btn">Save Autopilot Settings</button>
</div>

</form>

<script>
(function() {
  var form = document.querySelector('form[action="/autopilot"]');
  var hint = document.getElementById('save-hint');
  var btn = document.getElementById('save-btn');
  if (!form || !hint || !btn) return;
  var saveTimer = null;
  var saving = false;

  function autoSave() {
    if (saving) return;
    saving = true;
    hint.textContent = 'Saving...';
    hint.style.color = '#58a6ff';
    var data = new FormData(form);
    data.set('action', 'save-autopilot');
    fetch('/autopilot', {
      method: 'POST',
      body: new URLSearchParams(data),
    }).then(function(r) {
      if (r.redirected || r.ok) {
        hint.textContent = 'Saved.';
        hint.style.color = '#3fb950';
        setTimeout(function() { hint.textContent = 'Auto-saves when you make changes.'; hint.style.color = '#8b949e'; }, 2000);
      } else {
        hint.textContent = 'Save failed.';
        hint.style.color = '#f85149';
      }
      saving = false;
    }).catch(function() {
      hint.textContent = 'Save failed.';
      hint.style.color = '#f85149';
      saving = false;
    });
  }

  form.addEventListener('input', function() {
    hint.textContent = 'Unsaved changes...';
    hint.style.color = '#d29922';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(autoSave, 1500);
  });

  form.addEventListener('change', function() {
    hint.textContent = 'Saving...';
    hint.style.color = '#58a6ff';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(autoSave, 500);
  });

  // ── Live mode switching — toggle disabled state on settings cards ──
  var modeRadios = form.querySelectorAll('input[name="mode"]');
  var settingsCards = form.querySelectorAll('.settings-grid .settings-card');

  function updateModeUI() {
    var selected = form.querySelector('input[name="mode"]:checked');
    var isOff = selected && selected.value === 'off';
    settingsCards.forEach(function(card) {
      // Don't touch cards that are locked (X API required)
      if (card.classList.contains('locked')) return;
      if (isOff) {
        card.classList.add('disabled');
      } else {
        card.classList.remove('disabled');
      }
    });
  }

  modeRadios.forEach(function(radio) {
    radio.addEventListener('change', updateModeUI);
  });
})();
</script>
`;
}

// ─── Action Handler ─────────────────────────────────────────────────────────

export async function handlePost(
  action: string,
  body: Record<string, string>,
): Promise<{ redirect?: string; json?: unknown }> {
  if (action !== 'save-autopilot') {
    return { redirect: '/autopilot' };
  }

  const config = getConfig();

  // ── Mode ──
  const mode = (body.mode || 'off') as AutopilotMode;

  // Ensure autopilot config exists
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

  config.autopilot.enabled = mode !== 'off';

  // Ensure autopost config exists
  if (!config.autopost) {
    config.autopost = {} as any;
  }

  // Set approval mode based on autopilot mode
  if (mode === 'full') {
    config.autopost!.approvalMode = 'auto_all';
  } else if (mode === 'semi') {
    // Preserve existing or default to review_all
    if (config.autopost!.approvalMode === 'auto_all') {
      config.autopost!.approvalMode = 'review_all';
    }
  }

  // ── Schedule ──
  const postsPerDay = parseInt(body.postsPerDay) || 3;
  const activeStartHour = parseInt(body.activeStartHour) || 9;
  const activeEndHour = parseInt(body.activeEndHour) || 22;
  const timezone = body.timezone?.trim() || 'UTC';

  config.autopilot.activeHours = {
    start: `${String(activeStartHour).padStart(2, '0')}:00`,
    end: `${String(activeEndHour).padStart(2, '0')}:00`,
  };

  if (!config.autopost!.limits) {
    config.autopost!.limits = {
      profilePostsPerDay: 3,
      repliesPerDay: 10,
      repostsPerDay: 5,
      likesPerDay: 20,
      quoteTweetsPerDay: 3,
    };
  }
  config.autopost!.limits!.profilePostsPerDay = postsPerDay;

  // Ensure humanBehavior exists
  if (!config.humanBehavior) {
    config.humanBehavior = {};
  }
  if (!config.humanBehavior.timing) {
    config.humanBehavior.timing = {};
  }
  config.humanBehavior.timing.timezone = timezone;

  // ── Content Rules ──
  const tone = body.tone as any;
  if (tone && config.persona) {
    config.persona.tone = tone;
  }

  const neverSay = (body.neverSay || '').split(',').map((s: string) => s.trim()).filter(Boolean);
  if (config.persona) {
    config.persona.neverSay = neverSay;
  }

  if (!config.autopost!.safety) {
    config.autopost!.safety = {};
  }
  config.autopost!.safety!.requireFactCheck = body.requireFactCheck === '1';
  config.autopost!.safety!.maxThreadLength = parseInt(body.maxThreadLength) || 4;

  // ── Content Categories ──
  if (!config.autopost!.categories) {
    config.autopost!.categories = {};
  }
  for (const cat of CATEGORIES) {
    if (!config.autopost!.categories![cat.key]) {
      config.autopost!.categories![cat.key] = {};
    }
    config.autopost!.categories![cat.key].enabled = body[`cat_${cat.key}_enabled`] === '1';
    config.autopost!.categories![cat.key].weight = parseFloat(body[`cat_${cat.key}_weight`]) || 1;
  }

  // ── Publishing ──
  if (body.approvalMode) {
    config.autopost!.approvalMode = body.approvalMode as any;
  }

  // Auto-reply (mentions)
  if (!config.humanBehavior.mentions) {
    config.humanBehavior.mentions = {};
  }
  config.humanBehavior.mentions.enabled = body.autoReply === '1';

  // ── Engagement ──
  if (!config.humanBehavior.engagement) {
    config.humanBehavior.engagement = {};
  }
  config.humanBehavior.engagement.enabled = body.autoLike === '1';
  config.humanBehavior.engagement.likeRate = parseFloat(body.likeRate) || 0.3;

  // Monitor mentions toggle
  config.humanBehavior.mentions.enabled = body.monitorMentions === '1' || body.autoReply === '1';

  // ── Growth & Follow ──
  if (!config.autoFollow) {
    config.autoFollow = {};
  }
  const af = config.autoFollow;
  af.enabled = body.followEnabled === '1';
  af.dailyCap = parseInt(body.followDailyCap) || parseInt(body.limitFollows) || 15;
  af.minConfidence = parseInt(body.followMinConfidence) || 70;
  af.minFollowerCount = parseInt(body.followMinFollowers) || 50;
  af.autoUnfollowDays = parseInt(body.followAutoUnfollowDays) || 14;
  if (!af.signals) {
    af.signals = {};
  }
  af.signals.repost = body.followSignalRepost === '1';
  af.signals.reply = body.followSignalReply === '1';
  af.signals.tag = body.followSignalTag === '1';
  af.signals.mention_positive = body.followSignalMention === '1';

  // KOL whitelist
  af.kols = (body.kolList || '').split('\n').map((s: string) => s.trim().replace(/^@/, '')).filter(Boolean);

  // ── Safety ──
  config.autopost!.safety!.bannedTopics = (body.bannedTopics || '').split('\n').map((s: string) => s.trim()).filter(Boolean);
  config.autopost!.safety!.bannedWords = (body.bannedWords || '').split('\n').map((s: string) => s.trim()).filter(Boolean);

  if (!config.autopost!.safety!.coolDownOnNegative) {
    config.autopost!.safety!.coolDownOnNegative = {};
  }
  config.autopost!.safety!.coolDownOnNegative!.enabled = body.coolDownEnabled === '1';
  config.autopost!.safety!.coolDownOnNegative!.thresholdRatio = parseFloat(body.coolDownThreshold) || 0.3;
  config.autopost!.safety!.coolDownOnNegative!.pauseHours = parseInt(body.coolDownPauseHours) || 4;

  // ── Daily Limits ──
  config.autopost!.limits!.profilePostsPerDay = parseInt(body.limitPosts) || 3;
  config.autopost!.limits!.repliesPerDay = parseInt(body.limitReplies) || 10;
  config.autopost!.limits!.repostsPerDay = parseInt(body.limitReposts) || 5;
  config.autopost!.limits!.likesPerDay = parseInt(body.limitLikes) || 20;
  config.autopost!.limits!.quoteTweetsPerDay = parseInt(body.limitQuotes) || 3;

  // ── Anti-Detection ──
  if (!config.humanBehavior.antiDetection) {
    config.humanBehavior.antiDetection = {};
  }
  config.humanBehavior.antiDetection.enabled = body.adEnabled === '1';
  config.humanBehavior.antiDetection.minPostGapMinutes = parseInt(body.minGap) || 15;
  config.humanBehavior.antiDetection.maxPostGapMinutes = parseInt(body.maxGap) || 120;

  // Silent days
  const silentPct = parseInt(body.silentDayChance) || 0;
  config.humanBehavior.timing.silentDayChance = body.silentDays === '1' ? silentPct / 100 : 0;

  saveConfig(config);

  return { redirect: '/autopilot?saved=1' };
}
