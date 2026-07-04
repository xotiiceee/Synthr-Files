/**
 * Hosted Pulse SaaS — Main Server
 *
 * Multi-tenant Hono server on port 3457.
 * Auth and billing are resolved through configured providers.
 * Standalone production uses first-party auth, Stripe entitlements, and durable usage.
 *
 * Run: npx tsx hosted/server.ts
 */

import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { config } from 'dotenv'
config()

import {
  apiKeyAuth,
  adminAuth,
  SESSION_MAX_AGE,
  PIN_COOKIE_MAX_AGE,
  hashPin,
  verifyPin,
  isPinVerified,
  hasPin as hasTenantPin,
  getPinHash as getTenantPinHash,
  setPinHash as setTenantPinHash,
  getPinRecoveryEmail,
  generateOtp,
  verifyOtp,
  sendOtpEmail,
  sendPinResetNotification,
} from './auth.js'
import { delegationAuth } from './delegation-auth.js'
import agentRouter from './agent-routes.js'
import {
  isPinLocked,
  listAuditEvents,
  listOpenSafetyEvents,
  recordAuditEvent,
  recordPinFailure,
  resetPinFailures,
} from './db.js'
import {
  withTenantContext,
  initTenantConfig,
  hasTenantXKeys,
  storeTenantXKeys,
} from './tenant.js'
import { getHostedDb, listTenants, getTenant, type Tenant } from './db.js'
import { getBalance } from './billing.js'
import { getUsageSummary } from './limits.js'
import { startScheduler } from './scheduler.js'
import {
  initPulseHeart,
  forkAgentHeart,
  revokeAgentHeart,
} from './heart-client.js'
import { logoutByToken } from './first-party-auth.js'
import { registerFirstPartyAuthRoutes } from './first-party-auth-mount.js'
import { resolveChatToolExecutionOptions } from './chat-tool-execution-context.js'
import { renderOnboarding, handleOnboardingPost } from './pages/onboarding.js'
import {
  handleChatMessage,
  applyChatConfig,
  resetChat,
  renderPage as renderChatSetup,
} from './pages/chat-setup.js'
import { exportPrivacyData, requestPrivacyAction } from './privacy-export.js'
import { getPrivacyRequest } from './db.js'
import {
  getAuthProviderName,
  isFirstPartyAuthEnabled,
  SESSION_COOKIE,
} from './sessions.js'
import { registerStripeWebhookRoute } from './stripe-webhooks.js'
import { resolveAccountPermissions } from './account-permissions.js'
import {
  currentHostedRuntimeAgentId,
  loadHostedRuntimeState,
} from './runtime-agent.js'

import { existsSync as _exists, readFileSync, statSync } from 'node:fs'
import { join as _join, extname as _extname } from 'node:path'
import { createHash } from 'node:crypto'

const app = new Hono()

function stableOperationHash(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex')
    .slice(0, 32)
}

function readCookieValue(
  cookieHeader: string | undefined,
  cookieName: string,
): string | null {
  if (!cookieHeader) return null
  for (const cookie of cookieHeader.split(';')) {
    const [name, ...valueParts] = cookie.trim().split('=')
    if (name !== cookieName) continue
    const rawValue = valueParts.join('=')
    if (!rawValue) return null
    try {
      return decodeURIComponent(rawValue)
    } catch {
      return rawValue
    }
  }
  return null
}

function getRequestOperationId(c: any, fallback: unknown): string {
  const header =
    c.req.header('Idempotency-Key') || c.req.header('X-Idempotency-Key')
  return header?.trim() || stableOperationHash(fallback)
}

function getRequestIdempotencyHeader(c: any): string | undefined {
  return (
    (
      c.req.header('Idempotency-Key') || c.req.header('X-Idempotency-Key')
    )?.trim() || undefined
  )
}

// ── Platform Context: auto-injected product knowledge for all chat sessions ──
// Reads platform-context.md from project root. Operator edits this file,
// all tenants get it automatically. Cached in memory, refreshes when file changes.
const PLATFORM_CONTEXT_PATH = _join(
  import.meta.dirname || '.',
  '..',
  'platform-context.md',
)
let _platformContextCache: { content: string; mtime: number } | null = null

function getPlatformContext(): string {
  try {
    if (!_exists(PLATFORM_CONTEXT_PATH)) return ''
    const stat = statSync(PLATFORM_CONTEXT_PATH)
    const mtime = stat.mtimeMs
    if (_platformContextCache && _platformContextCache.mtime === mtime) {
      return _platformContextCache.content
    }
    const raw = readFileSync(PLATFORM_CONTEXT_PATH, 'utf-8')
    // Strip the markdown title + instruction header, keep the product facts
    const cleaned = raw
      .replace(/^#[^\n]*\n+/m, '')
      .replace(/^Use this as ground truth[^\n]*\n+/m, '')
      .replace(/^---\n*/m, '')
      .trim()
    _platformContextCache = { content: cleaned, mtime }
    return cleaned
  } catch {
    return ''
  }
}

/** Get agent-scoped state key for knowledge notes.
 * Each agent has its own notes — different brands = different knowledge. */
async function knowledgeKey(): Promise<string> {
  const agentId = currentHostedRuntimeAgentId()
  return `knowledge-notes-${agentId}`
}

/** One-time migration: copy shared knowledge-notes.json to per-agent file.
 * Runs once per tenant when the per-agent file doesn't exist yet. */
async function migrateKnowledgeIfNeeded(): Promise<void> {
  const { loadState, saveState } = await import('../src/core/state.js')
  const key = await knowledgeKey()
  const perAgent = loadState<any[]>(key, [])
  if (perAgent.length > 0) return // already has per-agent notes
  const shared = loadState<any[]>('knowledge-notes', [])
  if (shared.length === 0) return // nothing to migrate
  // Check migration flag to avoid copying shared notes to every new agent
  const migrated = loadState<{ done: boolean }>('knowledge-notes-migrated', {
    done: false,
  })
  if (migrated.done) return
  // Copy shared notes to this agent and set flag
  saveState(key, shared)
  saveState('knowledge-notes-migrated', { done: true })
}
const PORT = parseInt(process.env.HOSTED_PORT || '3457', 10)
const _spaReady = _exists(
  _join(import.meta.dirname || '.', 'ui', 'dist', 'index.html'),
)
const _deployMetaPath = _join(import.meta.dirname || '.', 'deploy-meta.json')
const CLAWNET_API = process.env.CLAWNET_API_URL || 'https://api.claw-net.org'
const CLAWNET_URL = 'https://claw-net.org' // Human-facing website (not the API)
const PULSE_URL = process.env.PULSE_URL || `http://localhost:${PORT}`
const SUPPORT_EMAIL = process.env.PULSE_SUPPORT_EMAIL || 'support@pulse.app'

function readDeployMeta() {
  try {
    if (!_exists(_deployMetaPath)) return null
    return JSON.parse(readFileSync(_deployMetaPath, 'utf8'))
  } catch {
    return null
  }
}

// ─── Public Routes ──────────────────────────────────────────────────────────

app.get('/health', (c) =>
  c.json({
    status: 'ok',
    service: 'pulse-hosted',
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    spaReady: _spaReady,
    deploy: readDeployMeta(),
  }),
)

app.get('/api/deploy-info', (c) =>
  c.json({
    service: 'pulse-hosted',
    spaReady: _spaReady,
    deploy: readDeployMeta(),
  }),
)

registerStripeWebhookRoute(app)

app.get('/login', (c) => {
  if (isFirstPartyAuthEnabled(getAuthProviderName()) && _spaReady) {
    c.header('Cache-Control', 'no-cache, no-store, must-revalidate')
    return c.html(
      readFileSync(
        _join(import.meta.dirname || '.', 'ui', 'dist', 'index.html'),
        'utf-8',
      ),
    )
  }

  const error = new URL(c.req.url).searchParams.get('error')
  const errorMessages: Record<string, string> = {
    invalid: 'Invalid API key. Check your key and try again.',
    no_code: 'Authorization failed. No code received.',
    invalid_code: 'Authorization failed. Please try again.',
    network: 'Could not reach ClawNet. Check your connection and try again.',
    timeout: 'ClawNet took too long to respond. Please try again.',
  }
  const errorMsg = error
    ? errorMessages[error] || 'Something went wrong. Please try again.'
    : ''
  const oauthUrl = `https://claw-net.org/oauth.html?app=pulse&redirect=${encodeURIComponent(PULSE_URL + '/auth/callback')}`

  return c.html(`<!DOCTYPE html>
<html><head><title>Pulse — Sign In</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0d1117;color:#e6edf3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh}
.login-card{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:40px;max-width:420px;width:90%;text-align:center}
h1{color:#58a6ff;margin-bottom:4px;font-size:1.6rem;letter-spacing:-0.02em}
.subtitle{color:#8b949e;margin-bottom:28px;font-size:0.9rem}
.btn-clawnet{display:block;width:100%;padding:14px;background:#238636;color:#fff;text-align:center;text-decoration:none;border-radius:8px;font-size:1rem;font-weight:600;margin-bottom:16px;transition:background 0.15s}
.btn-clawnet:hover{background:#2ea043}
.error{color:#f85149;font-size:0.85rem;margin-bottom:16px;padding:10px;background:rgba(248,81,73,0.1);border:1px solid rgba(248,81,73,0.2);border-radius:6px}
.hint{color:#8b949e;font-size:0.78rem;margin-top:20px}
.hint a{color:#58a6ff;text-decoration:none}
.hint a:hover{text-decoration:underline}
</style>
</head><body><div class="login-card">
<h1>Pulse</h1>
<p class="subtitle">X Marketing Automation</p>
${errorMsg ? `<div class="error">${errorMsg}</div>` : ''}
<a href="${oauthUrl}" class="btn-clawnet">Sign in with ClawNet</a>
<p class="hint">Don't have an account? <a href="${oauthUrl}" >Sign up</a> — it takes 10 seconds.</p>
</div></body></html>`)
})

app.get('/auth/callback', async (c) => {
  const code = new URL(c.req.url).searchParams.get('code')

  if (!code) return c.redirect('/login?error=no_code')

  try {
    const tokenUrl = `${CLAWNET_API}/v1/oauth/token`

    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, app: 'pulse' }),
      signal: AbortSignal.timeout(10000),
    })

    if (!res.ok) {
      return c.redirect('/login?error=invalid_code')
    }

    const data = (await res.json()) as any

    if (!data.apiKey) {
      return c.redirect('/login?error=invalid_code')
    }

    // Set cookie and redirect — use c.header() for proper Hono handling
    c.header(
      'Set-Cookie',
      `pulse_api_key=${encodeURIComponent(data.apiKey)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}`,
    )

    return c.redirect('/')
  } catch (err) {
    const isTimeout =
      err instanceof Error &&
      (err.name === 'AbortError' || err.message.includes('timeout'))
    return c.redirect(`/login?error=${isTimeout ? 'timeout' : 'network'}`)
  }
})

app.get('/auth/logout', (c) => {
  if (isFirstPartyAuthEnabled(getAuthProviderName())) {
    const token = readCookieValue(c.req.header('cookie'), SESSION_COOKIE.name)
    const result = logoutByToken(token || '', {
      isProduction: process.env.NODE_ENV === 'production',
    })
    return new Response(null, {
      status: 302,
      headers: {
        Location: '/login',
        'Set-Cookie': [
          result.clearCookieHeader,
          'pulse_pin_verified=; Path=/; HttpOnly; Max-Age=0',
        ].join(', '),
      },
    })
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: '/login',
      'Set-Cookie': [
        'pulse_api_key=; Path=/; HttpOnly; Max-Age=0',
        'pulse_pin_verified=; Path=/; HttpOnly; Max-Age=0',
      ].join(', '),
    },
  })
})

registerFirstPartyAuthRoutes(app, {
  expectedOrigin: PULSE_URL,
  isProduction: process.env.NODE_ENV === 'production',
})

// ─── Stripe Billing Checkout & Portal ───────────────────────────────────────

app.post('/api/billing/checkout', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const priceId = body?.priceId;
  if (!priceId || typeof priceId !== 'string') {
    return c.json({ ok: false, error: 'priceId is required' }, 400);
  }

  const { createCheckoutSession } = await import('./stripe-checkout.js');
  const result = await createCheckoutSession(c.req.header('cookie'), priceId, PULSE_URL);

  if ('error' in result) {
    return c.json({ ok: false, error: result.error }, 400);
  }
  return c.json({ ok: true, url: result.url });
});

app.post('/api/billing/portal', async (c) => {
  const { createPortalSession } = await import('./stripe-checkout.js');
  const result = await createPortalSession(c.req.header('cookie'), PULSE_URL);

  if ('error' in result) {
    return c.json({ ok: false, error: result.error }, 400);
  }
  return c.json({ ok: true, url: result.url });
});

// ─── SPA Static Assets (served BEFORE auth — these are public) ──────────────

if (_spaReady) {
  const _spaDir = _join(import.meta.dirname || '.', 'ui', 'dist')
  const _mimeTypes: Record<string, string> = {
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.json': 'application/json',
  }
  app.get('/assets/*', (c) => {
    const filePath = _join(_spaDir, new URL(c.req.url).pathname)
    if (_exists(filePath)) {
      const ext = _extname(filePath)
      return new Response(readFileSync(filePath), {
        headers: {
          'Content-Type': _mimeTypes[ext] || 'application/octet-stream',
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      })
    }
    return c.notFound()
  })
}

// ─── Agent API Routes (delegation auth — separate from UI auth) ──────────────

app.use('/v1/pulse/*', delegationAuth())
app.route('/v1/pulse', agentRouter)

// ─── Auth Middleware ─────────────────────────────────────────────────────────

app.use('/*', apiKeyAuth())

// ─── Onboarding ─────────────────────────────────────────────────────────────

app.get('/onboarding', (c) => {
  const tenant = c.get('tenant')
  const step = parseInt(new URL(c.req.url).searchParams.get('step') || '1', 10)
  return c.html(wrapLayout(renderOnboarding(tenant, step), tenant, 'Setup'))
})

app.post('/onboarding', async (c) => {
  const tenant = c.get('tenant')
  const body = (await c.req.parseBody()) as Record<string, string>
  const result = await handleOnboardingPost(tenant, body)
  return c.redirect(result.redirect)
})

// ─── Dashboard ──────────────────────────────────────────────────────────────

app.get('/', async (c) => {
  // Always route to chat — it handles both new and returning users
  if (_spaReady) return c.redirect('/chat-setup')
  return c.redirect('/chat-setup')
})

// ─── PIN Entry & Setup ──────────────────────────────────────────────────────

function pinPageHtml(
  title: string,
  desc: string,
  action: string,
  error?: string,
  isSetup?: boolean,
): string {
  const errorHtml = error
    ? `<div style="color:#f85149;font-size:0.85rem;margin-bottom:16px;padding:10px;background:rgba(248,81,73,0.1);border:1px solid rgba(248,81,73,0.2);border-radius:6px;">${error}</div>`
    : ''
  const confirmField = isSetup
    ? `<div style="margin-bottom:16px"><label style="display:block;color:#8b949e;font-size:0.82rem;margin-bottom:6px;">Confirm PIN</label><input type="password" name="pinConfirm" inputmode="numeric" pattern="[0-9]{4,6}" minlength="4" maxlength="6" required autocomplete="off" style="width:100%;padding:12px;background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:6px;font-size:1.2rem;text-align:center;letter-spacing:0.3em;outline:none;" placeholder="····"></div><div style="margin-bottom:16px"><label style="display:block;color:#8b949e;font-size:0.82rem;margin-bottom:6px;">Recovery email</label><input type="email" name="recoveryEmail" required style="width:100%;padding:12px;background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:6px;font-size:0.9rem;outline:none;" placeholder="your@email.com"></div>`
    : ''
  return `<!DOCTYPE html><html><head><title>Pulse — ${title}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="shortcut icon" href="/favicon.ico">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="icon" type="image/png" href="/favicon.png" sizes="32x32">
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0d1117;color:#e6edf3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh}.card{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:36px;max-width:380px;width:90%;text-align:center}h1{color:#58a6ff;font-size:1.4rem;margin-bottom:4px}p{color:#8b949e;font-size:0.88rem;margin-bottom:24px}button{width:100%;padding:12px;background:#238636;color:#fff;border:none;border-radius:6px;font-size:0.95rem;font-weight:600;cursor:pointer}button:hover{background:#2ea043}</style>
</head><body><div class="card">
<h1>${title}</h1>
<p>${desc}</p>
${errorHtml}
<form method="POST" action="${action}">
  <div style="margin-bottom:16px">
    <label style="display:block;color:#8b949e;font-size:0.82rem;margin-bottom:6px;">${isSetup ? 'Choose a PIN' : 'Enter PIN'}</label>
    <input type="password" name="pin" inputmode="numeric" pattern="[0-9]{4,6}" minlength="4" maxlength="6" required autofocus autocomplete="off" style="width:100%;padding:12px;background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:6px;font-size:1.2rem;text-align:center;letter-spacing:0.3em;outline:none;" placeholder="····">
  </div>
  ${confirmField}
  <button type="submit">${isSetup ? 'Set PIN' : 'Unlock'}</button>
</form>
${isSetup ? '' : '<p style="margin-top:16px;margin-bottom:0;"><a href="/auth/logout" style="color:#484f58;font-size:0.78rem;">Log out instead</a></p>'}
</div></body></html>`
}

app.get('/pin', (c) => {
  const tenant = c.get('tenant')
  if (!hasTenantPin(tenant.id)) return c.redirect('/pin/setup')
  if (isPinVerified(c)) return c.redirect('/')
  const error = new URL(c.req.url).searchParams.get('error')
  const lock = isPinLocked(tenant.id)
  const errorMsg = lock.locked
    ? `Too many attempts. Try again in ${lock.retryAfterSec} seconds.`
    : error === 'wrong'
      ? 'Incorrect PIN. Try again.'
      : error === 'locked'
        ? 'Account temporarily locked. Try again shortly.'
        : undefined
  const html = pinPageHtml(
    'Locked',
    'Enter your PIN to continue.',
    '/pin',
    errorMsg,
  )
  return c.html(
    html.replace(
      '</form>',
      '</form><p style="margin-top:16px;margin-bottom:0;font-size:0.78rem;"><a href="/pin/forgot" style="color:#58a6ff;">Forgot PIN?</a> · <a href="/auth/logout" style="color:#484f58;">Log out</a></p>',
    ),
  )
})

app.post('/pin', async (c) => {
  const tenant = c.get('tenant')

  // Check lockout before attempting
  const lock = isPinLocked(tenant.id)
  if (lock.locked) return c.redirect('/pin?error=locked')

  const body = await c.req.parseBody()
  const pin = ((body.pin as string) || '').trim()
  const stored = getTenantPinHash(tenant.id)
  if (!stored || !verifyPin(pin, stored)) {
    recordPinFailure(tenant.id)
    return c.redirect('/pin?error=wrong')
  }
  // Success — reset failure counter
  resetPinFailures(tenant.id)
  // Set PIN verified cookie (same lifetime as session)
  return new Response(null, {
    status: 302,
    headers: {
      Location: '/',
      'Set-Cookie': `pulse_pin_verified=1; Path=/; HttpOnly; SameSite=Lax; Max-Age=${PIN_COOKIE_MAX_AGE}`,
    },
  })
})

app.get('/pin/setup', (c) => {
  const tenant = c.get('tenant')
  if (hasTenantPin(tenant.id)) return c.redirect('/pin')
  const error = new URL(c.req.url).searchParams.get('error')
  const msgs: Record<string, string> = {
    mismatch: "PINs don't match.",
    short: 'PIN must be 4-6 digits.',
    numeric: 'PIN must be numbers only.',
  }
  return c.html(
    pinPageHtml(
      'Set a PIN',
      "Choose a 4-6 digit PIN. You'll need it to access Pulse after being away.",
      '/pin/setup',
      error ? msgs[error] : undefined,
      true,
    ),
  )
})

app.post('/pin/setup', async (c) => {
  const tenant = c.get('tenant')
  const body = await c.req.parseBody()
  const pin = ((body.pin as string) || '').trim()
  const confirm = ((body.pinConfirm as string) || '').trim()
  const recoveryEmail = ((body.recoveryEmail as string) || '')
    .trim()
    .toLowerCase()
  if (!/^\d{4,6}$/.test(pin))
    return c.redirect(
      '/pin/setup?error=' + (pin.length < 4 ? 'short' : 'numeric'),
    )
  if (pin !== confirm) return c.redirect('/pin/setup?error=mismatch')
  setTenantPinHash(tenant.id, hashPin(pin), recoveryEmail || undefined)
  return new Response(null, {
    status: 302,
    headers: {
      Location: '/',
      'Set-Cookie': `pulse_pin_verified=1; Path=/; HttpOnly; SameSite=Lax; Max-Age=${PIN_COOKIE_MAX_AGE}`,
    },
  })
})

// ─── Forgot PIN (email OTP recovery) ────────────────────────────────────────

app.get('/pin/forgot', async (c) => {
  const tenant = c.get('tenant')
  const email = getPinRecoveryEmail(tenant.id)
  if (!email) {
    return c.html(
      pinPageHtml(
        'No Recovery Email',
        `No recovery email is set for this account. Contact support at ${SUPPORT_EMAIL}.`,
        '/pin',
      ),
    )
  }
  const maskedEmail = email.replace(/^(.{2})(.*)(@.*)$/, '$1***$3')
  // Send OTP
  const code = generateOtp(tenant.id)
  await sendOtpEmail(email, code, 'Pulse')
  return c.redirect('/pin/verify-otp?sent=1')
})

app.get('/pin/verify-otp', (c) => {
  const tenant = c.get('tenant')
  const email = getPinRecoveryEmail(tenant.id)
  const maskedEmail = email
    ? email.replace(/^(.{2})(.*)(@.*)$/, '$1***$3')
    : 'your email'
  const error = new URL(c.req.url).searchParams.get('error')
  const errorHtml = error
    ? `<div style="color:#f85149;font-size:0.85rem;margin-bottom:16px;padding:10px;background:rgba(248,81,73,0.1);border:1px solid rgba(248,81,73,0.2);border-radius:6px;">${error}</div>`
    : ''
  return c.html(
    pinPageHtml(
      'Verify Email',
      `We sent a 6-digit code to ${maskedEmail}`,
      '/pin/verify-otp',
      error ? undefined : undefined,
    )
      .replace('<input type="password"', `${errorHtml}<input type="text"`)
      .replace(
        'placeholder="····"',
        'placeholder="000000" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6"',
      )
      .replace('>Unlock<', '>Verify<'),
  )
})

app.post('/pin/verify-otp', async (c) => {
  const tenant = c.get('tenant')
  const body = await c.req.parseBody()
  const code = ((body.pin as string) || '').trim()
  const result = verifyOtp(tenant.id, code)
  if (!result.ok)
    return c.redirect(
      '/pin/verify-otp?error=' +
        encodeURIComponent(result.error || 'Invalid code'),
    )
  // OTP verified — redirect to reset PIN
  return c.redirect('/pin/reset')
})

app.get('/pin/reset', (c) => {
  const error = new URL(c.req.url).searchParams.get('error')
  const msgs: Record<string, string> = {
    mismatch: "PINs don't match.",
    short: 'PIN must be 4-6 digits.',
    numeric: 'PIN must be numbers only.',
  }
  return c.html(
    pinPageHtml(
      'New PIN',
      'Choose a new 4-6 digit PIN.',
      '/pin/reset',
      error ? msgs[error] : undefined,
      true,
    ),
  )
})

app.post('/pin/reset', async (c) => {
  const tenant = c.get('tenant')
  const body = await c.req.parseBody()
  const pin = ((body.pin as string) || '').trim()
  const confirm = ((body.pinConfirm as string) || '').trim()
  if (!/^\d{4,6}$/.test(pin))
    return c.redirect(
      '/pin/reset?error=' + (pin.length < 4 ? 'short' : 'numeric'),
    )
  if (pin !== confirm) return c.redirect('/pin/reset?error=mismatch')
  const recoveryEmail =
    ((body.recoveryEmail as string) || '').trim().toLowerCase() ||
    getPinRecoveryEmail(tenant.id) ||
    undefined
  setTenantPinHash(tenant.id, hashPin(pin), recoveryEmail)
  // Send notification
  if (recoveryEmail)
    sendPinResetNotification(recoveryEmail, 'Pulse').catch(() => {})
  return new Response(null, {
    status: 302,
    headers: {
      Location: '/',
      'Set-Cookie': `pulse_pin_verified=1; Path=/; HttpOnly; SameSite=Lax; Max-Age=${PIN_COOKIE_MAX_AGE}`,
    },
  })
})

app.post('/pin/resend-otp', async (c) => {
  const tenant = c.get('tenant')
  const email = getPinRecoveryEmail(tenant.id)
  if (email) {
    const code = generateOtp(tenant.id)
    await sendOtpEmail(email, code, 'Pulse')
  }
  return c.redirect('/pin/verify-otp?sent=1')
})

// ─── Backwards-compat redirects ─────────────────────────────────────────────
app.get('/queue', (c) => c.redirect('/create'))
app.get('/performance', (c) => c.redirect('/activity'))

// ─── API Routes ─────────────────────────────────────────────────────────────

app.get('/api/usage', (c) => c.json(getUsageSummary(c.get('tenant'))))

app.get('/api/account/permissions', (c) => {
  return c.json(
    resolveAccountPermissions({
      authProvider: getAuthProviderName(),
      cookieHeader: c.req.header('cookie'),
      tenantId: c.get('tenant').id,
    }),
  )
})

function parseMetadata(value: string): Record<string, unknown> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : {}
  } catch {
    return {}
  }
}

app.get('/api/operations', (c) => {
  const tenant = c.get('tenant')
  const url = new URL(c.req.url)
  const requestedLimit = Number(url.searchParams.get('limit') || 50)
  const limit =
    Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(Math.floor(requestedLimit), 100)
      : 50
  const auditEvents = listAuditEvents(tenant.id, limit).map((event) => ({
    id: event.id,
    tenantId: event.tenant_id,
    orgId: event.org_id,
    workspaceId: event.workspace_id,
    brandId: event.brand_id,
    agentId: event.agent_id,
    actorId: event.actor_id,
    action: event.action,
    targetType: event.target_type,
    targetId: event.target_id,
    metadata: parseMetadata(event.metadata),
    createdAt: event.created_at,
  }))
  const safetyEvents = listOpenSafetyEvents(tenant.id, limit).map((event) => ({
    id: event.id,
    tenantId: event.tenant_id,
    orgId: event.org_id,
    workspaceId: event.workspace_id,
    brandId: event.brand_id,
    agentId: event.agent_id,
    severity: event.severity,
    source: event.source,
    eventType: event.event_type,
    message: event.message,
    metadata: parseMetadata(event.metadata),
    resolvedAt: event.resolved_at,
    createdAt: event.created_at,
  }))
  const criticalSafetyEvents = safetyEvents.filter(
    (event) => event.severity === 'critical',
  ).length

  return c.json({
    auditEvents,
    safetyEvents,
    summary: {
      auditEventCount: auditEvents.length,
      openSafetyEventCount: safetyEvents.length,
      criticalSafetyEventCount: criticalSafetyEvents,
      lastAuditAt: auditEvents[0]?.createdAt || null,
    },
  })
})

app.get('/api/credits', async (c) => {
  const tenant = c.get('tenant')
  const balance = await getBalance(c.get('apiKey'), { tenantId: tenant.id })
  const {
    CONTENT_MODELS,
    CHAT_MODELS: billingChat,
    FLAT_COSTS,
  } = await import('./billing.js')
  const { getDailySpend, getMonthlySpendTotal, getUsageProjection } =
    await import('./limits.js')
  const contentCosts = Object.fromEntries(
    Object.values(CONTENT_MODELS).map((m: any) => [m.id, m.costs]),
  )
  const chatCosts = Object.fromEntries(
    Object.values(billingChat).map((m: any) => [m.id, m.credits]),
  )
  const projection = getUsageProjection(tenant.id, balance)
  return c.json({
    credits: balance,
    contentCosts,
    chatCosts,
    flatCosts: FLAT_COSTS,
    spend: {
      today: getDailySpend(tenant.id),
      thisMonth: getMonthlySpendTotal(tenant.id),
    },
    projection: {
      avgDailySpend: projection.avgDailySpend,
      daysRemaining: projection.daysRemaining,
      burnRate: projection.burnRate,
    },
  })
})

app.post('/api/keys/x', async (c) => {
  const tenant = c.get('tenant')
  const { apiKey, apiSecret, accessToken, accessTokenSecret, agentId } =
    await c.req.json<{
      apiKey: string
      apiSecret: string
      accessToken: string
      accessTokenSecret: string
      agentId?: string
    }>()
  storeTenantXKeys(
    tenant.id,
    { apiKey, apiSecret, accessToken, accessTokenSecret },
    agentId || undefined,
  )
  return c.json({ ok: true })
})

app.get('/api/keys/x/status', (c) => {
  const agentId = new URL(c.req.url).searchParams.get('agentId') || undefined
  return c.json({ configured: hasTenantXKeys(c.get('tenant').id, agentId) })
})

app.post('/api/keys/x/disconnect', async (c) => {
  const tenant = c.get('tenant')
  const { agentId } = await c.req.json<{ agentId?: string }>()
  const { deleteSecret } = await import('./db.js')
  const prefix = agentId && agentId !== 'default' ? `${agentId}:` : ''
  for (const key of [
    'X_API_KEY',
    'X_API_SECRET',
    'X_ACCESS_TOKEN',
    'X_ACCESS_TOKEN_SECRET',
  ]) {
    deleteSecret(tenant.id, `${prefix}${key}`)
  }
  return c.json({ ok: true })
})

// ─── X OAuth 2.0 PKCE Flow ─────────────────────────────────────────────────

const xOAuthStates = new Map<
  string,
  { tenantId: string; agentId: string; codeVerifier: string; expiresAt: number }
>()
const X_CLIENT_ID = process.env.X_OAUTH_CLIENT_ID || ''
const X_CLIENT_SECRET = process.env.X_OAUTH_CLIENT_SECRET || ''

import crypto from 'node:crypto'

function generatePKCE(): { codeVerifier: string; codeChallenge: string } {
  const verifier = crypto.randomBytes(32).toString('base64url')
  const challenge = crypto
    .createHash('sha256')
    .update(verifier)
    .digest('base64url')
  return { codeVerifier: verifier, codeChallenge: challenge }
}

app.get('/auth/x/authorize', (c) => {
  if (!X_CLIENT_ID)
    return c.redirect('/settings?tab=connections&x_error=oauth_not_configured')
  const tenant = c.get('tenant')
  const agentId = new URL(c.req.url).searchParams.get('agentId') || 'default'
  const { codeVerifier, codeChallenge } = generatePKCE()
  const state = crypto.randomBytes(16).toString('hex')

  xOAuthStates.set(state, {
    tenantId: tenant.id,
    agentId,
    codeVerifier,
    expiresAt: Date.now() + 600_000,
  })

  // Cleanup expired states
  for (const [k, v] of xOAuthStates) {
    if (Date.now() > v.expiresAt) xOAuthStates.delete(k)
  }

  const scopes =
    'tweet.read tweet.write users.read follows.read follows.write offline.access'
  const authUrl = `https://x.com/i/oauth2/authorize?response_type=code&client_id=${encodeURIComponent(X_CLIENT_ID)}&redirect_uri=${encodeURIComponent(PULSE_URL + '/auth/x/callback')}&scope=${encodeURIComponent(scopes)}&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`

  return c.redirect(authUrl)
})

app.get('/auth/x/callback', async (c) => {
  const url = new URL(c.req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')

  if (error || !code || !state) {
    return c.redirect('/settings?tab=brand&x_error=denied')
  }

  const stored = xOAuthStates.get(state)
  if (!stored || Date.now() > stored.expiresAt) {
    return c.redirect('/settings?tab=brand&x_error=expired')
  }
  xOAuthStates.delete(state)

  try {
    // Exchange code for tokens
    const tokenRes = await fetch('https://api.x.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization:
          'Basic ' +
          Buffer.from(`${X_CLIENT_ID}:${X_CLIENT_SECRET}`).toString('base64'),
      },
      body: new URLSearchParams({
        code,
        grant_type: 'authorization_code',
        redirect_uri: PULSE_URL + '/auth/x/callback',
        code_verifier: stored.codeVerifier,
      }).toString(),
      signal: AbortSignal.timeout(10000),
    })

    if (!tokenRes.ok) {
      console.error(
        '[X OAuth] Token exchange failed:',
        await tokenRes.text().catch(() => ''),
      )
      return c.redirect('/settings?tab=brand&x_error=token_failed')
    }

    const tokens = (await tokenRes.json()) as {
      access_token: string
      refresh_token?: string
      expires_in: number
    }

    // Fetch the user's X profile to get their username
    let xUsername = ''
    try {
      const meRes = await fetch('https://api.x.com/2/users/me', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
        signal: AbortSignal.timeout(5000),
      })
      if (meRes.ok) {
        const me = (await meRes.json()) as {
          data?: { username?: string; name?: string }
        }
        xUsername = me.data?.username || ''
      }
    } catch {}

    // Store tokens encrypted per-agent
    storeTenantXKeys(
      stored.tenantId,
      {
        apiKey: 'oauth2',
        apiSecret: tokens.refresh_token || '',
        accessToken: tokens.access_token,
        accessTokenSecret: String(Date.now() + tokens.expires_in * 1000), // expiry timestamp
      },
      stored.agentId !== 'default' ? stored.agentId : undefined,
    )

    return c.redirect(
      `/settings?tab=brand&x_connected=1${xUsername ? `&x_username=${encodeURIComponent(xUsername)}` : ''}`,
    )
  } catch (err) {
    console.error('[X OAuth] Callback error:', err)
    return c.redirect('/settings?tab=brand&x_error=failed')
  }
})

app.get('/auth/github/authorize', async (c) => {
  const tenant = c.get('tenant')
  const { issueGitHubOAuthState, getGitHubAuthorizeUrl } =
    await import('./github.js')
  if (
    !process.env.GITHUB_OAUTH_CLIENT_ID ||
    !process.env.GITHUB_OAUTH_CLIENT_SECRET
  ) {
    return c.redirect(
      '/settings?tab=integrations&github_error=oauth_not_configured',
    )
  }
  const state = issueGitHubOAuthState(tenant.id)
  return c.redirect(
    getGitHubAuthorizeUrl(state, `${PULSE_URL}/auth/github/callback`),
  )
})

app.get('/auth/github/callback', async (c) => {
  const url = new URL(c.req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')

  if (error || !code || !state) {
    return c.redirect('/settings?tab=integrations&github_error=denied')
  }

  const github = await import('./github.js')
  const db = await import('./db.js')
  const resolved = github.consumeGitHubOAuthState(state)
  if (!resolved) {
    return c.redirect('/settings?tab=integrations&github_error=expired')
  }

  try {
    const token = await github.exchangeGitHubCode(
      code,
      `${PULSE_URL}/auth/github/callback`,
    )
    github.storeGitHubToken(resolved.tenantId, token)
    const viewer = await github.getGitHubViewer(resolved.tenantId)
    db.upsertGitHubConnection(resolved.tenantId, {
      githubUserId: viewer.id,
      login: viewer.login,
      name: viewer.name,
      avatarUrl: viewer.avatarUrl,
    })
    return c.redirect(
      `/settings?tab=integrations&github_connected=1&github_login=${encodeURIComponent(viewer.login)}`,
    )
  } catch (err) {
    console.error('[GitHub OAuth] Callback error:', err)
    return c.redirect('/settings?tab=integrations&github_error=failed')
  }
})

app.get('/api/integrations/github', async (c) => {
  const tenant = c.get('tenant')
  return await withTenantContext(tenant.id, async () => {
    const db = await import('./db.js')
    const connection = db.getGitHubConnection(tenant.id)
    const agentLinks = db.listGitHubRepoAgentLinks(tenant.id)
    const agentIdsByRepo = new Map<string, string[]>()
    for (const link of agentLinks) {
      const existing = agentIdsByRepo.get(link.repo_id) || []
      existing.push(link.agent_id)
      agentIdsByRepo.set(link.repo_id, existing)
    }
    const repos = db.listGitHubRepoLinks(tenant.id).map((repo) => ({
      ...repo,
      allowed_paths: JSON.parse(repo.allowed_paths || '[]'),
      agent_ids: agentIdsByRepo.get(repo.repo_id) || ['default'],
    }))
    return c.json({ connected: !!connection, connection, repos })
  })
})

app.get('/api/integrations/github/repos', async (c) => {
  const tenant = c.get('tenant')
  return await withTenantContext(tenant.id, async () => {
    const github = await import('./github.js')
    const db = await import('./db.js')
    const links = db.listGitHubRepoLinks(tenant.id)
    const agentLinks = db.listGitHubRepoAgentLinks(tenant.id)
    const agentIdsByRepo = new Map<string, string[]>()
    for (const link of agentLinks) {
      const existing = agentIdsByRepo.get(link.repo_id) || []
      existing.push(link.agent_id)
      agentIdsByRepo.set(link.repo_id, existing)
    }
    const linkedById = new Map(links.map((link) => [link.repo_id, link]))
    const repos = await github.listGitHubRepos(tenant.id)
    return c.json({
      repos: repos.map((repo) => {
        const linked = linkedById.get(repo.repoId)
        return {
          ...repo,
          selected: !!linked,
          trustMode: linked?.trust_mode || 'metadata',
          syncEnabled: linked ? !!linked.sync_enabled : true,
          allowedPaths: linked ? JSON.parse(linked.allowed_paths || '[]') : [],
          agentIds: linked
            ? agentIdsByRepo.get(repo.repoId) || ['default']
            : ['default'],
          lastSyncedAt: linked?.last_synced_at || null,
          lastSyncStatus: linked?.last_sync_status || 'never',
          summary: linked?.summary || '',
        }
      }),
    })
  })
})

app.post('/api/integrations/github/repos', async (c) => {
  const tenant = c.get('tenant')
  const body = await c.req.json<{
    repos?: Array<{
      repoId: string
      trustMode?: 'metadata' | 'docs' | 'full'
      allowedPaths?: string[]
      syncEnabled?: boolean
      agentIds?: string[]
    }>
  }>()
  const selected = Array.isArray(body.repos) ? body.repos : []

  return await withTenantContext(tenant.id, async () => {
    const github = await import('./github.js')
    const db = await import('./db.js')
    const accessible = await github.listGitHubRepos(tenant.id)
    const byId = new Map(accessible.map((repo) => [repo.repoId, repo]))

    const keep = new Set(selected.map((repo) => repo.repoId))
    for (const linked of db.listGitHubRepoLinks(tenant.id)) {
      if (!keep.has(linked.repo_id))
        db.deleteGitHubRepoLink(tenant.id, linked.repo_id)
    }

    for (const repo of selected) {
      const source = byId.get(repo.repoId)
      if (!source) continue
      const trustMode = repo.trustMode || 'metadata'
      const allowedPaths =
        trustMode === 'metadata'
          ? []
          : (repo.allowedPaths || [])
              .slice(0, 12)
              .map((p) => String(p).trim())
              .filter(Boolean)
      db.upsertGitHubRepoLink(tenant.id, {
        repoId: source.repoId,
        owner: source.owner,
        name: source.name,
        fullName: source.fullName,
        isPrivate: source.isPrivate,
        defaultBranch: source.defaultBranch,
        syncEnabled: repo.syncEnabled !== false,
        trustMode,
        allowedPaths,
        lastSyncStatus: 'configured',
      })
      db.setGitHubRepoAgentLinks(
        tenant.id,
        source.repoId,
        (repo.agentIds || ['default']).slice(0, 24),
      )
    }

    const agentLinks = db.listGitHubRepoAgentLinks(tenant.id)
    const agentIdsByRepo = new Map<string, string[]>()
    for (const link of agentLinks) {
      const existing = agentIdsByRepo.get(link.repo_id) || []
      existing.push(link.agent_id)
      agentIdsByRepo.set(link.repo_id, existing)
    }
    const repos = db.listGitHubRepoLinks(tenant.id).map((repo) => ({
      ...repo,
      allowed_paths: JSON.parse(repo.allowed_paths || '[]'),
      agent_ids: agentIdsByRepo.get(repo.repo_id) || ['default'],
    }))
    return c.json({ ok: true, repos })
  })
})

app.post('/api/integrations/github/sync', async (c) => {
  const tenant = c.get('tenant')
  const body = await c.req
    .json<{ repoId?: string; agentId?: string }>()
    .catch((): { repoId?: string; agentId?: string } => ({}))

  return await withTenantContext(tenant.id, async () => {
    const github = await import('./github.js')
    const db = await import('./db.js')
    const { saveState } = await import('../src/core/state.js')
    const scopedAgentId = body.agentId ? String(body.agentId).trim() : ''
    const repoAgentIds = new Map<string, string[]>(
      db
        .listGitHubRepoLinks(tenant.id)
        .map((repo) => [
          repo.repo_id,
          db.getGitHubRepoAgentIds(tenant.id, repo.repo_id),
        ]),
    )
    const links = db.listGitHubRepoLinks(tenant.id).filter((repo) => {
      if (!repo.sync_enabled) return false
      if (body.repoId && repo.repo_id !== body.repoId) return false
      if (scopedAgentId) {
        const assigned = repoAgentIds.get(repo.repo_id) || ['default']
        return assigned.includes(scopedAgentId)
      }
      return true
    })

    const synced: Array<{
      repoId: string
      fullName: string
      status: string
      summary: string
      agentIds: string[]
    }> = []
    for (const link of links) {
      try {
        const snapshot = await github.syncGitHubRepoContext(tenant.id, {
          repoId: link.repo_id,
          fullName: link.full_name,
          isPrivate: !!link.is_private,
          trustMode: link.trust_mode,
          allowedPaths: JSON.parse(link.allowed_paths || '[]'),
        })
        saveState(`github-context-${link.repo_id}`, {
          snapshot,
          hash: github.buildGitHubContextHash(snapshot),
        })
        db.upsertGitHubRepoLink(tenant.id, {
          repoId: link.repo_id,
          owner: link.owner,
          name: link.name,
          fullName: link.full_name,
          isPrivate: !!link.is_private,
          defaultBranch: link.default_branch,
          syncEnabled: !!link.sync_enabled,
          trustMode: link.trust_mode,
          allowedPaths: JSON.parse(link.allowed_paths || '[]'),
          lastSyncedAt: snapshot.generatedAt,
          lastSyncStatus: 'ok',
          summary: snapshot.summary,
        })
        synced.push({
          repoId: link.repo_id,
          fullName: link.full_name,
          status: 'ok',
          summary: snapshot.summary,
          agentIds: repoAgentIds.get(link.repo_id) || ['default'],
        })
      } catch (err) {
        db.upsertGitHubRepoLink(tenant.id, {
          repoId: link.repo_id,
          owner: link.owner,
          name: link.name,
          fullName: link.full_name,
          isPrivate: !!link.is_private,
          defaultBranch: link.default_branch,
          syncEnabled: !!link.sync_enabled,
          trustMode: link.trust_mode,
          allowedPaths: JSON.parse(link.allowed_paths || '[]'),
          lastSyncStatus: 'error',
          summary: link.summary,
        })
        synced.push({
          repoId: link.repo_id,
          fullName: link.full_name,
          status: err instanceof Error ? err.message : 'sync failed',
          summary: link.summary,
          agentIds: repoAgentIds.get(link.repo_id) || ['default'],
        })
      }
    }

    saveState('github-context-index', synced)

    return c.json({ ok: true, synced })
  })
})

app.post('/api/integrations/github/disconnect', async (c) => {
  const tenant = c.get('tenant')
  return await withTenantContext(tenant.id, async () => {
    const db = await import('./db.js')
    db.deleteSecret(tenant.id, 'GITHUB_ACCESS_TOKEN')
    db.deleteGitHubConnection(tenant.id)
    return c.json({ ok: true })
  })
})

app.post('/api/platforms', async (c) => {
  const tenant = c.get('tenant')
  const { platforms } = await c.req.json<{ platforms: string[] }>()
  if (!Array.isArray(platforms)) return c.json({ error: 'Invalid' }, 400)

  const allowed = ['x']
  const valid = platforms.filter((p) => allowed.includes(p))

  await withTenantContext(tenant.id, async () => {
    const { getConfig, saveConfig } = await import('../src/core/persona.js')
    const config = getConfig()
    if (!config.platforms) config.platforms = {} as any
    for (const plat of allowed) {
      if (!config.platforms[plat])
        config.platforms[plat] = {
          enabled: false,
          maxPerDay: 8,
          maxPerRun: 3,
        } as any
      config.platforms[plat].enabled = valid.includes(plat)
    }
    saveConfig(config)
    recordAuditEvent({
      tenantId: tenant.id,
      agentId: currentHostedRuntimeAgentId(),
      actorId: tenant.id,
      action: 'settings.platforms.update',
      targetType: 'platform_settings',
      targetId: tenant.id,
      metadata: { platforms: valid },
    })
  })

  return c.json({ ok: true, platforms: valid })
})

// ─── Agent API ───────────────────────────────────────────────────────────────

async function getHostedLayoutAgentState(tenantId: string): Promise<{
  compatibilityAgents: unknown[]
  agents: Array<{ id: string; name: string }>
  activeId: string
}> {
  const {
    getHostedSelectedRuntimeAgentId,
    listHostedAgentCompatibilityViews,
  } = await import('./brand-runtime-context.js')
  const compatibilityAgents = listHostedAgentCompatibilityViews({
    tenantId,
    legacyAgents: [],
  })

  return {
    compatibilityAgents,
    agents: compatibilityAgents.map((agent) => ({
      id: agent.id,
      name: agent.name,
    })),
    activeId:
      getHostedSelectedRuntimeAgentId({ tenantId }),
  }
}

const listRuntimeBrandsHandler = async (c: any) => {
  const tenant = c.get('tenant')
  return await withTenantContext(tenant.id, async () => {
    const layoutAgents = await getHostedLayoutAgentState(tenant.id)
    return c.json({
      agents: layoutAgents.compatibilityAgents,
      brands: layoutAgents.compatibilityAgents,
      activeId: layoutAgents.activeId,
    })
  })
}

const mutateRuntimeBrandsHandler = async (c: any) => {
  const tenant = c.get('tenant')
  const body = (await c.req.json()) as {
    name?: string
    action?: string
    id?: string
  }

  // Delete agent + clean up its data
  if (body.action === 'delete' && body.id) {
    return await withTenantContext(tenant.id, async () => {
      const { deleteState } = await import('../src/core/state.js')
      const { getCRM } = await import('../src/crm/database.js')
      const { markHostedBrandRuntimeDeleted, resolveHostedBrandRuntimeContext } =
        await import('./brand-runtime-context.js')
      const context = resolveHostedBrandRuntimeContext({
        tenantId: tenant.id,
        agentId: body.id!,
      })
      if (!context) return c.json({ error: 'Brand not found' }, 404)
      try {
        revokeAgentHeart(body.id!)
      } catch {}
      markHostedBrandRuntimeDeleted({
        tenantId: tenant.id,
        legacyAgentId: body.id!,
      })
      // Remove per-agent state files
      deleteState(`knowledge-notes-${body.id}`)
      deleteState(`brand-profile-${body.id}`)
      deleteState(`domain-knowledge-${body.id}`)
      // Archive chat conversations for this agent
      try {
        const db = getCRM()
        db.prepare(
          `UPDATE chat_conversations SET status = 'deleted' WHERE agent_id = ?`,
        ).run(body.id)
      } catch {}
      return c.json({ ok: true })
    })
  }

  const name = body.name
  if (!name?.trim()) return c.json({ error: 'Name required' }, 400)

  // Accept brand data from the creation form
  const { brandName, niche, tone, website, xHandle } = body as Record<
    string,
    string
  >

  return await withTenantContext(tenant.id, async () => {
    const { getContext, runInContext } = await import('./context.js')
    const id =
      name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 60) || 'agent'
    const preset = {
      id,
      name: name.trim(),
      brandName: brandName?.trim() || '',
      website: website?.trim() || '',
      tagline: '',
      niche: niche?.trim() || '',
      xHandle: xHandle?.trim() || '',
      tone: tone?.trim() || 'professional',
      agentRole: '',
      competitors: [] as string[],
      topics: [] as any[],
      contentThemes: [] as string[],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    const { ensureHostedBrandRuntimeContext, setHostedSelectedRuntimeAgentId } =
      await import('./brand-runtime-context.js')
    ensureHostedBrandRuntimeContext({
      tenantId: tenant.id,
      legacyAgentId: id,
      brandName: preset.brandName || preset.name,
      runtimeConfig: preset,
    })
    setHostedSelectedRuntimeAgentId({ tenantId: tenant.id, agentId: id })
    const tenantContext = getContext()
    try {
      await forkAgentHeart(id, name.trim())
    } catch {}

    // Initialize brand profile from agent data (niche-aware defaults)
    const { initProfileFromAgentData } =
      await import('../src/intelligence/brand-profile.js')
    if (tenantContext) {
      await runInContext({ ...tenantContext, selectedAgentId: id }, async () => {
        initProfileFromAgentData({
          brandName: preset.brandName,
          niche: preset.niche,
          website: preset.website,
          xHandle: preset.xHandle,
          tone: preset.tone,
        })
      })
    }

    // Auto-research in background (don't block agent creation).
    // Pin agentId so the .then() callback writes to the correct agent
    // even if the user switches agents before research completes.
    if (preset.niche) {
      const targetAgentId = id
      const { runAutoResearch, applyResearchToProfile } =
        await import('../src/intelligence/auto-research.js')
      runAutoResearch({
        niche: preset.niche,
        brandName: preset.brandName || undefined,
        website: preset.website || undefined,
        xHandle: preset.xHandle || undefined,
      })
        .then((research) => {
          applyResearchToProfile(
            {
              niche: preset.niche,
              brandName: preset.brandName || undefined,
              website: preset.website || undefined,
              xHandle: preset.xHandle || undefined,
            },
            research,
            targetAgentId,
          )
          console.log(
            `[Agent] Auto-research complete for ${targetAgentId}: ${research.nicheTopics.length} topics, ${research.painPoints.length} pain points (${research.creditsUsed} credits)`,
          )
        })
        .catch((err) => {
          console.error(
            `[Agent] Auto-research failed for ${targetAgentId}: ${err instanceof Error ? err.message : err}`,
          )
        })
    }

    return c.json({ ok: true, agent: preset })
  })
}

const switchRuntimeBrandHandler = async (c: any) => {
  const tenant = c.get('tenant')
  const { id } = (await c.req.json()) as { id: string }
  if (!id) return c.json({ error: 'ID required' }, 400)

  return await withTenantContext(tenant.id, async () => {
    const { setHostedSelectedRuntimeAgentId } =
      await import('./brand-runtime-context.js')
    const context = setHostedSelectedRuntimeAgentId({
      tenantId: tenant.id,
      agentId: id,
    })
    if (!context) return c.json({ error: 'Brand not found' }, 404)
    return c.json({ ok: true })
  })
}

const toggleRuntimeBrandHandler = async (c: any) => {
  const tenant = c.get('tenant')
  const { id, running } = (await c.req.json()) as {
    id: string
    running: boolean
  }
  if (!id) return c.json({ error: 'ID required' }, 400)

  return await withTenantContext(tenant.id, async () => {
    const { setHostedBrandRuntimeEnabled } =
      await import('./brand-runtime-context.js')
    const updated = setHostedBrandRuntimeEnabled({
      tenantId: tenant.id,
      legacyAgentId: id,
      enabled: running,
    })
    if (!updated) return c.json({ error: 'Brand not found' }, 404)
    return c.json({ ok: true, running })
  })
}

app.get('/api/brands', listRuntimeBrandsHandler)
app.post('/api/brands', mutateRuntimeBrandsHandler)
app.post('/api/brands/switch', switchRuntimeBrandHandler)
app.post('/api/brands/toggle-running', toggleRuntimeBrandHandler)

// ─── SPA JSON APIs ──────────────────────────────────────────────────────────

// Config (persona + autopost + humanBehavior)
app.get('/api/config', async (c) => {
  const tenant = c.get('tenant')
  return await withTenantContext(tenant.id, async () => {
    const { getConfig } = await import('../src/core/persona.js')
    return c.json(getConfig())
  })
})

app.post('/api/config', async (c) => {
  const tenant = c.get('tenant')
  const updates = await c.req.json()
  // Reject excessively large config updates (prevent payload abuse)
  if (JSON.stringify(updates).length > 50_000)
    return c.json({ error: 'Config too large', code: 'INVALID_INPUT' }, 400)
  return await withTenantContext(tenant.id, async () => {
    const { getConfig, saveConfig } = await import('../src/core/persona.js')
    const config = getConfig()
    // Deep merge updates into config
    for (const [key, val] of Object.entries(updates)) {
      if (
        typeof val === 'object' &&
        val !== null &&
        !Array.isArray(val) &&
        typeof (config as any)[key] === 'object'
      ) {
        ;(config as any)[key] = { ...(config as any)[key], ...val }
      } else {
        ;(config as any)[key] = val
      }
    }
    saveConfig(config)
    // Persist per-brand runtime settings for hosted execution.
    if (updates.account || updates.connections) {
      const { updateHostedBrandRuntimeConfig } =
        await import('./brand-runtime-context.js')
      updateHostedBrandRuntimeConfig({
        tenantId: tenant.id,
        legacyAgentId: currentHostedRuntimeAgentId(),
        runtimeConfig: {
          account: updates.account,
          connections: updates.connections,
        },
      })
    }
    return c.json({ ok: true })
  })
})

// ─── Brand Profile (intelligence visibility + editing) ──────────────────────

app.get('/api/brand-profile', async (c) => {
  const tenant = c.get('tenant')
  return await withTenantContext(tenant.id, async () => {
    const { loadBrandProfile } =
      await import('../src/intelligence/brand-profile.js')
    const profile = loadBrandProfile()
    const domain = loadHostedRuntimeState<{
      chunks?: Array<{ topic: string; content: string; tags: string[] }>
      researchedAt?: string
      niche?: string
    }>('domain-knowledge', {})
    return c.json({ profile, domain })
  })
})

app.post('/api/brand-profile', async (c) => {
  const tenant = c.get('tenant')
  const updates = await c.req.json()
  return await withTenantContext(tenant.id, async () => {
    const { loadBrandProfile, saveBrandProfile } =
      await import('../src/intelligence/brand-profile.js')
    const { sanitizeForLLM } =
      await import('../src/intelligence/input-sanitizer.js')
    const profile = loadBrandProfile()

    // Identity
    if (updates.name !== undefined)
      profile.identity.name = sanitizeForLLM(String(updates.name)).text
    if (updates.description !== undefined)
      profile.identity.description = sanitizeForLLM(
        String(updates.description),
      ).text
    if (updates.tagline !== undefined)
      profile.identity.tagline = sanitizeForLLM(String(updates.tagline)).text
    if (Array.isArray(updates.keyFacts))
      profile.identity.keyFacts = updates.keyFacts
        .map((f: string) => sanitizeForLLM(String(f)).text)
        .slice(0, 20)

    // Voice
    if (updates.toneNotes !== undefined)
      profile.voice.toneNotes = sanitizeForLLM(String(updates.toneNotes)).text
    if (Array.isArray(updates.neverSay))
      profile.voice.neverSay = updates.neverSay
        .map((w: string) => String(w).trim())
        .filter(Boolean)
        .slice(0, 50)
    if (Array.isArray(updates.signatures))
      profile.voice.signatures = updates.signatures
        .map((s: string) => String(s).trim())
        .filter(Boolean)
        .slice(0, 10)

    // Style rules
    if (updates.useHashtags !== undefined)
      profile.styleRules.useHashtags = Boolean(updates.useHashtags)
    if (updates.usePolls !== undefined)
      profile.styleRules.usePolls = Boolean(updates.usePolls)
    if (
      updates.emojiUsage !== undefined &&
      ['none', 'minimal', 'moderate', 'heavy'].includes(updates.emojiUsage)
    )
      profile.styleRules.emojiUsage = updates.emojiUsage
    if (updates.useStoryOpeners !== undefined)
      profile.styleRules.useStoryOpeners = Boolean(updates.useStoryOpeners)
    if (Array.isArray(updates.customRules))
      profile.styleRules.customRules = updates.customRules
        .map((r: string) => sanitizeForLLM(String(r)).text)
        .filter(Boolean)
        .slice(0, 20)

    // Content themes
    if (Array.isArray(updates.contentThemes))
      profile.contentThemes = updates.contentThemes
        .map((t: string) => String(t).trim())
        .filter(Boolean)
        .slice(0, 30)

    saveBrandProfile(profile)
    return c.json({ ok: true, profile })
  })
})

// ─── Profile Export/Import ───────────────────────────────────────────────────

app.get('/api/profile/export', async (c) => {
  const tenant = c.get('tenant')
  return await withTenantContext(tenant.id, async () => {
    const { exportAgentProfile } = await import('./profile-export.js')
    const profile = exportAgentProfile()
    return c.json(profile)
  })
})

app.post('/api/profile/import', async (c) => {
  const tenant = c.get('tenant')
  const body = await c.req.json()
  const { profile } = body
  if (!profile)
    return c.json({ error: 'No profile data', code: 'MISSING_PROFILE' }, 400)
  if (JSON.stringify(profile).length > 200_000)
    return c.json({ error: 'Profile too large', code: 'TOO_LARGE' }, 400)

  const {
    validateProfileImport,
    importAgentProfile,
    importHostedBrandMemoryExport,
  } = await import('./profile-export.js')
  const validation = validateProfileImport(profile)
  if (!validation.valid)
    return c.json(
      {
        error: 'Invalid profile',
        errors: validation.errors,
        code: 'INVALID_PROFILE',
      },
      400,
    )

  return await withTenantContext(tenant.id, async () => {
    if (validation.kind === 'hosted-brand-memory') {
      const result = importHostedBrandMemoryExport(
        validation.hostedBrandMemory!,
        { tenantId: tenant.id },
      )
      return c.json({ ok: true, ...result })
    }
    const result = importAgentProfile(validation.profile!)
    return c.json({ ok: true, ...result })
  })
})

// ─── Feedback ────────────────────────────────────────────────────────────────

app.post('/api/feedback', async (c) => {
  const tenant = c.get('tenant')
  const { type, message } = await c.req.json<{
    type?: string
    message?: string
  }>()
  if (!message?.trim())
    return c.json({ error: 'Message required', code: 'EMPTY' }, 400)
  if (message.length > 2000)
    return c.json({ error: 'Too long (max 2000 chars)', code: 'TOO_LONG' }, 400)
  const feedbackType = type === 'bug' ? 'bug' : 'suggestion'

  // Rate limit: 3 per day per tenant
  const { getFeedbackCount, submitFeedback } = await import('./db.js')
  const todayCount = getFeedbackCount(tenant.id, 1)
  if (todayCount >= 3)
    return c.json(
      { error: 'Limit reached — max 3 per day', code: 'RATE_LIMITED' },
      429,
    )

  submitFeedback(tenant.id, feedbackType as any, message.trim())

  // Email notification to admin
  const adminEmail = process.env.ADMIN_EMAIL
  const resendKey = process.env.RESEND_API_KEY
  if (adminEmail && resendKey) {
    fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || 'Pulse <notifications@pulse.app>',
        to: adminEmail,
        subject: `[Pulse ${feedbackType}] from ${tenant.name || tenant.id}`,
        text: `Type: ${feedbackType}\nTenant: ${tenant.name || tenant.id} (${tenant.id})\n\n${message.trim()}`,
      }),
    }).catch(() => {})
  }

  return c.json({ ok: true })
})

// Admin: view all feedback (requires ADMIN_PIN env var)
app.get('/api/admin/feedback', async (c) => {
  const pin = new URL(c.req.url).searchParams.get('pin')
  if (!pin || pin !== process.env.ADMIN_PIN)
    return c.json({ error: 'Unauthorized' }, 401)
  const { listFeedback } = await import('./db.js')
  return c.json({ feedback: listFeedback(100) })
})

// Knowledge notes (per-agent scoped)
app.get('/api/knowledge', async (c) => {
  const tenant = c.get('tenant')
  return await withTenantContext(tenant.id, async () => {
    await migrateKnowledgeIfNeeded()
    const { loadState } = await import('../src/core/state.js')
    const notes = loadState(await knowledgeKey(), [])
    return c.json({ notes })
  })
})

app.post('/api/knowledge', async (c) => {
  const tenant = c.get('tenant')
  const body = await c.req.json()
  return await withTenantContext(tenant.id, async () => {
    const { loadState, saveState } = await import('../src/core/state.js')
    const crypto = await import('node:crypto')
    const { sanitizeForLLM } =
      await import('../src/intelligence/input-sanitizer.js')
    const notes = loadState<any[]>(await knowledgeKey(), [])

    if (body.action === 'add') {
      const cleanTitle = sanitizeForLLM((body.title || '').trim())
      const cleanContent = sanitizeForLLM((body.content || '').trim())
      if (cleanTitle.stripped || cleanContent.stripped) {
        console.log(
          `[Security] Prompt injection patterns stripped from knowledge note for tenant ${tenant.id}`,
        )
      }
      notes.push({
        id: crypto.randomBytes(8).toString('hex'),
        title: cleanTitle.text,
        content: cleanContent.text,
        tags: (body.tags || '')
          .split(',')
          .map((t: string) => t.trim())
          .filter(Boolean),
        priority: Math.min(3, Math.max(0, body.priority ?? 1)),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        editedBy: 'user',
      })
    } else if (body.action === 'update' && body.id) {
      const idx = notes.findIndex((n: any) => n.id === body.id)
      if (idx >= 0) {
        notes[idx] = {
          ...notes[idx],
          title: body.title,
          content: body.content,
          tags: (body.tags || '')
            .split(',')
            .map((t: string) => t.trim())
            .filter(Boolean),
          priority: body.priority ?? notes[idx].priority,
          updatedAt: new Date().toISOString(),
          editedBy: 'user',
        }
      }
    } else if (body.action === 'delete' && body.id) {
      const idx = notes.findIndex((n: any) => n.id === body.id)
      if (idx >= 0) notes.splice(idx, 1)
    } else if (body.action === 'lock' && body.id) {
      const idx = notes.findIndex((n: any) => n.id === body.id)
      if (idx >= 0) notes[idx].locked = true
    } else if (body.action === 'unlock' && body.id) {
      const idx = notes.findIndex((n: any) => n.id === body.id)
      if (idx >= 0) notes[idx].locked = false
    }

    saveState(await knowledgeKey(), notes)
    return c.json({ ok: true, notes })
  })
})

// Activity feed
app.get('/api/activity', async (c) => {
  const tenant = c.get('tenant')
  const period = new URL(c.req.url).searchParams.get('period') || '7d'
  return await withTenantContext(tenant.id, async () => {
    const { getActions } = await import('../src/core/state.js')
    const { loadState } = await import('../src/core/state.js')
    const { getThemePerformance } = await import('../src/analytics/tracker.js')
    const autopostQueue = loadState('autopost-queue', [])

    // Period filtering
    const now = Date.now()
    const periodMs: Record<string, number> = {
      '1d': 86400_000,
      '7d': 7 * 86400_000,
      '30d': 30 * 86400_000,
    }
    const since =
      period === 'all'
        ? undefined
        : new Date(now - (periodMs[period] || 7 * 86400_000)).toISOString()
    const allActions = getActions(since).filter(
      (a: any) => a.platform !== 'system',
    )

    // Compute stats
    let totalEngagement = 0
    let engagementCount = 0
    const byPlatform: Record<string, number> = {}
    const byType: Record<string, number> = {}
    let bestPost: any = null
    let bestEng = -1

    for (const a of allActions as any[]) {
      byPlatform[a.platform] = (byPlatform[a.platform] ?? 0) + 1
      byType[a.type] = (byType[a.type] ?? 0) + 1
      if (a.engagement) {
        const eng =
          (a.engagement.likes ?? 0) +
          (a.engagement.replies ?? 0) +
          (a.engagement.reposts ?? 0)
        totalEngagement += eng
        engagementCount++
        if (eng > bestEng) {
          bestEng = eng
          bestPost = a
        }
      }
    }

    const themePerf = getThemePerformance('month').slice(0, 5)

    return c.json({
      actions: allActions.slice(-100).reverse(),
      queue: autopostQueue,
      stats: {
        total: allActions.length,
        totalEngagement,
        avgEngagement:
          engagementCount > 0
            ? Math.round((totalEngagement / engagementCount) * 10) / 10
            : 0,
        byPlatform,
        byType,
        bestPost: bestPost
          ? {
              content: bestPost.content?.slice(0, 120),
              platform: bestPost.platform,
              engagement: bestPost.engagement,
            }
          : null,
        topThemes: themePerf,
      },
    })
  })
})

// Theme analytics + adaptation
app.get('/api/themes', async (c) => {
  const tenant = c.get('tenant')
  return await withTenantContext(tenant.id, async () => {
    const { getConfig } = await import('../src/core/persona.js')
    const { getThemePerformance } = await import('../src/analytics/tracker.js')
    const { getThemeAdaptationState } =
      await import('../src/intelligence/adaptive-themes.js')
    const config = getConfig()
    const performance = getThemePerformance('month')
    const adaptationState = getThemeAdaptationState()
    return c.json({
      themes: config.contentThemes,
      performance,
      lastAdapted: adaptationState.lastAdaptedAt || null,
      recentChanges: adaptationState.history.slice(-5),
    })
  })
})

app.post('/api/themes/adapt', async (c) => {
  const tenant = c.get('tenant')
  return await withTenantContext(tenant.id, async () => {
    const { adaptThemes } =
      await import('../src/intelligence/adaptive-themes.js')
    const result = await adaptThemes()
    return c.json(result)
  })
})

// Autopost queue
app.get('/api/queue', async (c) => {
  const tenant = c.get('tenant')
  return await withTenantContext(tenant.id, async () => {
    const { getAutopostQueue } = await import('../src/modes/autopost.js')
    return c.json({ queue: getAutopostQueue() })
  })
})

// Content models & cost estimate
app.get('/api/content-models', async (c) => {
  const { CONTENT_MODELS, PARAM_LIMITS } = await import('./billing.js')
  const models = Object.values(CONTENT_MODELS).map((m: any) => ({
    id: m.id,
    label: m.label,
    desc: m.desc,
    costs: m.costs, // { post, reply, thread }
  }))
  return c.json({ models, paramLimits: PARAM_LIMITS })
})

app.post('/api/estimate', async (c) => {
  const { calculateCost } = await import('./billing.js')
  const body = await c.req.json()
  const cost = calculateCost(body.action || 'generate_post', body.model)
  return c.json({ cost, action: body.action, model: body.model })
})

app.post('/api/generate', async (c) => {
  const tenant = c.get('tenant')
  const {
    topic,
    platform,
    type,
    model: modelId,
    temperature: rawTemp,
  } = await c.req.json()
  const apiKey = c.get('apiKey')

  // ── Input validation ──
  if (!topic || typeof topic !== 'string')
    return c.json({ error: 'Topic is required', code: 'INVALID_INPUT' }, 400)
  if (topic.length > 2000)
    return c.json(
      { error: 'Topic too long (max 2000 chars)', code: 'INVALID_INPUT' },
      400,
    )
  if (platform && typeof platform !== 'string')
    return c.json({ error: 'Invalid platform', code: 'INVALID_INPUT' }, 400)
  if (type && !['post', 'reply', 'thread', 'message', 'article'].includes(type))
    return c.json({ error: 'Invalid content type', code: 'INVALID_INPUT' }, 400)

  // ── Prompt injection sanitization ──
  const { sanitizeForLLM } =
    await import('../src/intelligence/input-sanitizer.js')
  const sanitized = sanitizeForLLM(topic)
  if (sanitized.stripped) {
    console.log(
      `[Security] Prompt injection patterns stripped from topic for tenant ${tenant.id}`,
    )
  }

  return await withTenantContext(tenant.id, async () => {
    const { calculateDynamicCost, clampParams, resolveModel, CONTENT_MODELS } =
      await import('./billing.js')

    // Validate model — only allow known models, default to llama
    const safeModelId =
      modelId && CONTENT_MODELS[modelId] ? modelId : 'llama-3.3-70b'

    // Check daily spend cap
    const { checkSpendCap } = await import('./limits.js')
    const spendCheck = checkSpendCap(tenant.id)
    if (!spendCheck.allowed) {
      return c.json(
        {
          ok: false,
          error: `Daily spend cap reached (${spendCheck.spent}/${spendCheck.cap} credits). Resets at midnight UTC.`,
          code: 'SPEND_CAP_REACHED',
        },
        429,
      )
    }

    // Pre-flight: check they have at least 0.5 credits
    const bal = await getBalance(apiKey, { tenantId: c.get('tenant')?.id })
    if (bal < 0.5) {
      return c.json(
        {
          ok: false,
          error: 'Insufficient usage entitlement. Manage your plan in Settings.',
          code: 'INSUFFICIENT_CREDITS',
        },
        402,
      )
    }

    // Clamp parameters to safe ranges
    const action = type === 'thread' ? 'thread_generation' : 'generate_post'
    const params = clampParams(action, { temperature: rawTemp }, safeModelId)
    const resolved = resolveModel(safeModelId)

    // Build LLM options with model override
    const llmOpts = resolved
      ? {
          provider: resolved.provider,
          model: resolved.model,
          temperature: params.temperature,
          maxTokens: params.maxTokens,
        }
      : { temperature: params.temperature, maxTokens: params.maxTokens }

    const targetPlatform = platform || 'x'
    let content: any = null
    let usage: any = null

    // Resolve "auto" topic to a real theme (smart selection)
    let resolvedTopic = sanitized.text
    if (sanitized.text === 'auto') {
      const { loadBrandProfile } =
        await import('../src/intelligence/brand-profile.js')
      const { getContentHook } =
        await import('../src/intelligence/conversation-hooks.js')
      const { getConfig: getCfg } = await import('../src/core/persona.js')
      const profile = loadBrandProfile()
      const cfg = getCfg()
      const nicheFb = cfg.persona?.niche
        ? [
            `trends in ${cfg.persona.niche}`,
            `common challenges in ${cfg.persona.niche}`,
          ]
        : [`${profile.identity.name || 'industry'} insights`]
      const themes =
        profile.contentThemes?.length > 0
          ? profile.contentThemes
          : cfg.contentThemes?.length > 0
            ? cfg.contentThemes
            : nicheFb

      const hook = Math.random() < 0.3 ? getContentHook() : null
      resolvedTopic = hook
        ? hook.contentPrompt
        : themes[Math.floor(Math.random() * themes.length)]
    }

    if (type === 'thread') {
      const { generateThread } =
        await import('../src/intelligence/thread-generator.js')
      const threadResult = await generateThread(resolvedTopic, llmOpts)
      if (!threadResult)
        return c.json({ ok: false, error: 'Generation failed' }, 500)
      const tweetTexts = threadResult.tweets.map((t: any) => t.text)
      content = { text: tweetTexts.join('\n\n'), thread: tweetTexts }
      // Thread doesn't return per-token usage yet — charge minimum
    } else {
      const { generatePost } =
        await import('../src/intelligence/content-generator.js')
      const result = await generatePost(resolvedTopic, targetPlatform, llmOpts)
      if (!result) return c.json({ ok: false, error: 'Generation failed' }, 500)
      content = { text: result.text, type: result.type, format: result.format }
      usage = result.usage
    }

    // Dynamic billing: actual token usage × 1.15 markup
    const creditsCharged = usage ? calculateDynamicCost(usage) : 0.5
    const { buildBillingOperationIdempotencyKey, deduct } =
      await import('./billing-operations.js')
    const operationId = getRequestOperationId(c, {
      route: '/api/generate',
      tenantId: tenant.id,
      action,
      platform: targetPlatform,
      topic: resolvedTopic,
      model: usage?.model || safeModelId,
      content,
    })
    const billing = await deduct({
      tenantId: tenant.id,
      apiKey,
      amount: creditsCharged,
      reason: `pulse:${action}:${usage?.model || safeModelId}`,
      idempotencyKey: buildBillingOperationIdempotencyKey({
        tenantId: tenant.id,
        action,
        operationId,
      }),
      metadata: {
        route: '/api/generate',
        operationId,
        platform: targetPlatform,
        model: usage?.model || safeModelId,
      },
    })

    return c.json({
      ok: true,
      content,
      cost: creditsCharged,
      creditsRemaining: billing.remaining,
    })
  })
})

// ─── Autopilot Quick Actions (Full Auto = generate + post immediately) ──────

app.post('/api/autopilot/post', async (c) => {
  const tenant = c.get('tenant')
  const apiKey = c.get('apiKey')
  const { platform } = await c.req.json().catch(() => ({ platform: 'x' }))

  // Rate limit: 30s cooldown between autopilot posts per tenant
  const { checkActionCooldown } = await import('./limits.js')
  const cooldown = checkActionCooldown(tenant.id, 'autopilot_post')
  if (!cooldown.allowed) {
    return c.json(
      {
        ok: false,
        error: `Too fast — wait ${Math.ceil(cooldown.retryAfterMs / 1000)}s`,
        code: 'RATE_LIMITED',
      },
      429,
    )
  }
  return await withTenantContext(tenant.id, async () => {
    const { getConfig } = await import('../src/core/persona.js')
    const { getHostedAutopilotWriteDecision, consumeRateBucket } =
      await import('./account-safety.js')
    const decision = getHostedAutopilotWriteDecision({
      brandId: tenant.id,
      accountId: tenant.id,
      config: getConfig() as any,
    })
    if (!decision.allowed) {
      const safetyBlocked = decision.safety.allowed === false
      return c.json(
        {
          ok: false,
          error: safetyBlocked
            ? 'Autopilot is paused by account safety controls'
            : 'Autopilot live posting requires Full Auto mode',
          reasons: decision.reasons,
          code: safetyBlocked
            ? 'ACCOUNT_SAFETY_BLOCKED'
            : 'AUTOPILOT_MODE_BLOCKED',
        },
        safetyBlocked ? 423 : 409,
      )
    }

    const writeBucket = consumeRateBucket({
      scopeType: 'account',
      scopeId: tenant.id,
      bucketKey: 'autopilot_post_hourly',
      limit: 20,
      windowMs: 60 * 60 * 1000,
      idempotencyKey: getRequestIdempotencyHeader(c)
        ? `autopilot-post:${tenant.id}:${getRequestIdempotencyHeader(c)}`
        : undefined,
    })
    if (!writeBucket.allowed) {
      return c.json(
        {
          ok: false,
          error: `Autopilot post limit reached — retry in ${Math.ceil(writeBucket.retryAfterMs / 1000)}s`,
          code: 'RATE_LIMITED',
        },
        429,
      )
    }

    const { calculateDynamicCost, getBalance: getBal } =
      await import('./billing.js')

    // Pre-flight: just check they have at least 0.5 credits (minimum charge)
    const bal = await getBal(apiKey)
    if (bal < 0.5) {
      return c.json(
        { ok: false, error: 'Not enough usage entitlement. Manage your plan in Settings.' },
        402,
      )
    }

    // Pick a smart topic — conversation hook (30%) or content theme from brand profile
    const { getContentHook } =
      await import('../src/intelligence/conversation-hooks.js')
    const { loadBrandProfile } =
      await import('../src/intelligence/brand-profile.js')
    const config = getConfig()
    const profile = loadBrandProfile()

    // Themes from brand profile (per-agent) → pulse.yaml (legacy) → niche fallback
    const nicheFallback = config.persona?.niche
      ? [
          `trends in ${config.persona.niche}`,
          `common challenges in ${config.persona.niche}`,
          `${config.persona.niche} observations`,
        ]
      : ['general industry insight']
    const themes =
      profile.contentThemes?.length > 0
        ? profile.contentThemes
        : config.contentThemes?.length > 0
          ? config.contentThemes
          : nicheFallback

    let topic: string
    const hook = Math.random() < 0.3 ? getContentHook() : null
    if (hook) {
      topic = hook.contentPrompt
    } else {
      topic = themes[Math.floor(Math.random() * themes.length)]
    }

    // Generate + validate (retry once if validation fails)
    const { generatePost } =
      await import('../src/intelligence/content-generator.js')
    const { validatePost } =
      await import('../src/intelligence/post-validator.js')
    const targetPlatform = platform || 'x'
    const allThemes =
      config.contentThemes?.length > 0
        ? config.contentThemes
        : ['general industry insight']

    let result = await generatePost(topic, targetPlatform)
    if (result) {
      const validation = validatePost(result.text, targetPlatform, 'post')
      if (!validation.pass) {
        const retryTopic =
          allThemes[Math.floor(Math.random() * allThemes.length)]
        result = await generatePost(retryTopic, targetPlatform)
      }
    }
    if (!result)
      return c.json({ ok: false, error: 'Generation failed — try again' }, 500)

    // Hard truncation safety — never post over platform limit
    const charLimit = targetPlatform === 'x' ? 280 : 2000
    if (result.text.length > charLimit) {
      // Truncate at last sentence boundary
      const truncated = result.text.slice(0, charLimit)
      const lastSentence = Math.max(
        truncated.lastIndexOf('. '),
        truncated.lastIndexOf('.\n'),
        truncated.lastIndexOf('\n\n'),
      )
      result = {
        ...result,
        text:
          lastSentence > charLimit * 0.5
            ? truncated.slice(0, lastSentence + 1).trim()
            : truncated.slice(0, truncated.lastIndexOf(' ')).trim(),
      }
    }

    // Post immediately
    const { getXWriteClient } =
      await import('../src/platforms/x-write-client.js')
    const xWrite = getXWriteClient()
    if (!xWrite.isConfigured())
      return c.json(
        { ok: false, error: 'X not connected — check Settings' },
        400,
      )

    const postResult = await xWrite.post({ text: result.text, type: 'post' })
    if (!postResult.ok)
      return c.json(
        { ok: false, error: postResult.error || 'Post failed' },
        500,
      )

    // Dynamic billing: actual token usage × 1.15 markup
    let creditsCharged = 0
    if (result.usage) {
      creditsCharged = calculateDynamicCost(result.usage)
    } else {
      creditsCharged = 0.5 // fallback minimum if usage not available
    }
    const { buildBillingOperationIdempotencyKey, deduct } =
      await import('./billing-operations.js')
    const operationId = getRequestOperationId(c, {
      route: '/api/autopilot/post',
      tenantId: tenant.id,
      platform: targetPlatform,
      postId: postResult.postId,
      url: postResult.url,
      text: result.text,
      model: result.usage?.model || 'unknown',
    })
    const billing = await deduct({
      tenantId: tenant.id,
      apiKey,
      amount: creditsCharged,
      reason: `pulse:generate_post:${result.usage?.model || 'unknown'}`,
      idempotencyKey: buildBillingOperationIdempotencyKey({
        tenantId: tenant.id,
        action: 'autopilot_post',
        operationId,
      }),
      metadata: {
        route: '/api/autopilot/post',
        operationId,
        platform: targetPlatform,
        postId: postResult.postId,
        model: result.usage?.model || 'unknown',
      },
    })

    // Track for engagement feedback
    if (postResult.postId) {
      const { trackPostedItem } =
        await import('../src/intelligence/engagement-monitor.js')
      const { generateId, logAction } = await import('../src/core/state.js')
      const actionId = generateId()
      logAction({
        id: actionId,
        timestamp: new Date().toISOString(),
        platform: platform || 'x',
        type: 'post',
        topicId: 'autopilot',
        content: result.text,
        targetUrl: postResult.url,
      })
      trackPostedItem({
        actionId,
        postId: postResult.postId,
        platform: platform || 'x',
        postType: 'post',
        text: result.text,
        url: postResult.url,
        topicId: 'autopilot',
      })
    }

    // Track auto-post as approval in Content DNA
    try {
      const { recordApproval } =
        await import('../src/intelligence/content-dna.js')
      recordApproval(result.text)
    } catch {}

    return c.json({
      ok: true,
      text: result.text,
      url: postResult.url,
      postId: postResult.postId,
    })
  })
})

app.post('/api/autopilot/reply', async (c) => {
  const tenant = c.get('tenant')
  const apiKey = c.get('apiKey')

  // Rate limit: 30s cooldown between autopilot replies per tenant
  const { checkActionCooldown } = await import('./limits.js')
  const cooldown = checkActionCooldown(tenant.id, 'autopilot_reply')
  if (!cooldown.allowed) {
    return c.json(
      {
        ok: false,
        error: `Too fast — wait ${Math.ceil(cooldown.retryAfterMs / 1000)}s`,
        code: 'RATE_LIMITED',
      },
      429,
    )
  }
  return await withTenantContext(tenant.id, async () => {
    const { getConfig } = await import('../src/core/persona.js')
    const { getHostedAutopilotWriteDecision, consumeRateBucket } =
      await import('./account-safety.js')
    const decision = getHostedAutopilotWriteDecision({
      brandId: tenant.id,
      accountId: tenant.id,
      config: getConfig() as any,
    })
    if (!decision.allowed) {
      const safetyBlocked = decision.safety.allowed === false
      return c.json(
        {
          ok: false,
          error: safetyBlocked
            ? 'Autopilot is paused by account safety controls'
            : 'Autopilot live replies require Full Auto mode',
          reasons: decision.reasons,
          code: safetyBlocked
            ? 'ACCOUNT_SAFETY_BLOCKED'
            : 'AUTOPILOT_MODE_BLOCKED',
        },
        safetyBlocked ? 423 : 409,
      )
    }
    const writeBucket = consumeRateBucket({
      scopeType: 'account',
      scopeId: tenant.id,
      bucketKey: 'autopilot_reply_hourly',
      limit: 50,
      windowMs: 60 * 60 * 1000,
      idempotencyKey: getRequestIdempotencyHeader(c)
        ? `autopilot-reply:${tenant.id}:${getRequestIdempotencyHeader(c)}`
        : undefined,
    })
    if (!writeBucket.allowed) {
      return c.json(
        {
          ok: false,
          error: `Autopilot reply limit reached — retry in ${Math.ceil(writeBucket.retryAfterMs / 1000)}s`,
          code: 'RATE_LIMITED',
        },
        429,
      )
    }

    // Pre-flight: check minimum credits
    const bal = await getBalance(apiKey, { tenantId: c.get('tenant')?.id })
    if (bal < 0.5) {
      return c.json(
        { ok: false, error: 'Not enough usage entitlement. Manage your plan in Settings.' },
        402,
      )
    }

    // Run a mini outreach — find 1 conversation and reply
    const { runOutreach } = await import('../src/modes/outreach.js')
    const result = await runOutreach({ autoPost: true, platforms: ['x'] })

    if (result.repliedCount === 0 && result.likedCount === 0) {
      return c.json({
        ok: false,
        error: 'No relevant conversations found right now. Try again later.',
      })
    }

    // Dynamic billing: charge for LLM usage in generating replies
    const totalActions = result.repliedCount + result.likedCount
    if (totalActions > 0) {
      const credits = Math.max(0.5, totalActions * 0.5)
      const { buildBillingOperationIdempotencyKey, deduct } =
        await import('./billing-operations.js')
      const operationId = getRequestOperationId(c, {
        route: '/api/autopilot/reply',
        tenantId: tenant.id,
        repliedCount: result.repliedCount,
        likedCount: result.likedCount,
        targets: result.drafts?.map((d: any) => d.targetUrl).sort() || [],
      })
      await deduct({
        tenantId: tenant.id,
        apiKey,
        amount: credits,
        reason: `pulse:outreach:x:${result.repliedCount}r+${result.likedCount}l`,
        idempotencyKey: buildBillingOperationIdempotencyKey({
          tenantId: tenant.id,
          action: 'autopilot_reply',
          operationId,
        }),
        metadata: {
          route: '/api/autopilot/reply',
          operationId,
          repliedCount: result.repliedCount,
          likedCount: result.likedCount,
        },
      })
    }

    // Persist reply drafts to content queue so they survive page refreshes
    const drafts = result.drafts.map((d) => ({
      targetUrl: d.targetUrl,
      targetAuthor: d.targetAuthor,
      targetText: d.targetText.slice(0, 120),
      replyText: d.replyText,
    }))
    if (drafts.length > 0) {
      try {
        const { createQueueItem } =
          await import('../src/intelligence/content-queue.js')
        const now = new Date().toISOString()
        for (const d of drafts) {
          createQueueItem({
            platform: 'x',
            type: 'reply-draft',
            content: d.replyText,
            theme: null,
            scheduledAt: now,
            status: 'reply-draft',
            metadata: {
              targetUrl: d.targetUrl,
              targetAuthor: d.targetAuthor,
              targetText: d.targetText,
            },
          })
        }
      } catch {}
    }

    return c.json({
      ok: true,
      repliedCount: result.repliedCount,
      likedCount: result.likedCount,
      drafts,
    })
  })
})

// ─── Content Queue API ──────────────────────────────────────────────────────

app.get('/api/content-queue', async (c) => {
  const tenant = c.get('tenant')
  return await withTenantContext(tenant.id, async () => {
    const { getQueue } = await import('../src/intelligence/content-queue.js')
    return c.json({ queue: getQueue({ limit: 100 }) })
  })
})

app.post('/api/content-queue', async (c) => {
  const tenant = c.get('tenant')
  const { content, platform, type, theme, status, scheduledAt } =
    await c.req.json()
  return await withTenantContext(tenant.id, async () => {
    const now = new Date().toISOString()
    const scheduled = scheduledAt || now
    const { createQueueItem } =
      await import('../src/intelligence/content-queue.js')
    const item = createQueueItem({
      platform: platform || 'x',
      type: type || 'post',
      content,
      theme: theme || null,
      scheduledAt: scheduled,
      status: status || 'draft',
    })
    return c.json({ ok: true, id: item.id })
  })
})

app.post('/api/content-queue/publish-now', async (c) => {
  const tenant = c.get('tenant')
  const { content, platform, type, theme } = await c.req.json()
  return await withTenantContext(tenant.id, async () => {
    try {
      const platformModule = await import(
        `../src/platforms/${platform || 'x'}.js`
      )
      const plat = platformModule.default ?? platformModule
      if (!plat.post || !plat.isConfigured || !plat.isConfigured()) {
        return c.json({ ok: false, error: 'Platform not configured' }, 400)
      }
      const result = await plat.post({ text: content, type: type || 'post' })
      if (result.ok) {
        // Track approval in Content DNA
        try {
          const { recordApproval } =
            await import('../src/intelligence/content-dna.js')
          recordApproval(content)
        } catch {}

        // Also save to queue as published
        const { createQueueItem } =
          await import('../src/intelligence/content-queue.js')
        const now = new Date().toISOString()
        createQueueItem({
          platform: platform || 'x',
          type: type || 'post',
          content,
          theme: theme || null,
          scheduledAt: now,
          publishedAt: now,
          status: 'published',
          postUrl: result.url || null,
        })
        return c.json({ ok: true, url: result.url })
      }
      return c.json({ ok: false, error: 'Post failed' }, 500)
    } catch (err: any) {
      console.log(`  [Publish] Error: ${(err.message || '').slice(0, 200)}`)
      return c.json({ ok: false, error: 'Post failed' }, 500)
    }
  })
})

app.post('/api/content-queue/:id/approve', async (c) => {
  const tenant = c.get('tenant')
  const id = parseInt(c.req.param('id'), 10)
  return await withTenantContext(tenant.id, async () => {
    const { approveItem, getQueue } =
      await import('../src/intelligence/content-queue.js')
    const items = getQueue()
    const item = items.find((i) => i.id === id)
    approveItem(id)
    // Track in DNA
    if (item?.content) {
      try {
        const { recordApproval } =
          await import('../src/intelligence/content-dna.js')
        recordApproval(item.content)
      } catch {}
    }
    return c.json({ ok: true })
  })
})

app.post('/api/content-queue/:id/publish', async (c) => {
  const tenant = c.get('tenant')
  const id = parseInt(c.req.param('id'), 10)
  return await withTenantContext(tenant.id, async () => {
    const { getQueue, markFailed, markPublished } =
      await import('../src/intelligence/content-queue.js')
    const items = getQueue()
    const item = items.find((i) => i.id === id)
    if (!item) return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404)
    try {
      const platformModule = await import(
        `../src/platforms/${item.platform}.js`
      )
      const plat = platformModule.default ?? platformModule
      if (!plat.post || !plat.isConfigured || !plat.isConfigured()) {
        return c.json({ ok: false, error: 'Platform not configured' }, 400)
      }
      const result = await plat.post({ text: item.content, type: item.type })
      if (result.ok) {
        markPublished(id, new Date().toISOString(), result.url || null)
        return c.json({ ok: true, url: result.url })
      }
      markFailed(id)
      return c.json({ ok: false, error: 'Publish failed' }, 500)
    } catch (err: any) {
      console.log(
        `  [Queue Publish] Error: ${(err.message || '').slice(0, 200)}`,
      )
      markFailed(id)
      return c.json({ ok: false, error: 'Publish failed' }, 500)
    }
  })
})

app.post('/api/content-queue/:id/edit', async (c) => {
  const tenant = c.get('tenant')
  const id = parseInt(c.req.param('id'), 10)
  const { content } = await c.req.json()
  return await withTenantContext(tenant.id, async () => {
    // Get original before editing (for DNA diff tracking)
    const { editItem, getQueue } =
      await import('../src/intelligence/content-queue.js')
    const items = getQueue()
    const original = items.find((i) => i.id === id)

    editItem(id, content)

    // Track the edit diff in Content DNA
    if (original?.content && content && original.content !== content) {
      try {
        const { recordEdit } =
          await import('../src/intelligence/content-dna.js')
        recordEdit(original.content, content)
      } catch {}
    }
    return c.json({ ok: true })
  })
})

app.post('/api/content-queue/:id/reschedule', async (c) => {
  const tenant = c.get('tenant')
  const id = parseInt(c.req.param('id'), 10)
  const { scheduledAt } = await c.req.json()
  return await withTenantContext(tenant.id, async () => {
    const { rescheduleItem } =
      await import('../src/intelligence/content-queue.js')
    rescheduleItem(id, scheduledAt)
    return c.json({ ok: true })
  })
})

app.post('/api/content-queue/:id/delete', async (c) => {
  const tenant = c.get('tenant')
  const id = parseInt(c.req.param('id'), 10)
  return await withTenantContext(tenant.id, async () => {
    // Track rejection in DNA before deleting
    try {
      const { getQueue } = await import('../src/intelligence/content-queue.js')
      const items = getQueue()
      const item = items.find((i) => i.id === id)
      if (item?.content) {
        const { recordRejection } =
          await import('../src/intelligence/content-dna.js')
        recordRejection(item.content)
      }
    } catch {}

    const { skipItem } = await import('../src/intelligence/content-queue.js')
    skipItem(id)
    return c.json({ ok: true })
  })
})

app.delete('/api/content-queue/:id', async (c) => {
  const tenant = c.get('tenant')
  const id = parseInt(c.req.param('id'), 10)
  return await withTenantContext(tenant.id, async () => {
    const { deleteItem } = await import('../src/intelligence/content-queue.js')
    deleteItem(id)
    return c.json({ ok: true })
  })
})

// ─── Growth API ─────────────────────────────────────────────────────────────

app.get('/api/growth', async (c) => {
  const tenant = c.get('tenant')
  return await withTenantContext(tenant.id, async () => {
    const { getFollowRecords, getFollowMetrics, getKolList } =
      await import('../src/core/follow-engine.js')
    const { getFollowStats } = await import('../src/platforms/x-follow.js')
    const { getConfig } = await import('../src/core/persona.js')
    const config = getConfig() as any
    const followConfig = config.autoFollow ?? {
      enabled: false,
      dailyCap: 15,
      minConfidence: 70,
      minFollowerCount: 50,
      autoUnfollowDays: 14,
      signals: { repost: true, reply: true, tag: true, mention_positive: true },
    }
    const metrics = getFollowMetrics()
    const xStats = getFollowStats()
    return c.json({
      config: followConfig,
      stats: {
        today: xStats.today,
        month: xStats.month,
        total: metrics.total,
        active: metrics.active,
        unfollowed: metrics.unfollowed,
        bySignal: metrics.bySignal,
      },
      records: getFollowRecords().slice(0, 100),
      kols: getKolList(),
    })
  })
})

app.post('/api/growth/config', async (c) => {
  const tenant = c.get('tenant')
  const growthConfig = await c.req.json()
  return await withTenantContext(tenant.id, async () => {
    const { getConfig, saveConfig } = await import('../src/core/persona.js')
    const config = getConfig() as any
    config.autoFollow = { ...(config.autoFollow || {}), ...growthConfig }
    saveConfig(config)
    return c.json({ ok: true })
  })
})

app.post('/api/growth/kol/add', async (c) => {
  const tenant = c.get('tenant')
  const { username } = await c.req.json()
  return await withTenantContext(tenant.id, async () => {
    const { addKol } = await import('../src/core/follow-engine.js')
    addKol(username)
    return c.json({ ok: true })
  })
})

app.post('/api/growth/kol/remove', async (c) => {
  const tenant = c.get('tenant')
  const { username } = await c.req.json()
  return await withTenantContext(tenant.id, async () => {
    const { removeKol } = await import('../src/core/follow-engine.js')
    removeKol(username)
    return c.json({ ok: true })
  })
})

// Voice
app.get('/api/voice', async (c) => {
  const tenant = c.get('tenant')
  return await withTenantContext(tenant.id, async () => {
    const { loadVoice } = await import('../src/intelligence/human-behavior.js')
    return c.json({ voice: loadVoice() })
  })
})

// Available providers (which API keys are set — no values exposed)
app.get('/api/providers', (c) => {
  return c.json({
    llm: {
      groq: !!process.env.GROQ_API_KEY,
      openai: !!process.env.OPENAI_API_KEY,
      anthropic: !!process.env.ANTHROPIC_API_KEY,
      openrouter: !!process.env.OPENROUTER_API_KEY,
      ollama: true, // always "available" but requires local setup
    },
    search: {
      serper: !!process.env.SERPER_API_KEY,
      brave: !!process.env.BRAVE_API_KEY,
      serpapi: !!process.env.SERPAPI_API_KEY,
    },
  })
})

// ─── Panel Pages (tenant-scoped) ────────────────────────────────────────────

const pageModules: Record<string, string> = {
  create: '../src/panel/pages/create.js',
  autopilot: '../src/panel/pages/autopilot.js',
  activity: '../src/panel/pages/activity-feed.js',
  knowledge: '../src/panel/pages/knowledge.js',
  settings: '../src/panel/pages/settings.js',
}
const pageLabels: Record<string, string> = {
  create: 'Create',
  autopilot: 'Autopilot',
  activity: 'Activity',
  knowledge: 'Knowledge',
  settings: 'Settings',
}

// ─── Chat Setup (special page — not in pageModules because it uses its own API routes) ─
if (!_spaReady) {
  app.get('/chat-setup', async (c) => {
    const tenant = c.get('tenant')
    // Auto-init config for new users so chat works without onboarding form
    const tenantConfigPath = _join(
      process.cwd(),
      'data',
      'tenants',
      tenant.id,
      'pulse.yaml',
    )
    if (!_exists(tenantConfigPath)) {
      initTenantConfig(tenant.id, { brandName: tenant.name || 'My Brand' })
    }
    return await withTenantContext(tenant.id, async () => {
      const { agents, activeId } = await getHostedLayoutAgentState(tenant.id)
      return c.html(
        wrapLayout(
          renderChatSetup(),
          tenant,
          'Chat',
          agents,
          activeId,
        ),
      )
    })
  })
}

// Available chat models — sourced from billing.ts
app.get('/api/chat-models', async (c) => {
  const { CHAT_MODELS } = await import('./billing.js')
  const models = Object.values(CHAT_MODELS).map((m: any) => ({
    id: m.id,
    label: m.label,
    provider: m.provider,
    credits: m.credits,
    desc: m.desc,
  }))
  return c.json({ models })
})

// Rate limit: 30 chat messages per tenant per hour, 200 char max per message
const chatRateLimits = new Map<string, { count: number; resetAt: number }>()

app.post('/api/chat-setup', async (c) => {
  const tenant = c.get('tenant')
  if (!tenant) return c.json({ error: 'Session not found. Please log in again.', reply: 'Your session expired. Please sign out and log in again.' }, 401)

  // Rate limit
  const now = Date.now()
  let rl = chatRateLimits.get(tenant.id)
  if (!rl || now > rl.resetAt) {
    rl = { count: 0, resetAt: now + 3600_000 }
    chatRateLimits.set(tenant.id, rl)
  }
  rl.count++
  if (rl.count > 30) {
    return c.json(
      {
        error: 'Too many messages. Try again in an hour.',
        reply: "You've hit the rate limit — try again in a bit.",
      },
      429,
    )
  }

  const { message, model: modelId } = await c.req.json<{
    message: string
    model?: string
  }>()
  if (!message?.trim()) return c.json({ error: 'Empty message' }, 400)

  // Use billing.ts as single source of truth for chat models
  const { CHAT_MODELS: billingChatModels } = await import('./billing.js')
  const selectedModel =
    billingChatModels[modelId || 'llama-3.3-70b'] ||
    billingChatModels['llama-3.3-70b']

  // Pre-flight: check balance + daily/monthly spend caps
  const estimatedCost = selectedModel.credits
  const { checkSpendCap, checkMonthlySpendCap } = await import('./limits.js')
  const dailyCheck = checkSpendCap(tenant.id)
  if (!dailyCheck.allowed) {
    return c.json(
      {
        reply: `Daily spend cap reached (${dailyCheck.spent}/${dailyCheck.cap} credits). Resets at midnight UTC.`,
        configReady: false,
      },
      429,
    )
  }
  const monthlyCheck = checkMonthlySpendCap(tenant.id)
  if (!monthlyCheck.allowed) {
    return c.json(
      {
        reply: `Monthly spend cap reached (${monthlyCheck.spent}/${monthlyCheck.cap} credits). Resets next month.`,
        configReady: false,
      },
      429,
    )
  }
  const bal = await getBalance(c.get('apiKey'), { tenantId: tenant.id })
  if (bal < estimatedCost) {
    return c.json(
      {
        reply: `Not enough usage entitlement. You have ${bal} usage credits available. Manage your plan in Settings.`,
        configReady: false,
      },
      402,
    )
  }
  const trimmed = message.trim().slice(0, 5000)
  let activeAgentId = 'default'
  try {
    await withTenantContext(tenant.id, async () => {
      activeAgentId = currentHostedRuntimeAgentId()
    })
  } catch {}

  // Read platform context from cookie
  const cookieHeader = c.req.header('cookie') || ''
  const platMatch = cookieHeader.match(/pulse_platforms=([^;]*)/)
  const platforms = platMatch
    ? decodeURIComponent(platMatch[1]).split(',').filter(Boolean)
    : ['x']

  // Build extended context from tenant + config
  const context: import('./pages/chat-setup.js').ChatContext = {
    platforms,
    agentName: tenant.name || 'Default Brand',
    brandName: tenant.name || undefined,
    credits: undefined,
  }

  // Best-effort credit fetch
  try {
    context.credits = await getBalance(c.get('apiKey'), { tenantId: tenant.id })
  } catch {}

  // Read full config for context injection
  try {
    await withTenantContext(tenant.id, async () => {
      const { getConfig } = await import('../src/core/persona.js')
      const cfg = getConfig() as any
      if (cfg.persona?.brandName) context.brandName = cfg.persona.brandName
      if (cfg.persona?.niche) context.niche = cfg.persona.niche
      if (cfg.persona?.tone) context.tone = cfg.persona.tone
      context.autopilotMode = cfg.autopilot?.mode || 'off'
      context.contentModel = cfg.account?.contentModel || 'llama-3.3-70b'
      context.postsPerDay =
        cfg.autopilot?.postsPerDay || cfg.schedule?.contentPostsPerDay
      if (cfg.topics?.length)
        context.topics = cfg.topics
          .slice(0, 10)
          .map((t: any) => ({ id: t.id, query: t.query }))
      if (cfg.contentThemes?.length) context.contentThemes = cfg.contentThemes
      if (cfg.competitors?.length) context.competitors = cfg.competitors
      // Check X connection status
      const { hasTenantXKeys } = await import('./tenant.js')
      ;(context as any).xConnected = hasTenantXKeys(tenant.id)
      const { getHostedChatMemoryContext } =
        await import('./brand-memory-context.js')
      const durableNotes = getHostedChatMemoryContext({
        tenantId: tenant.id,
        agentId: activeAgentId,
        query: trimmed,
        limit: 10,
      })
      if (durableNotes.length) {
        context.knowledgeNotes = durableNotes
      } else {
        // JSON remains the rollback/self-host compatibility path.
        const { loadState } = await import('../src/core/state.js')
        const notes = loadState(await knowledgeKey(), []) as any[]
        if (notes.length)
          context.knowledgeNotes = notes.slice(0, 10).map((n: any) => ({
            title: n.title,
            content: n.content,
            priority: n.priority || 0,
          }))
      }
    })
  } catch {}

  // Inject platform context (operator-maintained product knowledge)
  const platformCtx = getPlatformContext()
  if (platformCtx) context.platformContext = platformCtx

  const chatOperationId = getRequestOperationId(c, {
    route: '/api/chat-setup',
    tenantId: tenant.id,
    message: trimmed,
    model: selectedModel.id,
  })

  // ── Preference signal: track chat style ──
  const {
    detectChatStyle,
    isBulkContent,
    chunkStructuredContent,
    buildPreferenceContext,
  } = await import('./preference-engine.js')
  const { recordSignal } = await import('./db.js')
  const chatToolExecutionOptions = resolveChatToolExecutionOptions({
    tenant,
    agentId: activeAgentId,
    cookieHeader: c.req.header('cookie'),
  })
  const { evaluateToolActionPolicy } = await import('./chat-tools.js')

  const chatStyle = detectChatStyle(trimmed)
  recordSignal(tenant.id, activeAgentId, 'chat_message', chatStyle)

  // ── Server-side smart import: detect bulk content, chunk and save directly ──
  let bulkImportNote = ''
  let importedBrandName = ''
  if (isBulkContent(trimmed)) {
    const bulkImportPolicy = evaluateToolActionPolicy(
      {
        type: 'save_knowledge',
        payload: {
          title: 'Bulk import',
          content: trimmed.slice(0, 500),
          tags: ['auto-import'],
        },
        raw: '[BULK_IMPORT]',
      },
      chatToolExecutionOptions.policy,
    )
    if (!bulkImportPolicy.allowed) {
      recordAuditEvent({
        tenantId: tenant.id,
        orgId: chatToolExecutionOptions.audit?.orgId,
        workspaceId: chatToolExecutionOptions.audit?.workspaceId,
        brandId: chatToolExecutionOptions.audit?.brandId,
        agentId: activeAgentId,
        actorId: chatToolExecutionOptions.audit?.actorId,
        action: 'chat_tool.bulk_import',
        targetType: 'knowledge_note',
        targetId: 'bulk_import',
        metadata: {
          outcome: 'rejected',
          actionType: 'bulk_import',
          impact: 'content',
          permission: bulkImportPolicy.permission,
          reason: bulkImportPolicy.reason,
        },
      })
    }
    if (bulkImportPolicy.allowed) {
      const { findMatchingNote } = await import('./preference-engine.js')
      try {
        await withTenantContext(tenant.id, async () => {
          const { loadState, saveState } = await import('../src/core/state.js')
          const crypto = await import('node:crypto')
          const chunks = chunkStructuredContent(trimmed)
          if (chunks.length > 0) {
            const notes = loadState<any[]>(await knowledgeKey(), [])
            let saved = 0
            let updated = 0
            for (const chunk of chunks) {
              // Fuzzy match: find existing note by normalized title similarity
              const existingIdx = findMatchingNote(notes, chunk.title)
              if (existingIdx >= 0) {
                if (notes[existingIdx].locked) continue
                notes[existingIdx] = {
                  ...notes[existingIdx],
                  title: chunk.title,
                  content: chunk.content,
                  priority: chunk.priority,
                  updatedAt: new Date().toISOString(),
                  editedBy: 'bot',
                  tags: [
                    ...new Set([
                      ...(notes[existingIdx].tags || []),
                      'auto-import',
                    ]),
                  ],
                }
                updated++
                saved++
              } else if (notes.length < 100) {
                notes.push({
                  id: crypto.randomBytes(8).toString('hex'),
                  title: chunk.title,
                  content: chunk.content,
                  tags: ['auto-import'],
                  priority: chunk.priority,
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                  editedBy: 'bot',
                })
                saved++
              }
            }
            if (saved > 0) {
              saveState(await knowledgeKey(), notes)
              recordAuditEvent({
                tenantId: tenant.id,
                orgId: chatToolExecutionOptions.audit?.orgId,
                workspaceId: chatToolExecutionOptions.audit?.workspaceId,
                brandId: chatToolExecutionOptions.audit?.brandId,
                agentId: activeAgentId,
                actorId: chatToolExecutionOptions.audit?.actorId,
                action: 'chat_tool.bulk_import',
                targetType: 'knowledge_note',
                targetId: 'bulk_import',
                metadata: {
                  outcome: 'accepted',
                  actionType: 'bulk_import',
                  impact: 'content',
                  permission: bulkImportPolicy.permission,
                  saved,
                  updated,
                },
              })
              const updatedNote =
                updated > 0
                  ? ` (${updated} updated, ${saved - updated} new)`
                  : ''
              bulkImportNote = `\n\nSYSTEM NOTE: The user's message was structured content. I auto-saved it as ${saved} knowledge notes${updatedNote}: ${chunks.map((c) => c.title).join(', ')}. Acknowledge this briefly and continue naturally. Do NOT try to re-save the content with [SAVE_KNOWLEDGE] tags — it's already saved. Do NOT ask for brand name or what they do — the info is already in the notes you just received.`
            }

            // Extract brand name from imported content if we can detect it
            for (const chunk of chunks) {
              // Look for patterns like "BrandName (domain.com) — description" or "BrandName — description"
              const brandMatch =
                chunk.content.match(
                  /^([A-Z][A-Za-z0-9]+(?:\s[A-Za-z0-9]+)?)\s*\([^)]+\)\s*[—\-]/m,
                ) ||
                chunk.title.match(
                  /^([A-Z][A-Za-z0-9]+(?:\s[A-Za-z0-9]+)?)\s*\(/,
                )
              if (brandMatch && !importedBrandName) {
                importedBrandName = brandMatch[1].trim()
              }
            }
          }
        })

        // If we extracted a brand name and tenant doesn't have one, set it
        if (importedBrandName) {
          const brandNamePolicy = evaluateToolActionPolicy(
            {
              type: 'update_setting',
              payload: {
                path: 'persona.brandName',
                value: importedBrandName,
              },
              raw: '[BULK_IMPORT_BRAND_NAME]',
            },
            chatToolExecutionOptions.policy,
          )
          if (!brandNamePolicy.allowed) {
            recordAuditEvent({
              tenantId: tenant.id,
              orgId: chatToolExecutionOptions.audit?.orgId,
              workspaceId: chatToolExecutionOptions.audit?.workspaceId,
              brandId: chatToolExecutionOptions.audit?.brandId,
              agentId: activeAgentId,
              actorId: chatToolExecutionOptions.audit?.actorId,
              action: 'chat_tool.bulk_import_brand_name',
              targetType: 'setting',
              targetId: 'persona.brandName',
              metadata: {
                outcome: 'rejected',
                actionType: 'bulk_import_brand_name',
                impact: 'configuration',
                permission: brandNamePolicy.permission,
                path: 'persona.brandName',
                reason: brandNamePolicy.reason,
              },
            })
          } else {
            try {
              await withTenantContext(tenant.id, async () => {
                const { getConfig } = await import('../src/core/persona.js')
                const cfg = getConfig() as any
                const currentBrand = cfg.persona?.brandName
                if (
                  !currentBrand ||
                  currentBrand === 'My Brand' ||
                  currentBrand === 'Default Brand'
                ) {
                  // Auto-set brand name from imported content
                  const fs = await import('node:fs')
                  const path = await import('node:path')
                  const YAML = (await import('yaml')).default
                  const configPath = path.join(
                    process.cwd(),
                    'data',
                    'tenants',
                    tenant.id,
                    'pulse.yaml',
                  )
                  if (fs.existsSync(configPath)) {
                    const existing =
                      YAML.parse(fs.readFileSync(configPath, 'utf-8')) || {}
                    if (!existing.persona) existing.persona = {}
                    existing.persona.brandName = importedBrandName
                    fs.writeFileSync(
                      configPath,
                      YAML.stringify(existing),
                      'utf-8',
                    )
                    context.brandName = importedBrandName
                    recordAuditEvent({
                      tenantId: tenant.id,
                      orgId: chatToolExecutionOptions.audit?.orgId,
                      workspaceId: chatToolExecutionOptions.audit?.workspaceId,
                      brandId: chatToolExecutionOptions.audit?.brandId,
                      agentId: activeAgentId,
                      actorId: chatToolExecutionOptions.audit?.actorId,
                      action: 'chat_tool.bulk_import_brand_name',
                      targetType: 'setting',
                      targetId: 'persona.brandName',
                      metadata: {
                        outcome: 'accepted',
                        actionType: 'bulk_import_brand_name',
                        impact: 'configuration',
                        permission: brandNamePolicy.permission,
                        path: 'persona.brandName',
                        value: importedBrandName,
                      },
                    })
                    console.log(
                      `[Smart Import] Auto-set brand name: ${importedBrandName}`,
                    )
                  }
                }
              })
            } catch (err) {
              console.error('[Smart Import] Brand name auto-set failed:', err)
            }
          }
        }
      } catch (err) {
        console.error('[Smart Import] Failed:', err)
      }
    }
  }

  // ── Inject preference context ──
  let prefContext = ''
  try {
    prefContext = buildPreferenceContext(tenant.id, activeAgentId)
  } catch {}

  // Append system-level notes to context
  if (bulkImportNote || prefContext) {
    ;(context as any)._systemNotes = (prefContext + bulkImportNote).trim()
  }

  const result = (await handleChatMessage(tenant.id, trimmed, context, {
    provider: selectedModel.provider,
    model: selectedModel.model,
    maxTokens: 1000,
  })) as any
  if (result.knowledgeNotes?.length) {
    for (const n of result.knowledgeNotes)
      console.log(
        `  [Chat Debug] Note: "${n.title}" (${n.content?.length ?? 0} chars)`,
      )
  }

  // Execute any tool actions the LLM emitted
  let actionResults: string[] = []
  let executableActions: NonNullable<typeof result.actions> = []
  if (result.actions?.length) {
    try {
      await withTenantContext(tenant.id, async () => {
        const { executeToolActions, getExecutableToolActions } =
          await import('./pages/chat-setup.js')
        actionResults = executeToolActions(
          tenant.id,
          result.actions!,
          chatToolExecutionOptions,
        )
        executableActions = getExecutableToolActions(
          result.actions!,
          chatToolExecutionOptions,
        )
      })
    } catch (err) {
      console.error('[Chat Tools] Execution failed:', err)
    }
  }

  // Handle image generation actions from chat bot
  let generatedImages: Array<{ imageUrl: string; name: string }> = []
  if (executableActions.length) {
    for (const action of executableActions) {
      if (action.type === 'generate_image' && action.payload?.prompt) {
        try {
          await withTenantContext(tenant.id, async () => {
            const { generateImage } =
              await import('../src/intelligence/image-gen.js')
            const genResult = await generateImage(action.payload.prompt, {
              model: 'fast',
              tags: action.payload.tags ?? [],
              width: 1200,
              height: 675,
            })
            generatedImages.push({
              imageUrl: genResult.imageUrl,
              name: genResult.asset.name,
            })
            actionResults.push(
              `Generated image: ${genResult.asset.name} (${genResult.creditsUsed} credits)`,
            )

            // Bill for generation
            if (genResult.creditsUsed) {
              const { buildBillingOperationIdempotencyKey, deduct } =
                await import('./billing-operations.js')
              const imageOperationId = `${chatOperationId}:image:${genResult.asset.id}`
              try {
                await deduct({
                  tenantId: tenant.id,
                  apiKey: c.get('apiKey'),
                  amount: genResult.creditsUsed,
                  reason: 'pulse-chat-image-gen',
                  idempotencyKey: buildBillingOperationIdempotencyKey({
                    tenantId: tenant.id,
                    action: 'chat_image_generation',
                    operationId: imageOperationId,
                  }),
                  metadata: {
                    route: '/api/chat-setup',
                    operationId: imageOperationId,
                    chatOperationId,
                    assetId: genResult.asset.id,
                    model: genResult.model,
                  },
                })
              } catch {}
            }
          })
        } catch (err) {
          actionResults.push(
            `Image generation failed: ${err instanceof Error ? err.message : 'unknown error'}`,
          )
        }
      }
      if (action.type === 'list_images') {
        try {
          await withTenantContext(tenant.id, async () => {
            const { getAssets } = await import('../src/core/asset-library.js')
            const images = getAssets({ type: 'image' as const })
            if (images.length === 0) {
              actionResults.push(
                'No images in your media library yet. Upload or generate some in the Media tab.',
              )
            } else {
              const summary = images
                .slice(0, 10)
                .map(
                  (i) =>
                    `- ${i.name} [${i.tags.slice(0, 3).join(', ')}]${i.starred ? ' ⭐' : ''} (used ${i.usageCount}x)`,
                )
                .join('\n')
              actionResults.push(
                `Media library (${images.length} images):\n${summary}`,
              )
            }
          })
        } catch {}
      }
    }
  }

  // Auto-save ALL knowledge notes the bot detected (no user click needed)
  const allKnowledge =
    result.knowledgeNotes || (result.knowledge ? [result.knowledge] : [])
  if (allKnowledge.length > 0) {
    try {
      await withTenantContext(tenant.id, async () => {
        const { loadState, saveState } = await import('../src/core/state.js')
        const crypto = await import('node:crypto')
        const notes = loadState<any[]>(await knowledgeKey(), [])
        let saved = 0
        for (const k of allKnowledge) {
          if (!k?.title || !k?.content) continue
          // Update existing note with same title instead of skipping
          const existingIdx = notes.findIndex((n: any) => n.title === k.title)
          if (existingIdx >= 0) {
            const existing = notes[existingIdx]
            if (existing.locked) continue // respect locked notes
            notes[existingIdx] = {
              ...existing,
              content: k.content,
              priority: Math.min(
                3,
                Math.max(0, k.priority ?? existing.priority),
              ),
              updatedAt: new Date().toISOString(),
              editedBy: 'bot',
            }
            saved++
            continue
          }
          // Cap at 100 notes to prevent abuse
          if (notes.length >= 100) break
          notes.push({
            id: crypto.randomBytes(8).toString('hex'),
            title: k.title,
            content: k.content,
            tags: ['from-chat'],
            priority: Math.min(3, Math.max(0, k.priority ?? 1)),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            editedBy: 'bot',
          })
          saved++
        }
        console.log(
          `[Chat Debug] Save result: ${saved} saved, ${notes.length} total notes, key: ${await knowledgeKey()}`,
        )
        if (saved > 0) {
          saveState(await knowledgeKey(), notes)
          actionResults.push(
            `Saved ${saved} knowledge note${saved > 1 ? 's' : ''}`,
          )
        }
      })
    } catch (err) {
      console.error('[Chat] Knowledge auto-save failed:', err)
    }
  }

  // Dynamic billing: charge based on actual token usage × 1.15
  let creditsUsed = 0
  if (result.usage) {
    const { calculateDynamicCost } = (await import('./billing.js')) as any
    creditsUsed = calculateDynamicCost(result.usage)
    const { buildBillingOperationIdempotencyKey, deduct } =
      await import('./billing-operations.js')
    try {
      const deductResult = await deduct({
        tenantId: tenant.id,
        apiKey: c.get('apiKey'),
        amount: creditsUsed,
        reason: `pulse-chat:${selectedModel.label}:${result.usage.inputTokens}in+${result.usage.outputTokens}out`,
        idempotencyKey: buildBillingOperationIdempotencyKey({
          tenantId: tenant.id,
          action: 'chat_completion',
          operationId: chatOperationId,
        }),
        metadata: {
          route: '/api/chat-setup',
          operationId: chatOperationId,
          model: selectedModel.id,
          provider: selectedModel.provider,
        },
      })
      if (!deductResult.ok) {
        const { deductFreeTierCredits } = await import('./billing.js')
        deductFreeTierCredits(tenant.id, creditsUsed)
      }
    } catch (err) {
      const { deductFreeTierCredits } = await import('./billing.js')
      deductFreeTierCredits(tenant.id, creditsUsed)
    }
  }

  // Handle profile export if the bot triggered it
  let exportProfile: any = undefined
  if (result.actions?.some((a: any) => a.type === 'export_profile')) {
    try {
      await withTenantContext(tenant.id, async () => {
        const { exportAgentProfile } = await import('./profile-export.js')
        exportProfile = exportAgentProfile()
      })
      actionResults.push('Profile ready for download')
    } catch {}
  }

  return c.json({
    ...result,
    actionResults,
    creditsUsed,
    model: selectedModel.label,
    usage: result.usage,
    exportProfile,
    generatedImages,
  })
})

app.post('/api/chat-setup/apply', async (c) => {
  const tenant = c.get('tenant')
  const { config } = await c.req.json<{ config: Record<string, any> }>()
  if (!config) return c.json({ error: 'No config' }, 400)
  await withTenantContext(tenant.id, async () => {
    applyChatConfig(tenant.id, config)
  })
  return c.json({ ok: true })
})

app.get('/api/chat-setup/history', async (c) => {
  const tenant = c.get('tenant')
  return await withTenantContext(tenant.id, async () => {
    const { getCRM } = await import('../src/crm/database.js')
    const db = getCRM()
    const agentId = currentHostedRuntimeAgentId()
    const convo = db
      .prepare(
        `SELECT id FROM chat_conversations WHERE status = 'active' AND agent_id = ? ORDER BY updated_at DESC LIMIT 1`,
      )
      .get(agentId) as { id: string } | undefined
    if (!convo) return c.json({ messages: [] })
    const raw = db
      .prepare(
        `SELECT role, content FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC`,
      )
      .all(convo.id) as Array<{ role: string; content: string }>
    // Strip leaked tool tags from old messages stored before the fix
    const tagClean = (s: string) =>
      s
        .replace(
          /\[(SAVE_KNOWLEDGE|UPDATE_NOTE|MERGE_NOTES|DELETE_NOTE|UPDATE_SETTING|ADD_TOPIC|SET_AUTOPILOT|SET_MODEL|READY_TO_CONFIGURE|EXPORT_PROFILE)(:\s*[\s\S]*?)?\]/g,
          '',
        )
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    const messages = raw.map((m) => ({
      role: m.role,
      content: m.role === 'assistant' ? tagClean(m.content) : m.content,
    }))
    return c.json({ messages, conversationId: convo.id })
  })
})

app.post('/api/chat-setup/reset', async (c) => {
  const tenant = c.get('tenant')
  await withTenantContext(tenant.id, async () => {
    resetChat(tenant.id)
  })
  return c.json({ ok: true })
})

app.post('/api/chat-setup/save-knowledge', async (c) => {
  const tenant = c.get('tenant')
  const { title, content, priority } = await c.req.json<{
    title: string
    content: string
    priority: number
  }>()
  if (!title?.trim() || !content?.trim())
    return c.json({ error: 'Title and content required' }, 400)

  await withTenantContext(tenant.id, async () => {
    const { loadState, saveState } = await import('../src/core/state.js')
    const crypto = await import('node:crypto')
    const notes = loadState<any[]>(await knowledgeKey(), [])
    if (notes.length >= 100)
      return c.json(
        { error: 'Note limit reached (100 max). Delete some notes first.' },
        400,
      )
    notes.push({
      id: crypto.randomBytes(8).toString('hex'),
      title: title.trim(),
      content: content.trim(),
      tags: ['from-chat'],
      priority: Math.min(3, Math.max(0, priority ?? 1)),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    saveState(await knowledgeKey(), notes)
  })

  return c.json({ ok: true })
})

/** Get persisted reply drafts (sorted by freshness — newest target tweets first) */
app.get('/api/reply-drafts', async (c) => {
  const tenant = c.get('tenant')
  return await withTenantContext(tenant.id, async () => {
    const { getCRM } = await import('../src/crm/database.js')
    const db = getCRM()
    const rows = db
      .prepare(
        `SELECT id, content, created_at, metadata FROM content_queue WHERE status = 'reply-draft' AND type = 'reply-draft' ORDER BY created_at DESC LIMIT 20`,
      )
      .all() as Array<{
      id: number
      content: string
      created_at: string
      metadata: string
    }>

    const drafts = rows.map((r) => {
      let meta: any = {}
      try {
        meta = JSON.parse(r.metadata)
      } catch {}
      return {
        id: r.id,
        replyText: r.content,
        targetUrl: meta.targetUrl || '',
        targetAuthor: meta.targetAuthor || '',
        targetText: meta.targetText || '',
        createdAt: r.created_at,
      }
    })
    return c.json({ drafts })
  })
})

/** Dismiss a reply draft (mark as used/skipped) */
app.post('/api/reply-drafts/:id/dismiss', async (c) => {
  const tenant = c.get('tenant')
  const id = parseInt(c.req.param('id'), 10)
  return await withTenantContext(tenant.id, async () => {
    const { getCRM } = await import('../src/crm/database.js')
    getCRM()
      .prepare(`UPDATE content_queue SET status = 'skipped' WHERE id = ?`)
      .run(id)
    return c.json({ ok: true })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Media / Image API
// ═══════════════════════════════════════════════════════════════════════════

/** List all images in the asset library for this tenant */
app.get('/api/media', async (c) => {
  const tenant = c.get('tenant')
  let assets: any[] = []
  await withTenantContext(tenant.id, async () => {
    const { getAssets } = await import('../src/core/asset-library.js')
    const filter: any = { type: 'image' as const }
    const _mood = c.req.query('mood') // deprecated, ignored
    const starred = c.req.query('starred')
    // mood filter removed — pure tag matching now
    if (starred === 'true') filter.starred = true
    assets = getAssets(filter).map((a) => ({
      id: a.id,
      name: a.name,
      tags: a.tags,
      source: a.source,
      mimeType: a.mimeType,
      prompt: a.prompt,
      model: a.model,
      starred: a.starred,
      usageCount: a.usageCount,
      lastUsedAt: a.lastUsedAt,
      createdAt: a.createdAt,
    }))
  })
  return c.json({ assets })
})

/** Upload an image (base64 or multipart) */
app.post('/api/media/upload', async (c) => {
  const tenant = c.get('tenant')
  const body = await c.req.json<{
    name: string
    imageData: string // base64 encoded
    mimeType?: string
    tags?: string[]
  }>()

  if (!body.name?.trim() || !body.imageData) {
    return c.json({ error: 'name and imageData (base64) required' }, 400)
  }

  let asset: any
  await withTenantContext(tenant.id, async () => {
    const { addImageAsset } = await import('../src/core/asset-library.js')
    const fs = await import('node:fs')
    const path = await import('node:path')
    const crypto = await import('node:crypto')
    const { getDataDir } = await import('../src/core/state.js')

    // Decode and save to local file
    const buffer = Buffer.from(body.imageData, 'base64')
    if (buffer.length > 5 * 1024 * 1024) {
      throw new Error('Image too large (5MB max)')
    }
    const ext =
      body.mimeType?.includes('jpeg') || body.mimeType?.includes('jpg')
        ? '.jpg'
        : body.mimeType?.includes('gif')
          ? '.gif'
          : body.mimeType?.includes('webp')
            ? '.webp'
            : '.png'
    const filename = `upload-${crypto.randomBytes(6).toString('hex')}${ext}`
    const assetsDir = path.join(getDataDir(), 'assets')
    if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true })
    fs.writeFileSync(path.join(assetsDir, filename), buffer)

    asset = addImageAsset({
      name: body.name.trim().slice(0, 80),
      tags: body.tags ?? [],
      source: filename,
      mimeType: body.mimeType || 'image/png',
      categories: [],
    })
    asset.localPath = filename
  })

  return c.json({ ok: true, asset })
})

/** Generate an image via ClawNet AI */
app.post('/api/media/generate', async (c) => {
  const tenant = c.get('tenant')
  const { prompt, model, tags, style, width, height } = await c.req.json<{
    prompt: string
    model?: string
    tags?: string[]
    style?: string
    width?: number
    height?: number
  }>()

  if (!prompt?.trim()) return c.json({ error: 'prompt required' }, 400)

  // Check balance before generating
  const bal = await getBalance(c.get('apiKey'), { tenantId: tenant.id })
  if (bal < 5) {
    return c.json(
      {
        error:
          'Not enough usage entitlement for image generation. Manage your plan in Settings.',
        code: 'INSUFFICIENT_CREDITS',
      },
      402,
    )
  }

  let result: any
  await withTenantContext(tenant.id, async () => {
    const { generateImage } = await import('../src/intelligence/image-gen.js')
    result = await generateImage(prompt.trim(), {
      model: (model as any) ?? 'fast',
      tags: tags ?? [],
      style,
      width: width ?? 1200,
      height: height ?? 675,
    })
  })

  // Bill for generation
  if (result?.creditsUsed) {
    const { buildBillingOperationIdempotencyKey, deduct } =
      await import('./billing-operations.js')
    const operationId = getRequestOperationId(c, {
      route: '/api/media/generate',
      tenantId: tenant.id,
      prompt: prompt.trim(),
      model: result.model || model || 'fast',
      assetId: result.asset?.id,
    })
    try {
      await deduct({
        tenantId: tenant.id,
        apiKey: c.get('apiKey'),
        amount: result.creditsUsed,
        reason: `pulse-image-gen:${model ?? 'fast'}`,
        idempotencyKey: buildBillingOperationIdempotencyKey({
          tenantId: tenant.id,
          action: 'image_generation',
          operationId,
        }),
        metadata: {
          route: '/api/media/generate',
          operationId,
          model: result.model || model || 'fast',
          assetId: result.asset?.id,
        },
      })
    } catch {}
  }

  return c.json({
    ok: true,
    asset: {
      id: result.asset.id,
      name: result.asset.name,
      tags: result.asset.tags,
      source: result.imageUrl,
      prompt: result.asset.prompt,
      model: result.model,
      starred: false,
      usageCount: 0,
      createdAt: result.asset.createdAt,
    },
    creditsUsed: result.creditsUsed,
    imageUrl: result.imageUrl,
  })
})

/** Update asset metadata (tags, name, starred) */
app.post('/api/media/:id/update', async (c) => {
  const tenant = c.get('tenant')
  const id = c.req.param('id')
  const updates = await c.req.json<{
    name?: string
    tags?: string[]
    starred?: boolean
  }>()

  let updated: any
  await withTenantContext(tenant.id, async () => {
    const { updateAsset } = await import('../src/core/asset-library.js')
    updated = updateAsset(id, updates as any)
  })

  if (!updated) return c.json({ error: 'Asset not found' }, 404)
  return c.json({ ok: true, asset: updated })
})

/** Toggle star on an asset */
app.post('/api/media/:id/star', async (c) => {
  const tenant = c.get('tenant')
  const id = c.req.param('id')

  let starred = false
  await withTenantContext(tenant.id, async () => {
    const { toggleStar } = await import('../src/core/asset-library.js')
    starred = toggleStar(id)
  })

  return c.json({ ok: true, starred })
})

/** Delete an asset */
app.post('/api/media/:id/delete', async (c) => {
  const tenant = c.get('tenant')
  const id = c.req.param('id')

  let deleted = false
  await withTenantContext(tenant.id, async () => {
    const { deleteAsset } = await import('../src/core/asset-library.js')
    deleted = deleteAsset(id)
  })

  if (!deleted) return c.json({ error: 'Asset not found' }, 404)
  return c.json({ ok: true })
})

/** Get available image generation models + pricing */
app.get('/api/media/models', async (c) => {
  const { getAvailableModels } =
    await import('../src/intelligence/image-gen.js')
  return c.json({ models: getAvailableModels() })
})

/** Get content rules (visible to user, editable) */
app.get('/api/content-rules', async (c) => {
  const tenant = c.get('tenant')
  let rules: any[] = []
  await withTenantContext(tenant.id, async () => {
    const { loadBrandProfile, DEFAULT_CONTENT_RULES } =
      await import('../src/intelligence/brand-profile.js')
    const profile = loadBrandProfile()
    rules = profile.contentRules?.length
      ? profile.contentRules
      : DEFAULT_CONTENT_RULES()
  })
  return c.json({ rules })
})

/** Update content rules (toggle, edit, add, remove) */
app.post('/api/content-rules', async (c) => {
  const tenant = c.get('tenant')
  const { rules } = await c.req.json<{
    rules: Array<{ id: string; text: string; enabled: boolean }>
  }>()
  if (!Array.isArray(rules))
    return c.json({ error: 'rules array required' }, 400)

  await withTenantContext(tenant.id, async () => {
    const { loadBrandProfile, saveBrandProfile } =
      await import('../src/intelligence/brand-profile.js')
    const profile = loadBrandProfile()
    profile.contentRules = rules
    saveBrandProfile(profile)
  })
  return c.json({ ok: true })
})

/** Generate a caption/post text for an image (image-first flow) */
app.post('/api/media/:id/caption', async (c) => {
  const tenant = c.get('tenant')
  const id = c.req.param('id')
  const { platform, style } = await c.req.json<{
    platform?: string
    style?: string
  }>()

  let caption = ''
  let creditsUsed = 0
  await withTenantContext(tenant.id, async () => {
    const { getAssets } = await import('../src/core/asset-library.js')
    const { loadBrandProfile, buildProfileContext } =
      await import('../src/intelligence/brand-profile.js')
    const { askLLMWithSystemAndUsage } = await import('../src/core/llm.js')

    const assets = getAssets({ type: 'image' as const })
    const asset = assets.find((a) => a.id === id)
    if (!asset) throw new Error('Image not found')

    const profile = loadBrandProfile()
    const profileCtx = buildProfileContext()
    const plat = platform || 'x'
    const charLimit = plat === 'x' ? 280 : 2000

    const systemPrompt = `You write social media posts. ${profileCtx}

Generate a ${plat} post to accompany this image.
Image name: ${asset.name}
Image tags: ${asset.tags.join(', ')}
${asset.prompt ? `Image was generated with prompt: ${asset.prompt}` : ''}
${style ? `Style guidance: ${style}` : ''}

Rules:
- Max ${charLimit} characters
- Write as the brand, in their voice
- The image is the star — the text should complement it, not describe it
- Be natural, not salesy
- Return ONLY the post text, nothing else`

    const result = await askLLMWithSystemAndUsage(
      systemPrompt,
      'Generate the post text.',
      {
        maxTokens: 300,
        temperature: 0.85,
      },
    )

    if (result) {
      caption = result.text.trim().replace(/^["']|["']$/g, '')
      // Bill
      const { calculateDynamicCost } = (await import('./billing.js')) as any
      creditsUsed = calculateDynamicCost(result.usage)
      const { buildBillingOperationIdempotencyKey, deduct } =
        await import('./billing-operations.js')
      const operationId = getRequestOperationId(c, {
        route: '/api/media/:id/caption',
        tenantId: tenant.id,
        assetId: id,
        platform: plat,
        style: style || '',
        caption,
        model: result.usage?.model || 'unknown',
      })
      try {
        await deduct({
          tenantId: tenant.id,
          apiKey: c.get('apiKey'),
          amount: creditsUsed,
          reason: 'pulse-image-caption',
          idempotencyKey: buildBillingOperationIdempotencyKey({
            tenantId: tenant.id,
            action: 'image_caption',
            operationId,
          }),
          metadata: {
            route: '/api/media/:id/caption',
            operationId,
            assetId: id,
            platform: plat,
            style: style || '',
            model: result.usage?.model || 'unknown',
          },
        })
      } catch {}
    }
  })

  if (!caption) return c.json({ error: 'Caption generation failed' }, 500)
  return c.json({ ok: true, caption, creditsUsed })
})

/** Serve uploaded media files from tenant's assets directory */
app.get('/api/media-file/:filename', async (c) => {
  const tenant = c.get('tenant')
  const filename = c.req.param('filename')
  // Prevent path traversal
  if (
    filename.includes('..') ||
    filename.includes('/') ||
    filename.includes('\\')
  ) {
    return c.json({ error: 'Invalid filename' }, 400)
  }

  let filePath = ''
  await withTenantContext(tenant.id, async () => {
    const { getDataDir } = await import('../src/core/state.js')
    const path = await import('node:path')
    filePath = path.join(getDataDir(), 'assets', filename)
  })

  const fs = await import('node:fs')
  if (!filePath || !fs.existsSync(filePath)) {
    return c.json({ error: 'File not found' }, 404)
  }

  const ext = filename.split('.').pop()?.toLowerCase()
  const mimeMap: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
  }
  const mime = mimeMap[ext || ''] || 'application/octet-stream'
  const buffer = fs.readFileSync(filePath)
  return new Response(buffer, {
    headers: { 'Content-Type': mime, 'Cache-Control': 'public, max-age=86400' },
  })
})

// Legacy HTML panel routes — only register when SPA build is not present

if (!_spaReady) {
  for (const page of Object.keys(pageModules)) {
    app.get(`/${page}`, async (c) => {
      const tenant = c.get('tenant')
      return await withTenantContext(tenant.id, async () => {
        const mod = await import(pageModules[page])
        const { agents, activeId } = await getHostedLayoutAgentState(tenant.id)
        const url = new URL(c.req.url)
        const html = await mod.renderPage(url.searchParams)
        return c.html(
          wrapLayout(
            html,
            tenant,
            pageLabels[page],
            agents,
            activeId,
          ),
        )
      })
    })

    app.post(`/${page}`, async (c) => {
      const tenant = c.get('tenant')
      return await withTenantContext(tenant.id, async () => {
        const mod = await import(pageModules[page])
        if (!mod.handlePost) return c.redirect(`/${page}`)
        const body = (await c.req.parseBody()) as Record<string, string>
        const action = body.action || ''
        const result = await mod.handlePost(action, body)
        if (result?.redirect) return c.redirect(result.redirect)
        if (result?.json) return c.json(result.json)
        return c.redirect(`/${page}`)
      })
    })
  }
}

// ─── Admin Routes ───────────────────────────────────────────────────────────

const admin = new Hono()
admin.use('/*', adminAuth())
admin.get('/tenants', (c) =>
  c.json({ count: listTenants().length, tenants: listTenants() }),
)
admin.get('/tenants/:id', (c) => {
  const tenant = getTenant(c.req.param('id'))
  if (!tenant) return c.json({ error: 'Not found' }, 404)
  return c.json({ tenant, usage: getUsageSummary(tenant) })
})
admin.get('/stats', (c) => {
  const all = listTenants()
  return c.json({
    total: all.length,
    active: all.filter((t) => t.status === 'active').length,
  })
})
admin.get('/privacy/export/:subjectType/:subjectId', async (c) => {
  const subjectType = c.req.param('subjectType')
  const subjectId = c.req.param('subjectId')
  if (
    subjectType !== 'tenant' &&
    subjectType !== 'org' &&
    subjectType !== 'user'
  ) {
    return c.json({ error: 'Invalid subject type' }, 400)
  }
  const includeProfileExport = c.req.query('includeProfileExport') !== '0'
  const payload = await exportPrivacyData({
    subjectType,
    subjectId,
    includeProfileExport,
  })
  return c.json(payload)
})
admin.post('/privacy/requests', async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    subjectType?: 'tenant' | 'org' | 'user'
    subjectId?: string
    tenantId?: string
    orgId?: string
    userId?: string
    action?: 'export' | 'delete' | 'anonymize'
    mode?: 'record_only' | 'soft_delete'
    requestedBy?: string
    notes?: string
    metadata?: Record<string, unknown>
    execute?: boolean
  } | null
  if (!body?.subjectType || !body?.subjectId || !body?.action) {
    return c.json(
      { error: 'subjectType, subjectId, and action are required' },
      400,
    )
  }
  const result = await requestPrivacyAction({
    subjectType: body.subjectType,
    subjectId: body.subjectId,
    tenantId: body.tenantId,
    orgId: body.orgId,
    userId: body.userId,
    action: body.action,
    mode: body.mode,
    requestedBy: body.requestedBy,
    notes: body.notes,
    metadata: body.metadata,
    execute: body.execute,
  })
  return c.json(result, body.execute ? 200 : 202)
})
admin.get('/privacy/requests/:id', (c) => {
  const request = getPrivacyRequest(c.req.param('id'))
  if (!request) return c.json({ error: 'Not found' }, 404)
  return c.json({ request })
})
app.route('/admin', admin)

// ─── Layout ─────────────────────────────────────────────────────────────────

function wrapLayout(
  content: string,
  tenant: Tenant,
  title: string,
  agents?: { id: string; name: string }[],
  activeAgentId?: string,
): string {
  const nav = [
    { href: '/chat-setup', label: 'Chat', icon: '💬' },
    { href: '/autopilot', label: 'Autopilot', icon: '🤖' },
    { href: '/create', label: 'Create', icon: '📝' },
    { href: '/knowledge', label: 'Knowledge', icon: '🧠' },
    { href: '/activity', label: 'Activity', icon: '📊' },
    { href: '/settings', label: 'Settings', icon: '⚙️' },
  ]
  const links = nav
    .map(
      (n) =>
        `<a href="${n.href}" class="nav-link${title === n.label ? ' active' : ''}"><span class="nav-icon">${n.icon}</span>${n.label}</a>`,
    )
    .join('')

  return `<!DOCTYPE html><html style="background:#0d1117"><head><title>Pulse — ${title}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="shortcut icon" href="/favicon.ico">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="icon" type="image/png" href="/favicon.png" sizes="32x32">
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{background:#0d1117;color:#e6edf3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
.layout{display:flex;min-height:100vh}
.sidebar{width:220px;background:#161b22;border-right:1px solid #21262d;display:flex;flex-direction:column;padding:16px 0}
.sidebar-brand{padding:0 20px 12px;font-size:1.2rem;font-weight:700;color:#58a6ff}
.nav-link{display:flex;align-items:center;gap:10px;padding:10px 20px;color:#8b949e;text-decoration:none;font-size:0.88rem;border-left:3px solid transparent}
.nav-link:hover{color:#e6edf3;background:#1c2128}
.nav-link.active{color:#e6edf3;background:#1c2128;border-left-color:#58a6ff}
.sidebar-section{padding:12px 20px;border-top:1px solid #21262d}
.sidebar-footer{margin-top:auto;padding:12px 20px;border-top:1px solid #21262d}
.sidebar-footer a{color:#8b949e;font-size:0.78rem;text-decoration:none}
.sidebar-select{width:100%;background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:6px;padding:7px 28px 7px 10px;font-size:0.8rem;font-family:inherit;cursor:pointer;outline:none;appearance:none;-webkit-appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23484f58'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 8px center}
.sidebar-select:hover{border-color:#484f58}
.sidebar-select:focus{border-color:#58a6ff}
.sidebar-new-agent{background:#238636;color:#fff;border:none;border-radius:6px;padding:4px 10px;font-size:0.78rem;font-weight:700;cursor:pointer;margin-left:6px;vertical-align:middle}
.sidebar-new-agent:hover{background:#2ea043}
.sf-credits{font-size:0.8rem;color:#8b949e;margin-bottom:8px;font-variant-numeric:tabular-nums;background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:8px 12px;text-align:center}
.sf-dashboard{display:block;text-align:center;background:#21262d;color:#c9d1d9;border:1px solid #30363d;border-radius:6px;padding:7px 0;font-size:0.78rem;font-weight:500;text-decoration:none;transition:all 0.15s;margin-bottom:10px}
.sf-dashboard:hover{background:#30363d;border-color:#484f58;color:#e6edf3}
.sf-account{display:flex;align-items:center;gap:6px;font-size:0.72rem}
.sf-email{color:#484f58;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
.sf-link{color:#484f58;text-decoration:none;white-space:nowrap;transition:color 0.12s}
.sf-link:hover{color:#8b949e}
.sf-logout:hover{color:#f85149}
.platform-toggles{display:flex;flex-wrap:wrap;gap:5px}
.plat-btn{background:#21262d;color:#8b949e;border:1px solid #30363d;border-radius:6px;padding:5px 10px;font-size:0.75rem;font-family:inherit;cursor:pointer;transition:all 0.15s;font-weight:500;display:inline-flex;align-items:center;gap:5px}
.plat-btn:hover{border-color:#58a6ff;color:#c9d1d9;background:#1c2128}
.plat-btn.active{background:#1f6feb22;color:#58a6ff;border-color:#1f6feb;font-weight:600}
.plat-btn svg{width:14px;height:14px;flex-shrink:0;opacity:0.7}
.plat-btn.active svg{opacity:1}
.main{flex:1;padding:24px 32px;overflow-y:auto}
.header{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px}
.header-title{font-size:1.3rem;font-weight:600}
.header-user{color:#8b949e;font-size:0.82rem}
/* ── Global button styles ── */
.btn{display:inline-flex;align-items:center;justify-content:center;padding:8px 16px;border-radius:6px;font-size:0.85rem;font-weight:500;font-family:inherit;cursor:pointer;transition:background 0.15s,border-color 0.15s;border:1px solid #30363d;text-decoration:none;line-height:1.4}
.btn-primary{background:#238636;color:#fff;border-color:#238636}
.btn-primary:hover{background:#2ea043;border-color:#2ea043}
.btn-secondary{background:#21262d;color:#c9d1d9;border-color:#30363d}
.btn-secondary:hover{background:#30363d;border-color:#484f58;color:#e6edf3}
.btn-danger{background:transparent;color:#f85149;border-color:#f85149}
.btn-danger:hover{background:rgba(248,81,73,0.15)}
/* ── Global input styles (number, text outside form-field context) ── */
input[type="number"]{background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:6px;padding:8px 12px;font-size:0.85rem;font-family:inherit;outline:none;box-sizing:border-box}
input[type="number"]:focus{border-color:#58a6ff}
input[type="text"]:not(.chat-input):not(.generate-input){background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:6px;padding:8px 12px;font-size:0.85rem;font-family:inherit;outline:none;box-sizing:border-box}
input[type="text"]:not(.chat-input):not(.generate-input):focus{border-color:#58a6ff}
/* ── Custom radio buttons ── */
input[type="radio"]{appearance:none;-webkit-appearance:none;width:16px;height:16px;border:2px solid #30363d;border-radius:50%;background:#0d1117;cursor:pointer;vertical-align:middle;position:relative;flex-shrink:0}
input[type="radio"]:checked{border-color:#58a6ff;background:#58a6ff}
input[type="radio"]:checked::after{content:'';position:absolute;width:6px;height:6px;background:#fff;border-radius:50%;top:50%;left:50%;transform:translate(-50%,-50%)}
input[type="radio"]:hover{border-color:#58a6ff}
@media(max-width:768px){.layout{flex-direction:column}.sidebar{width:100%;flex-direction:row;padding:8px;overflow-x:auto;border-right:none;border-bottom:1px solid #21262d}.sidebar-brand,.sidebar-section,.sidebar-footer{display:none}.sidebar>div:nth-child(2){display:none}.nav-link{padding:8px 14px;border-left:none;border-bottom:3px solid transparent;white-space:nowrap}.nav-link.active{border-bottom-color:#58a6ff;border-left:none}.main{padding:16px}}
</style></head><body><div class="layout">
<nav class="sidebar">
  <div class="sidebar-brand">PULSE</div>
  <div style="padding:0 20px 12px;">
    <div style="display:flex;gap:6px;align-items:center;">
      <select class="sidebar-select" id="agentSelect" onchange="switchAgent(this.value)" autocomplete="off" style="flex:1;">
        <option value="default"${!activeAgentId || activeAgentId === 'default' ? ' selected' : ''}>Default Brand</option>
        ${(agents || []).map((a) => `<option value="${a.id}"${a.id === activeAgentId ? ' selected' : ''}>${a.name}</option>`).join('')}
      </select>
      <button class="sidebar-new-agent" onclick="createAgent()" title="New brand">+</button>
    </div>
  </div>
  ${links}
  <div class="sidebar-section">
    <div class="platform-toggles" id="platformToggles">
      <button class="plat-btn active" data-plat="x" onclick="togglePlatform(this)"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>X</button>
    </div>
  </div>
  <div class="sidebar-footer">
    <div class="sf-credits"><span style="color:#3fb950;font-weight:600;" id="creditCount">—</span> usage credits</div>
    <a href="${CLAWNET_URL}/dashboard" target="_blank" class="sf-dashboard">Provider Dashboard</a>
    <div class="sf-account">
      <span class="sf-email" title="${tenant.email}">${tenant.email}</span>
      <a href="/login" class="sf-link">Switch</a>
      <span style="color:#21262d;">·</span>
      <a href="/auth/logout" class="sf-link sf-logout">Log out</a>
    </div>
  </div>
</nav>
<main class="main">
  <div class="header"><div class="header-title">${title}</div></div>
  ${content}
</main>
</div>

<!-- Global Modal -->
<div id="pulseModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;align-items:center;justify-content:center;">
  <div style="background:#161b22;border:1px solid #30363d;border-radius:12px;padding:24px;max-width:400px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,0.5);">
    <div id="pulseModalTitle" style="font-size:1rem;font-weight:600;color:#e6edf3;margin-bottom:12px;"></div>
    <div id="pulseModalBody"></div>
    <div id="pulseModalActions" style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;"></div>
  </div>
</div>

<script>
fetch('/api/credits').then(r=>r.json()).then(d=>{
  const el=document.getElementById('creditCount');
  if(el&&d.credits!=null)el.textContent=d.credits.toLocaleString();
}).catch(()=>{});

/* ── Custom modal system (replaces native prompt/confirm/alert) ── */
function _showModal(title,bodyHtml,actions){
  const m=document.getElementById('pulseModal');
  document.getElementById('pulseModalTitle').textContent=title;
  document.getElementById('pulseModalBody').innerHTML=bodyHtml;
  document.getElementById('pulseModalActions').innerHTML=actions;
  m.style.display='flex';
  const inp=m.querySelector('input');
  if(inp)setTimeout(()=>inp.focus(),50);
}
function _hideModal(){document.getElementById('pulseModal').style.display='none';}
document.getElementById('pulseModal').addEventListener('click',function(e){if(e.target===this)_hideModal();});

function pulsePrompt(title,placeholder){
  return new Promise(function(resolve){
    _showModal(title,
      '<input id="pulsePromptInput" type="text" placeholder="'+(placeholder||'')+'" style="width:100%;background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:6px;padding:10px 14px;font-size:0.9rem;outline:none;font-family:inherit;">',
      '<button onclick="_hideModal()" style="background:#21262d;color:#c9d1d9;border:1px solid #30363d;border-radius:6px;padding:8px 20px;font-size:0.85rem;cursor:pointer;">Cancel</button>'
      +'<button id="pulsePromptOk" style="background:#238636;color:#fff;border:none;border-radius:6px;padding:8px 20px;font-size:0.85rem;font-weight:600;cursor:pointer;">OK</button>'
    );
    var inp=document.getElementById('pulsePromptInput');
    var ok=document.getElementById('pulsePromptOk');
    ok.onclick=function(){var v=inp.value.trim();_hideModal();resolve(v||null);};
    inp.onkeydown=function(e){if(e.key==='Enter'){ok.click();}if(e.key==='Escape'){_hideModal();resolve(null);}};
  });
}

function pulseConfirm(title,message){
  return new Promise(function(resolve){
    _showModal(title,
      '<p style="color:#8b949e;font-size:0.88rem;line-height:1.5;">'+(message||'')+'</p>',
      '<button onclick="_hideModal()" style="background:#21262d;color:#c9d1d9;border:1px solid #30363d;border-radius:6px;padding:8px 20px;font-size:0.85rem;cursor:pointer;">Cancel</button>'
      +'<button id="pulseConfirmOk" style="background:#da3633;color:#fff;border:none;border-radius:6px;padding:8px 20px;font-size:0.85rem;font-weight:600;cursor:pointer;">Confirm</button>'
    );
    document.getElementById('pulseConfirmOk').onclick=function(){_hideModal();resolve(true);};
  });
}

/* ── Platform toggles (multi-select, syncs to server config) ── */
function togglePlatform(btn){
  btn.classList.toggle('active');
  var active=[];
  document.querySelectorAll('.plat-btn.active').forEach(function(b){active.push(b.dataset.plat);});
  document.cookie='pulse_platforms='+encodeURIComponent(active.join(','))+';path=/;max-age='+30*86400;
  // Sync to server config (fire-and-forget)
  fetch('/api/platforms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({platforms:active})}).catch(function(){});
}
// Restore platform state from cookie (fallback) or server config
(function(){
  var m=document.cookie.match(/pulse_platforms=([^;]*)/);
  if(m){
    var active=decodeURIComponent(m[1]).split(',').filter(Boolean);
    document.querySelectorAll('.plat-btn').forEach(function(b){
      b.classList.toggle('active',active.includes(b.dataset.plat));
    });
  }
})();

/* ── Brand switching — no page reload ── */
function switchAgent(id){
  document.cookie='pulse_agent='+encodeURIComponent(id)+';path=/;max-age='+30*86400;
  fetch('/api/brands/switch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:id})}).catch(function(){});
}
async function createAgent(){
  const name=await pulsePrompt('Create Brand','Brand name');
  if(!name)return;
  try{
    const res=await fetch('/api/brands',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name})});
    const data=await res.json();
    if(data.ok&&data.agent){
      var sel=document.getElementById('agentSelect');
      var opt=document.createElement('option');
      opt.value=data.agent.id;opt.textContent=data.agent.name;opt.selected=true;
      sel.appendChild(opt);
    }
  }catch(e){}
}
</script>
</body></html>`
}

// ─── SPA Static Serving ──────────────────────────────────────────────────────

const SPA_DIR = _join(import.meta.dirname || '.', 'ui', 'dist')
const SPA_ENABLED = _spaReady

if (SPA_ENABLED) {
  const spaIndex = readFileSync(_join(SPA_DIR, 'index.html'), 'utf-8')
  const mimeTypes: Record<string, string> = {
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.html': 'text/html',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.json': 'application/json',
  }

  // Serve static assets from /assets/* and root-level static files (favicon, etc.)
  app.get('/assets/*', (c) => {
    const filePath = _join(SPA_DIR, new URL(c.req.url).pathname)
    if (_exists(filePath)) {
      const ext = _extname(filePath)
      const content = readFileSync(filePath)
      return new Response(content, {
        headers: {
          'Content-Type': mimeTypes[ext] || 'application/octet-stream',
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      })
    }
    return c.notFound()
  })

  app.get('/favicon.svg', (c) => {
    const filePath = _join(SPA_DIR, 'favicon.svg')
    if (_exists(filePath)) {
      return new Response(readFileSync(filePath), {
        headers: {
          'Content-Type': 'image/svg+xml',
          'Cache-Control': 'public, max-age=86400',
        },
      })
    }
    return c.notFound()
  })

  app.get('/favicon.png', (c) => {
    const filePath = _join(SPA_DIR, 'favicon.png')
    if (_exists(filePath)) {
      return new Response(readFileSync(filePath), {
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=86400',
        },
      })
    }
    return c.notFound()
  })

  app.get('/favicon.ico', (c) => {
    const filePath = _join(SPA_DIR, 'favicon.ico')
    if (_exists(filePath)) {
      return new Response(readFileSync(filePath), {
        headers: {
          'Content-Type': 'image/x-icon',
          'Cache-Control': 'public, max-age=86400',
        },
      })
    }
    return c.notFound()
  })

  // SPA fallback — serve index.html for any unmatched GET request
  // no-cache ensures browser always fetches fresh index.html (assets use content hashes)
  app.get('*', (c) => {
    c.header('Cache-Control', 'no-cache, no-store, must-revalidate')
    return c.html(spaIndex)
  })

  console.log('  SPA: enabled (serving from hosted/ui/dist/)')
} else {
  console.log(
    '  SPA: disabled (no hosted/ui/dist/ found — using legacy HTML panel)',
  )
}

// ─── Start ──────────────────────────────────────────────────────────────────

console.log('\n  PULSE Hosted SaaS')
console.log(`  Port: ${PORT}`)
console.log(
  `  ClawNet API: ${process.env.CLAWNET_API_URL || 'https://api.claw-net.org'}`,
)
console.log(`  Encryption: ${process.env.TENANT_ENCRYPTION_KEY ? '✓' : '✗'}`)
console.log(
  `  LLM: ${process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.OPENROUTER_API_KEY ? '✓' : '✗'}`,
)

const warnings: string[] = []
if (!process.env.TENANT_ENCRYPTION_KEY)
  warnings.push('TENANT_ENCRYPTION_KEY not set')
if (
  !process.env.GROQ_API_KEY &&
  !process.env.OPENAI_API_KEY &&
  !process.env.ANTHROPIC_API_KEY &&
  !process.env.OPENROUTER_API_KEY
)
  warnings.push('No platform LLM key')
if (!process.env.SERPER_API_KEY && !process.env.BRAVE_API_KEY && !process.env.SERPAPI_API_KEY)
  warnings.push('No search provider key')
if (warnings.length > 0) {
  console.log('\n  ⚠ Warnings:')
  warnings.forEach((w) => console.log(`    - ${w}`))
}
console.log('')

getHostedDb()
startScheduler()
try {
  initPulseHeart()
} catch (err) {
  console.error('[heart-client] startup init failed:', err)
}
serve({ fetch: app.fetch, port: PORT })
console.log(`  Listening on http://0.0.0.0:${PORT}\n`)
