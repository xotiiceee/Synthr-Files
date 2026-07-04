/**
 * Async-local tenant context — replaces process.env injection.
 *
 * Uses Node's AsyncLocalStorage so each concurrent request gets its own
 * isolated context without clobbering globals. No more race conditions
 * between tenants.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export interface TenantContext {
  tenantId: string;
  dataDir: string;
  configPath: string;
  secrets: Record<string, string>; // X_API_KEY, X_API_SECRET, etc.
  billingApiKey?: string; // Customer's cn-xxx key for ClawNet cost recovery
  selectedAgentId?: string;
}

const storage = new AsyncLocalStorage<TenantContext>();

/** Run a function within an isolated tenant context. */
export function runInContext<T>(ctx: TenantContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** Get the current tenant context (or null if outside a context). */
export function getContext(): TenantContext | undefined {
  return storage.getStore();
}

export function getContextTenantId(): string | undefined {
  return storage.getStore()?.tenantId;
}

export function getContextAgentId(): string | undefined {
  return storage.getStore()?.selectedAgentId;
}

/** Get a secret from the current context (safe alternative to process.env). */
export function getContextSecret(key: string): string | undefined {
  return storage.getStore()?.secrets[key];
}

/** Get the billing API key for the current tenant (for ClawNet cost recovery). */
export function getContextBillingKey(): string | undefined {
  return storage.getStore()?.billingApiKey;
}

/** Get the current context's data dir. */
export function getContextDataDir(): string | undefined {
  return storage.getStore()?.dataDir;
}

/** Get the current context's config path. */
export function getContextConfigPath(): string | undefined {
  return storage.getStore()?.configPath;
}

Object.assign(globalThis, {
  __pulseGetContextDataDir: getContextDataDir,
  __pulseGetContextConfigPath: getContextConfigPath,
  __pulseGetContextTenantId: getContextTenantId,
  __pulseGetContextAgentId: getContextAgentId,
});
