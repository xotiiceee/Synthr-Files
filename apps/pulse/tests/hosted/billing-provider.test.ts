import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cleanupSqliteFiles, createTempHostedDbPath } from "./temp-db.js";

const mocks = vi.hoisted(() => ({
  checkCredits: vi.fn(),
  deductPulseCredits: vi.fn(),
}));

vi.mock("../../hosted/auth.js", () => ({
  checkCredits: mocks.checkCredits,
  deductPulseCredits: mocks.deductPulseCredits,
}));

const dbPath = createTempHostedDbPath("pulse-billing-provider");
process.env.HOSTED_DB_PATH = dbPath;

const { createOrg, createTenant } = await import("../../hosted/db.js");
const {
  BILLING_PROVIDER_ENV,
  BILLING_PROVIDER_NAMES,
  STRIPE_BILLING_NOT_ENTITLED_ERROR,
  getBillingProvider,
  resolveBillingProviderName,
} = await import("../../hosted/billing-provider.js");
const { upsertStripeCustomer, upsertStripeSubscription } =
  await import("../../hosted/stripe-billing.js");

const originalProvider = process.env[BILLING_PROVIDER_ENV];

describe("billing provider skeleton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env[BILLING_PROVIDER_ENV];
  });

  afterEach(() => {
    if (originalProvider === undefined) {
      delete process.env[BILLING_PROVIDER_ENV];
    } else {
      process.env[BILLING_PROVIDER_ENV] = originalProvider;
    }
  });

  it("defaults to the ClawNet billing provider", async () => {
    mocks.checkCredits.mockResolvedValue(10);
    mocks.deductPulseCredits.mockResolvedValue({ ok: true, remaining: 8 });

    const provider = getBillingProvider();

    expect(provider.name).toBe("clawnet");
    expect(provider.isEnabled()).toBe(true);
    await expect(provider.checkBalance("cn-key")).resolves.toBe(10);
    await expect(provider.canAfford("cn-key", 9)).resolves.toBe(true);
    await expect(provider.deduct("cn-key", 2, "test")).resolves.toEqual({
      ok: true,
      remaining: 8,
    });
    expect(mocks.checkCredits).toHaveBeenCalledWith("cn-key");
    expect(mocks.deductPulseCredits).toHaveBeenCalledWith("cn-key", 2, "test");
  });

  it("resolves only supported billing provider names", () => {
    expect(BILLING_PROVIDER_NAMES).toEqual(["clawnet", "stripe"]);
    expect(resolveBillingProviderName("clawnet")).toBe("clawnet");
    expect(resolveBillingProviderName("stripe")).toBe("stripe");
    expect(() => resolveBillingProviderName("paypal")).toThrow(
      'Unknown BILLING_PROVIDER="paypal"',
    );
  });

  it("uses active Stripe subscription entitlements for standalone billing", async () => {
    process.env[BILLING_PROVIDER_ENV] = "stripe";
    const tenant = createTenant(
      "cn-stripe-provider",
      "claw-stripe-provider",
      "stripe-provider@example.test",
      "Stripe Provider",
    );
    const org = createOrg({
      name: "Stripe Provider Org",
      legacyTenantId: tenant.id,
    });
    upsertStripeCustomer({
      stripeCustomerId: "cus_provider_active",
      orgId: org.id,
      email: "billing@example.test",
    });
    upsertStripeSubscription({
      stripeSubscriptionId: "sub_provider_active",
      orgId: org.id,
      stripeCustomerId: "cus_provider_active",
      status: "active",
      stripePriceId: "price_10_monthly",
      stripeProductId: "prod_pulse",
    });

    const provider = getBillingProvider();

    expect(provider.name).toBe("stripe");
    expect(provider.isEnabled()).toBe(true);
    await expect(provider.canAfford(tenant.id, 999)).resolves.toBe(true);
    await expect(provider.checkBalance(tenant.api_key)).resolves.toBe(
      Number.MAX_SAFE_INTEGER,
    );
    await expect(provider.deduct(tenant.id, 1, "test")).resolves.toEqual({
      ok: true,
      remaining: Number.MAX_SAFE_INTEGER,
    });
    expect(mocks.checkCredits).not.toHaveBeenCalled();
    expect(mocks.deductPulseCredits).not.toHaveBeenCalled();
  });

  it("fails Stripe billing closed when no active entitlement exists", async () => {
    process.env[BILLING_PROVIDER_ENV] = "stripe";
    const provider = getBillingProvider();

    await expect(provider.canAfford("tn_missing_entitlement", 1)).resolves.toBe(
      false,
    );
    await expect(provider.checkBalance("tn_missing_entitlement")).resolves.toBe(
      0,
    );
    await expect(
      provider.deduct("tn_missing_entitlement", 1, "test"),
    ).resolves.toEqual({
      ok: false,
      error: STRIPE_BILLING_NOT_ENTITLED_ERROR,
    });
    expect(mocks.checkCredits).not.toHaveBeenCalled();
    expect(mocks.deductPulseCredits).not.toHaveBeenCalled();
  });
});

process.on("exit", () => {
  cleanupSqliteFiles(dbPath);
});
