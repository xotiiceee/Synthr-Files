import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  verifyX402Payment,
  setLegacyX402VerifierLoaderForTests,
} from "../../hosted/x402-verify.js";

const mockVerify = vi.fn();
const mockUseFacilitator = vi.fn(() => ({ verify: mockVerify }));

const USDC_BASE_MAINNET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

function createMockContext(
  opts: { paymentHeader?: string; url?: string } = {},
) {
  return {
    req: {
      url: opts.url ?? "http://localhost/v1/pulse/post",
      header: (name: string) => {
        if (name === "X-Payment") return opts.paymentHeader ?? null;
        return null;
      },
    },
  } as any;
}

const encodePayment = (payload: any) =>
  Buffer.from(JSON.stringify(payload)).toString("base64");

const samplePayload = { x402Version: 1, scheme: "exact", network: "base" };

let savedTreasury: string | undefined;
let savedFacilitator: string | undefined;
let savedLegacyFlag: string | undefined;

beforeEach(() => {
  savedTreasury = process.env.X402_TREASURY_ADDRESS;
  savedFacilitator = process.env.X402_FACILITATOR_URL;
  savedLegacyFlag = process.env.PULSE_ENABLE_LEGACY_X402;
  vi.clearAllMocks();
  setLegacyX402VerifierLoaderForTests(async () => ({
    useFacilitator: mockUseFacilitator,
  }));
});

afterEach(() => {
  if (savedTreasury !== undefined)
    process.env.X402_TREASURY_ADDRESS = savedTreasury;
  else delete process.env.X402_TREASURY_ADDRESS;
  if (savedFacilitator !== undefined)
    process.env.X402_FACILITATOR_URL = savedFacilitator;
  else delete process.env.X402_FACILITATOR_URL;
  if (savedLegacyFlag !== undefined)
    process.env.PULSE_ENABLE_LEGACY_X402 = savedLegacyFlag;
  else delete process.env.PULSE_ENABLE_LEGACY_X402;
  setLegacyX402VerifierLoaderForTests();
});

describe("verifyX402Payment — early exits", () => {
  it("no X-Payment header returns false immediately without loading legacy verifier", async () => {
    process.env.X402_TREASURY_ADDRESS = "0xTestTreasury";
    process.env.PULSE_ENABLE_LEGACY_X402 = "true";
    const c = createMockContext();
    expect(await verifyX402Payment(c, 10)).toBe(false);
    expect(mockUseFacilitator).not.toHaveBeenCalled();
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it("no X402_TREASURY_ADDRESS env var returns false", async () => {
    delete process.env.X402_TREASURY_ADDRESS;
    process.env.PULSE_ENABLE_LEGACY_X402 = "true";
    const c = createMockContext({
      paymentHeader: encodePayment(samplePayload),
    });
    expect(await verifyX402Payment(c, 10)).toBe(false);
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it("legacy x402 flag disabled returns false", async () => {
    process.env.X402_TREASURY_ADDRESS = "0xTestTreasury";
    delete process.env.PULSE_ENABLE_LEGACY_X402;
    const c = createMockContext({
      paymentHeader: encodePayment(samplePayload),
    });
    expect(await verifyX402Payment(c, 10)).toBe(false);
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it("invalid JSON in X-Payment header returns false", async () => {
    process.env.X402_TREASURY_ADDRESS = "0xTestTreasury";
    process.env.PULSE_ENABLE_LEGACY_X402 = "true";
    const c = createMockContext({
      paymentHeader: Buffer.from("this is not valid json").toString("base64"),
    });
    expect(await verifyX402Payment(c, 10)).toBe(false);
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it("missing legacy verifier dependency returns false", async () => {
    process.env.X402_TREASURY_ADDRESS = "0xTestTreasury";
    process.env.PULSE_ENABLE_LEGACY_X402 = "true";
    setLegacyX402VerifierLoaderForTests(async () => null);
    const c = createMockContext({
      paymentHeader: encodePayment(samplePayload),
    });
    expect(await verifyX402Payment(c, 10)).toBe(false);
    expect(mockVerify).not.toHaveBeenCalled();
  });
});

describe("verifyX402Payment — verify outcomes", () => {
  beforeEach(() => {
    process.env.X402_TREASURY_ADDRESS = "0xTestTreasury";
    process.env.PULSE_ENABLE_LEGACY_X402 = "true";
  });

  it("verify returns { isValid: true } and returns true", async () => {
    mockVerify.mockResolvedValue({ isValid: true });
    const c = createMockContext({
      paymentHeader: encodePayment(samplePayload),
    });
    expect(await verifyX402Payment(c, 10)).toBe(true);
    expect(mockVerify).toHaveBeenCalledOnce();
  });

  it("verify returns { isValid: false } and returns false", async () => {
    mockVerify.mockResolvedValue({ isValid: false });
    const c = createMockContext({
      paymentHeader: encodePayment(samplePayload),
    });
    expect(await verifyX402Payment(c, 10)).toBe(false);
  });

  it("verify throws and returns false", async () => {
    mockVerify.mockRejectedValue(new Error("verification failed"));
    const c = createMockContext({
      paymentHeader: encodePayment(samplePayload),
    });
    expect(await verifyX402Payment(c, 10)).toBe(false);
  });
});

describe("verifyX402Payment — requirements passed to verify", () => {
  beforeEach(() => {
    process.env.X402_TREASURY_ADDRESS = "0xTestTreasury";
    process.env.PULSE_ENABLE_LEGACY_X402 = "true";
    mockVerify.mockResolvedValue({ isValid: true });
  });

  it("maxAmountRequired equals amountCredits / 1000 with 6 decimal places", async () => {
    const c = createMockContext({
      paymentHeader: encodePayment(samplePayload),
    });
    await verifyX402Payment(c, 10);
    const [, requirements] = mockVerify.mock.calls[0];
    expect(requirements.maxAmountRequired).toBe("0.010000");
  });

  it("payTo matches X402_TREASURY_ADDRESS", async () => {
    const c = createMockContext({
      paymentHeader: encodePayment(samplePayload),
    });
    await verifyX402Payment(c, 10);
    const [, requirements] = mockVerify.mock.calls[0];
    expect(requirements.payTo).toBe("0xTestTreasury");
  });

  it("asset is the USDC Base mainnet address", async () => {
    const c = createMockContext({
      paymentHeader: encodePayment(samplePayload),
    });
    await verifyX402Payment(c, 10);
    const [, requirements] = mockVerify.mock.calls[0];
    expect(requirements.asset).toBe(USDC_BASE_MAINNET);
  });

  it("payload passed to verify matches parsed X-Payment header", async () => {
    const c = createMockContext({
      paymentHeader: encodePayment(samplePayload),
    });
    await verifyX402Payment(c, 10);
    const [payload] = mockVerify.mock.calls[0];
    expect(payload).toEqual(samplePayload);
  });
});

describe("verifyX402Payment — facilitator URL", () => {
  beforeEach(() => {
    process.env.X402_TREASURY_ADDRESS = "0xTestTreasury";
    process.env.PULSE_ENABLE_LEGACY_X402 = "true";
    mockVerify.mockResolvedValue({ isValid: true });
  });

  it("uses default facilitator URL when X402_FACILITATOR_URL is not set", async () => {
    delete process.env.X402_FACILITATOR_URL;
    const c = createMockContext({
      paymentHeader: encodePayment(samplePayload),
    });
    await verifyX402Payment(c, 5);
    expect(mockUseFacilitator).toHaveBeenCalledWith({
      url: "https://x402.org/facilitate",
    });
  });

  it("uses custom X402_FACILITATOR_URL when set", async () => {
    process.env.X402_FACILITATOR_URL = "https://custom.facilitator/facilitate";
    const c = createMockContext({
      paymentHeader: encodePayment(samplePayload),
    });
    await verifyX402Payment(c, 5);
    expect(mockUseFacilitator).toHaveBeenCalledWith({
      url: "https://custom.facilitator/facilitate",
    });
  });
});
