import crypto from "node:crypto";
import type Database from "better-sqlite3";

import { getHostedDb } from "./db.js";

export type AccountSafetyScopeType = "global" | "brand" | "account";
export type AccountSafetyControlType =
  | "pause"
  | "kill_switch"
  | "autopilot_pause";
export type CircuitBreakerState = "open" | "closed";

export interface RateBucketRef {
  scopeType: AccountSafetyScopeType;
  scopeId?: string;
  bucketKey: string;
}

export interface RateBucketStatus {
  allowed: boolean;
  limit: number;
  used: number;
  remaining: number;
  retryAfterMs: number;
  windowStartedAt: string;
  windowEndsAt: string;
}

export interface AccountSafetyRateBucket {
  scope_type: AccountSafetyScopeType;
  scope_id: string;
  bucket_key: string;
  limit_count: number;
  window_ms: number;
  used_count: number;
  window_started_at: string;
  window_ends_at: string;
  last_event_at: string;
  updated_at: string;
}

export interface AccountSafetyRateBucketEvent {
  id: string;
  idempotency_key: string;
  scope_type: AccountSafetyScopeType;
  scope_id: string;
  bucket_key: string;
  cost: number;
  limit_count: number;
  window_ms: number;
  resulting_used_count: number;
  window_started_at: string;
  window_ends_at: string;
  created_at: string;
}

export interface AccountSafetyControl {
  scope_type: AccountSafetyScopeType;
  scope_id: string;
  control_type: AccountSafetyControlType;
  is_active: number;
  reason: string;
  source: string;
  metadata: string;
  created_at: string;
  updated_at: string;
  cleared_at: string | null;
}

export interface AccountSafetyCircuitBreaker {
  scope_type: AccountSafetyScopeType;
  scope_id: string;
  breaker_key: string;
  state: CircuitBreakerState;
  reason: string;
  source: string;
  opened_at: string | null;
  closed_at: string | null;
  open_until: string | null;
  threshold_count: number;
  threshold_window_ms: number;
  last_event_at: string | null;
  metadata: string;
  created_at: string;
  updated_at: string;
}

export interface AccountSafetyCircuitBreakerEvent {
  id: string;
  idempotency_key: string | null;
  scope_type: AccountSafetyScopeType;
  scope_id: string;
  breaker_key: string;
  event_type: string;
  status_code: number | null;
  source: string;
  message: string;
  metadata: string;
  created_at: string;
}

export interface ConsumeRateBucketInput extends RateBucketRef {
  limit: number;
  windowMs: number;
  cost?: number;
  now?: Date | string;
  idempotencyKey?: string;
}

export interface RecordCircuitBreakerEventInput {
  scopeType: AccountSafetyScopeType;
  scopeId?: string;
  breakerKey: string;
  eventType: string;
  statusCode?: number | null;
  source: string;
  message?: string;
  metadata?: Record<string, unknown>;
  now?: Date | string;
  idempotencyKey?: string;
  thresholdCount?: number;
  thresholdWindowMs?: number;
  openMs?: number;
}

export interface SetSafetyControlInput {
  scopeType: AccountSafetyScopeType;
  scopeId?: string;
  controlType: AccountSafetyControlType;
  reason: string;
  source: string;
  metadata?: Record<string, unknown>;
  now?: Date | string;
}

export interface OpenCircuitBreakerInput {
  scopeType: AccountSafetyScopeType;
  scopeId?: string;
  breakerKey: string;
  source: string;
  reason: string;
  metadata?: Record<string, unknown>;
  now?: Date | string;
  openMs?: number | null;
  thresholdCount?: number;
  thresholdWindowMs?: number;
}

export interface CloseCircuitBreakerInput {
  scopeType: AccountSafetyScopeType;
  scopeId?: string;
  breakerKey: string;
  source?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
  now?: Date | string;
}

export interface AccountSafetyDecision {
  allowed: boolean;
  reasons: string[];
  activeControls: AccountSafetyControl[];
  activeCircuitBreakers: AccountSafetyCircuitBreaker[];
  rateBuckets: RateBucketStatus[];
}

export interface HostedFollowChurnDecision {
  allowed: boolean;
  reasons: string[];
  configEnabled: boolean;
  runtimeOptIn: boolean;
  safety: AccountSafetyDecision;
}

export interface HostedAutopilotWriteDecision {
  allowed: boolean;
  reasons: string[];
  mode: string;
  fullAutoEnabled: boolean;
  safety: AccountSafetyDecision;
}

export interface HostedAutopilotPauseInput {
  brandId: string;
  reason: string;
  source: string;
  actorId?: string;
  accountId?: string;
  now?: Date | string;
  metadata?: Record<string, unknown>;
}

export interface HostedAutopilotResumeInput {
  brandId: string;
  now?: Date | string;
}

export interface SyncHostedAutopilotPauseFromCircuitBreakersInput {
  brandId: string;
  accountId?: string;
  now?: Date | string;
}

export interface AccountSafetyRepository {
  consumeRateBucket(input: ConsumeRateBucketInput): RateBucketStatus;
  getRateBucket(ref: RateBucketRef): AccountSafetyRateBucket | null;
  getRateBucketEventByIdempotencyKey(
    idempotencyKey: string,
  ): AccountSafetyRateBucketEvent | null;
  checkRateBucket(
    input: Omit<ConsumeRateBucketInput, "cost" | "idempotencyKey">,
  ): RateBucketStatus;
  setSafetyControl(input: SetSafetyControlInput): AccountSafetyControl;
  clearSafetyControl(
    input: Omit<SetSafetyControlInput, "reason" | "source" | "metadata"> & {
      now?: Date | string;
    },
  ): AccountSafetyControl | null;
  getSafetyControl(
    scopeType: AccountSafetyScopeType,
    scopeId: string | undefined,
    controlType: AccountSafetyControlType,
  ): AccountSafetyControl | null;
  openCircuitBreaker(
    input: OpenCircuitBreakerInput,
  ): AccountSafetyCircuitBreaker;
  closeCircuitBreaker(
    input: CloseCircuitBreakerInput,
  ): AccountSafetyCircuitBreaker | null;
  getCircuitBreaker(
    scopeType: AccountSafetyScopeType,
    scopeId: string | undefined,
    breakerKey: string,
  ): AccountSafetyCircuitBreaker | null;
  recordCircuitBreakerEvent(input: RecordCircuitBreakerEventInput): {
    event: AccountSafetyCircuitBreakerEvent;
    breaker: AccountSafetyCircuitBreaker | null;
    opened: boolean;
    recentEventCount: number;
  };
  isAccountAllowed(input: {
    brandId?: string;
    accountId?: string;
    now?: Date | string;
    rateBucketRefs?: Array<
      Omit<ConsumeRateBucketInput, "cost" | "idempotencyKey">
    >;
  }): AccountSafetyDecision;
}

const GLOBAL_SCOPE_ID = "global";
const HOSTED_AUTOPILOT_BREAKER_KEYS = [
  "x_write_post",
  "x_write_reply",
] as const;

function iso(value?: Date | string): string {
  if (!value) return new Date().toISOString();
  if (value instanceof Date) return value.toISOString();
  return value;
}

function requireNonBlank(value: string | undefined, field: string): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) throw new Error(`Account safety ${field} is required`);
  return trimmed;
}

function requireScopeId(
  scopeType: AccountSafetyScopeType,
  scopeId?: string,
): string {
  if (scopeType === "global") return GLOBAL_SCOPE_ID;
  return requireNonBlank(scopeId, "scopeId");
}

function requirePositiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Account safety ${field} must be a positive integer`);
  }
  return value;
}

function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

function plusMs(baseIso: string, ms: number): string {
  return new Date(new Date(baseIso).getTime() + ms).toISOString();
}

function toRateBucketStatus(
  bucket: AccountSafetyRateBucket,
  nowIso: string,
  mode: "check" | "consume" = "check",
): RateBucketStatus {
  const retryAfterMs = Math.max(
    0,
    new Date(bucket.window_ends_at).getTime() - new Date(nowIso).getTime(),
  );
  const remaining = Math.max(0, bucket.limit_count - bucket.used_count);
  const allowed =
    mode === "consume"
      ? bucket.used_count <= bucket.limit_count
      : bucket.used_count < bucket.limit_count || retryAfterMs === 0;
  return {
    allowed,
    limit: bucket.limit_count,
    used: bucket.used_count,
    remaining,
    retryAfterMs: allowed ? 0 : retryAfterMs,
    windowStartedAt: bucket.window_started_at,
    windowEndsAt: bucket.window_ends_at,
  };
}

function breakerIsActive(
  breaker: AccountSafetyCircuitBreaker,
  nowIso: string,
): boolean {
  if (breaker.state !== "open") return false;
  if (!breaker.open_until) return true;
  return breaker.open_until > nowIso;
}

function isTruthyFlag(value: string | undefined): boolean {
  if (!value) return false;
  switch (value.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
      return true;
    default:
      return false;
  }
}

export function initAccountSafetyTables(
  db: Database.Database = getHostedDb(),
): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS account_safety_rate_buckets (
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      bucket_key TEXT NOT NULL,
      limit_count INTEGER NOT NULL,
      window_ms INTEGER NOT NULL,
      used_count INTEGER NOT NULL DEFAULT 0,
      window_started_at TEXT NOT NULL,
      window_ends_at TEXT NOT NULL,
      last_event_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (scope_type, scope_id, bucket_key),
      CHECK(limit_count > 0),
      CHECK(window_ms > 0),
      CHECK(used_count >= 0)
    );

    CREATE TABLE IF NOT EXISTS account_safety_rate_bucket_events (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT UNIQUE NOT NULL,
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      bucket_key TEXT NOT NULL,
      cost INTEGER NOT NULL,
      limit_count INTEGER NOT NULL,
      window_ms INTEGER NOT NULL,
      resulting_used_count INTEGER NOT NULL,
      window_started_at TEXT NOT NULL,
      window_ends_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      CHECK(cost > 0),
      CHECK(limit_count > 0),
      CHECK(window_ms > 0),
      CHECK(resulting_used_count >= 0)
    );

    CREATE TABLE IF NOT EXISTS account_safety_controls (
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      control_type TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      reason TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT '',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      cleared_at TEXT,
      PRIMARY KEY (scope_type, scope_id, control_type)
    );

    CREATE TABLE IF NOT EXISTS account_safety_circuit_breakers (
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      breaker_key TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'closed',
      reason TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT '',
      opened_at TEXT,
      closed_at TEXT,
      open_until TEXT,
      threshold_count INTEGER NOT NULL DEFAULT 0,
      threshold_window_ms INTEGER NOT NULL DEFAULT 0,
      last_event_at TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (scope_type, scope_id, breaker_key)
    );

    CREATE TABLE IF NOT EXISTS account_safety_circuit_breaker_events (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT UNIQUE,
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      breaker_key TEXT NOT NULL,
      event_type TEXT NOT NULL,
      status_code INTEGER,
      source TEXT NOT NULL,
      message TEXT NOT NULL DEFAULT '',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_account_safety_rate_bucket_events_lookup
      ON account_safety_rate_bucket_events(scope_type, scope_id, bucket_key, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_account_safety_controls_active
      ON account_safety_controls(scope_type, scope_id, control_type, is_active);
    CREATE INDEX IF NOT EXISTS idx_account_safety_breakers_state
      ON account_safety_circuit_breakers(scope_type, scope_id, state, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_account_safety_breaker_events_lookup
      ON account_safety_circuit_breaker_events(scope_type, scope_id, breaker_key, created_at DESC);
  `);
}

export function createAccountSafetyRepository(
  db: Database.Database = getHostedDb(),
): AccountSafetyRepository {
  initAccountSafetyTables(db);

  const getRateBucket = (ref: RateBucketRef): AccountSafetyRateBucket | null =>
    (db
      .prepare(
        `SELECT * FROM account_safety_rate_buckets
         WHERE scope_type = ? AND scope_id = ? AND bucket_key = ?`,
      )
      .get(
        ref.scopeType,
        requireScopeId(ref.scopeType, ref.scopeId),
        requireNonBlank(ref.bucketKey, "bucketKey"),
      ) as AccountSafetyRateBucket | null) ?? null;

  const getRateBucketEventByIdempotencyKey = (
    idempotencyKey: string,
  ): AccountSafetyRateBucketEvent | null =>
    (db
      .prepare(
        "SELECT * FROM account_safety_rate_bucket_events WHERE idempotency_key = ?",
      )
      .get(
        requireNonBlank(idempotencyKey, "idempotencyKey"),
      ) as AccountSafetyRateBucketEvent | null) ?? null;

  const getSafetyControl = (
    scopeType: AccountSafetyScopeType,
    scopeId: string | undefined,
    controlType: AccountSafetyControlType,
  ): AccountSafetyControl | null =>
    (db
      .prepare(
        `SELECT * FROM account_safety_controls
         WHERE scope_type = ? AND scope_id = ? AND control_type = ?`,
      )
      .get(
        scopeType,
        requireScopeId(scopeType, scopeId),
        controlType,
      ) as AccountSafetyControl | null) ?? null;

  const getCircuitBreaker = (
    scopeType: AccountSafetyScopeType,
    scopeId: string | undefined,
    breakerKey: string,
  ): AccountSafetyCircuitBreaker | null =>
    (db
      .prepare(
        `SELECT * FROM account_safety_circuit_breakers
         WHERE scope_type = ? AND scope_id = ? AND breaker_key = ?`,
      )
      .get(
        scopeType,
        requireScopeId(scopeType, scopeId),
        requireNonBlank(breakerKey, "breakerKey"),
      ) as AccountSafetyCircuitBreaker | null) ?? null;

  const listScopeCircuitBreakers = (
    scopeType: AccountSafetyScopeType,
    scopeId: string | undefined,
  ): AccountSafetyCircuitBreaker[] =>
    (db
      .prepare(
        `SELECT * FROM account_safety_circuit_breakers
         WHERE scope_type = ? AND scope_id = ?`,
      )
      .all(
        scopeType,
        requireScopeId(scopeType, scopeId),
      ) as AccountSafetyCircuitBreaker[]) ?? [];

  const listScopeControls = (
    scopeType: AccountSafetyScopeType,
    scopeId: string | undefined,
  ): AccountSafetyControl[] =>
    (db
      .prepare(
        `SELECT * FROM account_safety_controls
         WHERE scope_type = ? AND scope_id = ? AND is_active = 1`,
      )
      .all(
        scopeType,
        requireScopeId(scopeType, scopeId),
      ) as AccountSafetyControl[]) ?? [];

  const openCircuitBreakerTransaction = db.transaction(
    (input: OpenCircuitBreakerInput): AccountSafetyCircuitBreaker => {
      const scopeId = requireScopeId(input.scopeType, input.scopeId);
      const breakerKey = requireNonBlank(input.breakerKey, "breakerKey");
      const nowIso = iso(input.now);
      const openUntil =
        input.openMs == null
          ? null
          : plusMs(nowIso, requirePositiveInteger(input.openMs, "openMs"));

      db.prepare(
        `INSERT INTO account_safety_circuit_breakers
         (scope_type, scope_id, breaker_key, state, reason, source, opened_at, closed_at, open_until,
          threshold_count, threshold_window_ms, last_event_at, metadata, created_at, updated_at)
         VALUES (?, ?, ?, 'open', ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(scope_type, scope_id, breaker_key)
         DO UPDATE SET
           state = 'open',
           reason = excluded.reason,
           source = excluded.source,
           opened_at = excluded.opened_at,
           closed_at = NULL,
           open_until = excluded.open_until,
           threshold_count = excluded.threshold_count,
           threshold_window_ms = excluded.threshold_window_ms,
           last_event_at = excluded.last_event_at,
           metadata = excluded.metadata,
           updated_at = excluded.updated_at`,
      ).run(
        input.scopeType,
        scopeId,
        breakerKey,
        requireNonBlank(input.reason, "reason"),
        requireNonBlank(input.source, "source"),
        nowIso,
        openUntil,
        input.thresholdCount ?? 0,
        input.thresholdWindowMs ?? 0,
        nowIso,
        JSON.stringify(input.metadata || {}),
        nowIso,
        nowIso,
      );

      return getCircuitBreaker(input.scopeType, scopeId, breakerKey)!;
    },
  );

  const closeCircuitBreakerTransaction = db.transaction(
    (input: CloseCircuitBreakerInput): AccountSafetyCircuitBreaker | null => {
      const scopeId = requireScopeId(input.scopeType, input.scopeId);
      const breakerKey = requireNonBlank(input.breakerKey, "breakerKey");
      const existing = getCircuitBreaker(input.scopeType, scopeId, breakerKey);
      if (!existing) return null;

      const nowIso = iso(input.now);
      db.prepare(
        `UPDATE account_safety_circuit_breakers
         SET state = 'closed',
             reason = ?,
             source = ?,
             closed_at = ?,
             open_until = NULL,
             metadata = ?,
             updated_at = ?
         WHERE scope_type = ? AND scope_id = ? AND breaker_key = ?`,
      ).run(
        input.reason ?? existing.reason,
        input.source ?? existing.source,
        nowIso,
        JSON.stringify(input.metadata || {}),
        nowIso,
        input.scopeType,
        scopeId,
        breakerKey,
      );

      return getCircuitBreaker(input.scopeType, scopeId, breakerKey)!;
    },
  );

  const consumeRateBucketTransaction = db.transaction(
    (input: ConsumeRateBucketInput): RateBucketStatus => {
      const scopeId = requireScopeId(input.scopeType, input.scopeId);
      const bucketKey = requireNonBlank(input.bucketKey, "bucketKey");
      const limit = requirePositiveInteger(input.limit, "limit");
      const windowMs = requirePositiveInteger(input.windowMs, "windowMs");
      const cost =
        input.cost == null ? 1 : requirePositiveInteger(input.cost, "cost");
      const nowIso = iso(input.now);

      if (input.idempotencyKey) {
        const existingEvent = getRateBucketEventByIdempotencyKey(
          input.idempotencyKey,
        );
        if (existingEvent) {
          return {
            allowed:
              existingEvent.resulting_used_count <= existingEvent.limit_count,
            limit: existingEvent.limit_count,
            used: existingEvent.resulting_used_count,
            remaining: Math.max(
              0,
              existingEvent.limit_count - existingEvent.resulting_used_count,
            ),
            retryAfterMs: Math.max(
              0,
              new Date(existingEvent.window_ends_at).getTime() -
                new Date(nowIso).getTime(),
            ),
            windowStartedAt: existingEvent.window_started_at,
            windowEndsAt: existingEvent.window_ends_at,
          };
        }
      }

      const current = getRateBucket({
        scopeType: input.scopeType,
        scopeId,
        bucketKey,
      });

      const hasExpiredWindow =
        !current ||
        current.window_ends_at <= nowIso ||
        current.window_ms !== windowMs;
      const windowStartedAt = hasExpiredWindow
        ? nowIso
        : current.window_started_at;
      const windowEndsAt = hasExpiredWindow
        ? plusMs(nowIso, windowMs)
        : current.window_ends_at;
      const priorUsed = hasExpiredWindow ? 0 : current.used_count;
      const nextUsed = priorUsed + cost;

      db.prepare(
        `INSERT INTO account_safety_rate_buckets
         (scope_type, scope_id, bucket_key, limit_count, window_ms, used_count, window_started_at,
          window_ends_at, last_event_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(scope_type, scope_id, bucket_key)
         DO UPDATE SET
           limit_count = excluded.limit_count,
           window_ms = excluded.window_ms,
           used_count = excluded.used_count,
           window_started_at = excluded.window_started_at,
           window_ends_at = excluded.window_ends_at,
           last_event_at = excluded.last_event_at,
           updated_at = excluded.updated_at`,
      ).run(
        input.scopeType,
        scopeId,
        bucketKey,
        limit,
        windowMs,
        nextUsed,
        windowStartedAt,
        windowEndsAt,
        nowIso,
        nowIso,
      );

      if (input.idempotencyKey) {
        db.prepare(
          `INSERT INTO account_safety_rate_bucket_events
           (id, idempotency_key, scope_type, scope_id, bucket_key, cost, limit_count, window_ms,
            resulting_used_count, window_started_at, window_ends_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          createId("asrbe"),
          requireNonBlank(input.idempotencyKey, "idempotencyKey"),
          input.scopeType,
          scopeId,
          bucketKey,
          cost,
          limit,
          windowMs,
          nextUsed,
          windowStartedAt,
          windowEndsAt,
          nowIso,
        );
      }

      return toRateBucketStatus(
        getRateBucket({ scopeType: input.scopeType, scopeId, bucketKey })!,
        nowIso,
        "consume",
      );
    },
  );

  const recordCircuitBreakerEventTransaction = db.transaction(
    (
      input: RecordCircuitBreakerEventInput,
    ): {
      event: AccountSafetyCircuitBreakerEvent;
      breaker: AccountSafetyCircuitBreaker | null;
      opened: boolean;
      recentEventCount: number;
    } => {
      const scopeId = requireScopeId(input.scopeType, input.scopeId);
      const breakerKey = requireNonBlank(input.breakerKey, "breakerKey");
      const eventType = requireNonBlank(input.eventType, "eventType");
      const source = requireNonBlank(input.source, "source");
      const nowIso = iso(input.now);

      if (input.idempotencyKey) {
        const existing = db
          .prepare(
            `SELECT * FROM account_safety_circuit_breaker_events
             WHERE idempotency_key = ?`,
          )
          .get(input.idempotencyKey) as
          | AccountSafetyCircuitBreakerEvent
          | undefined;
        if (existing) {
          return {
            event: existing,
            breaker: getCircuitBreaker(input.scopeType, scopeId, breakerKey),
            opened: false,
            recentEventCount: 0,
          };
        }
      }

      const eventId = createId("ascbe");
      db.prepare(
        `INSERT INTO account_safety_circuit_breaker_events
         (id, idempotency_key, scope_type, scope_id, breaker_key, event_type, status_code,
          source, message, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        eventId,
        input.idempotencyKey ?? null,
        input.scopeType,
        scopeId,
        breakerKey,
        eventType,
        input.statusCode ?? null,
        source,
        input.message ?? "",
        JSON.stringify(input.metadata || {}),
        nowIso,
      );

      const event = db
        .prepare(
          "SELECT * FROM account_safety_circuit_breaker_events WHERE id = ?",
        )
        .get(eventId) as AccountSafetyCircuitBreakerEvent;

      let recentEventCount = 0;
      let breaker: AccountSafetyCircuitBreaker | null = getCircuitBreaker(
        input.scopeType,
        scopeId,
        breakerKey,
      );
      let opened = false;

      if (input.thresholdCount && input.thresholdWindowMs) {
        const thresholdCount = requirePositiveInteger(
          input.thresholdCount,
          "thresholdCount",
        );
        const thresholdWindowMs = requirePositiveInteger(
          input.thresholdWindowMs,
          "thresholdWindowMs",
        );
        const windowStart = new Date(
          new Date(nowIso).getTime() - thresholdWindowMs,
        ).toISOString();
        const row = db
          .prepare(
            `SELECT COUNT(*) AS count
             FROM account_safety_circuit_breaker_events
             WHERE scope_type = ? AND scope_id = ? AND breaker_key = ? AND created_at >= ?`,
          )
          .get(input.scopeType, scopeId, breakerKey, windowStart) as {
          count: number;
        };
        recentEventCount = row.count;

        if (recentEventCount >= thresholdCount) {
          breaker = openCircuitBreakerTransaction({
            scopeType: input.scopeType,
            scopeId,
            breakerKey,
            source,
            reason:
              input.message ||
              `${eventType} threshold reached for ${breakerKey}`,
            metadata: input.metadata,
            now: nowIso,
            openMs: input.openMs ?? null,
            thresholdCount,
            thresholdWindowMs,
          });
          opened = true;
        }
      }

      return { event, breaker, opened, recentEventCount };
    },
  );

  return {
    consumeRateBucket(input) {
      return consumeRateBucketTransaction(input);
    },

    getRateBucket(ref) {
      return getRateBucket(ref);
    },

    getRateBucketEventByIdempotencyKey(idempotencyKey) {
      return getRateBucketEventByIdempotencyKey(idempotencyKey);
    },

    checkRateBucket(input) {
      const nowIso = iso(input.now);
      const bucket = getRateBucket(input);
      if (
        !bucket ||
        bucket.window_ends_at <= nowIso ||
        bucket.window_ms !== input.windowMs
      ) {
        return {
          allowed: true,
          limit: requirePositiveInteger(input.limit, "limit"),
          used: 0,
          remaining: requirePositiveInteger(input.limit, "limit"),
          retryAfterMs: 0,
          windowStartedAt: nowIso,
          windowEndsAt: plusMs(
            nowIso,
            requirePositiveInteger(input.windowMs, "windowMs"),
          ),
        };
      }
      return toRateBucketStatus(bucket, nowIso);
    },

    setSafetyControl(input) {
      const scopeId = requireScopeId(input.scopeType, input.scopeId);
      const nowIso = iso(input.now);
      db.prepare(
        `INSERT INTO account_safety_controls
         (scope_type, scope_id, control_type, is_active, reason, source, metadata, created_at, updated_at, cleared_at)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT(scope_type, scope_id, control_type)
         DO UPDATE SET
           is_active = 1,
           reason = excluded.reason,
           source = excluded.source,
           metadata = excluded.metadata,
           updated_at = excluded.updated_at,
           cleared_at = NULL`,
      ).run(
        input.scopeType,
        scopeId,
        input.controlType,
        requireNonBlank(input.reason, "reason"),
        requireNonBlank(input.source, "source"),
        JSON.stringify(input.metadata || {}),
        nowIso,
        nowIso,
      );
      return getSafetyControl(input.scopeType, scopeId, input.controlType)!;
    },

    clearSafetyControl(input) {
      const scopeId = requireScopeId(input.scopeType, input.scopeId);
      const existing = getSafetyControl(
        input.scopeType,
        scopeId,
        input.controlType,
      );
      if (!existing) return null;

      const nowIso = iso(input.now);
      db.prepare(
        `UPDATE account_safety_controls
         SET is_active = 0, updated_at = ?, cleared_at = ?
         WHERE scope_type = ? AND scope_id = ? AND control_type = ?`,
      ).run(nowIso, nowIso, input.scopeType, scopeId, input.controlType);
      return getSafetyControl(input.scopeType, scopeId, input.controlType)!;
    },

    getSafetyControl(scopeType, scopeId, controlType) {
      return getSafetyControl(scopeType, scopeId, controlType);
    },

    openCircuitBreaker(input) {
      return openCircuitBreakerTransaction(input);
    },

    closeCircuitBreaker(input) {
      return closeCircuitBreakerTransaction(input);
    },

    getCircuitBreaker(scopeType, scopeId, breakerKey) {
      return getCircuitBreaker(scopeType, scopeId, breakerKey);
    },

    recordCircuitBreakerEvent(input) {
      return recordCircuitBreakerEventTransaction(input);
    },

    isAccountAllowed({ brandId, accountId, now, rateBucketRefs = [] }) {
      const nowIso = iso(now);
      const activeControls = [
        ...listScopeControls("global", GLOBAL_SCOPE_ID),
        ...(brandId ? listScopeControls("brand", brandId) : []),
      ];

      const activeCircuitBreakers = [
        ...listScopeCircuitBreakers("global", GLOBAL_SCOPE_ID),
        ...(brandId ? listScopeCircuitBreakers("brand", brandId) : []),
        ...(accountId ? listScopeCircuitBreakers("account", accountId) : []),
      ].filter((breaker): breaker is AccountSafetyCircuitBreaker =>
        breakerIsActive(breaker, nowIso),
      );

      const rateBuckets = rateBucketRefs.map((ref) => {
        const bucket = getRateBucket(ref);
        if (
          !bucket ||
          bucket.window_ends_at <= nowIso ||
          bucket.window_ms !== ref.windowMs
        ) {
          return {
            allowed: true,
            limit: requirePositiveInteger(ref.limit, "limit"),
            used: 0,
            remaining: requirePositiveInteger(ref.limit, "limit"),
            retryAfterMs: 0,
            windowStartedAt: nowIso,
            windowEndsAt: plusMs(
              nowIso,
              requirePositiveInteger(ref.windowMs, "windowMs"),
            ),
          };
        }
        return toRateBucketStatus(bucket, nowIso);
      });
      const reasons = [
        ...activeControls.map(
          (control) =>
            `${control.scope_type}:${control.control_type}:${control.reason || control.source}`,
        ),
        ...activeCircuitBreakers.map(
          (breaker) =>
            `${breaker.scope_type}:circuit_breaker:${breaker.breaker_key}:${breaker.reason || breaker.source}`,
        ),
        ...rateBuckets
          .filter((bucket) => !bucket.allowed)
          .map((bucket) => `rate_bucket_exhausted:${bucket.windowEndsAt}`),
      ];

      return {
        allowed: reasons.length === 0,
        reasons,
        activeControls,
        activeCircuitBreakers,
        rateBuckets,
      };
    },
  };
}

export const accountSafetyRepository = createAccountSafetyRepository();

export const {
  checkRateBucket,
  clearSafetyControl,
  closeCircuitBreaker,
  consumeRateBucket,
  getCircuitBreaker,
  getRateBucket,
  getRateBucketEventByIdempotencyKey,
  getSafetyControl,
  isAccountAllowed,
  openCircuitBreaker,
  recordCircuitBreakerEvent,
  setSafetyControl,
} = accountSafetyRepository;

export function syncHostedAutopilotPauseFromCircuitBreakers(
  input: SyncHostedAutopilotPauseFromCircuitBreakersInput,
): AccountSafetyControl | null {
  const nowIso = iso(input.now);
  const existingPause = getSafetyControl(
    "brand",
    input.brandId,
    "autopilot_pause",
  );
  if (existingPause?.is_active) return existingPause;

  for (const breakerKey of HOSTED_AUTOPILOT_BREAKER_KEYS) {
    const brandBreaker = getCircuitBreaker("brand", input.brandId, breakerKey);
    if (brandBreaker && breakerIsActive(brandBreaker, nowIso)) {
      return pauseHostedAutopilot({
        brandId: input.brandId,
        accountId: input.accountId,
        reason: `automatic pause after ${breakerKey} circuit breaker`,
        source: "account-safety:auto-pause",
        now: nowIso,
        metadata: {
          trigger: "x_write_circuit_breaker",
          breakerKey,
          breakerScopeType: "brand",
          breakerScopeId: input.brandId,
          breakerReason: brandBreaker.reason,
        },
      });
    }

    if (!input.accountId) continue;
    const accountBreaker = getCircuitBreaker(
      "account",
      input.accountId,
      breakerKey,
    );
    if (accountBreaker && breakerIsActive(accountBreaker, nowIso)) {
      return pauseHostedAutopilot({
        brandId: input.brandId,
        accountId: input.accountId,
        reason: `automatic pause after ${breakerKey} circuit breaker`,
        source: "account-safety:auto-pause",
        now: nowIso,
        metadata: {
          trigger: "x_write_circuit_breaker",
          breakerKey,
          breakerScopeType: "account",
          breakerScopeId: input.accountId,
          breakerReason: accountBreaker.reason,
        },
      });
    }
  }

  return null;
}

export function getHostedFollowChurnDecision(input: {
  brandId: string;
  accountId?: string;
  config?: { autoFollow?: { enabled?: boolean } } | null;
  now?: Date | string;
}): HostedFollowChurnDecision {
  const safety = isAccountAllowed({
    brandId: input.brandId,
    accountId: input.accountId,
    now: input.now,
  });
  const configEnabled = input.config?.autoFollow?.enabled === true;
  const runtimeOptIn = isTruthyFlag(process.env.PULSE_ALLOW_FOLLOW_CHURN);
  const reasons = [...safety.reasons];

  if (!configEnabled) reasons.push("auto_follow_disabled");
  if (!runtimeOptIn) reasons.push("follow_churn_not_opted_in");

  return {
    allowed: reasons.length === 0,
    reasons,
    configEnabled,
    runtimeOptIn,
    safety,
  };
}

export function getHostedAutopilotWriteDecision(input: {
  brandId: string;
  accountId?: string;
  config?: { autopilot?: { mode?: string | null } } | null;
  now?: Date | string;
}): HostedAutopilotWriteDecision {
  const mode = input.config?.autopilot?.mode?.trim() || "off";
  const fullAutoEnabled = mode === "full";
  if (fullAutoEnabled) {
    syncHostedAutopilotPauseFromCircuitBreakers({
      brandId: input.brandId,
      accountId: input.accountId,
      now: input.now,
    });
  }
  const safety = isAccountAllowed({
    brandId: input.brandId,
    accountId: input.accountId,
    now: input.now,
  });
  const reasons = [...safety.reasons];

  if (!fullAutoEnabled) reasons.push(`autopilot_write_not_enabled:${mode}`);

  return {
    allowed: reasons.length === 0,
    reasons,
    mode,
    fullAutoEnabled,
    safety,
  };
}

export function pauseHostedAutopilot(
  input: HostedAutopilotPauseInput,
): AccountSafetyControl {
  return setSafetyControl({
    scopeType: "brand",
    scopeId: input.brandId,
    controlType: "autopilot_pause",
    reason: input.reason,
    source: input.source,
    now: input.now,
    metadata: {
      actorId: input.actorId,
      accountId: input.accountId,
      ...(input.metadata || {}),
    },
  });
}

export function resumeHostedAutopilot(
  input: HostedAutopilotResumeInput,
): AccountSafetyControl | null {
  return clearSafetyControl({
    scopeType: "brand",
    scopeId: input.brandId,
    controlType: "autopilot_pause",
    now: input.now,
  });
}
