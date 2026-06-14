import type { EnqueueJobInput, Job, JobRepository } from "./jobs.js";
import { jobRepository } from "./jobs.js";
import type { StripeEntitlementState } from "./stripe-billing.js";

export const BILLING_RECONCILIATION_JOB_TYPE = "billing.reconciliation";
export const BILLING_RECONCILIATION_QUEUE = "billing";

type ReconciliationStatus = StripeEntitlementState["status"];

export interface ExpectedEntitlementState {
  entitled: boolean;
  status: ReconciliationStatus;
  orgId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
  stripeProductId: string | null;
  currentPeriodEnd: string | null;
  trialEnd: string | null;
}

export interface BillingReconciliationJobPayload extends Record<
  string,
  unknown
> {
  reconciliationKey: string;
  orgId: string | null;
  stripeCustomerId: string | null;
}

export interface EnqueueBillingReconciliationJobInput {
  reconciliationKey: string;
  orgId?: string;
  stripeCustomerId?: string;
  tenantId?: string;
  workspaceId?: string;
  brandId?: string;
  agentId?: string;
  runAt?: EnqueueJobInput["runAt"];
  maxAttempts?: number;
}

export interface BillingReconciliationSnapshot {
  stripe: StripeEntitlementState | null;
  expected: ExpectedEntitlementState | null;
}

export type BillingReconciliationSnapshotProvider = (
  payload: BillingReconciliationJobPayload,
) => BillingReconciliationSnapshot[] | Promise<BillingReconciliationSnapshot[]>;

export type BillingReconciliationField =
  | "entitled"
  | "status"
  | "orgId"
  | "stripeCustomerId"
  | "stripeSubscriptionId"
  | "stripePriceId"
  | "stripeProductId"
  | "currentPeriodEnd"
  | "trialEnd";

export interface BillingReconciliationMismatch {
  scopeKey: string;
  kind: "missing_stripe_state" | "missing_expected_state" | "field_mismatch";
  differingFields: BillingReconciliationField[];
  stripe: StripeEntitlementState | null;
  expected: ExpectedEntitlementState | null;
}

export interface BillingReconciliationResult {
  job: BillingReconciliationJobPayload;
  checkedCount: number;
  matchedCount: number;
  missingCount: number;
  mismatchedCount: number;
  mismatches: BillingReconciliationMismatch[];
}

function requireNonBlank(value: string | undefined, field: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`Billing reconciliation ${field} is required`);
  }
  return trimmed;
}

function normalizeOptional(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function requireLookupTarget(input: {
  orgId?: string | null;
  stripeCustomerId?: string | null;
}): void {
  if (
    normalizeOptional(input.orgId) ||
    normalizeOptional(input.stripeCustomerId)
  ) {
    return;
  }
  throw new Error("Billing reconciliation requires orgId or stripeCustomerId");
}

function buildScopeKey(target: {
  orgId?: string | null;
  stripeCustomerId?: string | null;
}): string {
  const orgId = normalizeOptional(target.orgId);
  const stripeCustomerId = normalizeOptional(target.stripeCustomerId);
  const parts: string[] = [];
  if (orgId) parts.push(`org:${orgId}`);
  if (stripeCustomerId) parts.push(`stripeCustomer:${stripeCustomerId}`);
  return parts.join(":");
}

function normalizeState(
  state: StripeEntitlementState | ExpectedEntitlementState,
): ExpectedEntitlementState {
  return {
    entitled: Boolean(state.entitled),
    status: state.status,
    orgId: state.orgId.trim(),
    stripeCustomerId: normalizeOptional(state.stripeCustomerId),
    stripeSubscriptionId: normalizeOptional(state.stripeSubscriptionId),
    stripePriceId: normalizeOptional(state.stripePriceId),
    stripeProductId: normalizeOptional(state.stripeProductId),
    currentPeriodEnd: normalizeOptional(state.currentPeriodEnd),
    trialEnd: normalizeOptional(state.trialEnd),
  };
}

function findDifferingFields(
  stripe: ExpectedEntitlementState,
  expected: ExpectedEntitlementState,
): BillingReconciliationField[] {
  const differingFields: BillingReconciliationField[] = [];
  const fields: BillingReconciliationField[] = [
    "entitled",
    "status",
    "orgId",
    "stripeCustomerId",
    "stripeSubscriptionId",
    "stripePriceId",
    "stripeProductId",
    "currentPeriodEnd",
    "trialEnd",
  ];

  for (const field of fields) {
    if (stripe[field] !== expected[field]) {
      differingFields.push(field);
    }
  }

  return differingFields;
}

export function buildBillingReconciliationIdempotencyKey(
  input: Pick<
    EnqueueBillingReconciliationJobInput,
    "reconciliationKey" | "orgId" | "stripeCustomerId"
  >,
): string {
  const reconciliationKey = requireNonBlank(
    input.reconciliationKey,
    "reconciliationKey",
  );
  requireLookupTarget(input);
  return `billing-reconciliation:${reconciliationKey}:${buildScopeKey(input)}`;
}

export function enqueueBillingReconciliationJob(
  input: EnqueueBillingReconciliationJobInput,
  repository: Pick<JobRepository, "enqueueJob"> = jobRepository,
): Job {
  const payload: BillingReconciliationJobPayload = {
    reconciliationKey: requireNonBlank(
      input.reconciliationKey,
      "reconciliationKey",
    ),
    orgId: normalizeOptional(input.orgId),
    stripeCustomerId: normalizeOptional(input.stripeCustomerId),
  };
  requireLookupTarget(payload);

  return repository.enqueueJob({
    idempotencyKey: buildBillingReconciliationIdempotencyKey(input),
    type: BILLING_RECONCILIATION_JOB_TYPE,
    queue: BILLING_RECONCILIATION_QUEUE,
    tenantId: input.tenantId,
    orgId: payload.orgId || undefined,
    workspaceId: input.workspaceId,
    brandId: input.brandId,
    agentId: input.agentId,
    payload,
    runAt: input.runAt,
    maxAttempts: input.maxAttempts,
  });
}

export async function handleBillingReconciliation(
  payload: BillingReconciliationJobPayload,
  loadSnapshots: BillingReconciliationSnapshotProvider,
): Promise<BillingReconciliationResult> {
  requireNonBlank(payload.reconciliationKey, "reconciliationKey");
  requireLookupTarget(payload);

  const snapshots = await loadSnapshots({
    reconciliationKey: payload.reconciliationKey.trim(),
    orgId: normalizeOptional(payload.orgId),
    stripeCustomerId: normalizeOptional(payload.stripeCustomerId),
  });

  let matchedCount = 0;
  let missingCount = 0;
  let mismatchedCount = 0;
  const mismatches: BillingReconciliationMismatch[] = [];

  for (const snapshot of snapshots) {
    const stripe = snapshot.stripe ? normalizeState(snapshot.stripe) : null;
    const expected = snapshot.expected
      ? normalizeState(snapshot.expected)
      : null;
    const scopeKey = buildScopeKey({
      orgId: stripe?.orgId || expected?.orgId || payload.orgId,
      stripeCustomerId:
        stripe?.stripeCustomerId ||
        expected?.stripeCustomerId ||
        payload.stripeCustomerId,
    });

    if (!stripe || !expected) {
      missingCount += 1;
      mismatches.push({
        scopeKey,
        kind: stripe ? "missing_expected_state" : "missing_stripe_state",
        differingFields: [],
        stripe: snapshot.stripe,
        expected: snapshot.expected,
      });
      continue;
    }

    const differingFields = findDifferingFields(stripe, expected);
    if (differingFields.length === 0) {
      matchedCount += 1;
      continue;
    }

    mismatchedCount += 1;
    mismatches.push({
      scopeKey,
      kind: "field_mismatch",
      differingFields,
      stripe: snapshot.stripe,
      expected: snapshot.expected,
    });
  }

  return {
    job: {
      reconciliationKey: payload.reconciliationKey.trim(),
      orgId: normalizeOptional(payload.orgId),
      stripeCustomerId: normalizeOptional(payload.stripeCustomerId),
    },
    checkedCount: snapshots.length,
    matchedCount,
    missingCount,
    mismatchedCount,
    mismatches,
  };
}
