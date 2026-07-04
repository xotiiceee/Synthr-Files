/**
 * Multi-provider LLM wrapper with fallback chain and circuit breaker.
 * Supports: Groq (default), OpenAI, Anthropic, OpenRouter, Ollama (local).
 * Provider selected via LLM_PROVIDER env var. Model override via LLM_MODEL.
 *
 * Fallback: If the primary provider fails, automatically tries other configured providers.
 * Circuit breaker: After 3 consecutive failures, a provider is skipped for 5 minutes.
 */

export interface LLMOptions {
  maxTokens?: number;
  temperature?: number;
  timeout?: number;
  /** Override the provider (groq, openai, anthropic) for this call */
  provider?: string;
  /** Override the model ID for this call */
  model?: string;
}

export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
  provider: string;
  model: string;
}

export interface LLMResult {
  text: string;
  usage: LLMUsage;
}

const DEFAULT_OPTIONS: LLMOptions = {
  maxTokens: 300,
  temperature: 0.7,
  timeout: parseInt(process.env.LLM_REQUEST_TIMEOUT ?? "120000", 10),
};

interface ProviderConfig {
  name: string;
  url: string;
  apiKey: string;
  model: string;
  headers: Record<string, string>;
}

// ─── Circuit Breaker ───────────────────────────────────────────────────────

const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_COOLDOWN = 5 * 60_000; // 5 minutes

const circuitBreakers: Record<string, { failures: number; openUntil: number }> = {};

function isCircuitOpen(provider: string): boolean {
  const cb = circuitBreakers[provider];
  if (!cb) return false;
  if (cb.failures >= CIRCUIT_BREAKER_THRESHOLD) {
    if (Date.now() < cb.openUntil) return true;
    // Cooldown expired — half-open, allow one retry
    cb.failures = 0;
  }
  return false;
}

function recordSuccess(provider: string): void {
  delete circuitBreakers[provider];
}

function recordFailure(provider: string): void {
  const cb = circuitBreakers[provider] ?? { failures: 0, openUntil: 0 };
  cb.failures++;
  if (cb.failures >= CIRCUIT_BREAKER_THRESHOLD) {
    cb.openUntil = Date.now() + CIRCUIT_BREAKER_COOLDOWN;
    console.log(`  [LLM] Circuit breaker OPEN for ${provider} — skipping for 5 min`);
  }
  circuitBreakers[provider] = cb;
}

// ─── Provider Config ───────────────────────────────────────────────────────

function getProviderConfig(name: string): ProviderConfig | null {
  switch (name.toLowerCase()) {
    case 'groq': {
      const key = process.env.GROQ_API_KEY ?? '';
      if (!key) return null;
      return {
        name: 'groq',
        url: 'https://api.groq.com/openai/v1/chat/completions',
        apiKey: key,
        model: process.env.LLM_MODEL ?? 'llama-3.3-70b-versatile',
        headers: { 'Authorization': `Bearer ${key}` },
      };
    }
    case 'openai': {
      const key = process.env.OPENAI_API_KEY ?? '';
      if (!key) return null;
      return {
        name: 'openai',
        url: 'https://api.openai.com/v1/chat/completions',
        apiKey: key,
        model: process.env.LLM_MODEL ?? 'gpt-4o-mini',
        headers: { 'Authorization': `Bearer ${key}` },
      };
    }
    case 'anthropic': {
      const key = process.env.ANTHROPIC_API_KEY ?? '';
      if (!key) return null;
      return {
        name: 'anthropic',
        url: 'https://api.anthropic.com/v1/messages',
        apiKey: key,
        model: process.env.LLM_MODEL ?? 'claude-sonnet-4-20250514',
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
      };
    }
    case 'openrouter': {
      const key = process.env.OPENROUTER_API_KEY ?? '';
      if (!key) return null;
      return {
        name: 'openrouter',
        url: 'https://openrouter.ai/api/v1/chat/completions',
        apiKey: key,
        model: process.env.LLM_MODEL ?? 'meta-llama/llama-3.3-70b-instruct',
        headers: { 'Authorization': `Bearer ${key}` },
      };
    }
    case 'ollama':
      return {
        name: 'ollama',
        url: process.env.OLLAMA_URL ?? 'http://localhost:11434/api/chat',
        apiKey: '',
        model: process.env.LLM_MODEL ?? 'llama3.1',
        headers: {},
      };
    default:
      return null;
  }
}

/** Build ordered provider chain: primary first, then any other configured providers */
function getProviderChain(): ProviderConfig[] {
  const primary = (process.env.LLM_PROVIDER ?? 'groq').toLowerCase();
  const allProviders = ['groq', 'openai', 'anthropic', 'openrouter', 'ollama'];

  const chain: ProviderConfig[] = [];

  // Primary first
  const primaryConfig = getProviderConfig(primary);
  if (primaryConfig) chain.push(primaryConfig);

  // Then fallbacks (any other provider with a key set)
  for (const name of allProviders) {
    if (name === primary) continue;
    const config = getProviderConfig(name);
    if (config) chain.push(config);
  }

  return chain;
}

// ─── Rate Limiting ─────────────────────────────────────────────────────────

let requestCount = 0;
let lastResetTime = Date.now();
const MAX_REQUESTS_PER_HOUR = parseInt(process.env.LLM_RATE_LIMIT ?? '200', 10);

function checkRateLimit(): boolean {
  const now = Date.now();
  if (now - lastResetTime > 3600_000) {
    requestCount = 0;
    lastResetTime = now;
  }
  if (requestCount >= MAX_REQUESTS_PER_HOUR) {
    return false;
  }
  requestCount++;
  return true;
}

// ─── Request Building & Parsing ────────────────────────────────────────────

interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

function buildRequestBody(
  provider: ProviderConfig,
  messages: Message[],
  opts: Required<LLMOptions>,
): string {
  if (provider.name === 'anthropic') {
    // Anthropic uses top-level system field, not in messages array
    const systemMsg = messages.find(m => m.role === 'system');
    const nonSystem = messages.filter(m => m.role !== 'system');
    return JSON.stringify({
      model: provider.model,
      max_tokens: opts.maxTokens,
      ...(systemMsg ? { system: systemMsg.content } : {}),
      messages: nonSystem.map(m => ({ role: m.role, content: m.content })),
    });
  } else if (provider.name === 'ollama') {
    return JSON.stringify({
      model: provider.model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      stream: false,
    });
  } else {
    // OpenAI-compatible (Groq, OpenAI, OpenRouter)
    return JSON.stringify({
      model: provider.model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      max_tokens: opts.maxTokens,
      temperature: opts.temperature,
    });
  }
}

function parseResponse(provider: ProviderConfig, data: unknown): string | null {
  if (provider.name === 'anthropic') {
    const d = data as { content?: Array<{ text: string }> };
    return d.content?.[0]?.text ?? null;
  } else if (provider.name === 'ollama') {
    const d = data as { message?: { content?: string } };
    return d.message?.content ?? null;
  } else {
    const d = data as { choices?: { message?: { content?: string } }[] };
    return d.choices?.[0]?.message?.content ?? null;
  }
}

function parseUsage(provider: ProviderConfig, data: unknown): { inputTokens: number; outputTokens: number } {
  if (provider.name === 'anthropic') {
    const d = data as { usage?: { input_tokens?: number; output_tokens?: number } };
    return { inputTokens: d.usage?.input_tokens ?? 0, outputTokens: d.usage?.output_tokens ?? 0 };
  } else if (provider.name === 'ollama') {
    const d = data as { prompt_eval_count?: number; eval_count?: number };
    return { inputTokens: d.prompt_eval_count ?? 0, outputTokens: d.eval_count ?? 0 };
  } else {
    // OpenAI-compatible (Groq, OpenAI, OpenRouter)
    const d = data as { usage?: { prompt_tokens?: number; completion_tokens?: number } };
    return { inputTokens: d.usage?.prompt_tokens ?? 0, outputTokens: d.usage?.completion_tokens ?? 0 };
  }
}

// ─── Single Provider Call with Retry ───────────────────────────────────────

async function callProvider(
  provider: ProviderConfig,
  messages: Message[],
  opts: Required<LLMOptions>,
): Promise<LLMResult | null> {
  const body = buildRequestBody(provider, messages, opts);
  const maxAttempts = 2;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetch(provider.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...provider.headers },
        body,
        signal: AbortSignal.timeout(opts.timeout),
      });

      if (res.ok) {
        const data = await res.json();
        const text = parseResponse(provider, data);
        if (text) {
          recordSuccess(provider.name);
          const usage = parseUsage(provider, data);
          return { text, usage: { ...usage, provider: provider.name, model: provider.model } };
        }
        return null;
      }

      // Handle specific status codes
      const status = res.status;

      if (status === 401 || status === 403) {
        console.log(`  [LLM] ${provider.name}: Auth error ${status} — check API key`);
        recordFailure(provider.name);
        return null; // Don't retry auth errors
      }

      if (status === 429) {
        const retryAfter = parseInt(res.headers.get('retry-after') ?? '5', 10);
        if (retryAfter > 3600) {
          // Quota exhausted (monthly limit) — don't retry
          console.log(`  [LLM] ${provider.name}: Quota exhausted — trying next provider`);
          recordFailure(provider.name);
          return null;
        }
        if (attempt < maxAttempts - 1) {
          const wait = Math.min(retryAfter * 1000, 60_000);
          console.log(`  [LLM] ${provider.name}: Rate limited — retrying in ${Math.round(wait / 1000)}s`);
          await new Promise(r => setTimeout(r, wait));
          continue;
        }
      }

      if ((status === 500 || status === 503) && attempt < maxAttempts - 1) {
        console.log(`  [LLM] ${provider.name}: Server error ${status} — retrying in 2s`);
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }

      const errBody = await res.text().catch(() => '');
      console.log(`  [LLM] ${provider.name}: HTTP ${status}: ${errBody.slice(0, 200)}`);
      recordFailure(provider.name);
      return null;
    } catch (err) {
      if (attempt < maxAttempts - 1) {
        console.log(`  [LLM] ${provider.name}: ${err instanceof Error ? err.message : String(err)} — retrying`);
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      console.log(`  [LLM] ${provider.name}: ${err instanceof Error ? err.message : String(err)}`);
      recordFailure(provider.name);
      return null;
    }
  }

  return null;
}

// ─── Main LLM Functions ────────────────────────────────────────────────────

/**
 * Internal: try each provider in the chain until one succeeds.
 */
async function askLLMMessages(
  messages: Message[],
  options?: LLMOptions,
): Promise<LLMResult | null> {
  if (!checkRateLimit()) {
    console.log('  [LLM] Rate limit — waiting 60s');
    await new Promise(r => setTimeout(r, 60_000));
    requestCount = 0;
  }

  const opts = { ...DEFAULT_OPTIONS, ...options } as Required<LLMOptions>;

  // If caller specified a provider+model, use that directly
  if (options?.provider && options?.model) {
    const providerConfig = getProviderConfig(options.provider);
    if (providerConfig) {
      providerConfig.model = options.model;
      const result = await callProvider(providerConfig, messages, opts);
      if (result !== null) return result;
    }
    // Fall through to chain if specified provider failed
  }

  const chain = getProviderChain();
  if (chain.length === 0) {
    console.log('  [LLM] No providers configured — check .env');
    return null;
  }

  for (const provider of chain) {
    if (isCircuitOpen(provider.name)) continue;
    const result = await callProvider(provider, messages, opts);
    if (result !== null) return result;
    if (provider === chain[0] && chain.length > 1) {
      console.log(`  [LLM] Primary (${provider.name}) failed — trying fallback providers`);
    }
  }

  return null;
}

/**
 * Send a prompt to the configured LLM provider and return the response text.
 * Returns null on any failure. Automatically tries fallback providers.
 */
export async function askLLM(prompt: string, options?: LLMOptions): Promise<string | null> {
  const result = await askLLMMessages([{ role: 'user', content: prompt }], options);
  return result?.text ?? null;
}

/**
 * Send a prompt with a separate system message for better persona control.
 * Anthropic correctly uses the top-level `system` field.
 * Other providers send it as the first message.
 */
export async function askLLMWithSystem(
  systemPrompt: string,
  userPrompt: string,
  options?: LLMOptions,
): Promise<string | null> {
  const result = await askLLMMessages([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ], options);
  return result?.text ?? null;
}

/**
 * Send a prompt and get the full result including token usage.
 * Use this when you need to bill based on actual token consumption.
 */
export async function askLLMWithUsage(prompt: string, options?: LLMOptions): Promise<LLMResult | null> {
  return askLLMMessages([{ role: 'user', content: prompt }], options);
}

/**
 * Send a prompt with system message and get the full result including token usage.
 */
export async function askLLMWithSystemAndUsage(
  systemPrompt: string,
  userPrompt: string,
  options?: LLMOptions,
): Promise<LLMResult | null> {
  return askLLMMessages([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ], options);
}

// ─── LLM Availability ──────────────────────────────────────────────────────

let llmOnline: boolean | null = null;
let llmOnlineCheckedAt = 0;
const LLM_CHECK_TTL = 5 * 60_000; // Re-check every 5 minutes

/**
 * Check if any LLM provider is reachable.
 * Cached for 5 minutes to avoid hammering providers.
 */
export async function isLLMAvailable(): Promise<boolean> {
  if (llmOnline !== null && Date.now() - llmOnlineCheckedAt < LLM_CHECK_TTL) {
    return llmOnline;
  }

  llmOnline = null;
  llmOnlineCheckedAt = Date.now();

  const result = await askLLM('Reply with exactly: OK', { maxTokens: 10 });
  llmOnline = result !== null;

  const chain = getProviderChain();
  const primary = chain[0];
  const fallbackCount = chain.length - 1;
  const fallbackInfo = fallbackCount > 0 ? ` (+${fallbackCount} fallback${fallbackCount > 1 ? 's' : ''})` : '';

  if (primary) {
    console.log(`LLM: ${llmOnline ? `ONLINE (${primary.model} via ${primary.name}${fallbackInfo})` : 'OFFLINE (template mode)'}`);
  } else {
    console.log('LLM: OFFLINE (no providers configured)');
  }

  return llmOnline;
}

/**
 * Reset the LLM availability cache and circuit breakers.
 * Useful for long-running processes or after config changes.
 */
export function recheckLLMAvailability(): void {
  llmOnline = null;
  llmOnlineCheckedAt = 0;
  for (const key of Object.keys(circuitBreakers)) delete circuitBreakers[key];
}

/**
 * @deprecated Use recheckLLMAvailability() instead
 */
export function resetLLMCache(): void {
  recheckLLMAvailability();
}
