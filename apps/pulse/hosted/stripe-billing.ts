import type Database from "better-sqlite3";

import { getHostedDb } from "./db.js";

export type StripeWebhookEventStatus = "pending" | "processed" | "failed";

export interface StripeCustomer {
  stripe_customer_id: string;
  org_id: string;
  email: string;
  name: string;
  livemode: number;
  metadata: string;
  created_at: string;
  updated_at: string;
}

export interface StripeSubscription {
  stripe_subscription_id: string;
  org_id: string;
  stripe_customer_id: string;
  status: string;
  stripe_price_id: string;
  stripe_product_id: string;
  cancel_at_period_end: number;
  current_period_start: string | null;
  current_period_end: string | null;
  trial_start: string | null;
  trial_end: string | null;
  canceled_at: string | null;
  metadata: string;
  created_at: string;
  updated_at: string;
}

export interface StripeWebhookEvent {
  stripe_event_id: string;
  event_type: string;
  api_version: string;
  livemode: number;
  payload: string;
  processing_status: StripeWebhookEventStatus;
  processing_attempts: number;
  last_error: string;
  received_at: string;
  processed_at: string | null;
  failed_at: string | null;
  updated_at: string;
}

export interface UpsertStripeCustomerInput {
  stripeCustomerId: string;
  orgId?: string;
  email?: string;
  name?: string;
  livemode?: boolean;
  metadata?: Record<string, unknown>;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export interface UpsertStripeSubscriptionInput {
  stripeSubscriptionId: string;
  orgId?: string;
  stripeCustomerId: string;
  status: string;
  stripePriceId?: string;
  stripeProductId?: string;
  cancelAtPeriodEnd?: boolean;
  currentPeriodStart?: Date | string | null;
  currentPeriodEnd?: Date | string | null;
  trialStart?: Date | string | null;
  trialEnd?: Date | string | null;
  canceledAt?: Date | string | null;
  metadata?: Record<string, unknown>;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export interface RecordStripeWebhookEventInput {
  stripeEventId: string;
  eventType: string;
  apiVersion?: string;
  livemode?: boolean;
  payload?: Record<string, unknown>;
  receivedAt?: Date | string;
}

export interface MarkStripeWebhookEventInput {
  stripeEventId: string;
  now?: Date | string;
}

export interface MarkStripeWebhookEventFailedInput extends MarkStripeWebhookEventInput {
  error: string;
}

export interface StripeEntitlementState {
  entitled: boolean;
  status: "active" | "trialing" | "inactive";
  orgId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
  stripeProductId: string | null;
  currentPeriodEnd: string | null;
  trialEnd: string | null;
}

export interface DeriveStripeEntitlementInput {
  orgId?: string;
  stripeCustomerId?: string;
}

export interface StripeBillingRepository {
  upsertStripeCustomer(input: UpsertStripeCustomerInput): StripeCustomer;
  getStripeCustomer(stripeCustomerId: string): StripeCustomer | null;
  upsertStripeSubscription(
    input: UpsertStripeSubscriptionInput,
  ): StripeSubscription;
  getStripeSubscription(
    stripeSubscriptionId: string,
  ): StripeSubscription | null;
  recordStripeWebhookEvent(
    input: RecordStripeWebhookEventInput,
  ): StripeWebhookEvent;
  getStripeWebhookEvent(stripeEventId: string): StripeWebhookEvent | null;
  markStripeWebhookEventProcessed(
    input: MarkStripeWebhookEventInput,
  ): StripeWebhookEvent | null;
  markStripeWebhookEventFailed(
    input: MarkStripeWebhookEventFailedInput,
  ): StripeWebhookEvent | null;
  deriveStripeEntitlementState(
    input: DeriveStripeEntitlementInput,
  ): StripeEntitlementState;
}

function isoNow(value?: Date | string): string {
  if (value === undefined) return new Date().toISOString();
  if (value instanceof Date) return value.toISOString();
  return value;
}

function optionalIso(value?: Date | string | null): string | null {
  if (value === null) return null;
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function requireNonBlank(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`Stripe billing ${field} is required`);
  return trimmed;
}

function toJson(value: Record<string, unknown> | undefined): string {
  return JSON.stringify(value || {});
}

function boolInt(value: boolean | undefined): number {
  return value ? 1 : 0;
}

function requireLookupTarget(input: DeriveStripeEntitlementInput): void {
  if (input.orgId?.trim() || input.stripeCustomerId?.trim()) return;
  throw new Error(
    "Stripe billing entitlement lookup requires orgId or stripeCustomerId",
  );
}

export function initStripeBillingTables(
  db: Database.Database = getHostedDb(),
): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS stripe_customers (
      stripe_customer_id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      livemode INTEGER NOT NULL DEFAULT 0,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK(livemode IN (0, 1))
    );

    CREATE TABLE IF NOT EXISTS stripe_subscriptions (
      stripe_subscription_id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL DEFAULT '',
      stripe_customer_id TEXT NOT NULL,
      status TEXT NOT NULL,
      stripe_price_id TEXT NOT NULL DEFAULT '',
      stripe_product_id TEXT NOT NULL DEFAULT '',
      cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
      current_period_start TEXT,
      current_period_end TEXT,
      trial_start TEXT,
      trial_end TEXT,
      canceled_at TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK(cancel_at_period_end IN (0, 1))
    );

    CREATE TABLE IF NOT EXISTS stripe_webhook_events (
      stripe_event_id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      api_version TEXT NOT NULL DEFAULT '',
      livemode INTEGER NOT NULL DEFAULT 0,
      payload TEXT NOT NULL DEFAULT '{}',
      processing_status TEXT NOT NULL DEFAULT 'pending',
      processing_attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT NOT NULL DEFAULT '',
      received_at TEXT NOT NULL,
      processed_at TEXT,
      failed_at TEXT,
      updated_at TEXT NOT NULL,
      CHECK(livemode IN (0, 1)),
      CHECK(processing_status IN ('pending', 'processed', 'failed')),
      CHECK(processing_attempts >= 0)
    );

    CREATE INDEX IF NOT EXISTS idx_stripe_customers_org
      ON stripe_customers(org_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_stripe_customers_email
      ON stripe_customers(email);
    CREATE INDEX IF NOT EXISTS idx_stripe_subscriptions_customer_status
      ON stripe_subscriptions(stripe_customer_id, status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_stripe_subscriptions_org_status
      ON stripe_subscriptions(org_id, status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_status_received
      ON stripe_webhook_events(processing_status, received_at DESC);
    CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_type_received
      ON stripe_webhook_events(event_type, received_at DESC);
  `);
}

export function createStripeBillingRepository(
  db: Database.Database = getHostedDb(),
): StripeBillingRepository {
  initStripeBillingTables(db);

  const getStripeCustomer = (stripeCustomerId: string): StripeCustomer | null =>
    (db
      .prepare("SELECT * FROM stripe_customers WHERE stripe_customer_id = ?")
      .get(stripeCustomerId) as StripeCustomer | null) ?? null;

  const getStripeSubscription = (
    stripeSubscriptionId: string,
  ): StripeSubscription | null =>
    (db
      .prepare(
        "SELECT * FROM stripe_subscriptions WHERE stripe_subscription_id = ?",
      )
      .get(stripeSubscriptionId) as StripeSubscription | null) ?? null;

  const getStripeWebhookEvent = (
    stripeEventId: string,
  ): StripeWebhookEvent | null =>
    (db
      .prepare("SELECT * FROM stripe_webhook_events WHERE stripe_event_id = ?")
      .get(stripeEventId) as StripeWebhookEvent | null) ?? null;

  return {
    upsertStripeCustomer(input) {
      const stripeCustomerId = requireNonBlank(
        input.stripeCustomerId,
        "stripeCustomerId",
      );
      const createdAt = isoNow(input.createdAt);
      const updatedAt = input.updatedAt ? isoNow(input.updatedAt) : createdAt;

      db.prepare(
        `INSERT INTO stripe_customers
         (stripe_customer_id, org_id, email, name, livemode, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(stripe_customer_id)
         DO UPDATE SET
           org_id = excluded.org_id,
           email = excluded.email,
           name = excluded.name,
           livemode = excluded.livemode,
           metadata = excluded.metadata,
           updated_at = excluded.updated_at`,
      ).run(
        stripeCustomerId,
        input.orgId || "",
        input.email || "",
        input.name || "",
        boolInt(input.livemode),
        toJson(input.metadata),
        createdAt,
        updatedAt,
      );

      return getStripeCustomer(stripeCustomerId)!;
    },

    getStripeCustomer(stripeCustomerId) {
      return getStripeCustomer(
        requireNonBlank(stripeCustomerId, "stripeCustomerId"),
      );
    },

    upsertStripeSubscription(input) {
      const stripeSubscriptionId = requireNonBlank(
        input.stripeSubscriptionId,
        "stripeSubscriptionId",
      );
      const stripeCustomerId = requireNonBlank(
        input.stripeCustomerId,
        "stripeCustomerId",
      );
      const status = requireNonBlank(input.status, "status");
      const createdAt = isoNow(input.createdAt);
      const updatedAt = input.updatedAt ? isoNow(input.updatedAt) : createdAt;

      db.prepare(
        `INSERT INTO stripe_subscriptions
         (stripe_subscription_id, org_id, stripe_customer_id, status, stripe_price_id,
          stripe_product_id, cancel_at_period_end, current_period_start, current_period_end,
          trial_start, trial_end, canceled_at, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(stripe_subscription_id)
         DO UPDATE SET
           org_id = excluded.org_id,
           stripe_customer_id = excluded.stripe_customer_id,
           status = excluded.status,
           stripe_price_id = excluded.stripe_price_id,
           stripe_product_id = excluded.stripe_product_id,
           cancel_at_period_end = excluded.cancel_at_period_end,
           current_period_start = excluded.current_period_start,
           current_period_end = excluded.current_period_end,
           trial_start = excluded.trial_start,
           trial_end = excluded.trial_end,
           canceled_at = excluded.canceled_at,
           metadata = excluded.metadata,
           updated_at = excluded.updated_at`,
      ).run(
        stripeSubscriptionId,
        input.orgId || "",
        stripeCustomerId,
        status,
        input.stripePriceId || "",
        input.stripeProductId || "",
        boolInt(input.cancelAtPeriodEnd),
        optionalIso(input.currentPeriodStart),
        optionalIso(input.currentPeriodEnd),
        optionalIso(input.trialStart),
        optionalIso(input.trialEnd),
        optionalIso(input.canceledAt),
        toJson(input.metadata),
        createdAt,
        updatedAt,
      );

      return getStripeSubscription(stripeSubscriptionId)!;
    },

    getStripeSubscription(stripeSubscriptionId) {
      return getStripeSubscription(
        requireNonBlank(stripeSubscriptionId, "stripeSubscriptionId"),
      );
    },

    recordStripeWebhookEvent(input) {
      const stripeEventId = requireNonBlank(
        input.stripeEventId,
        "stripeEventId",
      );
      const receivedAt = isoNow(input.receivedAt);

      db.prepare(
        `INSERT INTO stripe_webhook_events
         (stripe_event_id, event_type, api_version, livemode, payload, received_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(stripe_event_id) DO NOTHING`,
      ).run(
        stripeEventId,
        requireNonBlank(input.eventType, "eventType"),
        input.apiVersion || "",
        boolInt(input.livemode),
        toJson(input.payload),
        receivedAt,
        receivedAt,
      );

      return getStripeWebhookEvent(stripeEventId)!;
    },

    getStripeWebhookEvent(stripeEventId) {
      return getStripeWebhookEvent(
        requireNonBlank(stripeEventId, "stripeEventId"),
      );
    },

    markStripeWebhookEventProcessed(input) {
      const stripeEventId = requireNonBlank(
        input.stripeEventId,
        "stripeEventId",
      );
      const now = isoNow(input.now);
      const current = getStripeWebhookEvent(stripeEventId);
      if (!current) return null;
      if (current.processing_status === "processed") return current;

      db.prepare(
        `UPDATE stripe_webhook_events
         SET processing_status = 'processed',
             processing_attempts = processing_attempts + 1,
             last_error = '',
             processed_at = ?,
             failed_at = NULL,
             updated_at = ?
         WHERE stripe_event_id = ?`,
      ).run(now, now, stripeEventId);

      return getStripeWebhookEvent(stripeEventId);
    },

    markStripeWebhookEventFailed(input) {
      const stripeEventId = requireNonBlank(
        input.stripeEventId,
        "stripeEventId",
      );
      const error = requireNonBlank(input.error, "error");
      const now = isoNow(input.now);
      const current = getStripeWebhookEvent(stripeEventId);
      if (!current) return null;

      db.prepare(
        `UPDATE stripe_webhook_events
         SET processing_status = 'failed',
             processing_attempts = processing_attempts + 1,
             last_error = ?,
             failed_at = ?,
             updated_at = ?
         WHERE stripe_event_id = ?`,
      ).run(error, now, now, stripeEventId);

      return getStripeWebhookEvent(stripeEventId);
    },

    deriveStripeEntitlementState(input) {
      requireLookupTarget(input);

      const where: string[] = [];
      const params: string[] = [];
      if (input.orgId?.trim()) {
        where.push("org_id = ?");
        params.push(input.orgId.trim());
      }
      if (input.stripeCustomerId?.trim()) {
        where.push("stripe_customer_id = ?");
        params.push(input.stripeCustomerId.trim());
      }

      const row = db
        .prepare(
          `SELECT *
           FROM stripe_subscriptions
           WHERE (${where.join(" OR ")})
             AND status IN ('active', 'trialing')
           ORDER BY
             CASE status
               WHEN 'active' THEN 0
               WHEN 'trialing' THEN 1
               ELSE 2
             END ASC,
             COALESCE(current_period_end, '') DESC,
             updated_at DESC
           LIMIT 1`,
        )
        .get(...params) as StripeSubscription | undefined;

      if (!row) {
        return {
          entitled: false,
          status: "inactive",
          orgId: input.orgId?.trim() || "",
          stripeCustomerId: input.stripeCustomerId?.trim() || null,
          stripeSubscriptionId: null,
          stripePriceId: null,
          stripeProductId: null,
          currentPeriodEnd: null,
          trialEnd: null,
        };
      }

      return {
        entitled: true,
        status: row.status === "active" ? "active" : "trialing",
        orgId: row.org_id,
        stripeCustomerId: row.stripe_customer_id,
        stripeSubscriptionId: row.stripe_subscription_id,
        stripePriceId: row.stripe_price_id || null,
        stripeProductId: row.stripe_product_id || null,
        currentPeriodEnd: row.current_period_end,
        trialEnd: row.trial_end,
      };
    },
  };
}

export const stripeBillingRepository = createStripeBillingRepository();

export const {
  deriveStripeEntitlementState,
  getStripeCustomer,
  getStripeSubscription,
  getStripeWebhookEvent,
  markStripeWebhookEventFailed,
  markStripeWebhookEventProcessed,
  recordStripeWebhookEvent,
  upsertStripeCustomer,
  upsertStripeSubscription,
} = stripeBillingRepository;
