import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const { mockCanUseLegacyX402, mockIsLegacyX402Enabled } = vi.hoisted(() => ({
  mockCanUseLegacyX402: vi.fn(),
  mockIsLegacyX402Enabled: vi.fn(() => false),
}));

vi.mock("../../hosted/x402-verify.js", () => ({
  canUseLegacyX402: mockCanUseLegacyX402,
  isLegacyX402Enabled: mockIsLegacyX402Enabled,
}));

import { createX402Response } from "../../hosted/x402-middleware.js";

function createMockContext(url: string = "http://localhost/v1/pulse/post") {
  const headers: Record<string, string> = {};
  return {
    req: { url },
    header: (name: string, value: string) => {
      headers[name] = value;
    },
    json: (body: any, status?: number) => ({
      _body: body,
      _status: status,
      _headers: headers,
    }),
    _headers: headers,
  } as any;
}

const USDC_BASE_MAINNET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

let savedTreasury: string | undefined;

beforeEach(() => {
  savedTreasury = process.env.X402_TREASURY_ADDRESS;
  vi.clearAllMocks();
  mockCanUseLegacyX402.mockResolvedValue(false);
  mockIsLegacyX402Enabled.mockReturnValue(false);
});

afterEach(() => {
  if (savedTreasury !== undefined)
    process.env.X402_TREASURY_ADDRESS = savedTreasury;
  else delete process.env.X402_TREASURY_ADDRESS;
});

describe("createX402Response — plain fallback paths", () => {
  it("returns 402 with INSUFFICIENT_CREDITS code when treasury address is missing", async () => {
    delete process.env.X402_TREASURY_ADDRESS;
    const c = createMockContext();
    const result = (await createX402Response(c, 10)) as any;
    expect(result._status).toBe(402);
    expect(result._body).toMatchObject({
      error: "Insufficient credits",
      code: "INSUFFICIENT_CREDITS",
    });
    expect(mockCanUseLegacyX402).not.toHaveBeenCalled();
  });

  it("does not set X-Payment-Required header when legacy x402 is disabled", async () => {
    process.env.X402_TREASURY_ADDRESS = "0xTestTreasuryAddress";
    const c = createMockContext();
    const result = (await createX402Response(c, 10)) as any;
    expect(result._headers["X-Payment-Required"]).toBeUndefined();
    expect(result._body.code).toBe("INSUFFICIENT_CREDITS");
  });

  it("falls back to plain 402 when legacy x402 is enabled but unavailable", async () => {
    process.env.X402_TREASURY_ADDRESS = "0xTestTreasuryAddress";
    mockCanUseLegacyX402.mockResolvedValue(false);
    mockIsLegacyX402Enabled.mockReturnValue(true);
    const c = createMockContext();
    const result = (await createX402Response(c, 10)) as any;
    expect(result._status).toBe(402);
    expect(result._body).toMatchObject({
      error: "Insufficient credits",
      code: "INSUFFICIENT_CREDITS",
    });
    expect(result._headers["X-Payment-Required"]).toBeUndefined();
  });
});

describe("createX402Response — full x402 path", () => {
  beforeEach(() => {
    process.env.X402_TREASURY_ADDRESS = "0xTestTreasuryAddress";
    mockCanUseLegacyX402.mockResolvedValue(true);
  });

  it("returns 402 with PAYMENT_REQUIRED code and x402:true", async () => {
    const c = createMockContext();
    const result = (await createX402Response(c, 10)) as any;
    expect(result._status).toBe(402);
    expect(result._body).toMatchObject({
      error: "Payment required",
      code: "PAYMENT_REQUIRED",
      x402: true,
      requiredUSDC: "0.010000",
    });
  });

  it("sets X-Payment-Required header with valid JSON", async () => {
    const c = createMockContext();
    const result = (await createX402Response(c, 10)) as any;
    const header = result._headers["X-Payment-Required"];
    expect(header).toBeDefined();
    expect(() => JSON.parse(header)).not.toThrow();
  });

  it("X-Payment-Required contains the expected payment requirement fields", async () => {
    const c = createMockContext();
    const result = (await createX402Response(c, 10)) as any;
    const requirements = JSON.parse(result._headers["X-Payment-Required"]);
    expect(requirements).toMatchObject({
      scheme: "exact",
      network: "base",
      payTo: "0xTestTreasuryAddress",
      asset: USDC_BASE_MAINNET,
      maxAmountRequired: "0.010000",
    });
  });
});

describe("credit-to-USDC conversion", () => {
  beforeEach(() => {
    process.env.X402_TREASURY_ADDRESS = "0xTestTreasury";
    mockCanUseLegacyX402.mockResolvedValue(true);
  });

  it.each([
    [10, "0.010000"],
    [1, "0.001000"],
    [500, "0.500000"],
    [0.5, "0.000500"],
  ])("%d credits to %s USDC", async (credits, expected) => {
    const c = createMockContext();
    const result = (await createX402Response(c, credits)) as any;
    expect(result._body.requiredUSDC).toBe(expected);
  });

  it("requiredUSDC in the body matches maxAmountRequired in the requirements header", async () => {
    const c = createMockContext();
    const result = (await createX402Response(c, 10)) as any;
    const requirements = JSON.parse(result._headers["X-Payment-Required"]);
    expect(result._body.requiredUSDC).toBe(requirements.maxAmountRequired);
  });
});
