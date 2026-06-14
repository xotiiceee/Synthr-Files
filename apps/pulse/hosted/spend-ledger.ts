import crypto from "node:crypto";
import type Database from "better-sqlite3";

import { getHostedDb } from "./db.js";

export interface SpendLedgerEvent {
  id: string;
  idempotency_key: string;
  tenant_id: string;
  amount: number;
  spend_date: string;
  spend_month: string;
  metadata: string;
  created_at: string;
}

export interface SpendTotalRow {
  tenant_id: string;
  total: number;
}

export interface ActionCooldownBucket {
  tenant_id: string;
  action: string;
  available_at: string;
  last_recorded_at: string;
  updated_at: string;
}

export interface ActionCooldownEvent {
  id: string;
  idempotency_key: string;
  tenant_id: string;
  action: string;
  cooldown_ms: number;
  recorded_at: string;
  available_at: string;
  created_at: string;
}

export interface RecordSpendInput {
  tenantId: string;
  amount: number;
  idempotencyKey: string;
  now?: Date | string;
  metadata?: Record<string, unknown>;
}

export interface SpendTotalInput {
  tenantId: string;
  date?: Date | string;
}

export interface RecordActionCooldownInput {
  tenantId: string;
  action: string;
  cooldownMs: number;
  now?: Date | string;
  idempotencyKey?: string;
}

export interface CheckActionCooldownInput {
  tenantId: string;
  action: string;
  now?: Date | string;
}

export interface CooldownStatus {
  allowed: boolean;
  retryAfterMs: number;
  availableAt: string | null;
}

export interface SpendLedgerRepository {
  recordSpend(input: RecordSpendInput): SpendLedgerEvent;
  getSpendEventByIdempotencyKey(
    idempotencyKey: string,
  ): SpendLedgerEvent | null;
  getDailySpendTotal(input: SpendTotalInput): number;
  getMonthlySpendTotal(input: SpendTotalInput): number;
  checkActionCooldown(input: CheckActionCooldownInput): CooldownStatus;
  recordActionCooldown(input: RecordActionCooldownInput): ActionCooldownBucket;
  getActionCooldownBucket(
    tenantId: string,
    action: string,
  ): ActionCooldownBucket | null;
  getActionCooldownEventByIdempotencyKey(
    idempotencyKey: string,
  ): ActionCooldownEvent | null;
}

function iso(value?: Date | string): string {
  if (!value) return new Date().toISOString();
  if (value instanceof Date) return value.toISOString();
  return value;
}

function dayKey(value: string): string {
  return value.slice(0, 10);
}

function monthKey(value: string): string {
  return value.slice(0, 7);
}

function requireNonBlank(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`Spend ledger ${field} is required`);
  return trimmed;
}

function requireFiniteAmount(amount: number): number {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("Spend ledger amount must be a non-negative finite number");
  }
  return amount;
}

function requireCooldownMs(cooldownMs: number): number {
  if (!Number.isInteger(cooldownMs) || cooldownMs < 0) {
    throw new Error("Spend ledger cooldownMs must be a non-negative integer");
  }
  return cooldownMs;
}

function createLedgerId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

function laterIso(a: string, b: string): string {
  return a >= b ? a : b;
}

export function initSpendLedgerTables(
  db: Database.Database = getHostedDb(),
): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS spend_ledger_events (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT UNIQUE NOT NULL,
      tenant_id TEXT NOT NULL,
      amount REAL NOT NULL,
      spend_date TEXT NOT NULL,
      spend_month TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      CHECK(amount >= 0)
    );

    CREATE TABLE IF NOT EXISTS spend_daily_totals (
      tenant_id TEXT NOT NULL,
      spend_date TEXT NOT NULL,
      total REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, spend_date),
      CHECK(total >= 0)
    );

    CREATE TABLE IF NOT EXISTS spend_monthly_totals (
      tenant_id TEXT NOT NULL,
      spend_month TEXT NOT NULL,
      total REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, spend_month),
      CHECK(total >= 0)
    );

    CREATE TABLE IF NOT EXISTS action_cooldown_buckets (
      tenant_id TEXT NOT NULL,
      action TEXT NOT NULL,
      available_at TEXT NOT NULL,
      last_recorded_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, action)
    );

    CREATE TABLE IF NOT EXISTS action_cooldown_events (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT UNIQUE NOT NULL,
      tenant_id TEXT NOT NULL,
      action TEXT NOT NULL,
      cooldown_ms INTEGER NOT NULL,
      recorded_at TEXT NOT NULL,
      available_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      CHECK(cooldown_ms >= 0)
    );

    CREATE INDEX IF NOT EXISTS idx_spend_ledger_events_tenant_date
      ON spend_ledger_events(tenant_id, spend_date, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_spend_ledger_events_tenant_month
      ON spend_ledger_events(tenant_id, spend_month, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_action_cooldown_events_bucket
      ON action_cooldown_events(tenant_id, action, recorded_at DESC);
  `);
}

export function createSpendLedgerRepository(
  db: Database.Database = getHostedDb(),
): SpendLedgerRepository {
  initSpendLedgerTables(db);

  const getSpendEventByIdempotencyKey = (
    idempotencyKey: string,
  ): SpendLedgerEvent | null =>
    (db
      .prepare("SELECT * FROM spend_ledger_events WHERE idempotency_key = ?")
      .get(idempotencyKey) as SpendLedgerEvent | null) ?? null;

  const getActionCooldownBucket = (
    tenantId: string,
    action: string,
  ): ActionCooldownBucket | null =>
    (db
      .prepare(
        "SELECT * FROM action_cooldown_buckets WHERE tenant_id = ? AND action = ?",
      )
      .get(tenantId, action) as ActionCooldownBucket | null) ?? null;

  const getActionCooldownEventByIdempotencyKey = (
    idempotencyKey: string,
  ): ActionCooldownEvent | null =>
    (db
      .prepare("SELECT * FROM action_cooldown_events WHERE idempotency_key = ?")
      .get(idempotencyKey) as ActionCooldownEvent | null) ?? null;

  const recordSpendTransaction = db.transaction(
    (input: RecordSpendInput): SpendLedgerEvent => {
      const tenantId = requireNonBlank(input.tenantId, "tenantId");
      const amount = requireFiniteAmount(input.amount);
      const idempotencyKey = requireNonBlank(
        input.idempotencyKey,
        "idempotencyKey",
      );
      const createdAt = iso(input.now);
      const spendDate = dayKey(createdAt);
      const spendMonth = monthKey(createdAt);
      const eventId = createLedgerId("sle");

      const inserted = db
        .prepare(
          `INSERT INTO spend_ledger_events
           (id, idempotency_key, tenant_id, amount, spend_date, spend_month, metadata, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(idempotency_key) DO NOTHING`,
        )
        .run(
          eventId,
          idempotencyKey,
          tenantId,
          amount,
          spendDate,
          spendMonth,
          JSON.stringify(input.metadata || {}),
          createdAt,
        );

      if (inserted.changes > 0) {
        db.prepare(
          `INSERT INTO spend_daily_totals (tenant_id, spend_date, total, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(tenant_id, spend_date)
           DO UPDATE SET total = total + excluded.total, updated_at = excluded.updated_at`,
        ).run(tenantId, spendDate, amount, createdAt);

        db.prepare(
          `INSERT INTO spend_monthly_totals (tenant_id, spend_month, total, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(tenant_id, spend_month)
           DO UPDATE SET total = total + excluded.total, updated_at = excluded.updated_at`,
        ).run(tenantId, spendMonth, amount, createdAt);
      }

      return getSpendEventByIdempotencyKey(idempotencyKey)!;
    },
  );

  const recordActionCooldownTransaction = db.transaction(
    (input: RecordActionCooldownInput): ActionCooldownBucket => {
      const tenantId = requireNonBlank(input.tenantId, "tenantId");
      const action = requireNonBlank(input.action, "action");
      const cooldownMs = requireCooldownMs(input.cooldownMs);
      const recordedAt = iso(input.now);
      const availableAt = new Date(
        new Date(recordedAt).getTime() + cooldownMs,
      ).toISOString();

      if (input.idempotencyKey) {
        const idempotencyKey = requireNonBlank(
          input.idempotencyKey,
          "idempotencyKey",
        );
        const eventId = createLedgerId("ace");
        const inserted = db
          .prepare(
            `INSERT INTO action_cooldown_events
             (id, idempotency_key, tenant_id, action, cooldown_ms, recorded_at, available_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(idempotency_key) DO NOTHING`,
          )
          .run(
            eventId,
            idempotencyKey,
            tenantId,
            action,
            cooldownMs,
            recordedAt,
            availableAt,
            recordedAt,
          );

        if (inserted.changes === 0) {
          return getActionCooldownBucket(tenantId, action)!;
        }
      }

      const current = getActionCooldownBucket(tenantId, action);
      const nextAvailableAt = current
        ? laterIso(current.available_at, availableAt)
        : availableAt;
      const nextRecordedAt = current
        ? laterIso(current.last_recorded_at, recordedAt)
        : recordedAt;

      db.prepare(
        `INSERT INTO action_cooldown_buckets
         (tenant_id, action, available_at, last_recorded_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(tenant_id, action)
         DO UPDATE SET
           available_at = excluded.available_at,
           last_recorded_at = excluded.last_recorded_at,
           updated_at = excluded.updated_at`,
      ).run(tenantId, action, nextAvailableAt, nextRecordedAt, recordedAt);

      return getActionCooldownBucket(tenantId, action)!;
    },
  );

  return {
    recordSpend(input) {
      return recordSpendTransaction(input);
    },

    getSpendEventByIdempotencyKey(idempotencyKey) {
      return getSpendEventByIdempotencyKey(idempotencyKey);
    },

    getDailySpendTotal({ tenantId, date }) {
      const row = db
        .prepare(
          "SELECT total FROM spend_daily_totals WHERE tenant_id = ? AND spend_date = ?",
        )
        .get(requireNonBlank(tenantId, "tenantId"), dayKey(iso(date))) as
        | { total: number }
        | undefined;
      return row?.total ?? 0;
    },

    getMonthlySpendTotal({ tenantId, date }) {
      const row = db
        .prepare(
          "SELECT total FROM spend_monthly_totals WHERE tenant_id = ? AND spend_month = ?",
        )
        .get(requireNonBlank(tenantId, "tenantId"), monthKey(iso(date))) as
        | { total: number }
        | undefined;
      return row?.total ?? 0;
    },

    checkActionCooldown({ tenantId, action, now }) {
      const bucket = getActionCooldownBucket(
        requireNonBlank(tenantId, "tenantId"),
        requireNonBlank(action, "action"),
      );
      if (!bucket) {
        return { allowed: true, retryAfterMs: 0, availableAt: null };
      }

      const nowIso = iso(now);
      const retryAfterMs = Math.max(
        0,
        new Date(bucket.available_at).getTime() - new Date(nowIso).getTime(),
      );
      return {
        allowed: retryAfterMs === 0,
        retryAfterMs,
        availableAt: bucket.available_at,
      };
    },

    recordActionCooldown(input) {
      return recordActionCooldownTransaction(input);
    },

    getActionCooldownBucket(tenantId, action) {
      return getActionCooldownBucket(
        requireNonBlank(tenantId, "tenantId"),
        requireNonBlank(action, "action"),
      );
    },

    getActionCooldownEventByIdempotencyKey(idempotencyKey) {
      return getActionCooldownEventByIdempotencyKey(
        requireNonBlank(idempotencyKey, "idempotencyKey"),
      );
    },
  };
}

export const spendLedgerRepository = createSpendLedgerRepository();

export const {
  checkActionCooldown,
  getActionCooldownBucket,
  getActionCooldownEventByIdempotencyKey,
  getDailySpendTotal,
  getMonthlySpendTotal,
  getSpendEventByIdempotencyKey,
  recordActionCooldown,
  recordSpend,
} = spendLedgerRepository;
