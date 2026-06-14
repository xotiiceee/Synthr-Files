import type Database from "better-sqlite3";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Hono } from "hono";

import { getHostedDb } from "./db.js";
import {
  createStripeBillingRepository,
  type StripeBillingRepository,
} from "./stripe-billing.js";

const DEFAULT_STRIPE_TOLERANCE_SECONDS = 300;

type JsonRecord = Record<string, unknown>;

export interface StripeWebhookEnvelope {
  id: string;
  type: string;
  api_version?: string;
  livemode?: boolean;
  data?: {
    object?: JsonRecord;
  };
}

export interface VerifyStripeWebhookSignatureOptions {
  payload: string;
  signatureHeader?: string | null;
  secret: string;
  nowMs?: number;
  toleranceSeconds?: number;
}

export interface HandleStripeWebhookInput {
  payload: string;
  signatureHeader?: string | null;
  secret?: string | null;
  nowMs?: number;
  toleranceSeconds?: number;
  db?: Database.Database;
  repository?: StripeBillingRepository;
}

export interface RegisterStripeWebhookRouteOptions {
  secret?: string | null;
  nowMs?: number;
  toleranceSeconds?: number;
  db?: Database.Database;
  repository?: StripeBillingRepository;
}

export interface HandleStripeWebhookResult {
  ok: boolean;
  status: number;
  duplicate: boolean;
  eventId?: string;
  eventType?: string;
  error?: string;
}

class StripeWebhookError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function registerStripeWebhookRoute(
  app: Hono,
  options: RegisterStripeWebhookRouteOptions = {},
): void {
  app.post("/webhooks/stripe", async (c) => {
    const result = await handleStripeWebhook({
      payload: await c.req.text(),
      signatureHeader: c.req.header("Stripe-Signature"),
      secret: options.secret ?? process.env.STRIPE_WEBHOOK_SECRET,
      nowMs: options.nowMs,
      toleranceSeconds: options.toleranceSeconds,
      db: options.db,
      repository: options.repository,
    });

    return c.json(
      result.ok
        ? {
            ok: true,
            duplicate: result.duplicate,
            eventId: result.eventId,
            eventType: result.eventType,
          }
        : {
            ok: false,
            error: result.error || "Stripe webhook processing failed",
            eventId: result.eventId,
            eventType: result.eventType,
          },
      result.status as 200 | 400 | 500,
    );
  });
}

export async function handleStripeWebhook(
  input: HandleStripeWebhookInput,
): Promise<HandleStripeWebhookResult> {
  try {
    const event = parseStripeWebhookEnvelope(
      input.secret?.trim()
        ? constructStripeWebhookEvent({
            payload: input.payload,
            signatureHeader: input.signatureHeader,
            secret: input.secret.trim(),
            nowMs: input.nowMs,
            toleranceSeconds: input.toleranceSeconds,
          })
        : input.payload,
    );

    const db = input.db ?? getHostedDb();
    const repository =
      input.repository ?? createStripeBillingRepository(db);

    const recorded = repository.recordStripeWebhookEvent({
      stripeEventId: event.id,
      eventType: event.type,
      apiVersion: event.api_version || "",
      livemode: Boolean(event.livemode),
      payload: event as unknown as Record<string, unknown>,
    });

    if (recorded.processing_status === "processed") {
      return {
        ok: true,
        status: 200,
        duplicate: true,
        eventId: event.id,
        eventType: event.type,
      };
    }

    const applyInTransaction = db.transaction(() => {
      applyStripeWebhookEvent(repository, event);
      repository.markStripeWebhookEventProcessed({
        stripeEventId: event.id,
      });
    });

    try {
      applyInTransaction();
      return {
        ok: true,
        status: 200,
        duplicate: false,
        eventId: event.id,
        eventType: event.type,
      };
    } catch (error) {
      repository.markStripeWebhookEventFailed({
        stripeEventId: event.id,
        error: summarizeError(error),
      });
      return {
        ok: false,
        status: 500,
        duplicate: false,
        eventId: event.id,
        eventType: event.type,
        error: summarizeError(error),
      };
    }
  } catch (error) {
    if (error instanceof StripeWebhookError) {
      return {
        ok: false,
        status: error.status,
        duplicate: false,
        error: error.message,
      };
    }

    return {
      ok: false,
      status: 500,
      duplicate: false,
      error: summarizeError(error),
    };
  }
}

export function constructStripeWebhookEvent(
  options: VerifyStripeWebhookSignatureOptions,
): string {
  const secret = options.secret.trim();
  if (!secret) {
    throw new StripeWebhookError(
      500,
      "MISSING_STRIPE_WEBHOOK_SECRET",
      "Stripe webhook secret is required for signature verification.",
    );
  }

  const parsedSignature = parseStripeSignatureHeader(options.signatureHeader);
  const toleranceSeconds =
    options.toleranceSeconds ?? DEFAULT_STRIPE_TOLERANCE_SECONDS;

  if (toleranceSeconds > 0) {
    const ageSeconds = Math.abs(
      (options.nowMs ?? Date.now()) / 1000 - parsedSignature.timestamp,
    );
    if (ageSeconds > toleranceSeconds) {
      throw new StripeWebhookError(
        400,
        "STRIPE_SIGNATURE_EXPIRED",
        "Stripe webhook signature timestamp is outside the allowed tolerance.",
      );
    }
  }

  const signedPayload = `${parsedSignature.timestamp}.${options.payload}`;
  const expected = createHmac("sha256", secret)
    .update(signedPayload, "utf8")
    .digest("hex");

  const verified = parsedSignature.signatures.some((candidate) =>
    secureCompareHex(candidate, expected),
  );

  if (!verified) {
    throw new StripeWebhookError(
      400,
      "INVALID_STRIPE_SIGNATURE",
      "Stripe webhook signature verification failed.",
    );
  }

  return options.payload;
}

export function applyStripeWebhookEvent(
  repository: StripeBillingRepository,
  event: StripeWebhookEnvelope,
): void {
  const object = getEventObject(event);

  switch (event.type) {
    case "customer.created":
    case "customer.updated":
    case "customer.deleted":
      upsertCustomerFromStripeObject(repository, object, event);
      return;
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      upsertSubscriptionFromStripeObject(repository, object, event);
      return;
    default:
      return;
  }
}

function parseStripeWebhookEnvelope(payload: string): StripeWebhookEnvelope {
  let parsed: unknown;

  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new StripeWebhookError(
      400,
      "INVALID_STRIPE_PAYLOAD",
      "Stripe webhook payload must be valid JSON.",
    );
  }

  if (!parsed || typeof parsed !== "object") {
    throw new StripeWebhookError(
      400,
      "INVALID_STRIPE_PAYLOAD",
      "Stripe webhook payload must be a JSON object.",
    );
  }

  const record = parsed as JsonRecord;
  const id = asNonBlankString(record.id);
  const type = asNonBlankString(record.type);

  if (!id || !type) {
    throw new StripeWebhookError(
      400,
      "INVALID_STRIPE_EVENT",
      "Stripe webhook payload is missing an event id or type.",
    );
  }

  return {
    id,
    type,
    api_version: asOptionalString(record.api_version),
    livemode: typeof record.livemode === "boolean" ? record.livemode : false,
    data:
      record.data && typeof record.data === "object"
        ? (record.data as StripeWebhookEnvelope["data"])
        : undefined,
  };
}

function parseStripeSignatureHeader(
  signatureHeader?: string | null,
): { timestamp: number; signatures: string[] } {
  if (!signatureHeader?.trim()) {
    throw new StripeWebhookError(
      400,
      "MISSING_STRIPE_SIGNATURE",
      "Stripe-Signature header is required.",
    );
  }

  let timestamp = 0;
  const signatures: string[] = [];
  for (const part of signatureHeader.split(",")) {
    const [key, value] = part.split("=", 2).map((entry) => entry.trim());
    if (!key || !value) continue;
    if (key === "t") {
      timestamp = Number(value);
      continue;
    }
    if (key === "v1") signatures.push(value);
  }

  if (!Number.isFinite(timestamp) || timestamp <= 0 || signatures.length === 0) {
    throw new StripeWebhookError(
      400,
      "INVALID_STRIPE_SIGNATURE",
      "Stripe-Signature header is malformed.",
    );
  }

  return { timestamp, signatures };
}

function secureCompareHex(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  if (leftBuffer.length === 0 || leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function getEventObject(event: StripeWebhookEnvelope): JsonRecord {
  const object = event.data?.object;
  if (!object || typeof object !== "object") {
    throw new Error(
      `Stripe webhook ${event.id} (${event.type}) is missing data.object`,
    );
  }
  return object;
}

function upsertCustomerFromStripeObject(
  repository: StripeBillingRepository,
  object: JsonRecord,
  event: StripeWebhookEnvelope,
): void {
  const stripeCustomerId = asNonBlankString(object.id);
  if (!stripeCustomerId) {
    throw new Error(`Stripe webhook ${event.id} customer object is missing id`);
  }

  const current = repository.getStripeCustomer(stripeCustomerId);
  const metadata = asRecord(object.metadata);
  repository.upsertStripeCustomer({
    stripeCustomerId,
    orgId:
      resolveOrgId(metadata) ||
      current?.org_id ||
      "",
    email:
      asOptionalString(object.email) ??
      current?.email ??
      "",
    name:
      asOptionalString(object.name) ??
      current?.name ??
      "",
    livemode:
      typeof object.livemode === "boolean"
        ? object.livemode
        : Boolean(current?.livemode),
    metadata:
      Object.keys(metadata).length > 0
        ? metadata
        : safeParseJsonRecord(current?.metadata),
  });
}

function upsertSubscriptionFromStripeObject(
  repository: StripeBillingRepository,
  object: JsonRecord,
  event: StripeWebhookEnvelope,
): void {
  const stripeSubscriptionId = asNonBlankString(object.id);
  if (!stripeSubscriptionId) {
    throw new Error(
      `Stripe webhook ${event.id} subscription object is missing id`,
    );
  }

  const stripeCustomerId = extractStripeCustomerId(object.customer);
  if (!stripeCustomerId) {
    throw new Error(
      `Stripe webhook ${event.id} subscription ${stripeSubscriptionId} is missing customer id`,
    );
  }

  const status =
    event.type === "customer.subscription.deleted"
      ? "canceled"
      : asNonBlankString(object.status);
  if (!status) {
    throw new Error(
      `Stripe webhook ${event.id} subscription ${stripeSubscriptionId} is missing status`,
    );
  }

  const currentCustomer = repository.getStripeCustomer(stripeCustomerId);
  const customerObject =
    object.customer && typeof object.customer === "object"
      ? (object.customer as JsonRecord)
      : null;
  const metadata = asRecord(object.metadata);
  const orgId =
    resolveOrgId(
      metadata,
      customerObject ? asRecord(customerObject.metadata) : {},
    ) ||
    currentCustomer?.org_id ||
    repository.getStripeSubscription(stripeSubscriptionId)?.org_id ||
    "";

  repository.upsertStripeCustomer({
    stripeCustomerId,
    orgId,
    email:
      (customerObject && asOptionalString(customerObject.email)) ??
      currentCustomer?.email ??
      "",
    name:
      (customerObject && asOptionalString(customerObject.name)) ??
      currentCustomer?.name ??
      "",
    livemode:
      typeof object.livemode === "boolean"
        ? object.livemode
        : Boolean(currentCustomer?.livemode),
    metadata:
      customerObject
        ? asRecord(customerObject.metadata)
        : safeParseJsonRecord(currentCustomer?.metadata),
  });

  const price = extractStripePrice(object);
  repository.upsertStripeSubscription({
    stripeSubscriptionId,
    orgId,
    stripeCustomerId,
    status,
    stripePriceId: asOptionalString(price?.id) || "",
    stripeProductId: extractStripeProductId(price),
    cancelAtPeriodEnd: Boolean(object.cancel_at_period_end),
    currentPeriodStart: unixSecondsToIso(object.current_period_start),
    currentPeriodEnd: unixSecondsToIso(object.current_period_end),
    trialStart: unixSecondsToIso(object.trial_start),
    trialEnd: unixSecondsToIso(object.trial_end),
    canceledAt: unixSecondsToIso(object.canceled_at),
    metadata,
  });
}

function extractStripeCustomerId(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object") {
    return asNonBlankString((value as JsonRecord).id);
  }
  return null;
}

function extractStripePrice(object: JsonRecord): JsonRecord | null {
  const items = object.items;
  if (!items || typeof items !== "object") return null;
  const data = (items as JsonRecord).data;
  if (!Array.isArray(data) || data.length === 0) return null;
  const first = data[0];
  if (!first || typeof first !== "object") return null;
  const price = (first as JsonRecord).price;
  return price && typeof price === "object" ? (price as JsonRecord) : null;
}

function extractStripeProductId(price: JsonRecord | null): string {
  if (!price) return "";
  const product = price.product;
  if (typeof product === "string") return product;
  if (product && typeof product === "object") {
    return asNonBlankString((product as JsonRecord).id) || "";
  }
  return "";
}

function unixSecondsToIso(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return new Date(value * 1000).toISOString();
}

function resolveOrgId(...metadataRecords: JsonRecord[]): string | null {
  for (const metadata of metadataRecords) {
    const orgId =
      asOptionalString(metadata.orgId) ||
      asOptionalString(metadata.org_id) ||
      asOptionalString(metadata.organizationId) ||
      asOptionalString(metadata.pulseOrgId);
    if (orgId) return orgId;
  }
  return null;
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function safeParseJsonRecord(value?: string): JsonRecord {
  if (!value?.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return asRecord(parsed);
  } catch {
    return {};
  }
}

function asNonBlankString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function summarizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
