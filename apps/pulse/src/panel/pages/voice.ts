/**
 * Voice Fingerprint page — view, test, and calibrate your voice profile.
 * Shows the current fingerprint, lets you score text against it, and
 * provides auto/manual calibration from sample posts.
 */

import { loadVoice, calibrateVoice, type VoiceFingerprint } from '../../intelligence/human-behavior.js';
import { getActions } from '../../core/state.js';
import { saveState } from '../../core/state.js';
import { search, searchPlatform } from '../../core/search.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function pill(text: string, bg = '#21262d', fg = '#c9d1d9'): string {
  return `<span style="display:inline-block;padding:3px 10px;border-radius:12px;font-size:0.78rem;font-weight:500;background:${bg};color:${fg};margin:2px 3px 2px 0">${esc(text)}</span>`;
}

function badge(text: string, color = '#58a6ff'): string {
  return `<span style="display:inline-block;padding:3px 12px;border-radius:12px;font-size:0.78rem;font-weight:600;background:${color}22;color:${color};border:1px solid ${color}44">${esc(text)}</span>`;
}

function progressBar(value: number, max = 1): string {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const color = pct > 70 ? '#238636' : pct > 40 ? '#9e6a03' : '#da3633';
  return `
    <div style="display:flex;align-items:center;gap:10px">
      <div style="flex:1;height:8px;background:#21262d;border-radius:4px;overflow:hidden">
        <div style="width:${pct}%;height:100%;background:${color};border-radius:4px;transition:width 0.3s"></div>
      </div>
      <span style="font-size:0.82rem;font-weight:600;color:${color};min-width:40px">${value.toFixed(2)}</span>
    </div>`;
}

// ─── Render ──────────────────────────────────────────────────────────────────

export async function renderPage(query?: URLSearchParams): Promise<string> {
  const voice = loadVoice();
  const msg = query?.get('msg') ?? '';

  return `
<style>
  .voice-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px 24px;
    margin-bottom: 24px;
  }
  .voice-field {
    background: #161b22;
    border: 1px solid #30363d;
    border-radius: 8px;
    padding: 14px 16px;
  }
  .voice-field .label {
    color: #8b949e;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 8px;
  }
  .voice-field .value {
    color: #e6edf3;
    font-size: 0.88rem;
    line-height: 1.5;
  }
  .voice-section {
    background: #161b22;
    border: 1px solid #30363d;
    border-radius: 8px;
    padding: 20px;
    margin-bottom: 20px;
  }
  .voice-section h3 {
    color: #e6edf3;
    font-size: 0.95rem;
    font-weight: 600;
    margin-bottom: 14px;
    padding-bottom: 10px;
    border-bottom: 1px solid #21262d;
  }
  .voice-actions {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    margin-top: 14px;
  }
  .voice-msg {
    padding: 12px 16px;
    border-radius: 8px;
    margin-bottom: 20px;
    font-size: 0.85rem;
    font-weight: 500;
  }
  .voice-msg.success { background: #23863622; color: #3fb950; border: 1px solid #23863644; }
  .voice-msg.error { background: #da363322; color: #f85149; border: 1px solid #da363344; }
  .voice-msg.info { background: #1f6feb22; color: #58a6ff; border: 1px solid #1f6feb44; }
  .quote-item {
    color: #c9d1d9;
    font-size: 0.84rem;
    font-style: italic;
    padding: 4px 0;
    border-bottom: 1px solid #21262d;
  }
  .quote-item:last-child { border-bottom: none; }
  #voice-result {
    margin-top: 12px;
    padding: 14px 16px;
    border-radius: 8px;
    background: #0d1117;
    border: 1px solid #30363d;
    font-size: 0.88rem;
    color: #8b949e;
    display: none;
  }
  #voice-result.visible { display: block; }
  @media (max-width: 768px) {
    .voice-grid { grid-template-columns: 1fr; }
  }
</style>

${msg ? `<div class="voice-msg ${msg.startsWith('error') ? 'error' : msg.startsWith('info') ? 'info' : 'success'}">${esc(msg)}</div>` : ''}

<!-- Current Voice Fingerprint -->
<div class="voice-section">
  <h3>Current Voice Fingerprint</h3>
  <div class="voice-grid">

    <div class="voice-field">
      <div class="label">Catchphrases</div>
      <div class="value">
        ${voice.catchphrases.length > 0
          ? voice.catchphrases.map(c => pill(c, '#1f6feb22', '#58a6ff')).join('')
          : '<span style="color:#484f58">None set</span>'}
      </div>
    </div>

    <div class="voice-field">
      <div class="label">Emoji Use</div>
      <div class="value">${badge(voice.emojiFrequency, emojiColor(voice.emojiFrequency))}</div>
    </div>

    <div class="voice-field">
      <div class="label">Favorite Emojis</div>
      <div class="value">
        ${voice.favoriteEmojis.length > 0
          ? voice.favoriteEmojis.map(e => pill(e, '#21262d', '#e6edf3')).join('')
          : '<span style="color:#484f58">None</span>'}
      </div>
    </div>

    <div class="voice-field">
      <div class="label">Cap Style</div>
      <div class="value">${badge(voice.capStyle, '#8b5cf6')}</div>
    </div>

    <div class="voice-field">
      <div class="label">Humor</div>
      <div class="value">${badge(voice.humorStyle, '#f59e0b')}</div>
    </div>

    <div class="voice-field">
      <div class="label">Sentence Style</div>
      <div class="value">${badge(voice.sentenceStyle, '#06b6d4')}</div>
    </div>

    <div class="voice-field">
      <div class="label">Casualness</div>
      <div class="value">${progressBar(voice.casualtyLevel)}</div>
    </div>

    <div class="voice-field">
      <div class="label">Anecdote Frequency</div>
      <div class="value">${progressBar(voice.anecdoteFrequency)}</div>
    </div>

    <div class="voice-field">
      <div class="label">Punctuation Quirks</div>
      <div class="value">
        ${voice.punctuationQuirks.length > 0
          ? voice.punctuationQuirks.map(q => pill(q)).join('')
          : '<span style="color:#484f58">None</span>'}
      </div>
    </div>

    <div class="voice-field" style="grid-column: span 1">
      <div class="label">Strong Opinions</div>
      <div class="value">
        ${voice.strongOpinions.length > 0
          ? voice.strongOpinions.map(o => `<div class="quote-item">"${esc(o)}"</div>`).join('')
          : '<span style="color:#484f58">None set</span>'}
      </div>
    </div>

  </div>
</div>

<!-- Calibrate Voice -->
<div class="voice-section">
  <h3>Calibrate Voice</h3>

  <p style="color:#8b949e;font-size:0.84rem;margin-bottom:20px">
    Give us examples of how you write. Paste 5+ tweets, enter your X handle to fetch recent posts, or mix both. The more samples, the better the match.
  </p>

  <div style="background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;margin-bottom:16px;">
    <div style="font-size:0.78rem;color:#8b949e;text-transform:uppercase;letter-spacing:0.03em;margin-bottom:10px;">Quick fetch from X</div>
    <div style="display:flex;gap:10px;align-items:center;">
      <input type="text" id="handle-input" placeholder="@handle or x.com/handle" style="flex:1;max-width:280px;background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:6px;padding:10px 14px;font-size:0.88rem;font-family:inherit;outline:none;"
        onkeydown="if(event.key==='Enter'){event.preventDefault();fetchHandle();}">
      <button id="handle-btn" class="btn btn-primary" onclick="fetchHandle()">Fetch</button>
    </div>
    <span id="handle-status" style="display:block;color:#8b949e;font-size:0.8rem;margin-top:6px;min-height:18px;"></span>
  </div>

  <form id="calibrate-form" method="POST" action="/voice">
    <input type="hidden" name="action" value="manual-calibrate">

    <textarea id="calibrate-box" name="samples" style="width:100%;min-height:220px;resize:vertical;font-family:inherit;background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:6px;padding:14px;font-size:0.88rem;outline:none;line-height:1.5;" placeholder="Paste your tweets here — one per line or separated by blank lines.

You can also paste tweet URLs:
https://x.com/yourhandle/status/123456789

Mix and match — we handle both."></textarea>

    <div id="sample-counter" style="font-size:0.82rem;font-weight:600;margin:10px 0 16px;min-height:20px;"></div>
  </form>

  <div class="voice-actions">
    <button id="calibrate-btn" class="btn btn-primary" disabled onclick="submitCalibrate()">Calibrate from samples</button>
    <form method="POST" action="/voice" style="display:inline;margin:0;padding:0;">
      <input type="hidden" name="action" value="auto-calibrate">
      <button type="submit" class="btn btn-secondary">Auto-calibrate from your recent posts</button>
    </form>
    <button class="btn" style="background:transparent;color:#f85149;border:1px solid #da363344;" onclick="(typeof pulseConfirm==='function'?pulseConfirm('Reset Voice','Reset voice fingerprint to defaults? This cannot be undone.'):Promise.resolve(confirm('Reset voice fingerprint to defaults?'))).then(function(ok){if(ok){var f=document.createElement('form');f.method='POST';f.action=window.location.pathname;var i=document.createElement('input');i.type='hidden';i.name='action';i.value='reset';f.appendChild(i);document.body.appendChild(f);f.submit();}})">Reset</button>
  </div>
</div>

<script>
// ── Calibration: count samples (URLs + text blocks) ──
function countSamples() {
  var text = document.getElementById('calibrate-box').value.trim();
  if (!text) { updateCounter(0); return; }

  var chunks = text.split(/\\n\\s*\\n/).filter(function(c) { return c.trim().length > 0; });

  if (chunks.length < 3) {
    chunks = text.split(/\\n/).filter(function(c) { return c.trim().length > 10; });
  }

  var count = 0;
  for (var i = 0; i < chunks.length; i++) {
    var line = chunks[i].trim();
    if (line.match(/^https?:\\/\\/(x\\.com|twitter\\.com)\\/\\w+\\/status\\/\\d+/)) {
      count++;
    } else if (line.length > 10) {
      count++;
    }
  }
  updateCounter(count);
}

function updateCounter(n) {
  var el = document.getElementById('sample-counter');
  var btn = document.getElementById('calibrate-btn');
  if (n === 0) {
    el.textContent = '';
    btn.disabled = true;
  } else if (n < 5) {
    el.textContent = n + ' sample' + (n !== 1 ? 's' : '') + ' detected \\u2014 need at least 5';
    el.style.color = '#d29922';
    btn.disabled = true;
  } else {
    el.textContent = '\\u2713 ' + n + ' samples detected';
    el.style.color = '#3fb950';
    btn.disabled = false;
  }
}

// ── Fetch tweets from @handle ──
function fetchHandle() {
  var input = document.getElementById('handle-input');
  var raw = input.value.trim();
  // Extract handle from URL (https://x.com/handle or https://twitter.com/handle)
  var urlMatch = raw.match(/(?:x\\.com|twitter\\.com)\\/([a-zA-Z0-9_]{1,15})/);
  var handle = urlMatch ? urlMatch[1] : raw.replace(/^@/, '');
  if (!handle || !/^[a-zA-Z0-9_]{1,15}$/.test(handle)) {
    document.getElementById('handle-status').textContent = 'Enter a valid X handle (e.g. @username)';
    document.getElementById('handle-status').style.color = '#f85149';
    return;
  }
  var btn = document.getElementById('handle-btn');
  var status = document.getElementById('handle-status');
  btn.disabled = true;
  btn.textContent = 'Fetching...';
  status.textContent = '';

  fetch(window.location.pathname, {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: 'action=fetch-handle&handle=' + encodeURIComponent(handle)
  })
  .then(function(r) { return r.json(); })
  .then(function(d) {
    btn.disabled = false;
    btn.textContent = 'Fetch tweets';
    if (d.error) {
      status.textContent = d.error;
      status.style.color = '#f85149';
    } else if (d.tweets && d.tweets.length > 0) {
      var box = document.getElementById('calibrate-box');
      var existing = box.value.trim();
      box.value = (existing ? existing + '\\n\\n' : '') + d.tweets.join('\\n\\n');
      status.textContent = 'Fetched ' + d.tweets.length + ' tweets';
      status.style.color = '#3fb950';
      countSamples();
    } else {
      status.textContent = 'No tweets found for @' + handle;
      status.style.color = '#d29922';
    }
  })
  .catch(function() {
    btn.disabled = false;
    btn.textContent = 'Fetch tweets';
    status.textContent = 'Search failed \\u2014 paste tweets manually';
    status.style.color = '#f85149';
  });
}

// ── Submit calibration ──
function submitCalibrate() {
  document.getElementById('calibrate-form').submit();
}

// ── Wire up live counter ──
document.getElementById('calibrate-box').addEventListener('input', countSamples);
</script>
`;
}

// ─── Emoji Frequency Color ───────────────────────────────────────────────────

function emojiColor(freq: string): string {
  switch (freq) {
    case 'none':     return '#484f58';
    case 'rare':     return '#8b949e';
    case 'moderate': return '#d29922';
    case 'heavy':    return '#f59e0b';
    default:         return '#8b949e';
  }
}

// ─── POST Handler ────────────────────────────────────────────────────────────

export async function handlePost(
  action: string,
  body: Record<string, string>,
): Promise<{ redirect?: string; json?: unknown }> {

  // ── Auto-Calibrate ──
  if (action === 'auto-calibrate') {
    const actions = getActions();
    const posts = actions
      .filter(a => a.type === 'post' || a.type === 'reply')
      .map(a => a.content)
      .filter(c => c && c.length > 10)
      .slice(-10);

    if (posts.length < 5) {
      return { redirect: '/voice?msg=' + encodeURIComponent('error: Need at least 5 recent posts to auto-calibrate. Found ' + posts.length + '.') };
    }

    try {
      await calibrateVoice(posts);
      return { redirect: '/voice?msg=' + encodeURIComponent('Voice calibrated from ' + posts.length + ' recent posts.') };
    } catch {
      return { redirect: '/voice?msg=' + encodeURIComponent('error: Calibration failed. Check LLM configuration.') };
    }
  }

  // ── Manual Calibrate (smart parser: mixed URLs + text) ──
  if (action === 'manual-calibrate') {
    const raw = (body.samples ?? '').trim();
    if (!raw) {
      return { redirect: '/voice?msg=' + encodeURIComponent('error: No samples provided.') };
    }

    // Split into segments: try double-newline, then single-newline fallback
    let segments = raw.split(/\n\s*\n/).map(s => s.trim()).filter(s => s.length > 0);
    if (segments.length < 3) {
      segments = raw.split(/\n/).map(s => s.trim()).filter(s => s.length > 10);
    }

    // Partition into URLs and raw text
    const urlPattern = /^https?:\/\/(x\.com|twitter\.com)\/\w+\/status\/\d+/;
    const urls: string[] = [];
    const textSamples: string[] = [];
    for (const seg of segments) {
      if (urlPattern.test(seg)) {
        urls.push(seg);
      } else if (seg.length > 10) {
        textSamples.push(seg);
      }
    }

    // Fetch tweet text for each URL
    const fetchedTexts: string[] = [];
    for (const url of urls) {
      try {
        const results = await search(url, { num: 1 });
        if (results.length > 0) {
          const titleMatch = results[0].title.match(/on X:\s*["\u201c](.+?)["\u201d]\s*$/);
          const text = titleMatch ? titleMatch[1].trim() : results[0].snippet || '';
          if (text.length > 10) fetchedTexts.push(text);
        }
      } catch { /* skip failed fetches */ }
    }

    // Combine fetched + raw text
    const allSamples = [...fetchedTexts, ...textSamples];

    if (allSamples.length < 5) {
      const urlNote = urls.length > 0 ? ` (fetched ${fetchedTexts.length}/${urls.length} URLs)` : '';
      return { redirect: '/voice?msg=' + encodeURIComponent('error: Need at least 5 samples. Found ' + allSamples.length + urlNote + '. Add more tweets or text.') };
    }

    try {
      await calibrateVoice(allSamples);
      const parts: string[] = [];
      if (fetchedTexts.length > 0) parts.push(fetchedTexts.length + ' from URLs');
      if (textSamples.length > 0) parts.push(textSamples.length + ' text');
      return { redirect: '/voice?msg=' + encodeURIComponent('Voice calibrated from ' + allSamples.length + ' samples (' + parts.join(' + ') + ').') };
    } catch {
      return { redirect: '/voice?msg=' + encodeURIComponent('error: Calibration failed. Check LLM configuration.') };
    }
  }

  // ── Fetch Handle (returns JSON for inline fetch) ──
  if (action === 'fetch-handle') {
    const handle = (body.handle ?? '').trim().replace(/^@/, '');
    if (!handle || !/^[a-zA-Z0-9_]{1,15}$/.test(handle)) {
      return { json: { error: 'Enter a valid X handle.' } };
    }

    try {
      const results = await searchPlatform('x.com', `@${handle}`, { num: 10 });
      const tweets: string[] = [];
      for (const r of results) {
        // Try extracting from Google title format: "Username on X: \"tweet text\""
        const titleMatch = r.title.match(/on X:\s*["\u201c](.+?)["\u201d]\s*$/);
        let text = titleMatch ? titleMatch[1].trim() : '';
        // Fallback: use snippet if title extraction fails
        if (text.length < 10 && r.snippet?.length > 10) {
          text = r.snippet.replace(/\s+/g, ' ').trim();
        }
        if (text.length > 10 && !tweets.includes(text)) tweets.push(text);
      }
      if (tweets.length === 0) {
        return { json: { error: 'No tweets found for @' + handle + '.' } };
      }
      return { json: { tweets } };
    } catch {
      return { json: { error: 'Search failed. Try again or paste tweets manually.' } };
    }
  }

  // ── Reset ──
  if (action === 'reset') {
    saveState('voice', null);
    return { redirect: '/voice?msg=' + encodeURIComponent('Voice fingerprint reset to defaults.') };
  }

  return { redirect: '/voice' };
}
