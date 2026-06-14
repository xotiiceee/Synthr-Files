/**
 * Tenant Context Manager — multi-tenancy with AsyncLocalStorage.
 *
 * Uses Node's AsyncLocalStorage for request-scoped isolation.
 * No more global state mutation — concurrent requests for different
 * tenants can't clobber each other's config or API keys.
 */

import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { getSecret, listSecretKeys, storeSecret } from "./db.js";
import { decrypt, encrypt } from "./crypto.js";
import { runInContext, type TenantContext } from "./context.js";

const TENANTS_DIR = path.join(process.cwd(), "data", "tenants");

/** Get or create the data directory for a tenant. */
export function getTenantDir(tenantId: string): string {
  const dir = path.join(TENANTS_DIR, tenantId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(path.join(dir, "agents"), { recursive: true });
  }
  return dir;
}

/** Get the pulse.yaml path for a tenant. */
export function getTenantConfigPath(tenantId: string): string {
  return path.join(getTenantDir(tenantId), "pulse.yaml");
}

/** Initialize a new tenant with default config. */
export function initTenantConfig(
  tenantId: string,
  config: {
    brandName: string;
    website?: string;
    niche?: string;
    tagline?: string;
    xHandle?: string;
    tone?: string;
    agentRole?: string;
  },
): void {
  const dir = getTenantDir(tenantId);
  const configPath = path.join(dir, "pulse.yaml");

  if (fs.existsSync(configPath)) return;

  const defaultConfig = {
    persona: {
      name: "Marketing Agent",
      brandName: config.brandName,
      website: config.website || "",
      tagline: config.tagline || "",
      niche: config.niche || "",
      xHandle: config.xHandle || "",
      tone: config.tone || "professional",
      idealCustomer: "",
      problemSolved: "",
      uniqueValue: "",
      neverSay: [] as string[],
    },
    agentRole: config.agentRole || "",
    platforms: {
      x: { enabled: true, maxPerDay: 10, maxPerRun: 5 },
      reddit: { enabled: false, maxPerDay: 5, maxPerRun: 3 },
      discord: { enabled: false, maxPerDay: 5, maxPerRun: 3 },
      hackernews: { enabled: false, maxPerDay: 3, maxPerRun: 2 },
      producthunt: { enabled: false, maxPerDay: 3, maxPerRun: 2 },
      linkedin: { enabled: false, maxPerDay: 3, maxPerRun: 2 },
    },
    topics: [] as any[],
    contentThemes: [] as string[],
    competitors: [] as string[],
    schedule: {
      outreachIntervalHours: 3,
      contentPostsPerDay: 3,
      adaptationIntervalDays: 7,
    },
    aggressiveness: "moderate",
    autopost: {
      approvalMode: "review_all",
      limits: {
        profilePostsPerDay: 3,
        repliesPerDay: 10,
        repostsPerDay: 5,
        likesPerDay: 20,
        quoteTweetsPerDay: 2,
      },
      safety: { bannedTopics: [] as string[], bannedWords: [] as string[] },
    },
    humanBehavior: {
      voice: {
        catchphrases: [] as string[],
        emojiFrequency: "rare",
        casualtyLevel: 0.5,
      },
      timing: {
        timezone: "UTC",
        basePostsPerDay: 3,
        silentDayChance: 0.05,
        activeWindows: ["09:00-12:00", "14:00-17:00", "19:00-22:00"],
      },
    },
  };

  fs.writeFileSync(configPath, YAML.stringify(defaultConfig, { indent: 2 }));
}

/** Decrypt all tenant secrets into a plain object (NOT process.env). */
function decryptTenantSecrets(
  tenantId: string,
  agentId?: string,
): Record<string, string> {
  const secrets: Record<string, string> = {};
  const baseKeys = [
    "X_API_KEY",
    "X_API_SECRET",
    "X_ACCESS_TOKEN",
    "X_ACCESS_TOKEN_SECRET",
  ];

  // Try agent-specific keys first, then fall back to tenant-level defaults
  for (const key of baseKeys) {
    const agentKey = agentId ? `${agentId}:${key}` : null;
    const secret =
      (agentKey ? getSecret(tenantId, agentKey) : null) ||
      getSecret(tenantId, key);
    if (secret) {
      try {
        secrets[key] = decrypt(
          secret.encrypted_value,
          secret.iv,
          secret.auth_tag,
        );
      } catch {
        /* skip corrupted secrets */
      }
    }
  }

  return secrets;
}

/**
 * Execute a function within a tenant's isolated context.
 *
 * Uses AsyncLocalStorage — safe for concurrent requests.
 * Context-aware reads in state.ts and persona.ts resolve tenant data and config
 * paths without mutating process-global fallbacks.
 */
export async function withTenantContext<T>(
  tenantId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const tenantDir = getTenantDir(tenantId);
  const tenantConfig = getTenantConfigPath(tenantId);
  const secrets = decryptTenantSecrets(tenantId);

  // Look up tenant's billing API key for ClawNet cost recovery
  const { getTenant } = await import("./db.js");
  const tenant = getTenant(tenantId);
  const { getHostedSelectedRuntimeAgentId } = await import(
    "./brand-runtime-context.js"
  );
  const selectedAgentId = getHostedSelectedRuntimeAgentId({ tenantId });

  const ctx: TenantContext = {
    tenantId,
    dataDir: tenantDir,
    configPath: tenantConfig,
    secrets,
    billingApiKey: tenant?.api_key,
    selectedAgentId: selectedAgentId || undefined,
  };

  // Run inside AsyncLocalStorage context
  return runInContext(ctx, fn) as T;
}

/** Check if a tenant (or specific agent) has X API keys configured. */
export function hasTenantXKeys(tenantId: string, agentId?: string): boolean {
  const keys = listSecretKeys(tenantId);
  if (agentId) {
    // Check agent-specific keys first, fall back to tenant-level
    const hasAgent =
      keys.includes(`${agentId}:X_API_KEY`) &&
      keys.includes(`${agentId}:X_ACCESS_TOKEN`);
    if (hasAgent) return true;
  }
  return keys.includes("X_API_KEY") && keys.includes("X_ACCESS_TOKEN");
}

/** Store encrypted X API keys for a tenant, optionally scoped to an agent. */
export function storeTenantXKeys(
  tenantId: string,
  keys: {
    apiKey: string;
    apiSecret: string;
    accessToken: string;
    accessTokenSecret: string;
  },
  agentId?: string,
): void {
  const prefix = agentId ? `${agentId}:` : "";
  const pairs: [string, string][] = [
    [`${prefix}X_API_KEY`, keys.apiKey],
    [`${prefix}X_API_SECRET`, keys.apiSecret],
    [`${prefix}X_ACCESS_TOKEN`, keys.accessToken],
    [`${prefix}X_ACCESS_TOKEN_SECRET`, keys.accessTokenSecret],
  ];

  for (const [name, value] of pairs) {
    if (value) {
      const encrypted = encrypt(value);
      storeSecret(
        tenantId,
        name,
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.authTag,
      );
    }
  }
}
