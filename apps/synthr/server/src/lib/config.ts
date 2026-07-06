import { z } from 'zod';

type NetworkId = `${string}:${string}`;
const PLACEHOLDER_PAY_TO = '0x1111111111111111111111111111111111111111';

const envSchema = z.object({
  PAY_TO_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  FACILITATOR_URL: z.string().url().default('https://x402.org/facilitator'),
  NETWORK: z.string().default('eip155:84532'), // Base Sepolia test default
  DEFAULT_PRICE_USD: z.coerce.number().positive().default(0.005),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  CORS_ORIGIN: z.string().default('*'),
  PUBLIC_BASE_URL: z.string().url().optional(),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(60),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().optional(),
});

const env = envSchema.parse(process.env);

export const config = {
  payToAddress: env.PAY_TO_ADDRESS as `0x${string}`,
  facilitatorUrl: env.FACILITATOR_URL,
  network: env.NETWORK as NetworkId,
  defaultPriceUsd: env.DEFAULT_PRICE_USD,
  port: env.PORT,
  logLevel: env.LOG_LEVEL,
  corsOrigin: env.CORS_ORIGIN,
  publicBaseUrl: env.PUBLIC_BASE_URL,
  rateLimitWindowMs: env.RATE_LIMIT_WINDOW_MS,
  rateLimitMaxRequests: env.RATE_LIMIT_MAX_REQUESTS,
  llm: {
    apiKey: env.LLM_API_KEY,
    model: env.LLM_MODEL || 'gpt-4o-mini',
  },
};

export function isPlaceholderPayTo(address: string) {
  return address.toLowerCase() === PLACEHOLDER_PAY_TO;
}
