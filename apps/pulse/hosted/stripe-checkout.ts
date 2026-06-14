import { getSessionByToken } from "./sessions.js";
import { SESSION_COOKIE } from "./sessions.js";
import {
  getHostedDb,
  createOrg,
  listMembershipsForUser,
  addMembership,
  type User,
  type Org,
} from "./db.js";
import {
  stripeBillingRepository,
  type StripeCustomer,
} from "./stripe-billing.js";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? "";
const STRIPE_API = "https://api.stripe.com/v1";

const DEFAULT_PRICE_IDS: Record<string, string> = {
  starter: process.env.STRIPE_STARTER_PRICE_ID ?? "",
  growth: process.env.STRIPE_GROWTH_PRICE_ID ?? "",
  pro: process.env.STRIPE_PRO_PRICE_ID ?? "",
};

function readCookieValue(
  cookieHeader: string | undefined,
  cookieName: string,
): string | null {
  if (!cookieHeader) return null;
  for (const cookie of cookieHeader.split(";")) {
    const [name, ...valueParts] = cookie.trim().split("=");
    if (name !== cookieName) continue;
    const rawValue = valueParts.join("=");
    if (!rawValue) return null;
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }
  return null;
}

function getSessionUser(cookieHeader: string | undefined): User | null {
  const token = readCookieValue(cookieHeader, SESSION_COOKIE.name);
  if (!token) return null;

  const session = getSessionByToken(token);
  if (!session) return null;

  const stmt = getHostedDb()
    .prepare("SELECT * FROM users WHERE id = ?");
  return (stmt.get(session.user_id) as User | null) ?? null;
}

function resolveOrgForUser(userId: string): Org {
  const memberships = listMembershipsForUser(userId);
  if (memberships.length > 0) {
    const stmt = getHostedDb()
      .prepare("SELECT * FROM orgs WHERE id = ?");
    const org = stmt.get(memberships[0].org_id) as Org | null;
    if (org) return org;
  }

  const org = createOrg({
    name: "Default Workspace",
    billingEmail: "",
  });
  addMembership(org.id, userId, "owner");
  return org;
}

async function resolveOrCreateStripeCustomer(org: Org): Promise<StripeCustomer> {
  const existing = getHostedDb()
    .prepare("SELECT * FROM orgs WHERE id = ?")
    .get(org.id) as Org | null;

  if (!existing) throw new Error("Org not found");

  const entitlement = stripeBillingRepository.deriveStripeEntitlementState({ orgId: org.id });
  if (entitlement.stripeCustomerId) {
    const cust = stripeBillingRepository.getStripeCustomer(entitlement.stripeCustomerId);
    if (cust) return cust;
  }

  if (!STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }

  const body = new URLSearchParams({
    email: existing.billing_email || "",
    name: existing.name,
  });
  body.append("metadata[orgId]", org.id);

  const stripeCust = await stripeFetch("/customers", body);

  return stripeBillingRepository.upsertStripeCustomer({
    stripeCustomerId: stripeCust.id,
    orgId: org.id,
    email: existing.billing_email || "",
    name: existing.name,
  });
}

function stripeFetch(path: string, body: URLSearchParams): Promise<any> {
  if (!STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }

  return fetch(`${STRIPE_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  }).then((r) => r.json());
}

export async function createCheckoutSession(
  cookieHeader: string | undefined,
  priceId: string,
  baseUrl: string,
): Promise<{ url: string } | { error: string }> {
  const user = getSessionUser(cookieHeader);
  if (!user) return { error: "Not authenticated" };

  const org = resolveOrgForUser(user.id);
  const customer = await resolveOrCreateStripeCustomer(org);

  const resolvedPriceId = resolvePriceId(priceId);
  if (!resolvedPriceId) return { error: `No Stripe price configured for plan: ${priceId}` };

  const body = new URLSearchParams({
    "line_items[0][price]": resolvedPriceId,
    "line_items[0][quantity]": "1",
    mode: "subscription",
    customer: customer.stripe_customer_id,
    success_url: `${baseUrl.replace(/\/$/, "")}/billing?checkout=success`,
    cancel_url: `${baseUrl.replace(/\/$/, "")}/billing?checkout=cancelled`,
  });

  if (org.billing_email) {
    body.set("customer_email", org.billing_email);
  }

  try {
    const session = await stripeFetch("/checkout/sessions", body);
    if (session.url) return { url: session.url };
    return { error: session.error?.message ?? "Failed to create checkout session" };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Stripe API error" };
  }
}

export async function createPortalSession(
  cookieHeader: string | undefined,
  baseUrl: string,
): Promise<{ url: string } | { error: string }> {
  const user = getSessionUser(cookieHeader);
  if (!user) return { error: "Not authenticated" };

  const org = resolveOrgForUser(user.id);

  const stmt = getHostedDb()
    .prepare("SELECT * FROM orgs WHERE id = ?");
  const orgRow = stmt.get(org.id) as Org | null;

  const entitlement = stripeBillingRepository.deriveStripeEntitlementState({
    orgId: org.id,
    stripeCustomerId: orgRow ? undefined : undefined,
  });

  if (!entitlement.stripeCustomerId) {
    return { error: "No Stripe customer found. Start a subscription first." };
  }

  const body = new URLSearchParams({
    customer: entitlement.stripeCustomerId,
    return_url: `${baseUrl.replace(/\/$/, "")}/settings`,
  });

  try {
    const session = await stripeFetch("/billing_portal/sessions", body);
    if (session.url) return { url: session.url };
    return { error: session.error?.message ?? "Failed to create portal session" };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Stripe API error" };
  }
}

function resolvePriceId(id: string): string {
  const map: Record<string, string> = {
    starter: process.env.STRIPE_STARTER_PRICE_ID ?? "",
    growth: process.env.STRIPE_GROWTH_PRICE_ID ?? "",
    pro: process.env.STRIPE_PRO_PRICE_ID ?? "",
  };
  return map[id] || id;
}

export function getDefaultPriceIds(): Record<string, string> {
  return {
    starter: DEFAULT_PRICE_IDS.starter || process.env.STRIPE_STARTER_PRICE_ID || "",
    growth: DEFAULT_PRICE_IDS.growth || process.env.STRIPE_GROWTH_PRICE_ID || "",
    pro: DEFAULT_PRICE_IDS.pro || process.env.STRIPE_PRO_PRICE_ID || "",
  };
}
