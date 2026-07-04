import crypto from "node:crypto";

import { getHostedDb } from "./db.js";

const SESSION_TOKEN_BYTES = 32;
const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;
const TOKEN_HASH_VERSION = "pulse-session-token-v1";

export const FIRST_PARTY_AUTH_PROVIDER = "firstparty";
export const CLAWNET_AUTH_PROVIDER = "clawnet";
export const AUTH_PROVIDER_ENV = "AUTH_PROVIDER";
export const AUTH_PROVIDER_NAMES = [
  CLAWNET_AUTH_PROVIDER,
  FIRST_PARTY_AUTH_PROVIDER,
] as const;
export type AuthProviderName = (typeof AUTH_PROVIDER_NAMES)[number];

export const SESSION_COOKIE = {
  name: "pulse_session",
  path: "/",
  httpOnly: true,
  sameSite: "Lax",
  secureInProduction: true,
  maxAgeSeconds: DEFAULT_SESSION_TTL_SECONDS,
} as const;

export interface HostedSession {
  id: string;
  user_id: string;
  org_id: string | null;
  token_hash: string;
  user_agent: string;
  ip_address: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  revoked_at: string | null;
  rotated_from_session_id: string | null;
  rotated_to_session_id: string | null;
}

export interface CreateSessionInput {
  userId: string;
  orgId?: string | null;
  ttlSeconds?: number;
  userAgent?: string;
  ipAddress?: string;
  now?: Date;
  rotatedFromSessionId?: string | null;
}

export interface CreatedSession {
  session: HostedSession;
  token: string;
}

export interface SessionLookupOptions {
  now?: Date;
  touch?: boolean;
}

export interface RevokeSessionOptions {
  now?: Date;
}

export interface RotateSessionInput {
  token: string;
  ttlSeconds?: number;
  userAgent?: string;
  ipAddress?: string;
  now?: Date;
}

export interface CleanupSessionsInput {
  now?: Date;
  revokedBefore?: Date;
}

export function resolveAuthProviderName(
  value = process.env[AUTH_PROVIDER_ENV] || CLAWNET_AUTH_PROVIDER,
): AuthProviderName {
  const normalized = value.trim();
  if (!normalized) return CLAWNET_AUTH_PROVIDER;
  if (
    normalized === CLAWNET_AUTH_PROVIDER ||
    normalized === FIRST_PARTY_AUTH_PROVIDER
  ) {
    return normalized;
  }
  throw new Error(
    `Unknown ${AUTH_PROVIDER_ENV}="${normalized}". Expected one of: ${AUTH_PROVIDER_NAMES.join(", ")}`,
  );
}

export function getAuthProviderName(): AuthProviderName {
  return resolveAuthProviderName();
}

export function isFirstPartyAuthEnabled(
  provider: AuthProviderName = getAuthProviderName(),
): boolean {
  return provider === FIRST_PARTY_AUTH_PROVIDER;
}

export function initSessionsSchema(): void {
  const db = getHostedDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      org_id TEXT REFERENCES orgs(id) ON DELETE SET NULL,
      token_hash TEXT UNIQUE NOT NULL,
      user_agent TEXT NOT NULL DEFAULT '',
      ip_address TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      rotated_from_session_id TEXT REFERENCES sessions(id),
      rotated_to_session_id TEXT REFERENCES sessions(id)
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user_created
      ON sessions(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_org_created
      ON sessions(org_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires
      ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_active
      ON sessions(user_id, expires_at)
      WHERE revoked_at IS NULL;
  `);
}

export function createSession(input: CreateSessionInput): CreatedSession {
  initSessionsSchema();

  const now = input.now ?? new Date();
  const token = generateSessionToken();
  const id = newSessionId();
  const createdAt = now.toISOString();
  const expiresAt = addSeconds(
    now,
    input.ttlSeconds ?? DEFAULT_SESSION_TTL_SECONDS,
  ).toISOString();

  getHostedDb()
    .prepare(
      `INSERT INTO sessions
       (id, user_id, org_id, token_hash, user_agent, ip_address, created_at, last_seen_at,
        expires_at, rotated_from_session_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.userId,
      input.orgId ?? null,
      hashSessionToken(token),
      input.userAgent ?? "",
      input.ipAddress ?? "",
      createdAt,
      createdAt,
      expiresAt,
      input.rotatedFromSessionId ?? null,
    );

  return { session: getSessionById(id)!, token };
}

export function getSessionByToken(
  token: string,
  options: SessionLookupOptions = {},
): HostedSession | null {
  initSessionsSchema();

  const now = (options.now ?? new Date()).toISOString();
  const session = getHostedDb()
    .prepare(
      `SELECT * FROM sessions
       WHERE token_hash = ?
         AND revoked_at IS NULL
         AND expires_at > ?
       LIMIT 1`,
    )
    .get(hashSessionToken(token), now) as HostedSession | null;

  if (!session) return null;
  if (options.touch) {
    getHostedDb()
      .prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?")
      .run(now, session.id);
    return getSessionById(session.id);
  }
  return session;
}

export function getSessionById(id: string): HostedSession | null {
  initSessionsSchema();
  const session = getHostedDb()
    .prepare("SELECT * FROM sessions WHERE id = ?")
    .get(id) as HostedSession | undefined;
  return session ?? null;
}

export function revokeSessionByToken(
  token: string,
  options: RevokeSessionOptions = {},
): HostedSession | null {
  initSessionsSchema();

  const session = getHostedDb()
    .prepare("SELECT * FROM sessions WHERE token_hash = ? LIMIT 1")
    .get(hashSessionToken(token)) as HostedSession | null;
  if (!session) return null;

  revokeSession(session.id, options);
  return getSessionById(session.id);
}

export function revokeSession(
  id: string,
  options: RevokeSessionOptions = {},
): HostedSession | null {
  initSessionsSchema();

  getHostedDb()
    .prepare(
      `UPDATE sessions
       SET revoked_at = COALESCE(revoked_at, ?)
       WHERE id = ?`,
    )
    .run((options.now ?? new Date()).toISOString(), id);

  return getSessionById(id);
}

export function rotateSession(
  input: RotateSessionInput,
): CreatedSession | null {
  initSessionsSchema();

  const db = getHostedDb();
  const now = input.now ?? new Date();

  const rotate = db.transaction(() => {
    const current = getSessionByToken(input.token, { now });
    if (!current) return null;

    const next = createSession({
      userId: current.user_id,
      orgId: current.org_id,
      ttlSeconds: input.ttlSeconds,
      userAgent: input.userAgent ?? current.user_agent,
      ipAddress: input.ipAddress ?? current.ip_address,
      now,
      rotatedFromSessionId: current.id,
    });

    db.prepare(
      `UPDATE sessions
       SET revoked_at = COALESCE(revoked_at, ?),
           rotated_to_session_id = ?
       WHERE id = ?`,
    ).run(now.toISOString(), next.session.id, current.id);

    return next;
  });

  return rotate();
}

export function cleanupSessions(input: CleanupSessionsInput = {}): number {
  initSessionsSchema();

  const now = (input.now ?? new Date()).toISOString();
  const revokedBefore = (
    input.revokedBefore ??
    input.now ??
    new Date()
  ).toISOString();
  const result = getHostedDb()
    .prepare(
      `DELETE FROM sessions
       WHERE expires_at <= ?
          OR (revoked_at IS NOT NULL AND revoked_at <= ?)`,
    )
    .run(now, revokedBefore);
  return result.changes;
}

export function hashSessionToken(token: string): string {
  return crypto
    .createHash("sha256")
    .update(`${TOKEN_HASH_VERSION}:${token}`, "utf8")
    .digest("hex");
}

function generateSessionToken(): string {
  return `ps_${crypto.randomBytes(SESSION_TOKEN_BYTES).toString("base64url")}`;
}

function newSessionId(): string {
  return `ses_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}
