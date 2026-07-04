/**
 * Legacy ClawNet API key authentication for Hosted Pulse.
 *
 * Kept as a provider/rollback path while standalone production uses
 * first-party auth, Stripe entitlements, and durable usage events.
 */

import type { Context, Next } from "hono";
import crypto from "node:crypto";
import {
  getTenantByApiKey,
  createTenant,
  hasPin,
  getPinHash,
  setPinHash,
  storeOtp,
  getOtp,
  incrementOtpAttempts,
  deleteOtp,
  cleanExpiredOtps,
  type Tenant,
} from "./db.js";
import {
  CLAWNET_AUTH_PROVIDER,
  FIRST_PARTY_AUTH_PROVIDER,
  getAuthProviderName,
  type AuthProviderName,
} from "./sessions.js";

const DEFAULT_PULSE_FROM = "Pulse <notifications@pulse.app>";
const DEFAULT_PULSE_SUPPORT_EMAIL = "support@pulse.app";

// Session timeout — cookie expires after this period of inactivity.
// Each authenticated request refreshes the timer (sliding window).
export const SESSION_MAX_AGE = 30 * 60; // 30 min inactivity timeout (sliding window)

// PIN cookie expires after 5 minutes of inactivity (sliding window).
// Each authenticated request refreshes the timer. This means:
// - Refresh while active → no re-PIN (timer refreshed)
// - Close tab, return within 5 min → no re-PIN
// - Close tab, return after 5 min → PIN required
// - 30 min idle → auth session expires → full re-login + PIN
export const PIN_COOKIE_MAX_AGE = 5 * 60; // 5 minutes sliding window

// ─── PIN Hashing (scrypt) ──────────────────────────────────────────────────

export function hashPin(pin: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(pin, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPin(pin: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const check = crypto.scryptSync(pin, salt, 32).toString("hex");
  return crypto.timingSafeEqual(
    Buffer.from(hash, "hex"),
    Buffer.from(check, "hex"),
  );
}

// ─── PIN Verification Check ────────────────────────────────────────────────

function extractCookie(c: Context, name: string): string | null {
  const cookies = c.req.header("Cookie") || "";
  for (const cookie of cookies.split(";")) {
    const [k, v] = cookie.trim().split("=");
    if (k === name) return decodeURIComponent(v);
  }
  return null;
}

export function isPinVerified(c: Context): boolean {
  return extractCookie(c, "pulse_pin_verified") === "1";
}

export interface LegacyPinOtpPosture {
  authProvider: AuthProviderName;
  usesLegacyPinGate: boolean;
  usesLegacyOtpRecovery: boolean;
}

export function getLegacyPinOtpPosture(
  authProvider: AuthProviderName = getAuthProviderName(),
): LegacyPinOtpPosture {
  if (authProvider === FIRST_PARTY_AUTH_PROVIDER) {
    return {
      authProvider,
      usesLegacyPinGate: false,
      usesLegacyOtpRecovery: false,
    };
  }

  return {
    authProvider: CLAWNET_AUTH_PROVIDER,
    usesLegacyPinGate: true,
    usesLegacyOtpRecovery: true,
  };
}

// ─── OTP for PIN Recovery (DB-persisted, survives restarts) ─────────────────

export function generateOtp(tenantId: string): string {
  const code = String(crypto.randomInt(100000, 999999));
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  storeOtp(tenantId, code, expiresAt);
  return code;
}

export function verifyOtp(
  tenantId: string,
  code: string,
): { ok: boolean; error?: string } {
  const entry = getOtp(tenantId);
  if (!entry)
    return { ok: false, error: "No code pending. Request a new one." };
  if (new Date(entry.expires_at) < new Date()) {
    deleteOtp(tenantId);
    return { ok: false, error: "Code expired. Request a new one." };
  }
  if (entry.attempts >= 5) {
    deleteOtp(tenantId);
    return { ok: false, error: "Too many attempts. Request a new one." };
  }
  incrementOtpAttempts(tenantId);
  if (entry.code !== code.trim())
    return {
      ok: false,
      error: `Incorrect code. ${4 - entry.attempts} attempts left.`,
    };
  deleteOtp(tenantId);
  return { ok: true };
}

// Clean expired OTPs every 30 minutes
setInterval(() => {
  try {
    cleanExpiredOtps();
  } catch {}
}, 30 * 60_000);

export async function sendOtpEmail(
  email: string,
  code: string,
  product: string = "Pulse",
): Promise<boolean> {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    console.log(
      `[OTP] No RESEND_API_KEY — cannot send to ${email.replace(/(.{2}).*(@.*)/, "$1***$2")}`,
    );
    return true;
  }
  try {
    const color = product === "Radar" ? "#d29922" : "#58a6ff";
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || DEFAULT_PULSE_FROM,
        to: email,
        subject: `${product} verification code: ${code}`,
        html: `<!DOCTYPE html><html><body style="font-family:monospace;background:#0d1117;color:#e6edf3;padding:40px;">
<div style="max-width:400px;margin:0 auto;background:#161b22;border:1px solid #30363d;border-radius:12px;padding:32px;text-align:center;">
<h1 style="color:${color};font-size:1.4rem;margin:0 0 8px;">${product} Verification</h1>
<p style="color:#8b949e;font-size:0.88rem;margin:0 0 24px;">Enter this code to verify your identity.</p>
<div style="font-size:2.4rem;font-weight:700;letter-spacing:0.3em;color:#e6edf3;background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:16px;margin-bottom:16px;">${code}</div>
<p style="color:#484f58;font-size:0.78rem;">Expires in 10 minutes. If you didn't request this, ignore it.</p>
</div></body></html>`,
      }),
      signal: AbortSignal.timeout(10000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function sendPinResetNotification(
  email: string,
  product: string = "Pulse",
): Promise<void> {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || DEFAULT_PULSE_FROM,
        to: email,
        subject: `${product} PIN was reset`,
        html: `<!DOCTYPE html><html><body style="font-family:monospace;background:#0d1117;color:#e6edf3;padding:40px;">
<div style="max-width:400px;margin:0 auto;background:#161b22;border:1px solid #30363d;border-radius:12px;padding:32px;text-align:center;">
<h1 style="color:#f85149;font-size:1.4rem;margin:0 0 8px;">PIN Reset</h1>
<p style="color:#8b949e;font-size:0.88rem;margin:0 0 16px;">Your ${product} PIN was just reset.</p>
<p style="color:#8b949e;font-size:0.88rem;">If this wasn't you, contact support immediately at <a href="mailto:${process.env.PULSE_SUPPORT_EMAIL || DEFAULT_PULSE_SUPPORT_EMAIL}" style="color:#58a6ff;">${process.env.PULSE_SUPPORT_EMAIL || DEFAULT_PULSE_SUPPORT_EMAIL}</a></p>
</div></body></html>`,
      }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {}
}

export async function sendVerificationEmail(
  email: string,
  token: string,
  baseUrl: string,
): Promise<boolean> {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    console.log(
      `[VERIFY] No RESEND_API_KEY — cannot send to ${email.replace(/(.{2}).*(@.*)/, "$1***$2")}`,
    );
    return true;
  }
  try {
    const verifyUrl = `${baseUrl.replace(/\/$/, "")}/auth/verify?token=${encodeURIComponent(token)}`;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || DEFAULT_PULSE_FROM,
        to: email,
        subject: `Verify your Pulse account`,
        html: `<!DOCTYPE html><html><body style="font-family:monospace;background:#0d1117;color:#e6edf3;padding:40px;">
<div style="max-width:400px;margin:0 auto;background:#161b22;border:1px solid #30363d;border-radius:12px;padding:32px;text-align:center;">
<h1 style="color:#58a6ff;font-size:1.4rem;margin:0 0 8px;">Verify your email</h1>
<p style="color:#8b949e;font-size:0.88rem;margin:0 0 24px;">Click the button below to verify your Pulse account.</p>
<a href="${verifyUrl}" style="display:inline-block;background:#238636;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:1rem;font-weight:600;">Verify email</a>
<p style="color:#484f58;font-size:0.78rem;margin-top:16px;">Link expires in 24 hours. If you didn't create this account, ignore this email.</p>
</div></body></html>`,
      }),
      signal: AbortSignal.timeout(10000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export { hasPin, setPinHash, getPinHash, getPinRecoveryEmail } from "./db.js";

function getClawNetUrl(): string {
  return process.env.CLAWNET_API_URL || "https://api.claw-net.org";
}

interface ClawNetKeyInfo {
  userId: string;
  email: string;
  credits: number;
  plan: string;
  active: boolean;
}

/**
 * Validate a ClawNet API key by calling the ClawNet API.
 * Returns key info (userId, credits, plan) or null if invalid.
 */
// Cache validated keys for 5 minutes to avoid external API calls on every request.
// Prevents random logouts from network blips to ClawNet API.
const keyCache = new Map<string, { info: ClawNetKeyInfo; expiresAt: number }>();
const KEY_CACHE_TTL = 5 * 60_000; // 5 minutes

async function validateApiKey(apiKey: string): Promise<ClawNetKeyInfo | null> {
  if (!apiKey || !apiKey.startsWith("cn-")) return null;

  // Check cache first
  const cached = keyCache.get(apiKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.info;
  }

  try {
    const res = await fetch(`${getClawNetUrl()}/v1/auth/me`, {
      headers: { "X-API-Key": apiKey },
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      // On auth failure, clear cache and return null
      keyCache.delete(apiKey);
      return null;
    }

    const data = (await res.json()) as any;
    const info: ClawNetKeyInfo = {
      userId: data.userId || data.id || "",
      email: data.email || "",
      credits: data.credits ?? 0,
      plan: data.plan || "free",
      active: data.active !== false,
    };

    // Cache the valid key
    keyCache.set(apiKey, { info, expiresAt: Date.now() + KEY_CACHE_TTL });
    return info;
  } catch {
    // Network error — use stale cache ONLY if not expired beyond grace period (10 min)
    // This prevents "shows logged in then logs out" when cache is very stale
    const GRACE_PERIOD = 10 * 60_000; // 10 minutes max stale window
    if (cached && Date.now() < cached.expiresAt + GRACE_PERIOD) {
      return cached.info;
    }
    // Cache too old or doesn't exist — force re-auth
    keyCache.delete(apiKey);
    return null;
  }
}

/**
 * Deduct credits from a ClawNet account for Pulse actions.
 */
export async function deductPulseCredits(
  apiKey: string,
  amount: number,
  reason: string,
): Promise<{ ok: boolean; remaining?: number; error?: string }> {
  // Idempotency key prevents double-charges if the request succeeds on
  // ClawNet's side but the response times out before reaching Pulse.
  const idempotencyKey = `pulse-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  try {
    const res = await fetch(`${getClawNetUrl()}/v1/auth/deduct`, {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({ amount, reason: `pulse:${reason}` }),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      const body = (await res
        .json()
        .catch(() => ({ error: "Credit deduction failed" }))) as any;
      return { ok: false, error: body.error || `HTTP ${res.status}` };
    }

    const data = (await res.json()) as any;
    return { ok: true, remaining: data.credits ?? data.remaining };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Network error",
    };
  }
}

/**
 * Check credit balance without deducting.
 */
export async function checkCredits(apiKey: string): Promise<number> {
  // Bust the cache so credits are always fresh
  keyCache.delete(apiKey);
  const info = await validateApiKey(apiKey);
  return info?.credits ?? 0;
}

/**
 * Extract API key from request.
 * Checks: X-API-Key header, ?apiKey query param, pulse_api_key cookie.
 */
function extractApiKey(c: Context): string | null {
  // Header
  const header = c.req.header("X-API-Key");
  if (header) return header;

  // Query param (for initial login)
  const url = new URL(c.req.url);
  const param = url.searchParams.get("apiKey");
  if (param) return param;

  // Cookie
  const cookies = c.req.header("Cookie") || "";
  for (const cookie of cookies.split(";")) {
    const [name, value] = cookie.trim().split("=");
    if (name === "pulse_api_key") return decodeURIComponent(value);
  }

  return null;
}

// Type-safe Hono context variables
declare module "hono" {
  interface ContextVariableMap {
    tenant: Tenant;
    apiKey: string;
    credits: number;
  }
}

/**
 * ClawNet API key auth middleware for Hono.
 * Validates key, resolves/creates tenant, attaches to context.
 */
export function apiKeyAuth() {
  return async (c: Context, next: Next) => {
    if (getAuthProviderName() === FIRST_PARTY_AUTH_PROVIDER) {
      const { getSessionByToken, SESSION_COOKIE } = await import("./sessions.js");
      const { getHostedDb, createOrg, listMembershipsForUser, addMembership } = await import("./db.js");

      const cookies = c.req.header("Cookie") || "";
      let sessionToken: string | null = null;
      for (const cookie of cookies.split(";")) {
        const [name, ...rest] = cookie.trim().split("=");
        if (name === SESSION_COOKIE.name) {
          sessionToken = decodeURIComponent(rest.join("="));
          break;
        }
      }

      if (sessionToken) {
        const session = getSessionByToken(sessionToken);
        if (session) {
          const user = getHostedDb()
            .prepare("SELECT * FROM users WHERE id = ?")
            .get(session.user_id) as any;

          if (user) {
            let org = null;
            const memberships = listMembershipsForUser(user.id) as any[];
            if (memberships.length > 0) {
              org = getHostedDb()
                .prepare("SELECT * FROM orgs WHERE id = ?")
                .get(memberships[0].org_id) as any;
            }

            if (!org) {
              org = createOrg({ name: user.name || user.email || "Default" });
              addMembership(org.id, user.id, "owner");
            }

            const tenantId =
              getHostedDb()
                .prepare("SELECT id FROM tenants WHERE email = ?")
                .get(user.email) as any;

            let tenant;
            if (tenantId) {
              tenant = getHostedDb()
                .prepare("SELECT * FROM tenants WHERE id = ?")
                .get(tenantId.id) as any;
            }

            if (!tenant) {
              const id = "tn_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
              const apiKey = "fp_" + crypto.randomUUID();
              getHostedDb()
                .prepare(
                  "INSERT INTO tenants (id, api_key, email, name, status) VALUES (?, ?, ?, ?, ?)",
                )
                .run(id, apiKey, user.email, user.name || "", "active");
              tenant = getHostedDb()
                .prepare("SELECT * FROM tenants WHERE id = ?")
                .get(id) as any;
            }

            if (tenant) {
              c.set("tenant", tenant);
              c.set("apiKey", tenant.api_key);
            }
          }
        }
      }

      return next();
    }

    const apiKey = extractApiKey(c);

    if (!apiKey) {
      if (c.req.method === "GET") return c.redirect("/login");
      return c.json(
        { error: "API key required. Use your ClawNet API key (cn-xxx)." },
        401,
      );
    }

    const keyInfo = await validateApiKey(apiKey);
    if (!keyInfo) {
      if (c.req.method === "GET") return c.redirect("/login?error=invalid");
      return c.json({ error: "Invalid API key" }, 401);
    }

    if (!keyInfo.active) {
      return c.json({ error: "API key is deactivated" }, 403);
    }

    // Resolve or create tenant
    let tenant = getTenantByApiKey(apiKey);
    if (!tenant) {
      tenant = createTenant(apiKey, keyInfo.userId, keyInfo.email);
      console.log(`[Auth] New tenant: ${tenant.id} (${keyInfo.email})`);
    }

    c.set("tenant", tenant);
    c.set("apiKey", apiKey);
    c.set("credits", keyInfo.credits);

    // Sliding window — refresh auth cookie on each authenticated request
    c.header(
      "Set-Cookie",
      `pulse_api_key=${encodeURIComponent(apiKey)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}`,
    );

    // PIN gate — optional, controlled by REQUIRE_PIN env var
    const legacyPinOtpPosture = getLegacyPinOtpPosture();
    if (
      process.env.REQUIRE_PIN !== "false" &&
      legacyPinOtpPosture.usesLegacyPinGate
    ) {
      const path = new URL(c.req.url).pathname;
      const pinExempt = ["/pin"];
      if (!pinExempt.some((p) => path.startsWith(p))) {
        if (!hasPin(tenant.id)) {
          if (c.req.method === "GET" && !path.startsWith("/api/"))
            return c.redirect("/pin/setup");
          if (path.startsWith("/api/"))
            return c.json(
              { error: "PIN setup required", code: "PIN_SETUP_REQUIRED" },
              403,
            );
        }
        if (!isPinVerified(c)) {
          if (c.req.method === "GET" && !path.startsWith("/api/"))
            return c.redirect("/pin");
          if (path.startsWith("/api/"))
            return c.json({ error: "PIN required", code: "PIN_REQUIRED" }, 403);
        }
        // Sliding window — refresh PIN cookie on ALL authenticated requests (including API)
        // so active SPA usage keeps the PIN alive
        c.header(
          "Set-Cookie",
          `pulse_pin_verified=1; Path=/; HttpOnly; SameSite=Lax; Max-Age=${PIN_COOKIE_MAX_AGE}`,
          { append: true },
        );
      }
    }

    await next();
  };
}

/**
 * Admin auth middleware — requires X-Admin-Key header.
 */
export function adminAuth() {
  const ADMIN_KEY = process.env.ADMIN_API_KEY || "";
  return async (c: Context, next: Next) => {
    if (!ADMIN_KEY) return c.json({ error: "Admin not configured" }, 503);
    const provided = c.req.header("X-Admin-Key") || "";
    if (
      provided.length !== ADMIN_KEY.length ||
      !crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(ADMIN_KEY))
    )
      return c.json({ error: "Unauthorized" }, 401);
    await next();
  };
}
