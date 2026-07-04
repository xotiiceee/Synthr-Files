/**
 * Settings page — visual config editor for pulse.yaml.
 * Read-only brand identity display + editable autopost, safety, mention, timing settings.
 * Raw YAML editor with collapsible section for power users.
 */

import { getConfig } from '../../core/persona.js';
import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import { loadState } from '../../core/state.js';

const configPath = path.join(process.cwd(), 'pulse.yaml');

// ─── HTML Escaping ─────────────────────────────────────────────────────────

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function checked(val: unknown): string {
  return val ? 'checked' : '';
}


function tip(text: string): string {
  return `<span class="info-tip" role="img" aria-label="Help"><span class="info-icon">?</span><span class="tip-text">${esc(text)}</span></span>`;
}

function readRawYaml(): string {
  try {
    return fs.readFileSync(configPath, 'utf-8');
  } catch {
    return '# No pulse.yaml found';
  }
}

// ─── Page CSS ──────────────────────────────────────────────────────────────

function settingsCss(): string {
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

    .field-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #21262d;
    }

    .field-row:last-child { border-bottom: none; }

    .field-label {
      color: #8b949e;
      font-size: 0.82rem;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      flex-shrink: 0;
      margin-right: 12px;
    }

    .field-value {
      color: #e6edf3;
      font-size: 0.88rem;
      text-align: right;
      word-break: break-word;
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

    .collapsible-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      cursor: pointer;
      user-select: none;
    }

    .collapsible-header .arrow {
      color: #8b949e;
      font-size: 0.8rem;
      transition: transform 0.2s;
    }

    .collapsible-body {
      display: none;
      margin-top: 12px;
    }

    .collapsible-body.open { display: block; }

    .raw-textarea {
      width: 100%;
      min-height: 300px;
      background: #0d1117;
      color: #e6edf3;
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 12px;
      font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
      font-size: 0.8rem;
      line-height: 1.5;
      resize: vertical;
      outline: none;
      tab-size: 2;
    }

    .raw-textarea:focus { border-color: #58a6ff; }

    .success-banner {
      background: #238636;
      color: #fff;
      padding: 10px 16px;
      border-radius: 6px;
      margin-bottom: 16px;
      font-size: 0.85rem;
    }

    /* ── Sub-tabs ── */

    .sub-tabs {
      display: flex;
      gap: 0;
      margin-bottom: 24px;
      border-bottom: 1px solid #30363d;
    }

    .sub-tab {
      padding: 10px 20px;
      font-size: 0.85rem;
      font-weight: 500;
      color: #8b949e;
      text-decoration: none;
      border-bottom: 2px solid transparent;
      transition: color 0.15s, border-color 0.15s;
    }

    .sub-tab:hover {
      color: #e6edf3;
      text-decoration: none;
    }

    .sub-tab.active {
      color: #58a6ff;
      border-bottom-color: #58a6ff;
    }
  `;
}

// ─── Brand Tab ────────────────────────────────────────────────────────────

function renderAgentsTab(): string {
  const config = getConfig();
  const persona = config.persona || {};

  return `
    <div class="settings-card full-width">
      <h2>Brand Runtime</h2>
      <p style="color:#8b949e;font-size:0.85rem;line-height:1.5;margin-bottom:16px;">
        The legacy file-backed brand preset editor has been removed from this
        self-host panel. Standalone hosted brand runtime is managed through the
        SQL-backed <code>/api/brands</code> surface and the hosted app.
      </p>
      <div class="settings-grid" style="margin-bottom:0;">
        <div class="settings-card">
          <h2>Identity</h2>
          <div class="field-row"><span class="field-label">Brand</span><span class="field-value">${esc(persona.brandName || 'My Brand')}</span></div>
          <div class="field-row"><span class="field-label">Website</span><span class="field-value">${esc(persona.website || 'Not set')}</span></div>
          <div class="field-row"><span class="field-label">X Handle</span><span class="field-value">${esc(persona.xHandle || 'Not set')}</span></div>
          <div class="field-row"><span class="field-label">Niche</span><span class="field-value">${esc(persona.niche || 'Not set')}</span></div>
        </div>
        <div class="settings-card">
          <h2>Voice</h2>
          <div class="field-row"><span class="field-label">Tone</span><span class="field-value">${esc(persona.tone || 'professional')}</span></div>
          <div class="field-row"><span class="field-label">Role</span><span class="field-value">${esc((config as any).agentRole || 'Not set')}</span></div>
          <div class="field-row"><span class="field-label">Competitors</span><span class="field-value">${esc((config.competitors || []).join(', ') || 'None')}</span></div>
          <div class="field-row"><span class="field-label">Topics</span><span class="field-value">${Array.isArray(config.topics) ? config.topics.length : 0}</span></div>
        </div>
      </div>
      <div style="margin-top:16px;">
        <a href="/settings?tab=general" class="btn btn-primary" style="text-decoration:none;">Edit account settings</a>
        <a href="/settings?tab=voice" class="btn btn-secondary" style="text-decoration:none;margin-left:8px;">Edit voice</a>
      </div>
    </div>
  `;
}

// ─── Platforms Tab ─────────────────────────────────────────────────────────

function renderPlatformsTab(query?: URLSearchParams): string {
  const config = getConfig();
  const successMsg = query?.get('saved') === '1'
    ? '<div class="success-banner">Platform settings saved.</div>'
    : '';

  // Load KOL list (sync — follow-engine uses loadState which is sync)
  let kolListHtml = '<span style="color:#8b949e;font-size:0.85rem;">No KOLs added yet.</span>';
  try {
    const state = loadState('follow-engine', { records: [] as any[], kols: [] as string[] });
    if (state.kols && state.kols.length > 0) {
      kolListHtml = state.kols.map((k: string) => `<form method="POST" action="/settings" style="display:inline;"><input type="hidden" name="action" value="remove-kol"><input type="hidden" name="kolUsername" value="${esc(k)}"><button type="submit" style="background:#21262d;border:1px solid #30363d;color:#c9d1d9;padding:4px 10px;border-radius:16px;cursor:pointer;font-size:0.8rem;">@${esc(k)} &times;</button></form>`).join('');
    }
  } catch {}

  return `
    ${successMsg}

    <form method="POST" action="/settings">
      <input type="hidden" name="action" value="save-platforms">

      <div class="settings-grid">
        <!-- ── Platform Toggles ── -->
        <div class="settings-card">
          <h2>Platforms</h2>
          <p style="color:#8b949e;font-size:0.78rem;margin-bottom:14px;margin-top:-8px">
            Enable platforms where Pulse should operate. Set max daily posts per platform.
          </p>
          ${Object.entries(config.platforms).map(([name, settings]) => `
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;padding:8px 0;border-bottom:1px solid #21262d;">
              <label class="toggle-switch" style="flex-shrink:0">
                <input type="checkbox" name="platform_${esc(name)}_enabled" value="1" ${settings.enabled ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
              <span style="flex:1;color:#e6edf3;font-size:0.85rem;font-weight:500">${esc(name.charAt(0).toUpperCase() + name.slice(1))}</span>
              <label style="color:#8b949e;font-size:0.72rem;margin-right:4px">Max/day:</label>
              <input type="number" name="platform_${esc(name)}_maxPerDay" min="0" max="50"
                value="${settings.maxPerDay ?? 8}" style="width:60px">
            </div>
          `).join('')}
        </div>

        <!-- ── X API Info ── -->
        <div class="settings-card">
          <h2>X API Connection</h2>
          <div style="display:flex;flex-direction:column;gap:12px;">
            <p style="color:#8b949e;font-size:0.85rem;line-height:1.5;margin:0;">
              Pulse uses the X API to post, reply, and monitor mentions. Your API tier determines which features are available.
            </p>
            <div style="padding:12px;background:#0d1117;border:1px solid #30363d;border-radius:6px;">
              <div style="font-size:0.82rem;color:#8b949e;line-height:1.6;">
                <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
                  <strong style="color:#e6edf3;">Free</strong>
                  <span>Post, like, quote tweet. No direct replies to non-followers.</span>
                </div>
                <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
                  <strong style="color:#e6edf3;">Basic</strong>
                  <span>Reply to anyone, search API, mention detection.</span>
                </div>
                <div style="display:flex;justify-content:space-between;">
                  <strong style="color:#e6edf3;">Pro</strong>
                  <span>Full search, analytics, high-volume.</span>
                </div>
              </div>
            </div>
            <p style="color:#6e7681;font-size:0.78rem;margin:0;">
              Manage your API access at <a href="https://developer.x.com" target="_blank" style="color:#58a6ff;">developer.x.com</a>
            </p>
          </div>
        </div>

        <!-- ── Auto-Follow ── -->
        <div class="settings-card">
          <h2>Auto-Follow ${tip('Automatically follow users who engage with your content.')}</h2>
          <div class="settings-grid">
            <div class="form-field">
              <label><input type="checkbox" name="autoFollowEnabled" ${(config as any).autoFollow?.enabled ? 'checked' : ''}> Enable Auto-Follow</label>
            </div>
            <div class="form-field">
              <label>Daily Cap ${tip('Max follows per day. Keep under 20 to avoid suspension.')}</label>
              <input type="number" name="autoFollowDailyCap" value="${(config as any).autoFollow?.dailyCap ?? 15}" min="1" max="50">
            </div>
            <div class="form-field">
              <label>Min Confidence ${tip('Only follow users with signal confidence above this.')}</label>
              <input type="range" name="autoFollowMinConfidence" min="30" max="95" value="${(config as any).autoFollow?.minConfidence ?? 70}"
                oninput="this.nextElementSibling.textContent=this.value+'%'">
              <span>${(config as any).autoFollow?.minConfidence ?? 70}%</span>
            </div>
            <div class="form-field">
              <label>Min Followers ${tip('Skip accounts with fewer followers (spam filter).')}</label>
              <input type="number" name="autoFollowMinFollowers" value="${(config as any).autoFollow?.minFollowerCount ?? 50}" min="0" max="10000">
            </div>
            <div class="form-field">
              <label>Auto-Unfollow Days ${tip('Unfollow if no follow-back after N days. 0 = never.')}</label>
              <input type="number" name="autoFollowUnfollowDays" value="${(config as any).autoFollow?.autoUnfollowDays ?? 14}" min="0" max="90">
            </div>
            <div class="form-field">
              <label>Follow Signals</label>
              <div style="display:flex;flex-direction:column;gap:6px;">
                <label style="font-weight:normal;"><input type="checkbox" name="signalRepost" ${(config as any).autoFollow?.signals?.repost !== false ? 'checked' : ''}> Reposts of your content</label>
                <label style="font-weight:normal;"><input type="checkbox" name="signalReply" ${(config as any).autoFollow?.signals?.reply !== false ? 'checked' : ''}> Replies to your posts</label>
                <label style="font-weight:normal;"><input type="checkbox" name="signalTag" ${(config as any).autoFollow?.signals?.tag !== false ? 'checked' : ''}> Tags/mentions</label>
                <label style="font-weight:normal;"><input type="checkbox" name="signalPositive" ${(config as any).autoFollow?.signals?.mention_positive !== false ? 'checked' : ''}> Positive mentions</label>
              </div>
            </div>
          </div>
        </div>

        <!-- ── Engagement Config ── -->
        <div class="settings-card">
          <h2>Engagement</h2>
          <div class="form-field">
            <label>Main Account ${tip('Your personal X handle. When you mention the bot, it joins the conversation.')}</label>
            <input type="text" name="engagementMainAccount" value="${esc((config as any).engagement?.mainAccount || '')}" placeholder="@yourpersonal">
          </div>
          <div class="form-field">
            <label>Reply Strategy ${tip('How to approach outreach replies. Direct = reply immediately. Engage-first = like/repost first, reply later.')}</label>
            <select name="engagementStrategy">
              ${['direct', 'engage-first', 'quote-fallback'].map(s =>
                `<option value="${s}"${(config as any).engagement?.strategy === s ? ' selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, ' ')}</option>`
              ).join('')}
            </select>
          </div>
        </div>
      </div>

      <div class="save-bar" id="plat-save-bar">
        <span class="save-hint" id="plat-save-hint">Auto-saves when you make changes.</span>
        <button type="submit" class="btn-save" id="plat-save-btn">Save Platforms</button>
      </div>
    </form>
    <script>
    (function() {
      var form = document.querySelector('form[action="/settings"] input[name="action"][value="save-platforms"]');
      if (!form) return;
      form = form.closest('form');
      var hint = document.getElementById('plat-save-hint');
      var btn = document.getElementById('plat-save-btn');
      if (!form || !hint || !btn) return;
      var saveTimer = null;
      var saving = false;
      function autoSave() {
        if (saving) return;
        saving = true;
        hint.textContent = 'Saving...';
        hint.style.color = '#58a6ff';
        var data = new FormData(form);
        data.set('action', 'save-platforms');
        fetch('/settings', {
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
    })();
    </script>

    <!-- ── KOL Whitelist (outside main form) ── -->
    <div class="settings-card full-width" style="margin-top:16px;">
      <h2>KOL Whitelist ${tip('Key Opinion Leaders to always follow. Bypass confidence checks.')}</h2>
      <div style="margin-bottom:12px;">
        <form method="POST" action="/settings" style="display:flex;gap:8px;align-items:center;">
          <input type="hidden" name="action" value="add-kol">
          <input type="text" name="kolUsername" placeholder="@username" style="flex:1;">
          <button type="submit" class="btn btn-primary" style="padding:6px 16px;">Add</button>
        </form>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;">
        ${kolListHtml}
      </div>
    </div>
  `;
}

// ─── Render Page ───────────────────────────────────────────────────────────

export async function renderPage(query?: URLSearchParams): Promise<string> {
  const tab = query?.get('tab') || 'agents';

  const subTabBar = `
    <div class="sub-tabs">
      <a href="/settings?tab=agents" class="sub-tab ${tab === 'agents' ? 'active' : ''}">Brand</a>
      <a href="/settings?tab=general" class="sub-tab ${tab === 'general' ? 'active' : ''}">Account</a>
      <a href="/settings?tab=platforms" class="sub-tab ${tab === 'platforms' ? 'active' : ''}">Connections</a>
      <a href="/settings?tab=voice" class="sub-tab ${tab === 'voice' ? 'active' : ''}">Voice</a>
    </div>
  `;

  // ── Brand sub-tab ──
  if (tab === 'agents') {
    return `<style>${settingsCss()}</style>${subTabBar}${renderAgentsTab()}`;
  }

  // ── Platforms sub-tab ──
  if (tab === 'platforms') {
    return `<style>${settingsCss()}</style>${subTabBar}${renderPlatformsTab(query)}`;
  }

  // ── Voice sub-tab ──
  if (tab === 'voice') {
    const voicePage = await import('./voice.js');
    let voiceHtml = await voicePage.renderPage(query);
    // Rewrite form actions and fetch URL to route through /settings
    voiceHtml = voiceHtml
      .replace(/action="\/voice"/g, 'action="/settings"')
      .replace(/fetch\('\/voice'/g, "fetch('/settings'");
    return `<style>${settingsCss()}</style>${subTabBar}${voiceHtml}`;
  }

  // ── General/Account sub-tab (default) — existing settings content ──
  const config = getConfig();
  const p = config.persona;
  const ap = config.autopost || {};
  const safety = ap.safety || {};
  const hb = config.humanBehavior || {};
  const mentions = hb.mentions || {};
  const timing = hb.timing || {};
  const categories = ap.categories || {};
  const rawYaml = readRawYaml();

  const errorMsg = query?.get('error') === 'invalid-yaml'
    ? '<div class="banner error" style="background:#da3633;color:#fff;padding:10px 16px;border-radius:6px;margin-bottom:16px;font-size:0.85rem">Invalid YAML syntax — changes were not saved.</div>'
    : '';

  const successMsg = query?.get('saved') === '1'
    ? '<div class="success-banner">Settings saved successfully.</div>'
    : '';

  const categoryNames = ['news_commentary', 'product_tips', 'industry_insights', 'engagement', 'curated_reshares', 'milestones'];
  const categoryLabels: Record<string, string> = {
    news_commentary: 'News Commentary',
    product_tips: 'Product Tips',
    industry_insights: 'Industry Insights',
    engagement: 'Engagement',
    curated_reshares: 'Curated Reshares',
    milestones: 'Milestones',
  };

  const categoriesHtml = categoryNames.map(name => {
    const cat = categories[name] || {};
    const weight = cat.weight ?? 0;
    const enabled = cat.enabled !== false;
    return `
      <div class="category-item">
        <div class="category-header">
          <span class="category-name">${esc(categoryLabels[name] || name)}</span>
          <label class="toggle-switch">
            <input type="checkbox" name="cat_${esc(name)}_enabled" value="1" ${checked(enabled)}>
            <span class="toggle-slider"></span>
          </label>
        </div>
        <div class="form-field" style="margin-bottom:0">
          <label>Weight ${tip('How often this category is used relative to others. Higher weight means more posts of this type.')}</label>
          <div class="range-row">
            <input type="range" name="cat_${esc(name)}_weight" min="0" max="100" value="${esc(weight)}"
              oninput="this.nextElementSibling.textContent=this.value+'%'">
            <span class="range-val">${esc(weight)}%</span>
          </div>
        </div>
      </div>`;
  }).join('');

  const activeWindowsStr = (timing.activeWindows || [])
    .map(w => `${w.start}-${w.end}`)
    .join(', ');

  return `
    <style>${settingsCss()}</style>

    ${subTabBar}

    ${errorMsg}
    ${successMsg}

    <form method="POST" action="/settings">
      <input type="hidden" name="action" value="save-settings">

      <div class="settings-grid">
        <!-- ── AI Providers ── -->
        <div class="settings-card">
          <h2>AI Provider</h2>
          <div class="form-field">
            <label>LLM Provider ${tip('Which AI model powers reply generation and content creation.')}</label>
            <select name="llmProvider">
              <option value="groq"${(process.env.LLM_PROVIDER ?? 'groq') === 'groq' ? ' selected' : ''}>Groq — Free, Llama 3.3 70B${process.env.GROQ_API_KEY ? ' ✓' : ''}</option>
              <option value="openai"${process.env.LLM_PROVIDER === 'openai' ? ' selected' : ''}>OpenAI — ~$0.15/1K calls, GPT-4o-mini${process.env.OPENAI_API_KEY ? ' ✓' : ''}</option>
              <option value="anthropic"${process.env.LLM_PROVIDER === 'anthropic' ? ' selected' : ''}>Anthropic — ~$0.25/1K calls, Claude${process.env.ANTHROPIC_API_KEY ? ' ✓' : ''}</option>
              <option value="openrouter"${process.env.LLM_PROVIDER === 'openrouter' ? ' selected' : ''}>OpenRouter — Pay-per-use, 100+ models${process.env.OPENROUTER_API_KEY ? ' ✓' : ''}</option>
              <option value="ollama"${process.env.LLM_PROVIDER === 'ollama' ? ' selected' : ''}>Ollama — Free, runs locally</option>
            </select>
            <span style="color:#8b949e;font-size:0.72rem;display:block;margin-top:4px">
              ✓ = API key configured in .env. Change provider in .env: LLM_PROVIDER=anthropic
            </span>
          </div>
          <div class="form-field">
            <label>Search Provider ${tip('How Pulse finds X conversations and news.')}</label>
            <select name="searchProvider">
              <option value="serper"${(process.env.SEARCH_PROVIDER ?? 'serper') === 'serper' ? ' selected' : ''}>Serper${process.env.SERPER_API_KEY ? ' ✓' : ''}</option>
              <option value="brave"${process.env.SEARCH_PROVIDER === 'brave' ? ' selected' : ''}>Brave${process.env.BRAVE_API_KEY ? ' ✓' : ''}</option>
              <option value="serpapi"${process.env.SEARCH_PROVIDER === 'serpapi' ? ' selected' : ''}>SerpAPI${process.env.SERPAPI_API_KEY ? ' ✓' : ''}</option>
            </select>
          </div>
        </div>


        <!-- ── Autopilot Link ── -->
        <div class="settings-card">
          <h2>Autopilot</h2>
          <div style="color:${config.autopilot?.enabled ? '#3fb950' : '#8b949e'};margin-bottom:12px;">
            Status: ${config.autopilot?.enabled ? 'Active' : 'Disabled'}
          </div>
          <a href="/autopilot" style="color:#58a6ff;text-decoration:none;font-size:0.9rem;">Configure autopilot, categories, limits, and safety settings →</a>
        </div>

        <!-- ── Mention Settings ── -->
        <div class="settings-card">
          <h2>Mention Settings</h2>

          <div class="toggle-row">
            <span class="toggle-label">Enabled</span>
            <label class="toggle-switch">
              <input type="checkbox" name="mentionsEnabled" value="1" ${checked(mentions.enabled)}>
              <span class="toggle-slider"></span>
            </label>
          </div>

          <div class="toggle-row">
            <span class="toggle-label">Reply to Questions</span>
            <label class="toggle-switch">
              <input type="checkbox" name="mentionsReplyQuestions" value="1" ${checked(mentions.replyToQuestions)}>
              <span class="toggle-slider"></span>
            </label>
          </div>

          <div class="form-field" style="margin-top:12px">
            <label>Reply to Positive ${tip('Chance of auto-replying when someone says something positive about your brand. 100% = always reply.')}</label>
            <div class="range-row">
              <input type="range" name="mentionsReplyPositive" min="0" max="100"
                value="${esc(Math.round((mentions.replyToPositive ?? 0) * 100))}"
                oninput="this.nextElementSibling.textContent=this.value+'%'">
              <span class="range-val">${esc(Math.round((mentions.replyToPositive ?? 0) * 100))}%</span>
            </div>
          </div>

          <div class="form-field">
            <label>Reply to Neutral ${tip('Chance of replying to neutral mentions. Lower values mean the bot is more selective about engaging.')}</label>
            <div class="range-row">
              <input type="range" name="mentionsReplyNeutral" min="0" max="100"
                value="${esc(Math.round((mentions.replyToNeutral ?? 0) * 100))}"
                oninput="this.nextElementSibling.textContent=this.value+'%'">
              <span class="range-val">${esc(Math.round((mentions.replyToNeutral ?? 0) * 100))}%</span>
            </div>
          </div>

          <div class="toggle-row">
            <span class="toggle-label">Reply to Negative</span>
            <label class="toggle-switch">
              <input type="checkbox" name="mentionsReplyNegative" value="1" ${checked(mentions.replyToNegative)}>
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>

      </div>

      <!-- ── Save Bar ── -->
      <div class="save-bar" id="save-bar">
        <span class="save-hint" id="save-hint">Auto-saves when you make changes.</span>
        <button type="submit" class="btn-save" id="save-btn">Save Settings</button>
      </div>
      <script>
        (function() {
          var form = document.querySelector('form[action="/settings"]');
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
            data.set('action', 'save-settings');
            fetch('/settings', {
              method: 'POST',
              body: new URLSearchParams(data),
            }).then(function(r) {
              if (r.redirected || r.ok) {
                hint.textContent = 'Saved.';
                hint.style.color = '#3fb950';
                setTimeout(function() { hint.textContent = 'Auto-saves when you make changes.'; hint.style.color = '#8b949e'; }, 2000);
              } else {
                hint.textContent = 'Save failed — try the Save button.';
                hint.style.color = '#f85149';
              }
              saving = false;
            }).catch(function() {
              hint.textContent = 'Save failed — try the Save button.';
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
        })();
      </script>
    </form>


    <!-- ── Raw YAML Editor ── -->
    <div class="settings-card full-width" style="margin-top:24px">
      <div class="collapsible-header" onclick="
        const body = this.nextElementSibling;
        const arrow = this.querySelector('.arrow');
        body.classList.toggle('open');
        arrow.textContent = body.classList.contains('open') ? '\u25BC' : '\u25B6';
      ">
        <h2 style="margin-bottom:0;border-bottom:none;padding-bottom:0">Raw YAML</h2>
        <span class="arrow">\u25B6</span>
      </div>
      <div class="collapsible-body">
        <form method="POST" action="/settings">
          <input type="hidden" name="action" value="save-raw">
          <div class="form-field" style="margin-top:12px">
            <textarea class="raw-textarea" name="rawYaml">${esc(rawYaml)}</textarea>
          </div>
          <button type="submit" class="btn-save" style="margin-top:8px">Save Raw</button>
        </form>
      </div>
    </div>

    <script>
      // Live range value display
      document.querySelectorAll('input[type="range"]').forEach(function(el) {
        el.addEventListener('input', function() {
          var span = el.nextElementSibling;
          if (span && span.classList.contains('range-val')) {
            span.textContent = el.value + '%';
          }
        });
      });
    </script>
  `;
}

// ─── Handle POST ───────────────────────────────────────────────────────────

export async function handlePost(
  action: string,
  body: Record<string, string>,
): Promise<{ redirect?: string; json?: unknown }> {

  // ── Voice actions → delegate to voice page ──
  if (action === 'auto-calibrate' || action === 'manual-calibrate' || action === 'fetch-handle' || action === 'reset') {
    const voicePage = await import('./voice.js');
    const result = await voicePage.handlePost(action, body);

    // JSON responses (fetch-handle) pass through as-is
    if (result.json !== undefined) {
      return result;
    }

    // Rewrite redirect from /voice?... to /settings?tab=voice&...
    if (result.redirect) {
      const url = new URL(result.redirect, 'http://localhost');
      const params = new URLSearchParams(url.searchParams);
      params.set('tab', 'voice');
      return { redirect: `/settings?${params.toString()}` };
    }

    return { redirect: '/settings?tab=voice' };
  }

  // ── Platform save ──

  if (action === 'save-platforms') {
    let parsed: Record<string, any> = {};
    try {
      const yamlContent = fs.readFileSync(configPath, 'utf-8');
      parsed = YAML.parse(yamlContent) || {};
    } catch {}

    // Platform toggles
    parsed.platforms = parsed.platforms || {};
    for (const name of ['x', 'reddit', 'discord', 'hackernews', 'producthunt', 'linkedin']) {
      parsed.platforms[name] = parsed.platforms[name] || {};
      parsed.platforms[name].enabled = body[`platform_${name}_enabled`] === '1';
      const maxPerDay = parseInt(body[`platform_${name}_maxPerDay`], 10);
      if (!isNaN(maxPerDay)) parsed.platforms[name].maxPerDay = maxPerDay;
    }

    // Auto-Follow
    parsed.autoFollow = {
      enabled: body.autoFollowEnabled === 'on',
      dailyCap: parseInt(body.autoFollowDailyCap || '15', 10),
      minConfidence: parseInt(body.autoFollowMinConfidence || '70', 10),
      minFollowerCount: parseInt(body.autoFollowMinFollowers || '50', 10),
      autoUnfollowDays: parseInt(body.autoFollowUnfollowDays || '14', 10),
      signals: {
        repost: body.signalRepost === 'on',
        reply: body.signalReply === 'on',
        tag: body.signalTag === 'on',
        mention_positive: body.signalPositive === 'on',
      },
    };

    // Engagement config
    parsed.engagement = parsed.engagement || {};
    if (body.engagementMainAccount !== undefined) {
      parsed.engagement.mainAccount = body.engagementMainAccount.trim();
    }
    if (body.engagementStrategy) {
      parsed.engagement.strategy = body.engagementStrategy;
    }

    fs.writeFileSync(configPath, YAML.stringify(parsed, { indent: 2 }), 'utf-8');
    try { const { resetConfigCache } = await import('../../core/persona.js'); resetConfigCache(); } catch {}
    return { redirect: '/settings?tab=platforms&saved=1' };
  }

  if (action === 'reset-calibration') {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = YAML.parse(raw) || {};
    parsed.autopilot = parsed.autopilot || {};
    parsed.autopilot.calibrationComplete = false;
    parsed.autopilot.calibrationDecisions = 0;
    fs.writeFileSync(configPath, YAML.stringify(parsed, { indent: 2 }), 'utf-8');
    try { const { resetConfigCache } = await import('../../core/persona.js'); resetConfigCache(); } catch {}
    return { redirect: '/settings?tab=general&saved=1' };
  }

  if (action === 'add-kol') {
    const username = (body.kolUsername || '').trim().replace(/^@/, '');
    if (username) {
      try {
        const { addKol } = await import('../../core/follow-engine.js');
        addKol(username);
      } catch {
        // follow-engine may not exist yet — save to state directly
        const { loadState, saveState } = await import('../../core/state.js');
        const state = loadState('follow-engine', { records: [], kols: [] as string[] });
        if (!state.kols.includes(username)) state.kols.push(username);
        saveState('follow-engine', state);
      }
    }
    return { redirect: '/settings?tab=platforms&saved=1' };
  }

  if (action === 'remove-kol') {
    const username = (body.kolUsername || '').trim().replace(/^@/, '');
    if (username) {
      try {
        const { removeKol } = await import('../../core/follow-engine.js');
        removeKol(username);
      } catch {
        const { loadState, saveState } = await import('../../core/state.js');
        const state = loadState('follow-engine', { records: [], kols: [] as string[] });
        state.kols = state.kols.filter((k: string) => k !== username);
        saveState('follow-engine', state);
      }
    }
    return { redirect: '/settings?tab=platforms&saved=1' };
  }

  if (action === 'save-raw') {
    const rawYaml = body.rawYaml || '';
    // Validate YAML before writing — reject invalid YAML
    try {
      YAML.parse(rawYaml);
    } catch (err) {
      return { redirect: '/settings?tab=general&error=invalid-yaml' };
    }
    fs.writeFileSync(configPath, rawYaml, 'utf-8');

    // Clear cached config so next getConfig() reloads
    try {
      const { resetConfigCache } = await import('../../core/persona.js');
      resetConfigCache();
    } catch { /* non-critical */ }

    return { redirect: '/settings?tab=general&saved=1' };
  }

  if (action === 'save-settings') {
    // Read current YAML and parse
    let parsed: Record<string, any> = {};
    try {
      const yamlContent = fs.readFileSync(configPath, 'utf-8');
      parsed = YAML.parse(yamlContent) || {};
    } catch {
      // Start from scratch if file is missing or invalid
    }

    // ── Autopilot threshold ──
    if (body.autopilotThreshold) {
      parsed.autopilot = parsed.autopilot || {};
      parsed.autopilot.confidenceThreshold = parseInt(body.autopilotThreshold, 10);
    }

    // ── Providers ──
    if (body.llmProvider) {
      parsed.llmProvider = body.llmProvider;
    }
    if (body.searchProvider) {
      parsed.searchProvider = body.searchProvider;
    }

    // ── Autopost settings ──
    parsed.autopost = parsed.autopost || {};

    // Categories
    parsed.autopost.categories = parsed.autopost.categories || {};
    const categoryNames = ['news_commentary', 'product_tips', 'industry_insights', 'engagement', 'curated_reshares', 'milestones'];

    for (const name of categoryNames) {
      parsed.autopost.categories[name] = parsed.autopost.categories[name] || {};
      parsed.autopost.categories[name].enabled = body[`cat_${name}_enabled`] === '1';
      const weight = parseInt(body[`cat_${name}_weight`], 10);
      if (!isNaN(weight)) {
        parsed.autopost.categories[name].weight = weight;
      }
    }

    // ── Activity Limits ──
    parsed.autopost.limits = parsed.autopost.limits || {};
    const limitsMap: Array<[string, string]> = [
      ['profilePostsPerDay', 'limitsProfilePosts'],
      ['repliesPerDay', 'limitsReplies'],
      ['repostsPerDay', 'limitsReposts'],
      ['likesPerDay', 'limitsLikes'],
      ['quoteTweetsPerDay', 'limitsQuoteTweets'],
    ];
    for (const [key, field] of limitsMap) {
      const val = parseInt(body[field], 10);
      if (!isNaN(val) && val >= 0) {
        parsed.autopost.limits[key] = val;
      }
    }

    // ── Safety settings ──
    parsed.autopost.safety = parsed.autopost.safety || {};
    parsed.autopost.safety.bannedTopics = (body.bannedTopics || '')
      .split('\n')
      .map((s: string) => s.trim())
      .filter(Boolean);
    parsed.autopost.safety.bannedWords = (body.bannedWords || '')
      .split('\n')
      .map((s: string) => s.trim())
      .filter(Boolean);

    // ── Mention settings ──
    parsed.humanBehavior = parsed.humanBehavior || {};
    parsed.humanBehavior.mentions = parsed.humanBehavior.mentions || {};
    parsed.humanBehavior.mentions.enabled = body.mentionsEnabled === '1';
    parsed.humanBehavior.mentions.replyToQuestions = body.mentionsReplyQuestions === '1';
    parsed.humanBehavior.mentions.replyToNegative = body.mentionsReplyNegative === '1';

    const replyPositive = parseInt(body.mentionsReplyPositive, 10);
    if (!isNaN(replyPositive)) {
      parsed.humanBehavior.mentions.replyToPositive = replyPositive / 100;
    }

    const replyNeutral = parseInt(body.mentionsReplyNeutral, 10);
    if (!isNaN(replyNeutral)) {
      parsed.humanBehavior.mentions.replyToNeutral = replyNeutral / 100;
    }

    // ── Timing settings ──
    parsed.humanBehavior.timing = parsed.humanBehavior.timing || {};

    if (body.timezone) {
      parsed.humanBehavior.timing.timezone = body.timezone;
    }

    const basePostsPerDay = parseInt(body.basePostsPerDay, 10);
    if (!isNaN(basePostsPerDay) && basePostsPerDay > 0) {
      parsed.humanBehavior.timing.basePostsPerDay = basePostsPerDay;
    }

    const silentChance = parseInt(body.silentDayChance, 10);
    if (!isNaN(silentChance)) {
      parsed.humanBehavior.timing.silentDayChance = silentChance / 100;
    }

    // Active windows: parse "09:00-12:00, 13:00-17:00" format
    if (body.activeWindows !== undefined) {
      const windowStr = body.activeWindows.trim();
      if (windowStr) {
        const windows = windowStr.split(',').map(w => {
          const parts = w.trim().split('-');
          if (parts.length === 2) {
            return { start: parts[0].trim(), end: parts[1].trim() };
          }
          return null;
        }).filter(Boolean);
        parsed.humanBehavior.timing.activeWindows = windows;
      } else {
        parsed.humanBehavior.timing.activeWindows = [];
      }
    }

    // ── Write back ──
    fs.writeFileSync(configPath, YAML.stringify(parsed, { indent: 2 }), 'utf-8');

    // Clear cached config so next getConfig() reloads
    try {
      const { resetConfigCache } = await import('../../core/persona.js');
      resetConfigCache();
    } catch {
      // Non-critical — cache will stale-refresh on next load
    }

    return { redirect: '/settings?tab=general&saved=1' };
  }

  return { redirect: '/settings' };
}
