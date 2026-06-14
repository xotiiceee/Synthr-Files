import { describe, expect, it } from "vitest";

import { cleanupSqliteFiles, createTempHostedDbPath } from "./temp-db.js";

const dbPath = createTempHostedDbPath("pulse-stripe-billing");
process.env.HOSTED_DB_PATH = dbPath;

const {
  deriveStripeEntitlementState,
  getStripeCustomer,
  getStripeSubscription,
  getStripeWebhookEvent,
  markStripeWebhookEventFailed,
  markStripeWebhookEventProcessed,
  recordStripeWebhookEvent,
  upsertStripeCustomer,
  upsertStripeSubscription,
} = await import("../../hosted/stripe-billing.js");

describe("stripe billing repository", () => {
  it("upserts customer and subscription records without creating duplicates", () => {
    const created = upsertStripeCustomer({
      stripeCustomerId: "cus_standalone",
      orgId: "org_pulse",
      email: "billing@pulse.test",
      name: "Pulse Org",
      livemode: false,
      metadata: { plan: "standalone-premium" },
      createdAt: "2026-05-26T10:00:00.000Z",
      updatedAt: "2026-05-26T10:00:00.000Z",
    });

    const updated = upsertStripeCustomer({
      stripeCustomerId: "cus_standalone",
      orgId: "org_pulse",
      email: "finance@pulse.test",
      name: "Pulse Billing",
      livemode: true,
      metadata: { plan: "standalone-premium", seatMode: "per-org" },
      createdAt: "2026-05-26T09:00:00.000Z",
      updatedAt: "2026-05-26T11:00:00.000Z",
    });

    expect(created.stripe_customer_id).toBe("cus_standalone");
    expect(updated.created_at).toBe("2026-05-26T10:00:00.000Z");
    expect(updated.updated_at).toBe("2026-05-26T11:00:00.000Z");
    expect(updated.email).toBe("finance@pulse.test");
    expect(updated.livemode).toBe(1);
    expect(JSON.parse(updated.metadata)).toEqual({
      plan: "standalone-premium",
      seatMode: "per-org",
    });
    expect(getStripeCustomer("cus_standalone")).toEqual(updated);

    const subscription = upsertStripeSubscription({
      stripeSubscriptionId: "sub_standalone",
      orgId: "org_pulse",
      stripeCustomerId: "cus_standalone",
      status: "trialing",
      stripePriceId: "price_premium_monthly",
      stripeProductId: "prod_premium",
      currentPeriodStart: "2026-05-26T10:00:00.000Z",
      currentPeriodEnd: "2026-06-26T10:00:00.000Z",
      trialStart: "2026-05-26T10:00:00.000Z",
      trialEnd: "2026-06-02T10:00:00.000Z",
      metadata: { source: "checkout.session.completed" },
      createdAt: "2026-05-26T10:00:00.000Z",
      updatedAt: "2026-05-26T10:00:00.000Z",
    });

    const transitioned = upsertStripeSubscription({
      stripeSubscriptionId: "sub_standalone",
      orgId: "org_pulse",
      stripeCustomerId: "cus_standalone",
      status: "active",
      stripePriceId: "price_premium_monthly",
      stripeProductId: "prod_premium",
      currentPeriodStart: "2026-06-02T10:00:00.000Z",
      currentPeriodEnd: "2026-07-02T10:00:00.000Z",
      trialStart: null,
      trialEnd: null,
      metadata: { source: "customer.subscription.updated" },
      createdAt: "2026-05-26T08:00:00.000Z",
      updatedAt: "2026-06-02T10:00:00.000Z",
    });

    expect(subscription.status).toBe("trialing");
    expect(transitioned.status).toBe("active");
    expect(transitioned.created_at).toBe("2026-05-26T10:00:00.000Z");
    expect(transitioned.updated_at).toBe("2026-06-02T10:00:00.000Z");
    expect(transitioned.current_period_end).toBe("2026-07-02T10:00:00.000Z");
    expect(getStripeSubscription("sub_standalone")).toEqual(transitioned);
  });

  it("records webhook events idempotently and tracks processed and failed states", () => {
    const first = recordStripeWebhookEvent({
      stripeEventId: "evt_1",
      eventType: "customer.subscription.updated",
      apiVersion: "2025-01-27.acacia",
      livemode: false,
      payload: { id: "evt_1", type: "customer.subscription.updated" },
      receivedAt: "2026-05-26T12:00:00.000Z",
    });

    const duplicate = recordStripeWebhookEvent({
      stripeEventId: "evt_1",
      eventType: "customer.subscription.deleted",
      apiVersion: "ignored",
      livemode: true,
      payload: { replaced: true },
      receivedAt: "2026-05-26T12:05:00.000Z",
    });

    expect(duplicate).toEqual(first);
    expect(getStripeWebhookEvent("evt_1")).toEqual(first);

    const failed = markStripeWebhookEventFailed({
      stripeEventId: "evt_1",
      error: "temporary downstream write failure",
      now: "2026-05-26T12:01:00.000Z",
    });
    expect(failed).toMatchObject({
      stripe_event_id: "evt_1",
      processing_status: "failed",
      processing_attempts: 1,
      last_error: "temporary downstream write failure",
      failed_at: "2026-05-26T12:01:00.000Z",
    });

    const processed = markStripeWebhookEventProcessed({
      stripeEventId: "evt_1",
      now: "2026-05-26T12:02:00.000Z",
    });
    expect(processed).toMatchObject({
      stripe_event_id: "evt_1",
      processing_status: "processed",
      processing_attempts: 2,
      last_error: "",
      processed_at: "2026-05-26T12:02:00.000Z",
      failed_at: null,
    });
    expect(
      markStripeWebhookEventProcessed({
        stripeEventId: "evt_1",
        now: "2026-05-26T12:03:00.000Z",
      }),
    ).toEqual(processed);
  });

  it("derives entitlements from active and trialing subscriptions only", () => {
    upsertStripeCustomer({
      stripeCustomerId: "cus_trial",
      orgId: "org_trial",
      createdAt: "2026-05-26T13:00:00.000Z",
      updatedAt: "2026-05-26T13:00:00.000Z",
    });
    upsertStripeSubscription({
      stripeSubscriptionId: "sub_trial",
      orgId: "org_trial",
      stripeCustomerId: "cus_trial",
      status: "trialing",
      stripePriceId: "price_trial",
      stripeProductId: "prod_premium",
      currentPeriodEnd: "2026-06-01T00:00:00.000Z",
      trialEnd: "2026-06-01T00:00:00.000Z",
      createdAt: "2026-05-26T13:00:00.000Z",
      updatedAt: "2026-05-26T13:00:00.000Z",
    });

    upsertStripeCustomer({
      stripeCustomerId: "cus_multi",
      orgId: "org_multi",
      createdAt: "2026-05-26T13:00:00.000Z",
      updatedAt: "2026-05-26T13:00:00.000Z",
    });
    upsertStripeSubscription({
      stripeSubscriptionId: "sub_canceled",
      orgId: "org_multi",
      stripeCustomerId: "cus_multi",
      status: "canceled",
      stripePriceId: "price_old",
      currentPeriodEnd: "2026-05-20T00:00:00.000Z",
      canceledAt: "2026-05-20T00:00:00.000Z",
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-20T00:00:00.000Z",
    });
    upsertStripeSubscription({
      stripeSubscriptionId: "sub_active",
      orgId: "org_multi",
      stripeCustomerId: "cus_multi",
      status: "active",
      stripePriceId: "price_current",
      stripeProductId: "prod_premium",
      currentPeriodEnd: "2026-06-30T00:00:00.000Z",
      createdAt: "2026-05-21T00:00:00.000Z",
      updatedAt: "2026-05-26T13:10:00.000Z",
    });
    upsertStripeSubscription({
      stripeSubscriptionId: "sub_trial_backup",
      orgId: "org_multi",
      stripeCustomerId: "cus_multi",
      status: "trialing",
      stripePriceId: "price_trial_backup",
      stripeProductId: "prod_premium",
      currentPeriodEnd: "2026-07-15T00:00:00.000Z",
      trialEnd: "2026-06-05T00:00:00.000Z",
      createdAt: "2026-05-22T00:00:00.000Z",
      updatedAt: "2026-05-26T13:20:00.000Z",
    });

    expect(
      deriveStripeEntitlementState({
        orgId: "org_trial",
      }),
    ).toEqual({
      entitled: true,
      status: "trialing",
      orgId: "org_trial",
      stripeCustomerId: "cus_trial",
      stripeSubscriptionId: "sub_trial",
      stripePriceId: "price_trial",
      stripeProductId: "prod_premium",
      currentPeriodEnd: "2026-06-01T00:00:00.000Z",
      trialEnd: "2026-06-01T00:00:00.000Z",
    });

    expect(
      deriveStripeEntitlementState({
        stripeCustomerId: "cus_multi",
      }),
    ).toEqual({
      entitled: true,
      status: "active",
      orgId: "org_multi",
      stripeCustomerId: "cus_multi",
      stripeSubscriptionId: "sub_active",
      stripePriceId: "price_current",
      stripeProductId: "prod_premium",
      currentPeriodEnd: "2026-06-30T00:00:00.000Z",
      trialEnd: null,
    });

    expect(
      deriveStripeEntitlementState({
        orgId: "org_missing",
      }),
    ).toEqual({
      entitled: false,
      status: "inactive",
      orgId: "org_missing",
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      stripePriceId: null,
      stripeProductId: null,
      currentPeriodEnd: null,
      trialEnd: null,
    });
  });
});

process.on("exit", () => {
  cleanupSqliteFiles(dbPath);
});
