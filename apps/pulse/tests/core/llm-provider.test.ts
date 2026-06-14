import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  askLLM: vi.fn(),
  askLLMWithSystem: vi.fn(),
  askLLMWithUsage: vi.fn(),
  askLLMWithSystemAndUsage: vi.fn(),
  isLLMAvailable: vi.fn(),
}));

vi.mock("../../src/core/llm.js", () => ({
  askLLM: mocks.askLLM,
  askLLMWithSystem: mocks.askLLMWithSystem,
  askLLMWithUsage: mocks.askLLMWithUsage,
  askLLMWithSystemAndUsage: mocks.askLLMWithSystemAndUsage,
  isLLMAvailable: mocks.isLLMAvailable,
}));

const { getLLMProvider, setLLMUsageHook } =
  await import("../../src/core/llm-provider.js");

describe("LLMProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setLLMUsageHook(null);
  });

  it("delegates simple prompt calls to the existing LLM wrapper", async () => {
    mocks.askLLM.mockResolvedValue("ok");

    await expect(
      getLLMProvider().ask("hello", { maxTokens: 10 }),
    ).resolves.toBe("ok");
    expect(mocks.askLLM).toHaveBeenCalledWith("hello", { maxTokens: 10 });
  });

  it("emits usage metadata for prompt calls with usage", async () => {
    const usage = {
      inputTokens: 12,
      outputTokens: 8,
      provider: "groq",
      model: "llama",
    };
    const hook = vi.fn();
    setLLMUsageHook(hook);
    mocks.askLLMWithUsage.mockResolvedValue({ text: "draft", usage });

    const result = await getLLMProvider().askWithUsage("write");

    expect(result?.text).toBe("draft");
    expect(hook).toHaveBeenCalledWith({ callType: "prompt", usage });
  });

  it("emits usage metadata for system prompt calls with usage", async () => {
    const usage = {
      inputTokens: 20,
      outputTokens: 5,
      provider: "openai",
      model: "gpt-4o-mini",
    };
    const hook = vi.fn();
    setLLMUsageHook(hook);
    mocks.askLLMWithSystemAndUsage.mockResolvedValue({ text: "reply", usage });

    await getLLMProvider().askWithSystemAndUsage("system", "user");

    expect(hook).toHaveBeenCalledWith({ callType: "system_prompt", usage });
  });

  it("does not fail the LLM call when the usage hook fails", async () => {
    const usage = {
      inputTokens: 1,
      outputTokens: 1,
      provider: "anthropic",
      model: "claude",
    };
    setLLMUsageHook(() => {
      throw new Error("hook failed");
    });
    mocks.askLLMWithUsage.mockResolvedValue({ text: "still ok", usage });

    await expect(getLLMProvider().askWithUsage("write")).resolves.toEqual({
      text: "still ok",
      usage,
    });
  });
});
