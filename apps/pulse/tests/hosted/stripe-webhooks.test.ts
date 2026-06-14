import Database from "better-sqlite3";
import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";

import {
  createStripeBillingRepository,
  initStripeBillingTables,
} from "../../hosted/stripe-billing.js";
import {
  handleStripeWebhook,
  registerStripeWebhookRoute,
} from "../../hosted/stripe-webhooks.js";
import { cleanupSqliteFiles, createTempHostedDbPath } from "./temp-db.js";

const createdDbPaths: string[] = [];

function createTestStore() {
  const dbPath = createTempHostedDbPath("pulse-stripe-webhooks");
  createdDbPaths.push(dbPath);
  const db = new Database(dbPath);
  initStripeBillingTables(db);
  const repository = createStripeBillingRepository(db);
  return { db, repository };
}

function signStripePayload(
  payload: string,
  secret: string,
  timestamp: number,
): string {
  const digest = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`, "utf8")
    .digest("hex");
  return `t=${timestamp},v1=${digest}`;
}

afterEach(() => {
  while (createdDbPaths.length > 0) {
    cleanupSqliteFiles(createdDbPaths.pop()!);
  }
});

describe("stripe webhooks", () => {
  it("verifies signatures, records events idempotently, and upserts customer/subscription state", async () => {
    const { db, repository } = createTestStore();
    const secret = "whsec_test_secret";
    const timestamp = 1_779_850_000;
    const payload = JSON.stringify({
      id: "evt_signed_subscription",
      type: "customer.subscription.updated",
      api_version: "2025-01-27.acacia",
      livemode: false,
      data: {
        object: {
          id: "sub_signed",
          customer: {
            id: "cus_signed",
            email: "billing@pulse.test",
            name: "Pulse Billing",
            metadata: { orgId: "org_signed" },
          },
          status: "active",
          livemode: false,
          cancel_at_period_end: false,
          current_period_start: 1_779_850_000,
          current_period_end: 1_782_442_800,
          trial_start: null,
          trial_end: null,
          items: {
            data: [
              {
                price: {
                  id: "price_premium_monthly",
                  product: "prod_premium",
                },
              },
            ],
          },
          metadata: { orgId: "org_signed", source: "tests" },
        },
      },
    });

    const first = await handleStripeWebhook({
      payload,
      signatureHeader: signStripePayload(payload, secret, timestamp),
      secret,
      nowMs: timestamp * 1000,
      db,
      repository,
    });
    expect(first).toMatchObject({
      ok: true,
      status: 200,
      duplicate: false,
      eventId: "evt_signed_subscription",
      eventType: "customer.subscription.updated",
    });

    const recorded = repository.getStripeWebhookEvent("evt_signed_subscription");
    expect(recorded).toMatchObject({
      stripe_event_id: "evt_signed_subscription",
      processing_status: "processed",
      processing_attempts: 1,
      last_error: "",
    });

    expect(repository.getStripeCustomer("cus_signed")).toMatchObject({
      stripe_customer_id: "cus_signed",
      org_id: "org_signed",
      email: "billing@pulse.test",
      name: "Pulse Billing",
    });
    expect(repository.getStripeSubscription("sub_signed")).toMatchObject({
      stripe_subscription_id: "sub_signed",
      org_id: "org_signed",
      stripe_customer_id: "cus_signed",
      status: "active",
      stripe_price_id: "price_premium_monthly",
      stripe_product_id: "prod_premium",
    });

    const duplicate = await handleStripeWebhook({
      payload,
      signatureHeader: signStripePayload(payload, secret, timestamp),
      secret,
      nowMs: timestamp * 1000,
      db,
      repository,
    });
    expect(duplicate).toMatchObject({
      ok: true,
      status: 200,
      duplicate: true,
    });
    expect(
      repository.getStripeWebhookEvent("evt_signed_subscription")
        ?.processing_attempts,
    ).toBe(1);

    db.close();
  });

  it("marks a recorded event failed when subscription processing errors", async () => {
    const { db, repository } = createTestStore();
    const payload = JSON.stringify({
      id: "evt_failed_subscription",
      type: "customer.subscription.updated",
      livemode: false,
      data: {
        object: {
          id: "sub_missing_customer",
          status: "active",
          items: { data: [] },
          metadata: { orgId: "org_failed" },
        },
      },
    });

    const result = await handleStripeWebhook({
      payload,
      db,
      repository,
    });
    expect(result).toMatchObject({
      ok: false,
      status: 500,
      duplicate: false,
      eventId: "evt_failed_subscription",
    });
    expect(result.error).toContain("missing customer id");

    expect(repository.getStripeWebhookEvent("evt_failed_subscription")).toMatchObject({
      stripe_event_id: "evt_failed_subscription",
      processing_status: "failed",
      processing_attempts: 1,
      last_error: expect.stringContaining("missing customer id"),
    });
    expect(repository.getStripeSubscription("sub_missing_customer")).toBeNull();

    db.close();
  });

  it("mounts a public route that rejects invalid signatures", async () => {
    const { db, repository } = createTestStore();
    const app = new Hono();
    registerStripeWebhookRoute(app, {
      secret: "whsec_test_secret",
      nowMs: 1_779_850_000_000,
      db,
      repository,
    });

    const response = await app.request("/webhooks/stripe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Stripe-Signature": "t=1779850000,v1=deadbeef",
      },
      body: JSON.stringify({
        id: "evt_invalid_signature",
        type: "customer.updated",
        data: { object: { id: "cus_invalid" } },
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "Stripe webhook signature verification failed.",
    });
    expect(repository.getStripeWebhookEvent("evt_invalid_signature")).toBeNull();

    db.close();
  });
});
