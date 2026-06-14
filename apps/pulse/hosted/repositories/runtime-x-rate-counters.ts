import { getHostedDb } from "../db.js";

export interface RuntimeXRateCounter {
  tenant_id: string;
  account_id: string;
  month_key: string;
  post_count: number;
  updated_at: string;
}

export interface RuntimeXRateCounterRef {
  tenantId: string;
  accountId?: string;
  monthKey: string;
}

export interface RuntimeXRateCounterRepository {
  getCounter(ref: RuntimeXRateCounterRef): RuntimeXRateCounter | null;
  getPostCount(ref: RuntimeXRateCounterRef): number;
  incrementPostCount(ref: RuntimeXRateCounterRef): RuntimeXRateCounter;
}

function normalizeAccountId(value?: string): string {
  return value?.trim() || "";
}

function normalizeTenantId(value: string): string {
  const tenantId = value.trim();
  if (!tenantId) throw new Error("Runtime X rate counter tenantId is required");
  return tenantId;
}

function normalizeMonthKey(value: string): string {
  const monthKey = value.trim();
  if (!/^\d{4}-\d{2}$/.test(monthKey)) {
    throw new Error("Runtime X rate counter monthKey must use YYYY-MM");
  }
  return monthKey;
}

export function createRuntimeXRateCounterRepository(): RuntimeXRateCounterRepository {
  return {
    getCounter(ref) {
      return (
        (getHostedDb()
          .prepare(
            `SELECT tenant_id, account_id, month_key, post_count, updated_at
               FROM runtime_x_rate_counters
              WHERE tenant_id = ?
                AND account_id = ?
                AND month_key = ?`,
          )
          .get(
            normalizeTenantId(ref.tenantId),
            normalizeAccountId(ref.accountId),
            normalizeMonthKey(ref.monthKey),
          ) as RuntimeXRateCounter | undefined) ?? null
      );
    },

    getPostCount(ref) {
      return this.getCounter(ref)?.post_count ?? 0;
    },

    incrementPostCount(ref) {
      const tenantId = normalizeTenantId(ref.tenantId);
      const accountId = normalizeAccountId(ref.accountId);
      const monthKey = normalizeMonthKey(ref.monthKey);
      const now = new Date().toISOString();

      getHostedDb()
        .prepare(
          `INSERT INTO runtime_x_rate_counters
             (tenant_id, account_id, month_key, post_count, updated_at)
           VALUES (?, ?, ?, 1, ?)
           ON CONFLICT(tenant_id, account_id, month_key)
           DO UPDATE SET
             post_count = post_count + 1,
             updated_at = excluded.updated_at`,
        )
        .run(tenantId, accountId, monthKey, now);

      return this.getCounter({ tenantId, accountId, monthKey })!;
    },
  };
}

export const runtimeXRateCounterRepository =
  createRuntimeXRateCounterRepository();
