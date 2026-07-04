import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { createJobRepository } from "../../hosted/jobs.js";
import {
  BILLING_RECONCILIATION_JOB_TYPE,
  BILLING_RECONCILIATION_QUEUE,
  buildBillingReconciliationIdempotencyKey,
  enqueueBillingReconciliationJob,
  handleBillingReconciliation,
} from "../../hosted/billing-reconciliation.js";
import { cleanupSqliteFiles, createTempHostedDbPath } from "./temp-db.js";

const dbPaths: string[] = [];

afterEach(() => {
  while (dbPaths.length > 0) {
    cleanupSqliteFiles(dbPaths.pop()!);
  }
});

function createTempJobRepository() {
  const dbPath = createTempHostedDbPath("pulse-billing-reconciliation");
  dbPaths.push(dbPath);
  const db = new Database(dbPath);
  return {
    db,
    repository: createJobRepository(db),
  };
}

describe("billing reconciliation", () => {
  it("enqueues durable reconciliation jobs idempotently with a stable key", () => {
    const { db, repository } = createTempJobRepository();

    try {
      const input = {
        reconciliationKey: "daily:2026-05-26",
        tenantId: "tn_pulse",
        orgId: "org_pulse",
        workspaceId: "ws_pulse",
        brandId: "br_pulse",
        runAt: "2026-05-26T00:05:00.000Z",
      };

      const first = enqueueBillingReconciliationJob(input, repository);
      const second = enqueueBillingReconciliationJob(
        {
          ...input,
          workspaceId: "ws_changed",
          brandId: "br_changed",
        },
        repository,
      );

      expect(buildBillingReconciliationIdempotencyKey(input)).toBe(
        "billing-reconciliation:daily:2026-05-26:org:org_pulse",
      );
      expect(second).toEqual(first);
      expect(first).toMatchObject({
        type: BILLING_RECONCILIATION_JOB_TYPE,
        queue: BILLING_RECONCILIATION_QUEUE,
        tenant_id: "tn_pulse",
        org_id: "org_pulse",
        workspace_id: "ws_pulse",
        brand_id: "br_pulse",
        status: "queued",
      });
      expect(JSON.parse(first.payload)).toEqual({
        reconciliationKey: "daily:2026-05-26",
        orgId: "org_pulse",
        stripeCustomerId: null,
      });
    } finally {
      db.close();
    }
  });

  it("returns matched, missing, and mismatched entitlement comparisons without mutating state", async () => {
    const result = await handleBillingReconciliation(
      {
        reconciliationKey: "daily:2026-05-26",
        orgId: "org_batch",
        stripeCustomerId: null,
      },
      async (payload) => {
        expect(payload).toEqual({
          reconciliationKey: "daily:2026-05-26",
          orgId: "org_batch",
          stripeCustomerId: null,
        });

        return [
          {
            stripe: {
              entitled: true,
              status: "active",
              orgId: "org_match",
              stripeCustomerId: "cus_match",
              stripeSubscriptionId: "sub_match",
              stripePriceId: "price_match",
              stripeProductId: "prod_premium",
              currentPeriodEnd: "2026-06-26T00:00:00.000Z",
              trialEnd: null,
            },
            expected: {
              entitled: true,
              status: "active",
              orgId: "org_match",
              stripeCustomerId: "cus_match",
              stripeSubscriptionId: "sub_match",
              stripePriceId: "price_match",
              stripeProductId: "prod_premium",
              currentPeriodEnd: "2026-06-26T00:00:00.000Z",
              trialEnd: null,
            },
          },
          {
            stripe: null,
            expected: {
              entitled: true,
              status: "trialing",
              orgId: "org_missing_stripe",
              stripeCustomerId: "cus_missing_stripe",
              stripeSubscriptionId: "sub_missing_stripe",
              stripePriceId: "price_trial",
              stripeProductId: "prod_premium",
              currentPeriodEnd: "2026-06-01T00:00:00.000Z",
              trialEnd: "2026-06-01T00:00:00.000Z",
            },
          },
          {
            stripe: {
              entitled: true,
              status: "active",
              orgId: "org_mismatch",
              stripeCustomerId: "cus_mismatch",
              stripeSubscriptionId: "sub_mismatch",
              stripePriceId: "price_monthly",
              stripeProductId: "prod_premium",
              currentPeriodEnd: "2026-06-26T00:00:00.000Z",
              trialEnd: null,
            },
            expected: {
              entitled: true,
              status: "trialing",
              orgId: "org_mismatch",
              stripeCustomerId: "cus_mismatch",
              stripeSubscriptionId: "sub_mismatch",
              stripePriceId: "price_annual",
              stripeProductId: "prod_premium",
              currentPeriodEnd: "2026-07-26T00:00:00.000Z",
              trialEnd: "2026-06-05T00:00:00.000Z",
            },
          },
          {
            stripe: {
              entitled: false,
              status: "inactive",
              orgId: "org_missing_expected",
              stripeCustomerId: "cus_missing_expected",
              stripeSubscriptionId: null,
              stripePriceId: null,
              stripeProductId: null,
              currentPeriodEnd: null,
              trialEnd: null,
            },
            expected: null,
          },
        ];
      },
    );

    expect(result).toMatchObject({
      checkedCount: 4,
      matchedCount: 1,
      missingCount: 2,
      mismatchedCount: 1,
    });
    expect(result.mismatches).toEqual([
      {
        scopeKey: "org:org_missing_stripe:stripeCustomer:cus_missing_stripe",
        kind: "missing_stripe_state",
        differingFields: [],
        stripe: null,
        expected: {
          entitled: true,
          status: "trialing",
          orgId: "org_missing_stripe",
          stripeCustomerId: "cus_missing_stripe",
          stripeSubscriptionId: "sub_missing_stripe",
          stripePriceId: "price_trial",
          stripeProductId: "prod_premium",
          currentPeriodEnd: "2026-06-01T00:00:00.000Z",
          trialEnd: "2026-06-01T00:00:00.000Z",
        },
      },
      {
        scopeKey: "org:org_mismatch:stripeCustomer:cus_mismatch",
        kind: "field_mismatch",
        differingFields: [
          "status",
          "stripePriceId",
          "currentPeriodEnd",
          "trialEnd",
        ],
        stripe: {
          entitled: true,
          status: "active",
          orgId: "org_mismatch",
          stripeCustomerId: "cus_mismatch",
          stripeSubscriptionId: "sub_mismatch",
          stripePriceId: "price_monthly",
          stripeProductId: "prod_premium",
          currentPeriodEnd: "2026-06-26T00:00:00.000Z",
          trialEnd: null,
        },
        expected: {
          entitled: true,
          status: "trialing",
          orgId: "org_mismatch",
          stripeCustomerId: "cus_mismatch",
          stripeSubscriptionId: "sub_mismatch",
          stripePriceId: "price_annual",
          stripeProductId: "prod_premium",
          currentPeriodEnd: "2026-07-26T00:00:00.000Z",
          trialEnd: "2026-06-05T00:00:00.000Z",
        },
      },
      {
        scopeKey:
          "org:org_missing_expected:stripeCustomer:cus_missing_expected",
        kind: "missing_expected_state",
        differingFields: [],
        stripe: {
          entitled: false,
          status: "inactive",
          orgId: "org_missing_expected",
          stripeCustomerId: "cus_missing_expected",
          stripeSubscriptionId: null,
          stripePriceId: null,
          stripeProductId: null,
          currentPeriodEnd: null,
          trialEnd: null,
        },
        expected: null,
      },
    ]);
  });
});
