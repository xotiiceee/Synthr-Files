import type { Context } from "hono";
import { canUseLegacyX402, isLegacyX402Enabled } from "./x402-verify.js";

const USDC_BASE_MAINNET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const CREDITS_PER_USD = 1000;

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

function createPlain402Response(c: Context): Response {
  return c.json(
    { error: "Insufficient credits", code: "INSUFFICIENT_CREDITS" },
    402,
  ) as Response;
}

/**
 * Return an HTTP 402 response conforming to the x402 spec.
 * Falls back to a plain JSON 402 if legacy x402 is disabled or unavailable.
 */
export async function createX402Response(
  c: Context,
  amountCredits: number,
): Promise<Response> {
  const treasuryAddress = process.env.X402_TREASURY_ADDRESS;

  if (!treasuryAddress) {
    console.warn(
      "[x402] X402_TREASURY_ADDRESS not set — falling back to plain 402",
    );
    return createPlain402Response(c);
  }

  if (!(await canUseLegacyX402())) {
    if (isLegacyX402Enabled()) {
      console.warn(
        "[x402] Legacy x402 requested but dependency is unavailable — falling back to plain 402",
      );
    }
    return createPlain402Response(c);
  }

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

  c.header("X-Payment-Required", JSON.stringify(requirements));
  return c.json(
    {
      error: "Payment required",
      code: "PAYMENT_REQUIRED",
      x402: true,
      requiredUSDC: amountUSDC,
    },
    402,
  ) as Response;
}
