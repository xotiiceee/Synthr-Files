import {
  askLLM,
  askLLMWithSystem,
  askLLMWithSystemAndUsage,
  askLLMWithUsage,
  isLLMAvailable,
  type LLMOptions,
  type LLMResult,
  type LLMUsage,
} from "./llm.js";

export type LLMCallType = "prompt" | "system_prompt";

export interface LLMUsageEvent {
  callType: LLMCallType;
  usage: LLMUsage;
}

export type LLMUsageHook = (event: LLMUsageEvent) => void | Promise<void>;

export interface LLMProvider {
  ask(prompt: string, options?: LLMOptions): Promise<string | null>;
  askWithSystem(
    systemPrompt: string,
    userPrompt: string,
    options?: LLMOptions,
  ): Promise<string | null>;
  askWithUsage(prompt: string, options?: LLMOptions): Promise<LLMResult | null>;
  askWithSystemAndUsage(
    systemPrompt: string,
    userPrompt: string,
    options?: LLMOptions,
  ): Promise<LLMResult | null>;
  isAvailable(): Promise<boolean>;
}

let usageHook: LLMUsageHook | null = null;

export function setLLMUsageHook(hook: LLMUsageHook | null): void {
  usageHook = hook;
}

async function emitUsage(event: LLMUsageEvent): Promise<void> {
  if (!usageHook) return;
  try {
    await usageHook(event);
  } catch (err) {
    console.warn(
      `[LLMProvider] Usage hook failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

class DefaultLLMProvider implements LLMProvider {
  ask(prompt: string, options?: LLMOptions): Promise<string | null> {
    return askLLM(prompt, options);
  }

  askWithSystem(
    systemPrompt: string,
    userPrompt: string,
    options?: LLMOptions,
  ): Promise<string | null> {
    return askLLMWithSystem(systemPrompt, userPrompt, options);
  }

  async askWithUsage(
    prompt: string,
    options?: LLMOptions,
  ): Promise<LLMResult | null> {
    const result = await askLLMWithUsage(prompt, options);
    if (result?.usage) {
      await emitUsage({ callType: "prompt", usage: result.usage });
    }
    return result;
  }

  async askWithSystemAndUsage(
    systemPrompt: string,
    userPrompt: string,
    options?: LLMOptions,
  ): Promise<LLMResult | null> {
    const result = await askLLMWithSystemAndUsage(
      systemPrompt,
      userPrompt,
      options,
    );
    if (result?.usage) {
      await emitUsage({ callType: "system_prompt", usage: result.usage });
    }
    return result;
  }

  isAvailable(): Promise<boolean> {
    return isLLMAvailable();
  }
}

const defaultProvider = new DefaultLLMProvider();

export function getLLMProvider(): LLMProvider {
  return defaultProvider;
}
