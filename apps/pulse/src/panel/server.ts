/**
 * PULSE Panel — Multi-page web dashboard.
 * Serves on http://localhost:3456 — uses Node built-in http, no external deps.
 * Run: npx tsx src/panel/server.ts
 *
 * Each page lives in src/panel/pages/<name>.ts and exports:
 *   renderPage(query?: URLSearchParams): Promise<string>   — inner HTML
 *   handlePost(action: string, body: Record<string,string>): Promise<{redirect?:string; json?:unknown}>
 *
 * The server wraps page content in the shared layout (sidebar + header + CSS).
 */

import { config } from 'dotenv';
config();

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';

const portArg = process.argv.find(a => a.startsWith('--port='))?.split('=')[1]
  || process.argv.find((_, i, a) => a[i - 1] === '--port');
const PORT = parseInt(portArg || process.env.PULSE_PANEL_PORT || '3456', 10);

// ─── HTML Escaping (XSS Prevention) ─────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Nav Definition ─────────────────────────────────────────────────────────

interface NavItem {
  href: string;
  label: string;
  icon: string;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/create',      label: 'Create',      icon: '📝' },
  { href: '/autopilot',   label: 'Autopilot',   icon: '🤖' },
  { href: '/activity',    label: 'Activity',    icon: '📊' },
  { href: '/knowledge',   label: 'Knowledge',   icon: '🧠' },
  { href: '/settings',    label: 'Settings',    icon: '⚙\uFE0F' },
];

// ─── Shared CSS ─────────────────────────────────────────────────────────────

function sharedCss(): string {
  return `
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      background: #0d1117;
      color: #e6edf3;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji';
      display: flex;
      min-height: 100vh;
    }

    a { color: #58a6ff; text-decoration: none; }
    a:hover { text-decoration: underline; }

    /* ── Sidebar ── */

    .sidebar {
      width: 220px;
      background: #010409;
      border-right: 1px solid #21262d;
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
      position: fixed;
      top: 0;
      left: 0;
      bottom: 0;
      overflow-y: auto;
      z-index: 100;
    }

    .sidebar-brand {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 20px;
      border-bottom: 1px solid #21262d;
      color: #58a6ff;
      font-size: 1.3rem;
      font-weight: 700;
      letter-spacing: 0.04em;
    }

    .sidebar-brand .brand-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #58a6ff;
      box-shadow: 0 0 8px rgba(88, 166, 255, 0.5);
    }

    .sidebar-nav {
      padding: 8px 0;
      flex: 1;
    }

    .sidebar-nav a {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 20px;
      color: #8b949e;
      font-size: 0.9rem;
      transition: background 0.15s, color 0.15s;
    }

    .sidebar-nav a:hover,
    .sidebar-nav a.active {
      color: #f0f6fc;
      background: #161b22;
      text-decoration: none;
    }

    .sidebar-nav a.active {
      border-left: 3px solid #58a6ff;
      padding-left: 17px;
    }

    .sidebar-nav .nav-icon {
      width: 22px;
      text-align: center;
      font-size: 1rem;
      flex-shrink: 0;
    }

    .nav-badge {
      background: #da3633;
      color: #fff;
      font-size: 10px;
      font-weight: 700;
      padding: 1px 6px;
      border-radius: 8px;
      margin-left: auto;
    }

    /* ── Main Content ── */

    .main-wrapper {
      margin-left: 220px;
      flex: 1;
      display: flex;
      flex-direction: column;
      min-height: 100vh;
    }

    .header {
      background: #161b22;
      border-bottom: 1px solid #30363d;
      padding: 16px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
    }

    .header-title {
      font-size: 1.2rem;
      font-weight: 600;
      color: #e6edf3;
    }

    .header-badge {
      font-size: 0.75rem;
      color: #8b949e;
      background: #0d1117;
      padding: 4px 10px;
      border-radius: 12px;
      border: 1px solid #30363d;
    }

    .content {
      flex: 1;
      padding: 24px;
      overflow-y: auto;
      max-width: 1200px;
      width: 100%;
    }

    /* ── Common Components ── */

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 14px;
      margin-bottom: 24px;
    }

    .card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 18px;
    }

    .card h3 {
      color: #8b949e;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 8px;
    }

    .card .val {
      font-size: 2rem;
      font-weight: 700;
      color: #f0f6fc;
    }

    .card .sub {
      color: #8b949e;
      font-size: 0.75rem;
      margin-top: 4px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      overflow: hidden;
      margin-bottom: 16px;
    }

    th {
      background: #0d1117;
      color: #8b949e;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      text-align: left;
      padding: 10px 14px;
      border-bottom: 1px solid #30363d;
    }

    td {
      padding: 10px 14px;
      border-bottom: 1px solid #21262d;
      font-size: 0.85rem;
      color: #e6edf3;
    }

    tr:last-child td { border-bottom: none; }

    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 0.75rem;
      font-weight: 600;
    }

    .badge-green  { background: #238636; color: #fff; }
    .badge-yellow { background: #9e6a03; color: #fff; }
    .badge-red    { background: #da3633; color: #fff; }
    .badge-blue   { background: #1f6feb; color: #fff; }

    .btn {
      display: inline-block;
      padding: 8px 16px;
      border-radius: 6px;
      font-size: 0.85rem;
      font-weight: 500;
      cursor: pointer;
      border: 1px solid #30363d;
      transition: background 0.15s;
    }

    .btn-primary { background: #238636; color: #fff; border-color: #238636; }
    .btn-primary:hover { background: #2ea043; }
    .btn-secondary { background: #21262d; color: #e6edf3; }
    .btn-secondary:hover { background: #30363d; }
    .btn-danger { background: #da3633; color: #fff; border-color: #da3633; }
    .btn-danger:hover { background: #f85149; }

    /* Focus states for keyboard navigation */
    .btn:focus, .btn-primary:focus, .btn-secondary:focus, .btn-danger:focus,
    a:focus, input:focus, select:focus, textarea:focus {
      outline: 2px solid #58a6ff;
      outline-offset: 2px;
    }

    /* Disabled button styling */
    .btn:disabled, .btn[disabled] {
      opacity: 0.5;
      cursor: not-allowed;
      pointer-events: none;
    }

    /* Minimum touch targets */
    .btn { min-height: 36px; }

    .list-item {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 14px;
      margin-bottom: 10px;
    }

    .list-item h4 { color: #f0f6fc; font-size: 0.9rem; margin-bottom: 4px; }
    .list-item p  { color: #8b949e; font-size: 0.8rem; }

    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: #8b949e;
    }

    .empty-state .icon { font-size: 3rem; margin-bottom: 12px; }
    .empty-state h3 { color: #e6edf3; font-size: 1.1rem; margin-bottom: 8px; }
    .empty-state p { font-size: 0.9rem; }

    form { margin: 0; }
    input, select, textarea {
      background: #0d1117;
      color: #e6edf3;
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 8px 12px;
      font-size: 0.85rem;
      font-family: inherit;
      outline: none;
    }
    input:focus, select:focus, textarea:focus { border-color: #58a6ff; }
    textarea { resize: vertical; min-height: 80px; }

    .form-group { margin-bottom: 14px; }
    .form-group label {
      display: block;
      color: #8b949e;
      font-size: 0.8rem;
      margin-bottom: 4px;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }

    /* ── Responsive ── */

    @media (max-width: 768px) {
      .sidebar {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: auto;
        width: 100%;
        flex-direction: row;
        overflow-x: auto;
        overflow-y: hidden;
        border-right: none;
        border-bottom: 1px solid #21262d;
        z-index: 100;
        height: auto;
      }

      .sidebar-brand {
        padding: 12px;
        border-bottom: none;
        border-right: 1px solid #21262d;
        white-space: nowrap;
      }

      .sidebar-nav {
        display: flex;
        padding: 0;
        flex: 0;
      }

      .sidebar-nav a {
        white-space: nowrap;
        padding: 12px 14px;
        border-left: none !important;
        padding-left: 14px !important;
      }

      .sidebar-nav a.active {
        border-bottom: 2px solid #58a6ff;
      }

      .main-wrapper {
        margin-left: 0;
        margin-top: 52px;
      }

      .grid { grid-template-columns: 1fr; }
    }
  `;
}

// ─── Page Module Interface ──────────────────────────────────────────────────

interface PageModule {
  renderPage(query?: URLSearchParams): Promise<string>;
  handlePost(action: string, body: Record<string, string>): Promise<{ redirect?: string; json?: unknown }>;
}

// ─── Page Loaders (lazy, with fallback) ─────────────────────────────────────

const pageCache = new Map<string, PageModule | null>();

async function loadPage(name: string): Promise<PageModule | null> {
  if (pageCache.has(name)) return pageCache.get(name)!;

  try {
    const mod = await import(`./pages/${name}.js`);
    const page: PageModule = {
      renderPage: mod.renderPage,
      handlePost: mod.handlePost,
    };
    pageCache.set(name, page);
    return page;
  } catch {
    pageCache.set(name, null);
    return null;
  }
}

function comingSoonHtml(label: string): string {
  return `
    <div class="empty-state">
      <div class="icon">🚧</div>
      <h3>${esc(label)}</h3>
      <p>This page is coming soon. The module has not been created yet.</p>
    </div>
  `;
}

// ─── Route → Page Mapping ───────────────────────────────────────────────────

interface RouteEntry {
  path: string;
  module: string;
  label: string;
}

const ROUTES: RouteEntry[] = [
  { path: '/create',      module: 'create',        label: 'Create' },
  { path: '/autopilot',   module: 'autopilot',     label: 'Autopilot' },
  { path: '/activity',    module: 'activity-feed', label: 'Activity' },
  { path: '/knowledge',   module: 'knowledge',     label: 'Knowledge' },
  { path: '/settings',    module: 'settings',      label: 'Settings' },
];

// ─── Badge Counts ───────────────────────────────────────────────────────────

function getBadgeCounts(): { queue: number; activity: number } {
  try {
    const dataDir = path.join(process.cwd(), 'data');

    // queue badge = pending posts + pending mentions + new opportunities
    let pendingPosts = 0;
    try {
      const queue = JSON.parse(fs.readFileSync(path.join(dataDir, 'autopost-queue.json'), 'utf-8') || '[]');
      pendingPosts = Array.isArray(queue) ? queue.filter((e: any) => e.status === 'pending').length : 0;
    } catch { /* file missing or invalid */ }

    let unrespondedMentions = 0;
    try {
      const mentions = JSON.parse(fs.readFileSync(path.join(dataDir, 'mentions.json'), 'utf-8') || '{}');
      const pendingReplies = mentions.pendingReplies || [];
      unrespondedMentions = pendingReplies.filter((m: any) => m.status === 'pending' || m.status === 'queued').length;
    } catch { /* file missing or invalid */ }

    // activity badge = count of error actions in last 24h (0 normally)
    let errorCount = 0;
    try {
      const activityLog = JSON.parse(fs.readFileSync(path.join(dataDir, 'activity-log.json'), 'utf-8') || '[]');
      if (Array.isArray(activityLog)) {
        const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
        errorCount = activityLog.filter((e: any) => e.status === 'error' && new Date(e.timestamp).getTime() > oneDayAgo).length;
      }
    } catch { /* file missing or invalid */ }

    return { queue: pendingPosts + unrespondedMentions, activity: errorCount };
  } catch {
    return { queue: 0, activity: 0 };
  }
}

// ─── Layout ─────────────────────────────────────────────────────────────────

function layout(activePath: string, pageTitle: string, body: string): string {
  const badges = getBadgeCounts();
  const badgeFor = (href: string): string => {
    if (href === '/create' && badges.queue > 0) {
      return `<span class="nav-badge">${badges.queue}</span>`;
    }
    if (href === '/activity' && badges.activity > 0) {
      return `<span class="nav-badge">${badges.activity}</span>`;
    }
    return '';
  };

  const navLinks = NAV_ITEMS.map(n =>
    `<a href="${n.href}" class="${n.href === activePath ? 'active' : ''}">`
    + `<span class="nav-icon">${n.icon}</span>${esc(n.label)}${badgeFor(n.href)}</a>`
  ).join('\n      ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PULSE — ${esc(pageTitle)}</title>
  <style>${sharedCss()}</style>
</head>
<body>
  <nav class="sidebar">
    <div class="sidebar-brand">
      <span class="brand-dot"></span>
      PULSE
    </div>
    <div class="sidebar-nav">
      ${navLinks}
    </div>
    ${PANEL_TOKEN ? '<a href="/auth/logout" style="display:block;padding:10px 20px;color:#8b949e;font-size:0.8rem;text-decoration:none;border-top:1px solid #21262d;margin-top:auto;">Logout</a>' : ''}
  </nav>
  <div class="main-wrapper">
    <header class="header">
      <span class="header-title">${esc(pageTitle)}</span>
      <span class="header-badge">PULSE Panel</span>
    </header>
    <div class="content">
      ${body}
    </div>
  </div>
</body>
</html>`;
}

// ─── POST Body Parser ───────────────────────────────────────────────────────

function parseFormBody(raw: string): Record<string, string> {
  const params = new URLSearchParams(raw);
  const result: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    result[key] = value;
  }
  return result;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const MAX_BODY = 1_048_576; // 1 MB limit

    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        req.destroy();
        reject(new Error('Body too large'));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

// ─── Response Helpers ───────────────────────────────────────────────────────

function htmlResponse(res: http.ServerResponse, html: string, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function jsonResponse(res: http.ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function redirect(res: http.ServerResponse, to: string): void {
  res.writeHead(302, { Location: to });
  res.end();
}

// ─── Auth Helpers ────────────────────────────────────────────────────────────

const PANEL_TOKEN = process.env.PULSE_PANEL_TOKEN;

// Login rate limiting (5 attempts per 15 min per IP)
const loginAttempts = new Map<string, { count: number; lastAttempt: number }>();

function parseCookie(cookieHeader: string, name: string): string | null {
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? match[1] : null;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Hash token for cookie storage so raw token isn't in the cookie */
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function loginPage(error?: string): string {
  const errorHtml = error
    ? `<p style="color:#f85149;margin-bottom:14px;font-size:0.85rem;">${error}</p>`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PULSE — Login</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #0d1117;
      color: #e6edf3;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji';
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .login-box {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 32px;
      width: 320px;
      text-align: center;
    }
    .login-box h2 { margin-bottom: 8px; color: #58a6ff; }
    .login-box p { color: #8b949e; font-size: 0.85rem; margin-bottom: 20px; }
    .login-box input {
      width: 100%;
      background: #0d1117;
      color: #e6edf3;
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 10px 12px;
      font-size: 0.9rem;
      margin-bottom: 14px;
      outline: none;
    }
    .login-box input:focus { border-color: #58a6ff; }
    .login-box button {
      width: 100%;
      background: #238636;
      color: #fff;
      border: none;
      border-radius: 6px;
      padding: 10px;
      font-size: 0.9rem;
      cursor: pointer;
    }
    .login-box button:hover { background: #2ea043; }
  </style>
</head>
<body>
  <div class="login-box">
    <h2>PULSE Panel</h2>
    <p>Enter your panel token to continue.</p>
    ${errorHtml}
    <form method="POST" action="/auth/login">
      <input type="password" name="token" placeholder="Enter panel token" autocomplete="current-password" required />
      <button type="submit">Login</button>
    </form>
  </div>
</body>
</html>`;
}

// ─── Router ─────────────────────────────────────────────────────────────────

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const rawUrl = req.url || '/';
  const method = (req.method || 'GET').toUpperCase();

  // ── Security Headers ──
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');

  // ── Health endpoint (no auth required) ──
  if (rawUrl === '/health' || rawUrl === '/api/health') {
    const health = {
      status: 'ok',
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      llm: process.env.GROQ_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY ? 'configured' : 'no_key',
      search: process.env.SERPER_API_KEY || process.env.BRAVE_API_KEY || process.env.SERPAPI_API_KEY ? 'configured' : 'no_key',
      x_api: process.env.X_API_KEY && process.env.X_ACCESS_TOKEN ? 'configured' : 'no_key',
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(health, null, 2));
    return;
  }

  // ── Auth: POST /auth/login and /auth/logout ──
  if (PANEL_TOKEN && method === 'POST' && rawUrl === '/auth/login') {
    // Rate limit login attempts (5 per 15 min per IP)
    const ip = req.socket.remoteAddress || 'unknown';
    const attempts = loginAttempts.get(ip);
    const now = Date.now();
    if (attempts && now - attempts.lastAttempt < 15 * 60_000 && attempts.count >= 5) {
      res.writeHead(429, { 'Content-Type': 'text/html' });
      res.end('<html><body style="background:#0d1117;color:#f85149;display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;"><div>Too many login attempts. Try again in 15 minutes.</div></body></html>');
      return;
    }

    const raw = await readBody(req);
    const body = parseFormBody(raw);
    const token = body.token || '';
    if (token.length === PANEL_TOKEN.length && timingSafeEqual(token, PANEL_TOKEN)) {
      loginAttempts.delete(ip); // Reset on success
      const hashed = hashToken(PANEL_TOKEN);
      res.writeHead(302, {
        Location: '/queue',
        'Set-Cookie': `pulse_auth=${hashed}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${30 * 86400}`,
      });
      res.end();
    } else {
      // Track failed attempt
      const rec = loginAttempts.get(ip) ?? { count: 0, lastAttempt: 0 };
      rec.count++;
      rec.lastAttempt = Date.now();
      loginAttempts.set(ip, rec);
      res.writeHead(401, { 'Content-Type': 'text/html' });
      res.end(loginPage('Invalid token. Please try again.'));
    }
    return;
  }

  if (PANEL_TOKEN && rawUrl === '/auth/logout') {
    res.writeHead(302, {
      Location: '/',
      'Set-Cookie': 'pulse_auth=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0',
    });
    res.end();
    return;
  }

  // ── Token auth gate ──
  if (PANEL_TOKEN) {
    const url = new URL(rawUrl, `http://${req.headers.host}`);
    const tokenParam = url.searchParams.get('token');
    const cookieHash = parseCookie(req.headers.cookie || '', 'pulse_auth');
    // Also check legacy cookie for existing sessions
    const legacyCookie = parseCookie(req.headers.cookie || '', 'pulse_token');
    const expectedHash = hashToken(PANEL_TOKEN);

    if (tokenParam && tokenParam.length === PANEL_TOKEN.length && timingSafeEqual(tokenParam, PANEL_TOKEN)) {
      // ?token= still works for API/programmatic access — upgrade to hashed cookie
      res.setHeader('Set-Cookie', `pulse_auth=${expectedHash}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${30 * 86400}`);
    } else if (cookieHash === expectedHash) {
      // Valid hashed cookie — good
    } else if (legacyCookie && legacyCookie.length === PANEL_TOKEN.length && timingSafeEqual(legacyCookie, PANEL_TOKEN)) {
      // Upgrade legacy cookie to hashed version
      res.setHeader('Set-Cookie', [
        `pulse_auth=${expectedHash}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${30 * 86400}`,
        'pulse_token=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0',
      ] as any);
    } else {
      res.writeHead(401, { 'Content-Type': 'text/html' });
      res.end(loginPage());
      return;
    }
  }

  try {
    const parsed = new URL(rawUrl, `http://localhost:${PORT}`);
    const pathname = parsed.pathname;
    const query = parsed.searchParams;

    // Root redirects to /create
    if (pathname === '/') {
      return redirect(res, '/create');
    }

    // Legacy redirects for old bookmarks
    const LEGACY_REDIRECTS: Record<string, string> = {
      '/dashboard':    '/create',
      '/queue':        '/create',
      '/review':       '/create?tab=feed',
      '/feed':         '/create?tab=feed',
      '/content':      '/create?tab=feed',
      '/mentions':     '/create?tab=mentions',
      '/outreach':     '/create?tab=outreach',
      '/engage':       '/create?tab=outreach',
      '/analytics':    '/activity',
      '/performance':  '/activity',
      '/voice':        '/settings?tab=voice',
    };
    if (LEGACY_REDIRECTS[pathname]) {
      // Preserve query params from the original URL
      const legacyTarget = LEGACY_REDIRECTS[pathname];
      const originalParams = parsed.search; // e.g. "?msg=success"
      const separator = legacyTarget.includes('?') ? '&' : '?';
      const targetWithParams = originalParams
        ? legacyTarget + separator + originalParams.slice(1) // strip leading ?
        : legacyTarget;
      return redirect(res, targetWithParams);
    }

    // Match route
    const route = ROUTES.find(r => pathname === r.path || pathname.startsWith(r.path + '/'));
    if (!route) {
      const html = layout(pathname, 'Not Found', `
        <div class="empty-state">
          <div class="icon">404</div>
          <h3>Page Not Found</h3>
          <p>The requested path <code>${esc(pathname)}</code> does not exist.</p>
        </div>
      `);
      return htmlResponse(res, html, 404);
    }

    // Load page module
    const page = await loadPage(route.module);

    // ── POST handling ──
    if (method === 'POST') {
      if (!page || !page.handlePost) {
        return jsonResponse(res, { error: 'Page does not support POST' }, 405);
      }

      const rawBody = await readBody(req);
      const body = parseFormBody(rawBody);
      const action = body.action || pathname.split('/').pop() || '';

      const result = await page.handlePost(action, body);

      if (result.redirect) {
        return redirect(res, result.redirect);
      }
      if (result.json !== undefined) {
        return jsonResponse(res, result.json);
      }

      // Default: redirect back to the page
      return redirect(res, route.path);
    }

    // ── GET handling ──
    let innerHtml: string;
    if (page && page.renderPage) {
      innerHtml = await page.renderPage(query);
    } else {
      innerHtml = comingSoonHtml(route.label);
    }

    const html = layout(route.path, route.label, innerHtml);
    return htmlResponse(res, html);

  } catch (err) {
    console.error('Panel error:', err);
    const html = layout('', 'Error', `
      <div class="empty-state">
        <div class="icon">!</div>
        <h3>Internal Server Error</h3>
        <p>${esc(err instanceof Error ? err.message : String(err))}</p>
      </div>
    `);
    htmlResponse(res, html, 500);
  }
}

// ─── Server ─────────────────────────────────────────────────────────────────

let server: http.Server | null = null;

export function startPanel(): http.Server {
  server = http.createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      console.error('Unhandled panel error:', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal server error');
      }
    });
  });

  // ── Startup Validation ──
  const warnings: string[] = [];
  if (!process.env.GROQ_API_KEY && !process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY && !process.env.OPENROUTER_API_KEY) {
    warnings.push('No LLM API key configured. Set GROQ_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY, or OPENROUTER_API_KEY in .env');
  }
  if (!process.env.SERPER_API_KEY && !process.env.BRAVE_API_KEY && !process.env.SERPAPI_API_KEY) {
    warnings.push('No search API key configured. Set SERPER_API_KEY, BRAVE_API_KEY, or SERPAPI_API_KEY in .env');
  }
  if (PANEL_TOKEN && PANEL_TOKEN.length < 16) {
    warnings.push('PULSE_PANEL_TOKEN should be at least 16 characters for security');
  }
  if (warnings.length > 0) {
    console.log('\n  Startup Warnings:');
    warnings.forEach(w => console.log(`    - ${w}`));
    console.log('');
  }

  const host = PANEL_TOKEN ? '0.0.0.0' : '127.0.0.1';
  server.listen(PORT, host, () => {
    console.log(`PULSE Panel running at http://${host === '0.0.0.0' ? 'localhost' : host}:${PORT}`);
    if (!PANEL_TOKEN) {
      console.log('  (localhost only — set PULSE_PANEL_TOKEN in .env to allow remote access)');
    }
    console.log('Pages: ' + ROUTES.map(r => r.path).join(', '));
    console.log('Press Ctrl+C to stop.\n');
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use. Try --port=<other>`);
    } else {
      console.error(`Panel server error: ${err.message}`);
    }
    process.exit(1);
  });

  return server;
}

export function stopPanel(): void {
  if (server) {
    server.close();
    server = null;
  }
}

// Run standalone
if (process.argv[1] && (process.argv[1].endsWith('server.ts') || process.argv[1].endsWith('server.js'))) {
  startPanel();
}
