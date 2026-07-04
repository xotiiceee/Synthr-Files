import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deductBillingOperation: vi.fn(),
  deductPulseCredits: vi.fn(),
}));

vi.mock("../../hosted/billing-operations.js", () => ({
  buildBillingOperationIdempotencyKey: ({
    tenantId,
    action,
    operationId,
  }: {
    tenantId: string;
    action: string;
    operationId: string;
  }) => `billing:${tenantId}:${action}:${operationId}`,
  deduct: mocks.deductBillingOperation,
}));

vi.mock("../../hosted/auth.js", () => ({
  checkCredits: vi.fn(),
  deductPulseCredits: mocks.deductPulseCredits,
}));

const { billPulseAction } = await import("../../hosted/billing.js");

describe("billPulseAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses billing operations when tenant and operation ids are provided", async () => {
    mocks.deductBillingOperation.mockResolvedValue({
      ok: true,
      remaining: 42,
    });

    await expect(
      billPulseAction("cn-key", "generate_post", "gpt-4o-mini", {
        tenantId: "tn_agent",
        operationId: "post_123",
        metadata: { route: "/v1/pulse/post" },
      }),
    ).resolves.toEqual({
      ok: true,
      cost: 0.9,
      remaining: 42,
    });

    expect(mocks.deductBillingOperation).toHaveBeenCalledWith({
      tenantId: "tn_agent",
      apiKey: "cn-key",
      amount: 0.9,
      reason: "pulse:generate_post:gpt-4o-mini",
      idempotencyKey: "billing:tn_agent:generate_post:post_123",
      metadata: {
        action: "generate_post",
        modelId: "gpt-4o-mini",
        operationId: "post_123",
        route: "/v1/pulse/post",
      },
    });
    expect(mocks.deductPulseCredits).not.toHaveBeenCalled();
  });

  it("fails closed before provider calls when operation ids are absent", async () => {
    await expect(
      // @ts-expect-error Runtime guard for stale JavaScript callers.
      billPulseAction("cn-key", "content_calendar"),
    ).rejects.toThrow();

    expect(mocks.deductPulseCredits).not.toHaveBeenCalled();
    expect(mocks.deductBillingOperation).not.toHaveBeenCalled();
  });
});
