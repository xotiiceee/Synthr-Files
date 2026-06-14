import crypto from "node:crypto";
import type Database from "better-sqlite3";

import { getHostedDb } from "./db.js";
import {
  getBillingProvider,
  type BillingDeductResult,
  type BillingProvider,
  type BillingProviderName,
} from "./billing-provider.js";
import {
  createSpendLedgerRepository,
  type SpendLedgerRepository,
} from "./spend-ledger.js";

export type BillingOperationStatus = "pending" | "succeeded" | "failed";

export interface BillingOperation {
  id: string;
  idempotency_key: string;
  tenant_id: string;
  provider: BillingProviderName;
  amount: number;
  reason: string;
  status: BillingOperationStatus;
  provider_remaining: number | null;
  provider_error: string;
  metadata: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface DeductBillingOperationInput {
  tenantId: string;
  apiKey: string;
  amount: number;
  reason: string;
  idempotencyKey: string;
  now?: Date | string;
  metadata?: Record<string, unknown>;
  provider?: BillingProvider;
}

export interface DeductBillingOperationResult {
  ok: boolean;
  remaining?: number;
  error?: string;
  operation: BillingOperation;
  duplicate: boolean;
}

export interface BillingOperationRepository {
  deduct(
    input: DeductBillingOperationInput,
  ): Promise<DeductBillingOperationResult>;
  getOperationByIdempotencyKey(idempotencyKey: string): BillingOperation | null;
}

function iso(value?: Date | string): string {
  if (!value) return new Date().toISOString();
  if (value instanceof Date) return value.toISOString();
  return value;
}

function requireNonBlank(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`Billing operation ${field} is required`);
  return trimmed;
}

function requireAmount(amount: number): number {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(
      "Billing operation amount must be a non-negative finite number",
    );
  }
  return amount;
}

function newBillingOperationId(): string {
  return `bop_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export function buildBillingOperationIdempotencyKey(parts: {
  tenantId: string;
  action: string;
  operationId: string;
}): string {
  return [
    "billing",
    requireNonBlank(parts.tenantId, "tenantId"),
    requireNonBlank(parts.action, "action"),
    requireNonBlank(parts.operationId, "operationId"),
  ].join(":");
}

export function initBillingOperationTables(
  db: Database.Database = getHostedDb(),
): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS billing_operations (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT UNIQUE NOT NULL,
      tenant_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      amount REAL NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL,
      provider_remaining REAL,
      provider_error TEXT NOT NULL DEFAULT '',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      CHECK(amount >= 0),
      CHECK(status IN ('pending', 'succeeded', 'failed'))
    );

    CREATE INDEX IF NOT EXISTS idx_billing_operations_tenant_created
      ON billing_operations(tenant_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_billing_operations_status_updated
      ON billing_operations(status, updated_at);
  `);
}

export function createBillingOperationRepository(
  db: Database.Database = getHostedDb(),
  spendRepository: SpendLedgerRepository = createSpendLedgerRepository(db),
): BillingOperationRepository {
  initBillingOperationTables(db);

  const getOperationByIdempotencyKey = (
    idempotencyKey: string,
  ): BillingOperation | null =>
    (db
      .prepare("SELECT * FROM billing_operations WHERE idempotency_key = ?")
      .get(
        requireNonBlank(idempotencyKey, "idempotencyKey"),
      ) as BillingOperation | null) ?? null;

  return {
    async deduct(input) {
      const tenantId = requireNonBlank(input.tenantId, "tenantId");
      const idempotencyKey = requireNonBlank(
        input.idempotencyKey,
        "idempotencyKey",
      );
      const amount = requireAmount(input.amount);
      const reason = requireNonBlank(input.reason, "reason");
      const provider = input.provider ?? getBillingProvider();
      const now = iso(input.now);

      const existing = getOperationByIdempotencyKey(idempotencyKey);
      if (existing) {
        if (existing.status === "succeeded") {
          return {
            ok: true,
            remaining: existing.provider_remaining ?? undefined,
            operation: existing,
            duplicate: true,
          };
        }
        if (existing.status === "pending") {
          return {
            ok: false,
            error: "Billing operation is already pending",
            operation: existing,
            duplicate: true,
          };
        }
      }

      let operation = existing;
      if (!operation || operation.status === "failed") {
        db.prepare(
          `INSERT INTO billing_operations
           (id, idempotency_key, tenant_id, provider, amount, reason, status, metadata, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
           ON CONFLICT(idempotency_key)
           DO UPDATE SET
             amount = excluded.amount,
             reason = excluded.reason,
             status = 'pending',
             provider_error = '',
             metadata = excluded.metadata,
             updated_at = excluded.updated_at,
             completed_at = NULL`,
        ).run(
          operation?.id ?? newBillingOperationId(),
          idempotencyKey,
          tenantId,
          provider.name,
          amount,
          reason,
          JSON.stringify(input.metadata || {}),
          now,
          now,
        );
        operation = getOperationByIdempotencyKey(idempotencyKey)!;
      }

      let providerResult: BillingDeductResult;
      try {
        providerResult = await provider.deduct(input.apiKey, amount, reason);
      } catch (error) {
        providerResult = {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }

      const completedAt = iso(input.now);
      if (!providerResult.ok) {
        db.prepare(
          `UPDATE billing_operations
           SET status = 'failed',
               provider_error = ?,
               updated_at = ?,
               completed_at = ?
           WHERE idempotency_key = ?`,
        ).run(
          providerResult.error || "Billing provider deduction failed",
          completedAt,
          completedAt,
          idempotencyKey,
        );
        return {
          ok: false,
          error: providerResult.error,
          operation: getOperationByIdempotencyKey(idempotencyKey)!,
          duplicate: false,
        };
      }

      spendRepository.recordSpend({
        tenantId,
        amount,
        idempotencyKey,
        now: completedAt,
        metadata: {
          billingOperationId: operation.id,
          reason,
          provider: provider.name,
          ...input.metadata,
        },
      });

      db.prepare(
        `UPDATE billing_operations
         SET status = 'succeeded',
             provider_remaining = ?,
             provider_error = '',
             updated_at = ?,
             completed_at = ?
         WHERE idempotency_key = ?`,
      ).run(
        providerResult.remaining ?? null,
        completedAt,
        completedAt,
        idempotencyKey,
      );

      return {
        ok: true,
        remaining: providerResult.remaining,
        operation: getOperationByIdempotencyKey(idempotencyKey)!,
        duplicate: false,
      };
    },

    getOperationByIdempotencyKey(idempotencyKey) {
      return getOperationByIdempotencyKey(idempotencyKey);
    },
  };
}

export const billingOperationRepository = createBillingOperationRepository();

export const { deduct, getOperationByIdempotencyKey } =
  billingOperationRepository;
