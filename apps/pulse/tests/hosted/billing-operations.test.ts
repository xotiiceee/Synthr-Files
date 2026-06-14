import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildBillingOperationIdempotencyKey,
  createBillingOperationRepository,
} from "../../hosted/billing-operations.js";
import { createSpendLedgerRepository } from "../../hosted/spend-ledger.js";
import type { BillingProvider } from "../../hosted/billing-provider.js";
import { cleanupSqliteFiles, createTempHostedDbPath } from "./temp-db.js";

const dbPaths: string[] = [];

afterEach(() => {
  while (dbPaths.length > 0) cleanupSqliteFiles(dbPaths.pop()!);
});

function createTempRepo() {
  const dbPath = createTempHostedDbPath("pulse-billing-operations");
  dbPaths.push(dbPath);
  const db = new Database(dbPath);
  return {
    db,
    repo: createBillingOperationRepository(db),
    spend: createSpendLedgerRepository(db),
  };
}

function createProvider(deduct: BillingProvider["deduct"]): BillingProvider {
  return {
    name: "clawnet",
    isEnabled: () => true,
    deduct,
    checkBalance: async () => 100,
    canAfford: async () => true,
  };
}

describe("billing operations", () => {
  it("builds stable operation idempotency keys", () => {
    expect(
      buildBillingOperationIdempotencyKey({
        tenantId: "tn_1",
        action: "generate_post",
        operationId: "req_1",
      }),
    ).toBe("billing:tn_1:generate_post:req_1");
  });

  it("persists pending operation before provider deduction and records spend on success", async () => {
    const { db, repo, spend } = createTempRepo();
    const providerDeduct = vi.fn(async () => {
      const pending = repo.getOperationByIdempotencyKey(
        "billing:tn_a:post:req_1",
      );
      expect(pending).toMatchObject({
        status: "pending",
        amount: 2.5,
        reason: "pulse:generate_post:gpt",
      });
      return { ok: true, remaining: 97.5 };
    });
    const provider = createProvider(providerDeduct);

    try {
      const result = await repo.deduct({
        tenantId: "tn_a",
        apiKey: "cn-key",
        amount: 2.5,
        reason: "pulse:generate_post:gpt",
        idempotencyKey: "billing:tn_a:post:req_1",
        provider,
        now: "2026-05-26T12:00:00.000Z",
        metadata: { route: "/api/generate" },
      });

      expect(result).toMatchObject({
        ok: true,
        remaining: 97.5,
        duplicate: false,
      });
      expect(providerDeduct).toHaveBeenCalledOnce();
      expect(
        repo.getOperationByIdempotencyKey("billing:tn_a:post:req_1"),
      ).toMatchObject({
        status: "succeeded",
        provider_remaining: 97.5,
        provider_error: "",
        completed_at: "2026-05-26T12:00:00.000Z",
      });
      expect(
        spend.getSpendEventByIdempotencyKey("billing:tn_a:post:req_1"),
      ).toMatchObject({
        tenant_id: "tn_a",
        amount: 2.5,
      });
      expect(
        spend.getDailySpendTotal({
          tenantId: "tn_a",
          date: "2026-05-26T23:59:00.000Z",
        }),
      ).toBe(2.5);
    } finally {
      db.close();
    }
  });

  it("returns successful duplicate operations without provider or spend writes", async () => {
    const { db, repo, spend } = createTempRepo();
    const providerDeduct = vi.fn(async () => ({ ok: true, remaining: 9 }));
    const provider = createProvider(providerDeduct);

    try {
      const first = await repo.deduct({
        tenantId: "tn_dupe",
        apiKey: "cn-key",
        amount: 1,
        reason: "pulse:test",
        idempotencyKey: "billing:tn_dupe:test:req_1",
        provider,
        now: "2026-05-26T12:00:00.000Z",
      });
      const second = await repo.deduct({
        tenantId: "tn_dupe",
        apiKey: "cn-key",
        amount: 99,
        reason: "pulse:test:changed",
        idempotencyKey: "billing:tn_dupe:test:req_1",
        provider,
        now: "2026-05-26T12:05:00.000Z",
      });

      expect(first.duplicate).toBe(false);
      expect(second).toMatchObject({
        ok: true,
        remaining: 9,
        duplicate: true,
      });
      expect(providerDeduct).toHaveBeenCalledTimes(1);
      expect(
        spend.getDailySpendTotal({
          tenantId: "tn_dupe",
          date: "2026-05-26T23:59:00.000Z",
        }),
      ).toBe(1);
    } finally {
      db.close();
    }
  });

  it("blocks duplicate pending operations without provider deduction", async () => {
    const { db, repo } = createTempRepo();
    const provider = createProvider(async () => {
      throw new Error("network hang");
    });

    try {
      const first = await repo.deduct({
        tenantId: "tn_pending",
        apiKey: "cn-key",
        amount: 1,
        reason: "pulse:test",
        idempotencyKey: "billing:tn_pending:test:req_1",
        provider,
        now: "2026-05-26T12:00:00.000Z",
      });
      db.prepare(
        "UPDATE billing_operations SET status = 'pending', completed_at = NULL WHERE idempotency_key = ?",
      ).run("billing:tn_pending:test:req_1");

      const providerDeduct = vi.fn(async () => ({ ok: true, remaining: 8 }));
      const duplicate = await repo.deduct({
        tenantId: "tn_pending",
        apiKey: "cn-key",
        amount: 1,
        reason: "pulse:test",
        idempotencyKey: "billing:tn_pending:test:req_1",
        provider: createProvider(providerDeduct),
        now: "2026-05-26T12:01:00.000Z",
      });

      expect(first.ok).toBe(false);
      expect(duplicate).toMatchObject({
        ok: false,
        error: "Billing operation is already pending",
        duplicate: true,
      });
      expect(providerDeduct).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });

  it("marks failed provider deductions and allows an explicit retry with the same key", async () => {
    const { db, repo, spend } = createTempRepo();
    const providerDeduct = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: "insufficient credits" })
      .mockResolvedValueOnce({ ok: true, remaining: 5 });
    const provider = createProvider(providerDeduct);

    try {
      const failed = await repo.deduct({
        tenantId: "tn_retry",
        apiKey: "cn-key",
        amount: 3,
        reason: "pulse:test",
        idempotencyKey: "billing:tn_retry:test:req_1",
        provider,
        now: "2026-05-26T12:00:00.000Z",
      });
      const retried = await repo.deduct({
        tenantId: "tn_retry",
        apiKey: "cn-key",
        amount: 3,
        reason: "pulse:test",
        idempotencyKey: "billing:tn_retry:test:req_1",
        provider,
        now: "2026-05-26T12:01:00.000Z",
      });

      expect(failed).toMatchObject({
        ok: false,
        error: "insufficient credits",
        duplicate: false,
      });
      expect(retried).toMatchObject({
        ok: true,
        remaining: 5,
        duplicate: false,
      });
      expect(providerDeduct).toHaveBeenCalledTimes(2);
      expect(
        spend.getDailySpendTotal({
          tenantId: "tn_retry",
          date: "2026-05-26T23:59:00.000Z",
        }),
      ).toBe(3);
    } finally {
      db.close();
    }
  });
});
