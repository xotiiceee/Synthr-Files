import { checkCredits, deductPulseCredits } from "./auth.js";
import { resolveHostedTenantRuntimeContext } from "./brand-runtime-context.js";
import { getHostedDb } from "./db.js";
import { stripeBillingRepository } from "./stripe-billing.js";
import type {
  StripeBillingRepository,
  StripeEntitlementState,
} from "./stripe-billing.js";

export type BillingProviderName = "clawnet" | "stripe";

export const BILLING_PROVIDER_ENV = "BILLING_PROVIDER";
export const BILLING_PROVIDER_NAMES: BillingProviderName[] = [
  "clawnet",
  "stripe",
];
export const STRIPE_BILLING_NOT_ENTITLED_ERROR =
  "Stripe subscription entitlement is inactive";
const STRIPE_ENTITLED_BALANCE = Number.MAX_SAFE_INTEGER;

export interface BillingDeductResult {
  ok: boolean;
  remaining?: number;
  error?: string;
}

export interface BillingProvider {
  name: BillingProviderName;
  isEnabled(): boolean;
  deduct(
    apiKey: string,
    amount: number,
    reason: string,
  ): Promise<BillingDeductResult>;
  checkBalance(apiKey: string): Promise<number>;
  canAfford(apiKey: string, amount: number): Promise<boolean>;
}

class ClawNetBillingProvider implements BillingProvider {
  name: BillingProviderName = "clawnet";

  isEnabled(): boolean {
    return true;
  }

  deduct(
    apiKey: string,
    amount: number,
    reason: string,
  ): Promise<BillingDeductResult> {
    return deductPulseCredits(apiKey, amount, reason);
  }

  checkBalance(apiKey: string): Promise<number> {
    return checkCredits(apiKey);
  }

  async canAfford(apiKey: string, amount: number): Promise<boolean> {
    return (await this.checkBalance(apiKey)) >= amount;
  }
}

class StripeBillingProvider implements BillingProvider {
  name: BillingProviderName = "stripe";

  constructor(
    private readonly repository: StripeBillingRepository = stripeBillingRepository,
  ) {}

  isEnabled(): boolean {
    return true;
  }

  async deduct(subject: string): Promise<BillingDeductResult> {
    const entitlement = this.getEntitlement(subject);
    if (!entitlement.entitled) {
      return { ok: false, error: STRIPE_BILLING_NOT_ENTITLED_ERROR };
    }
    return { ok: true, remaining: STRIPE_ENTITLED_BALANCE };
  }

  async checkBalance(subject: string): Promise<number> {
    return this.getEntitlement(subject).entitled ? STRIPE_ENTITLED_BALANCE : 0;
  }

  async canAfford(subject: string): Promise<boolean> {
    return this.getEntitlement(subject).entitled;
  }

  private getEntitlement(subject: string): StripeEntitlementState {
    const lookup = resolveStripeBillingSubject(subject);
    return this.repository.deriveStripeEntitlementState(lookup);
  }
}

function resolveStripeBillingSubject(subject: string): {
  orgId?: string;
  stripeCustomerId?: string;
} {
  const normalized = subject.trim();
  if (!normalized) return { orgId: "__missing_billing_subject__" };
  if (normalized.startsWith("org_")) return { orgId: normalized };
  if (normalized.startsWith("cus_")) return { stripeCustomerId: normalized };

  const tenantId = normalized.startsWith("tn_")
    ? normalized
    : (
        getHostedDb()
          .prepare("SELECT id FROM tenants WHERE api_key = ?")
          .get(normalized) as { id: string } | undefined
      )?.id;

  if (!tenantId) return { orgId: "__unresolved_billing_subject__" };

  const context = resolveHostedTenantRuntimeContext({ tenantId });
  return { orgId: context.orgId ?? `__missing_org_for_${tenantId}__` };
}

export function resolveBillingProviderName(
  value = process.env[BILLING_PROVIDER_ENV] || "clawnet",
): BillingProviderName {
  if (value === "clawnet" || value === "stripe") return value;
  throw new Error(
    `Unknown ${BILLING_PROVIDER_ENV}="${value}". Expected one of: ${BILLING_PROVIDER_NAMES.join(", ")}`,
  );
}

export function getBillingProvider(
  name: BillingProviderName = resolveBillingProviderName(),
): BillingProvider {
  return name === "stripe"
    ? new StripeBillingProvider()
    : new ClawNetBillingProvider();
}
