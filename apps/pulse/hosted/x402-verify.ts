import type { Context } from "hono";

const DEFAULT_FACILITATOR = "https://x402.org/facilitate";
const USDC_BASE_MAINNET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const CREDITS_PER_USD = 1000;
export const LEGACY_X402_FLAG = "PULSE_ENABLE_LEGACY_X402";

interface PaymentPayload {
  [key: string]: unknown;
}

interface PaymentRequirements {
  scheme: "exact";
  network: "base";
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
}

interface X402VerifyResult {
  isValid: boolean;
}

interface X402VerifyModule {
  useFacilitator(options: { url: `${string}://${string}` }): {
    verify(
      payload: PaymentPayload,
      requirements: PaymentRequirements,
    ): Promise<X402VerifyResult>;
  };
}

const importLegacyX402VerifyModule = new Function(
  "specifier",
  "return import(specifier);",
) as (specifier: string) => Promise<unknown>;

function isTruthyFlag(value: string | undefined): boolean {
  if (!value) return false;
  switch (value.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
      return true;
    default:
      return false;
  }
}

export function isLegacyX402Enabled(): boolean {
  return isTruthyFlag(process.env[LEGACY_X402_FLAG]);
}

const defaultLoadLegacyX402Verifier =
  async (): Promise<X402VerifyModule | null> => {
    if (!isLegacyX402Enabled()) return null;
    try {
      return (await importLegacyX402VerifyModule(
        "x402/verify",
      )) as X402VerifyModule;
    } catch {
      return null;
    }
  };

let loadLegacyX402VerifierImpl = defaultLoadLegacyX402Verifier;

export function setLegacyX402VerifierLoaderForTests(
  loader?: () => Promise<X402VerifyModule | null>,
): void {
  loadLegacyX402VerifierImpl = loader ?? defaultLoadLegacyX402Verifier;
}

export async function loadLegacyX402Verifier(): Promise<X402VerifyModule | null> {
  return loadLegacyX402VerifierImpl();
}

export async function canUseLegacyX402(): Promise<boolean> {
  if (!isLegacyX402Enabled()) return false;
  if (!process.env.X402_TREASURY_ADDRESS) return false;
  return (await loadLegacyX402Verifier()) !== null;
}

/**
 * Verify an x402 payment attached to the request.
 * Returns true only if the X-Payment header is present and validates against
 * the x402 facilitator. Never fulfills before verifying.
 */
export async function verifyX402Payment(
  c: Context,
  amountCredits: number,
): Promise<boolean> {
  const paymentHeader = c.req.header("X-Payment");
  if (!paymentHeader) return false;

  const treasuryAddress = process.env.X402_TREASURY_ADDRESS;
  if (!treasuryAddress) return false;
  if (!isLegacyX402Enabled()) return false;

  let payload: PaymentPayload;
  try {
    payload = JSON.parse(
      Buffer.from(paymentHeader, "base64").toString("utf-8"),
    ) as PaymentPayload;
  } catch {
    return false;
  }

  const x402 = await loadLegacyX402Verifier();
  if (!x402) return false;

  const facilitatorUrl = (process.env.X402_FACILITATOR_URL ??
    DEFAULT_FACILITATOR) as `${string}://${string}`;

  const { verify } = x402.useFacilitator({ url: facilitatorUrl });

  const amountUSDC = (amountCredits / CREDITS_PER_USD).toFixed(6);

  const requirements: PaymentRequirements = {
    scheme: "exact",
    network: "base",
    maxAmountRequired: amountUSDC,
    resource: c.req.url,
    description: "Pulse agent action",
    mimeType: "application/json",
    payTo: treasuryAddress,
    maxTimeoutSeconds: 300,
    asset: USDC_BASE_MAINNET,
  };

  try {
    const result = await verify(payload, requirements);
    return result.isValid;
  } catch {
    return false;
  }
}
