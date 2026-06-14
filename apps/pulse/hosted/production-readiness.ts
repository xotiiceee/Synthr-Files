import { createHash } from "node:crypto";
import fs from "node:fs";
import { isIP } from "node:net";
import path from "node:path";

import Database from "better-sqlite3";
import { loadSomaHeart } from "soma-heart";

import { areDurableSchedulerWritesEnabled } from "./durable-scheduler-config.js";

export type ProductionReadinessSeverity = "error" | "warning";

export interface ProductionReadinessIssue {
  severity: ProductionReadinessSeverity;
  code: string;
  message: string;
}

export interface ProductionReadinessReport {
  ok: boolean;
  errors: ProductionReadinessIssue[];
  warnings: ProductionReadinessIssue[];
  issues: ProductionReadinessIssue[];
}

export interface ProductionReadinessOptions {
  standaloneLaunch?: boolean;
  customerLaunch?: boolean;
  productionDeployWorkflow?: string | null;
  productionDeployScript?: string | null;
}

type Env = Record<string, string | undefined>;

const allowedAuthProviders = new Set(["clawnet", "firstparty"]);
const allowedBillingProviders = new Set(["clawnet", "stripe"]);
const allowedSchedulerModes = new Set(["legacy", "durable"]);
const validHeartCache = new Set<string>();

export function evaluateProductionReadiness(
  env: Env = process.env,
  options: ProductionReadinessOptions = {},
): ProductionReadinessReport {
  const issues: ProductionReadinessIssue[] = [];
  const standaloneLaunch = options.standaloneLaunch ?? true;
  const customerLaunch =
    options.customerLaunch ?? isTruthyFlag(env.PULSE_CUSTOMER_LAUNCH);
  if (options.productionDeployWorkflow != null) {
    evaluateProductionDeployWorkflow(issues, options.productionDeployWorkflow);
  }
  if (options.productionDeployScript != null) {
    evaluateProductionDeployScript(issues, options.productionDeployScript);
  }

  const nodeEnv = normalize(env.NODE_ENV, "");
  if (nodeEnv !== "production") {
    issues.push({
      severity: customerLaunch ? "error" : "warning",
      code: "NODE_ENV_NOT_PRODUCTION",
      message:
        "NODE_ENV must be production for customer launch so runtime security and cookie settings match the deployed service.",
    });
  }

  requireNonBlank(issues, env, "PULSE_URL", "Public Pulse URL is required.");
  if (customerLaunch) {
    validateProductionFilePath(
      issues,
      env,
      "HOSTED_DB_PATH",
      "hosted SQLite database",
      { sqliteQuickCheck: true },
    );
    validateProductionFilePath(
      issues,
      env,
      "PULSE_HEART_PATH",
      "Pulse operator heart identity",
      { heartSecret: env.PULSE_HEART_SECRET?.trim() },
    );
  }
  requireNonBlank(
    issues,
    env,
    "TENANT_ENCRYPTION_KEY",
    "Tenant encryption key is required for hosted production.",
  );
  requireNonBlank(
    issues,
    env,
    "ADMIN_API_KEY",
    "Admin API key is required for operator access.",
  );

  const encryptionKey = env.TENANT_ENCRYPTION_KEY?.trim();
  if (encryptionKey && !/^[a-f0-9]{64}$/i.test(encryptionKey)) {
    issues.push({
      severity: "error",
      code: "INVALID_TENANT_ENCRYPTION_KEY",
      message: "TENANT_ENCRYPTION_KEY must be a 64-character hex string.",
    });
  }
  if (customerLaunch && encryptionKey && hasLowEntropySecretShape(encryptionKey)) {
    issues.push({
      severity: "error",
      code: "LOW_ENTROPY_TENANT_ENCRYPTION_KEY",
      message:
        "TENANT_ENCRYPTION_KEY appears low entropy; generate a random 32-byte hex key before customer launch.",
    });
  }

  requireSecretLength(
    issues,
    env,
    "ADMIN_API_KEY",
    32,
    "ADMIN_API_KEY must be at least 32 characters for hosted production.",
  );
  if (
    customerLaunch &&
    env.ADMIN_API_KEY?.trim() &&
    hasLowEntropySecretShape(env.ADMIN_API_KEY.trim())
  ) {
    issues.push({
      severity: "error",
      code: "LOW_ENTROPY_ADMIN_API_KEY",
      message:
        "ADMIN_API_KEY appears low entropy; generate a random operator API key before customer launch.",
    });
  }

  const authProvider = normalize(env.AUTH_PROVIDER, "clawnet");
  if (!allowedAuthProviders.has(authProvider)) {
    issues.push({
      severity: "error",
      code: "INVALID_AUTH_PROVIDER",
      message: "AUTH_PROVIDER must be clawnet or firstparty.",
    });
  } else if (standaloneLaunch && authProvider !== "firstparty") {
    issues.push({
      severity: customerLaunch ? "error" : "warning",
      code: "AUTH_PROVIDER_NOT_STANDALONE",
      message:
        "AUTH_PROVIDER is not firstparty; ClawNet auth remains the default rollback path.",
    });
  }

  const billingProvider = normalize(env.BILLING_PROVIDER, "clawnet");
  if (!allowedBillingProviders.has(billingProvider)) {
    issues.push({
      severity: "error",
      code: "INVALID_BILLING_PROVIDER",
      message: "BILLING_PROVIDER must be clawnet or stripe.",
    });
  } else if (standaloneLaunch && billingProvider !== "stripe") {
    issues.push({
      severity: customerLaunch ? "error" : "warning",
      code: "BILLING_PROVIDER_NOT_STANDALONE",
      message:
        "BILLING_PROVIDER is not stripe; standalone subscriptions are not the active billing path.",
    });
  }

  if (billingProvider === "stripe") {
    requireNonBlank(
      issues,
      env,
      "STRIPE_WEBHOOK_SECRET",
      "STRIPE_WEBHOOK_SECRET is required when BILLING_PROVIDER=stripe.",
    );
    const stripeWebhookSecret = env.STRIPE_WEBHOOK_SECRET?.trim();
    if (stripeWebhookSecret && !stripeWebhookSecret.startsWith("whsec_")) {
      issues.push({
        severity: "error",
        code: "INVALID_STRIPE_WEBHOOK_SECRET",
        message:
          "STRIPE_WEBHOOK_SECRET must be a Stripe endpoint secret that starts with whsec_.",
      });
    }
    if (customerLaunch) {
      validateNoPlaceholderSecrets(issues, env, ["STRIPE_WEBHOOK_SECRET"]);
    }
  }

  const schedulerMode = normalize(env.SCHEDULER_MODE, "legacy");
  if (!allowedSchedulerModes.has(schedulerMode)) {
    issues.push({
      severity: "error",
      code: "INVALID_SCHEDULER_MODE",
      message: "SCHEDULER_MODE must be legacy or durable.",
    });
  } else if (schedulerMode !== "durable") {
    issues.push({
      severity: customerLaunch ? "error" : "warning",
      code: "SCHEDULER_NOT_DURABLE",
      message:
        "SCHEDULER_MODE is not durable; restart-safe scheduler execution is not active.",
    });
  } else if (customerLaunch && !areDurableSchedulerWritesEnabled(env)) {
    issues.push({
      severity: "error",
      code: "SCHEDULER_WRITES_NOT_DURABLE",
      message:
        "SCHEDULER_MODE=durable is active, but PULSE_DURABLE_SCHEDULER_WRITES=true is not enabled for durable content/outreach writes.",
    });
  }

  if (customerLaunch && isTruthyFlag(env.PULSE_ALLOW_FOLLOW_CHURN)) {
    issues.push({
      severity: "error",
      code: "FOLLOW_CHURN_ENABLED_FOR_CUSTOMER_LAUNCH",
      message:
        "PULSE_ALLOW_FOLLOW_CHURN must stay unset for customer launch; hosted follow/unfollow churn is not part of the canonical production path.",
    });
  }

  if (
    !hasAny(env, [
      "GROQ_API_KEY",
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "OPENROUTER_API_KEY",
    ])
  ) {
    issues.push({
      severity: "error",
      code: "MISSING_LLM_PROVIDER_KEY",
      message:
        "At least one hosted LLM key is required: GROQ_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, or OPENROUTER_API_KEY.",
    });
  }
  if (customerLaunch) {
    validateNoPlaceholderSecrets(issues, env, [
      "GROQ_API_KEY",
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "OPENROUTER_API_KEY",
    ]);
  }

  const searchProvider = normalize(env.SEARCH_PROVIDER, "serper");
  const searchKeyByProvider: Record<string, string> = {
    serper: "SERPER_API_KEY",
    brave: "BRAVE_API_KEY",
    serpapi: "SERPAPI_API_KEY",
  };
  const searchKey = searchKeyByProvider[searchProvider];
  if (!searchKey) {
    issues.push({
      severity: "error",
      code: "INVALID_SEARCH_PROVIDER",
      message: "SEARCH_PROVIDER must be serper, brave, or serpapi.",
    });
  } else if (!isPresent(env[searchKey])) {
    issues.push({
      severity: "error",
      code: "MISSING_SEARCH_PROVIDER_KEY",
      message: `${searchKey} is required when SEARCH_PROVIDER=${searchProvider}.`,
    });
  } else if (customerLaunch) {
    validateNoPlaceholderSecrets(issues, env, [searchKey]);
  }

  const pulseUrl = env.PULSE_URL?.trim();
  let pulseUrlOrigin: string | undefined;
  if (pulseUrl) {
    try {
      const parsed = new URL(pulseUrl);
      pulseUrlOrigin = parsed.origin;
      if (parsed.protocol !== "https:") {
        issues.push({
          severity: "error",
          code: "PULSE_URL_NOT_HTTPS",
          message: "PULSE_URL must use https in production.",
        });
      }
      if (
        customerLaunch &&
        (parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "")
      ) {
        issues.push({
          severity: "error",
          code: "PULSE_URL_NOT_ORIGIN",
          message:
            "PULSE_URL must be the standalone app origin only, without a path, query string, or fragment.",
        });
      }
      if (customerLaunch && pulseUrl !== parsed.origin) {
        issues.push({
          severity: "error",
          code: "PULSE_URL_NOT_CANONICAL_ORIGIN",
          message:
            "PULSE_URL must exactly match its canonical origin, for example https://app.pulse.com with no trailing slash.",
        });
      }
      if (customerLaunch && (parsed.username || parsed.password)) {
        issues.push({
          severity: "error",
          code: "PULSE_URL_HAS_CREDENTIALS",
          message:
            "PULSE_URL must not include embedded username or password credentials.",
        });
      }
      if (customerLaunch && parsed.port) {
        issues.push({
          severity: "error",
          code: "PULSE_URL_HAS_PORT",
          message:
            "PULSE_URL must use the default HTTPS port for customer launch.",
        });
      }
      if (standaloneLaunch && parsed.hostname.endsWith("claw-net.org")) {
        issues.push({
          severity: customerLaunch ? "error" : "warning",
          code: "PULSE_URL_STILL_CLAWNET",
          message:
            "PULSE_URL still points at claw-net.org; set the standalone Pulse domain before customer launch.",
        });
      }
      if (customerLaunch && isPlaceholderDomain(parsed.hostname)) {
        issues.push({
          severity: "error",
          code: "PULSE_URL_PLACEHOLDER_DOMAIN",
          message:
            "PULSE_URL uses a placeholder example domain; set the real standalone Pulse domain before customer launch.",
        });
      }
      if (
        customerLaunch &&
        (isLocalOrPrivateHost(parsed.hostname) ||
          !hasPublicDomainName(parsed.hostname))
      ) {
        issues.push({
          severity: "error",
          code: "PULSE_URL_NOT_PUBLIC_DOMAIN",
          message:
            "PULSE_URL must use the real public standalone Pulse domain before customer launch.",
        });
      }
    } catch {
      issues.push({
        severity: "error",
        code: "INVALID_PULSE_URL",
        message: "PULSE_URL must be a valid absolute URL.",
      });
    }
  }

  for (const [key, expectedPath] of [
    ["GITHUB_CALLBACK_URL", "/auth/github/callback"],
    ["X_CALLBACK_URL", "/auth/x/callback"],
    ["X_OAUTH_CALLBACK_URL", "/auth/x/callback"],
  ] as const) {
    validateOptionalCallbackUrl(issues, env, key, expectedPath, {
      standaloneLaunch,
      customerLaunch,
      expectedOrigin: pulseUrlOrigin,
    });
  }

  validateOAuthCredentialPair(issues, env, {
    enabled:
      customerLaunch ||
      isPresent(env.X_CALLBACK_URL) ||
      isPresent(env.X_OAUTH_CALLBACK_URL),
    clientIdKey: "X_OAUTH_CLIENT_ID",
    clientSecretKey: "X_OAUTH_CLIENT_SECRET",
    integrationName: "X OAuth",
  });
  validateOAuthCredentialPair(issues, env, {
    enabled: isPresent(env.GITHUB_CALLBACK_URL),
    clientIdKey: "GITHUB_OAUTH_CLIENT_ID",
    clientSecretKey: "GITHUB_OAUTH_CLIENT_SECRET",
    integrationName: "GitHub OAuth",
  });
  if (customerLaunch) {
    validateNoPlaceholderSecrets(issues, env, [
      "X_OAUTH_CLIENT_ID",
      "X_OAUTH_CLIENT_SECRET",
      "GITHUB_OAUTH_CLIENT_ID",
      "GITHUB_OAUTH_CLIENT_SECRET",
    ]);
  }

  const xMonthlyPostLimit = env.X_MONTHLY_POST_LIMIT?.trim();
  if (customerLaunch && !xMonthlyPostLimit) {
    issues.push({
      severity: "error",
      code: "MISSING_X_MONTHLY_POST_LIMIT",
      message:
        "X_MONTHLY_POST_LIMIT is required for customer launch; set it to the approved monthly write capacity for the configured X API tier.",
    });
  } else if (
    xMonthlyPostLimit &&
    !/^[1-9]\d*$/.test(xMonthlyPostLimit)
  ) {
    issues.push({
      severity: "error",
      code: "INVALID_X_MONTHLY_POST_LIMIT",
      message: "X_MONTHLY_POST_LIMIT must be a positive integer.",
    });
  }

  const resendFrom = env.RESEND_FROM?.trim();
  if (customerLaunch && !isPresent(env.RESEND_API_KEY)) {
    issues.push({
      severity: "error",
      code: "MISSING_RESEND_API_KEY",
      message:
        "RESEND_API_KEY is required for customer launch so security and account emails can be delivered.",
    });
  }
  if (customerLaunch) {
    validateNoPlaceholderSecrets(issues, env, ["RESEND_API_KEY"]);
  }
  if (customerLaunch && !resendFrom) {
    issues.push({
      severity: "error",
      code: "MISSING_RESEND_FROM",
      message:
        "RESEND_FROM is required for customer launch; set a Pulse-controlled sender address.",
    });
  }
  if (standaloneLaunch && resendFrom && /@[^>\s]*claw-net\.org\b/i.test(resendFrom)) {
    issues.push({
      severity: customerLaunch ? "error" : "warning",
      code: "RESEND_FROM_STILL_CLAWNET",
      message:
        "RESEND_FROM still uses claw-net.org; set a Pulse-controlled sender domain before customer launch.",
    });
  }
  if (customerLaunch && resendFrom) {
    validateLaunchEmailDomain(issues, "RESEND_FROM", resendFrom);
  }

  const supportEmail = env.PULSE_SUPPORT_EMAIL?.trim();
  if (customerLaunch && !supportEmail) {
    issues.push({
      severity: "error",
      code: "MISSING_PULSE_SUPPORT_EMAIL",
      message:
        "PULSE_SUPPORT_EMAIL is required for customer launch; set a Pulse-controlled support address.",
    });
  }
  if (
    standaloneLaunch &&
    supportEmail &&
    /@[^>\s]*claw-net\.org\b/i.test(supportEmail)
  ) {
    issues.push({
      severity: customerLaunch ? "error" : "warning",
      code: "SUPPORT_EMAIL_STILL_CLAWNET",
      message:
        "PULSE_SUPPORT_EMAIL still uses claw-net.org; set a Pulse-controlled support address before customer launch.",
    });
  }
  if (customerLaunch && supportEmail) {
    validateLaunchEmailDomain(issues, "PULSE_SUPPORT_EMAIL", supportEmail);
  }

  if (env.REQUIRE_PIN === "false") {
    issues.push({
      severity: "warning",
      code: "PIN_GATE_DISABLED",
      message: "REQUIRE_PIN=false disables the dashboard PIN gate.",
    });
  }

  const pulseHeartSecret = env.PULSE_HEART_SECRET?.trim();
  if (!pulseHeartSecret) {
    issues.push({
      severity: customerLaunch ? "error" : "warning",
      code: "MISSING_PULSE_HEART_SECRET",
      message:
        customerLaunch
          ? "PULSE_HEART_SECRET is required for customer launch so the Pulse operator heart persists across restarts."
          : "PULSE_HEART_SECRET is not set; the Pulse operator heart may not persist across restarts.",
    });
  } else {
    requireSecretLength(
      issues,
      env,
      "PULSE_HEART_SECRET",
      32,
      "PULSE_HEART_SECRET must be at least 32 characters for hosted production.",
    );
    if (customerLaunch && hasLowEntropySecretShape(pulseHeartSecret)) {
      issues.push({
        severity: "error",
        code: "LOW_ENTROPY_PULSE_HEART_SECRET",
        message:
          "PULSE_HEART_SECRET appears low entropy; generate a random heart secret before customer launch.",
      });
    }
  }

  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    issues,
  };
}

function validateOAuthCredentialPair(
  issues: ProductionReadinessIssue[],
  env: Env,
  options: {
    enabled: boolean;
    clientIdKey: string;
    clientSecretKey: string;
    integrationName: string;
  },
): void {
  if (!options.enabled) return;
  if (!isPresent(env[options.clientIdKey])) {
    issues.push({
      severity: "error",
      code: `MISSING_${options.clientIdKey}`,
      message: `${options.clientIdKey} is required when ${options.integrationName} is enabled for production.`,
    });
  }
  if (!isPresent(env[options.clientSecretKey])) {
    issues.push({
      severity: "error",
      code: `MISSING_${options.clientSecretKey}`,
      message: `${options.clientSecretKey} is required when ${options.integrationName} is enabled for production.`,
    });
  }
}

function validateNoPlaceholderSecrets(
  issues: ProductionReadinessIssue[],
  env: Env,
  keys: string[],
): void {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (!value || !looksPlaceholderSecret(value)) continue;
    issues.push({
      severity: "error",
      code: `PLACEHOLDER_${key}`,
      message: `${key} appears to be a placeholder or test credential; set a real production value before customer launch.`,
    });
  }
}

function validateProductionFilePath(
  issues: ProductionReadinessIssue[],
  env: Env,
  key: string,
  description: string,
  options: { sqliteQuickCheck?: boolean; heartSecret?: string } = {},
): void {
  const value = env[key]?.trim();
  if (!value) {
    issues.push({
      severity: "error",
      code: `MISSING_${key}`,
      message: `${key} is required for customer launch so the ${description} path is explicit and backup-safe.`,
    });
    return;
  }

  if (!path.isAbsolute(value)) {
    issues.push({
      severity: "error",
      code: `${key}_NOT_ABSOLUTE`,
      message: `${key} must be an absolute production file path.`,
    });
  }

  const normalized = path.resolve(value);
  const usesTempPath = isTempPath(normalized);
  if (usesTempPath) {
    issues.push({
      severity: "error",
      code: `${key}_TEMP_PATH`,
      message: `${key} must not point at a temporary directory for customer launch.`,
    });
  }

  if (!path.isAbsolute(value) || usesTempPath) return;

  if (!fs.existsSync(normalized)) {
    issues.push({
      severity: "error",
      code: `${key}_NOT_FOUND`,
      message: `${key} must point at an existing ${description} file before customer launch.`,
    });
    return;
  }

  if (!fs.statSync(normalized).isFile()) {
    issues.push({
      severity: "error",
      code: `${key}_NOT_FILE`,
      message: `${key} must point at a ${description} file before customer launch.`,
    });
    return;
  }

  if (options.sqliteQuickCheck) {
    validateSqliteQuickCheck(issues, normalized, key, description);
  }
  if (options.heartSecret) {
    validatePulseHeart(issues, normalized, key, description, options.heartSecret);
  }
}

function validateSqliteQuickCheck(
  issues: ProductionReadinessIssue[],
  filePath: string,
  key: string,
  description: string,
): void {
  let db: Database.Database | undefined;
  try {
    db = new Database(filePath, { readonly: true, fileMustExist: true });
    const quickCheckRows = db.pragma("quick_check") as Array<{
      quick_check: string;
    }>;
    const messages = quickCheckRows
      .map((row) => row.quick_check)
      .filter((message) => message !== "ok");
    if (messages.length > 0) {
      issues.push({
        severity: "error",
        code: `${key}_QUICK_CHECK_FAILED`,
        message: `${key} points at a ${description} file that fails SQLite quick_check.`,
      });
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    issues.push({
      severity: "error",
      code: `${key}_UNREADABLE`,
      message: `${key} must point at a readable ${description} file before customer launch: ${detail}`,
    });
  } finally {
    db?.close();
  }
}

function validatePulseHeart(
  issues: ProductionReadinessIssue[],
  filePath: string,
  key: string,
  description: string,
  secret: string,
): void {
  const stat = fs.statSync(filePath);
  const secretHash = createHash("sha256").update(secret).digest("hex");
  const cacheKey = `${filePath}:${stat.mtimeMs}:${stat.size}:${secretHash}`;
  if (validHeartCache.has(cacheKey)) return;

  try {
    const blob = fs.readFileSync(filePath, "utf-8");
    loadSomaHeart(blob, secret);
    validHeartCache.add(cacheKey);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    issues.push({
      severity: "error",
      code: `${key}_UNREADABLE`,
      message: `${key} must point at a loadable ${description} file before customer launch: ${detail}`,
    });
  }
}

function validateOptionalCallbackUrl(
  issues: ProductionReadinessIssue[],
  env: Env,
  key: string,
  expectedPath: string,
  options: {
    standaloneLaunch: boolean;
    customerLaunch: boolean;
    expectedOrigin?: string;
  },
): void {
  const value = env[key]?.trim();
  if (!value) return;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") {
      issues.push({
        severity: "error",
        code: `${key}_NOT_HTTPS`,
        message: `${key} must use https in production.`,
      });
    }
    if (parsed.pathname !== expectedPath) {
      issues.push({
        severity: "error",
        code: `${key}_UNEXPECTED_PATH`,
        message: `${key} must end with ${expectedPath}.`,
      });
    }
    if (
      options.customerLaunch &&
      (parsed.search !== "" || parsed.hash !== "")
    ) {
      issues.push({
        severity: "error",
        code: `${key}_HAS_QUERY_OR_FRAGMENT`,
        message: `${key} must not include a query string or fragment before customer launch.`,
      });
    }
    if (options.customerLaunch && (parsed.username || parsed.password)) {
      issues.push({
        severity: "error",
        code: `${key}_HAS_CREDENTIALS`,
        message: `${key} must not include embedded username or password credentials.`,
      });
    }
    if (options.customerLaunch && parsed.port) {
      issues.push({
        severity: "error",
        code: `${key}_HAS_PORT`,
        message: `${key} must use the default HTTPS port for customer launch.`,
      });
    }
    if (
      options.customerLaunch &&
      options.expectedOrigin &&
      parsed.origin !== options.expectedOrigin
    ) {
      issues.push({
        severity: "error",
        code: `${key}_ORIGIN_MISMATCH`,
        message: `${key} must use the same origin as PULSE_URL before customer launch.`,
      });
    }
    if (
      options.standaloneLaunch &&
      parsed.hostname.endsWith("claw-net.org")
    ) {
      issues.push({
        severity: options.customerLaunch ? "error" : "warning",
        code: `${key}_STILL_CLAWNET`,
        message: `${key} still points at claw-net.org; set the standalone Pulse callback URL before customer launch.`,
      });
    }
    if (options.customerLaunch && isPlaceholderDomain(parsed.hostname)) {
      issues.push({
        severity: "error",
        code: `${key}_PLACEHOLDER_DOMAIN`,
        message: `${key} uses a placeholder example domain; set the real standalone Pulse callback URL before customer launch.`,
      });
    }
    if (
      options.customerLaunch &&
      (isLocalOrPrivateHost(parsed.hostname) ||
        !hasPublicDomainName(parsed.hostname))
    ) {
      issues.push({
        severity: "error",
        code: `${key}_NOT_PUBLIC_DOMAIN`,
        message: `${key} must use the real public standalone Pulse callback domain before customer launch.`,
      });
    }
  } catch {
    issues.push({
      severity: "error",
      code: `INVALID_${key}`,
      message: `${key} must be a valid absolute URL.`,
    });
  }
}

function validateLaunchEmailDomain(
  issues: ProductionReadinessIssue[],
  key: string,
  value: string,
): void {
  const domain = parseEmailDomain(value);
  if (!domain) {
    issues.push({
      severity: "error",
      code: `INVALID_${key}`,
      message: `${key} must include a valid email address before customer launch.`,
    });
    return;
  }

  if (isPlaceholderDomain(domain)) {
    issues.push({
      severity: "error",
      code: `${key}_PLACEHOLDER_DOMAIN`,
      message: `${key} uses a placeholder example domain; set a real Pulse-controlled email domain before customer launch.`,
    });
    return;
  }

  if (isLocalOrPrivateHost(domain) || !hasPublicDomainName(domain)) {
    issues.push({
      severity: "error",
      code: `${key}_NOT_PUBLIC_DOMAIN`,
      message: `${key} must use a public Pulse-controlled email domain before customer launch.`,
    });
  }
}

function evaluateProductionDeployWorkflow(
  issues: ProductionReadinessIssue[],
  workflow: string,
): void {
  if (!workflow.trim()) return;
  const hasBranchDispatchInput =
    /\bworkflow_dispatch\s*:\s*\n[\s\S]*?\binputs\s*:\s*\n[\s\S]*?\bbranch\s*:/m.test(
      workflow,
    );
  const usesDispatchBranch = /\$\{\{\s*inputs\.branch\s*\}\}/.test(workflow);
  const autoSwitchesBranch = /\bAUTO_SWITCH_BRANCH=1\b/.test(workflow);

  if (hasBranchDispatchInput || usesDispatchBranch || autoSwitchesBranch) {
    issues.push({
      severity: "error",
      code: "UNSAFE_PRODUCTION_DEPLOY_BRANCH_INPUT",
      message:
        "Production deploy workflow allows arbitrary branch selection; remove workflow_dispatch branch input and pin deploys to the protected default branch.",
    });
  }

  if (!/\benvironment\s*:\s*production\b/.test(workflow)) {
    issues.push({
      severity: "error",
      code: "MISSING_PRODUCTION_DEPLOY_ENVIRONMENT",
      message:
        "Production deploy workflow must target the GitHub production environment so reviewer and secret gates apply before deploy.",
    });
  }

  const verifiesDeployInfo =
    workflow.includes("PUBLIC_APP_URL") &&
    workflow.includes("/api/deploy-info") &&
    /\bcurl\b[\s\S]*--fail/.test(workflow);
  if (!verifiesDeployInfo) {
    issues.push({
      severity: "error",
      code: "MISSING_PRODUCTION_DEPLOY_INFO_VERIFICATION",
      message:
        "Production deploy workflow must verify the deployed /api/deploy-info endpoint after the SSH deploy completes.",
    });
  }
}

function evaluateProductionDeployScript(
  issues: ProductionReadinessIssue[],
  script: string,
): void {
  if (!script.trim()) return;

  const hasBranchSwitchGuard =
    script.includes("ALLOW_DEPLOY_BRANCH_SWITCH") &&
    /if \[ "\$ALLOW_DEPLOY_BRANCH_SWITCH" != "1" \]/.test(script) &&
    script.includes("branch switching is disabled for deploys");
  if (!hasBranchSwitchGuard) {
    issues.push({
      severity: "error",
      code: "UNSAFE_DEPLOY_SCRIPT_BRANCH_SWITCH",
      message:
        "Server-side deploy script must reject automatic branch switching unless ALLOW_DEPLOY_BRANCH_SWITCH=1 is explicitly set for a reviewed manual deploy.",
    });
  }

  const hasBranchAllowlist =
    script.includes("DEPLOY_BRANCH_ALLOWLIST") &&
    script.includes("ALLOW_UNLISTED_DEPLOY_BRANCH") &&
    script.includes("git check-ref-format --branch") &&
    script.includes("deploy target branch is not allowlisted");
  if (!hasBranchAllowlist) {
    issues.push({
      severity: "error",
      code: "MISSING_DEPLOY_SCRIPT_BRANCH_ALLOWLIST",
      message:
        "Server-side deploy script must validate target branch names and require an explicit reviewed override for unlisted deploy branches.",
    });
  }

  const hasDirtyTreeGuard =
    script.includes("ALLOW_DIRTY") &&
    script.includes("git status --porcelain") &&
    script.includes("working tree is dirty");
  if (!hasDirtyTreeGuard) {
    issues.push({
      severity: "error",
      code: "MISSING_DEPLOY_SCRIPT_DIRTY_TREE_GUARD",
      message:
        "Server-side deploy script must fail on a dirty working tree unless ALLOW_DIRTY=1 is explicitly set for a reviewed manual deploy.",
    });
  }

  const hasEnvFileCheck =
    script.includes("ENV_FILE") &&
    script.includes('if [ ! -f "$ENV_FILE" ]; then') &&
    script.includes("the systemd unit requires it") &&
    script.indexOf('if [ ! -f "$ENV_FILE" ]; then') <
      script.indexOf('sudo systemctl restart "$SERVICE_NAME"');
  if (!hasEnvFileCheck) {
    issues.push({
      severity: "error",
      code: "MISSING_DEPLOY_SCRIPT_ENV_FILE_CHECK",
      message:
        "Server-side deploy script must verify the external production env file exists before restarting the service.",
    });
  }

  const hasDeployInfoVerification =
    script.includes('/api/deploy-info') &&
    script.includes("deploy.commit !== expectedCommit") &&
    script.includes("deploy.branch !== expectedBranch") &&
    script.includes("spaReady=false");
  if (!hasDeployInfoVerification) {
    issues.push({
      severity: "error",
      code: "MISSING_DEPLOY_SCRIPT_DEPLOY_INFO_VERIFICATION",
      message:
        "Server-side deploy script must verify /api/deploy-info reports the deployed branch, commit, and SPA readiness after restart.",
    });
  }
}

function requireSecretLength(
  issues: ProductionReadinessIssue[],
  env: Env,
  key: string,
  minLength: number,
  message: string,
): void {
  const value = env[key]?.trim();
  if (!value || value.length >= minLength) return;
  issues.push({
    severity: "error",
    code: `WEAK_${key}`,
    message,
  });
}

function requireNonBlank(
  issues: ProductionReadinessIssue[],
  env: Env,
  key: string,
  message: string,
): void {
  if (isPresent(env[key])) return;
  issues.push({
    severity: "error",
    code: `MISSING_${key}`,
    message,
  });
}

function normalize(value: string | undefined, fallback: string): string {
  const normalized = value?.trim().toLowerCase();
  return normalized || fallback;
}

function isPresent(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

function hasAny(env: Env, keys: string[]): boolean {
  return keys.some((key) => isPresent(env[key]));
}

function isTruthyFlag(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function isTempPath(value: string): boolean {
  const normalized = value.replace(/\\/g, "/");
  return (
    normalized === "/tmp" ||
    normalized.startsWith("/tmp/") ||
    normalized === "/var/tmp" ||
    normalized.startsWith("/var/tmp/")
  );
}

function looksPlaceholderSecret(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized.includes("...")) return true;
  return /(^|[^a-z0-9])(test|example|placeholder|dummy|changeme|change-me|todo|sample)([^a-z0-9]|$)/i.test(
    normalized,
  );
}

function hasLowEntropySecretShape(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 16) return false;
  if (/^(.)\1+$/.test(trimmed)) return true;

  const uniqueCharacters = new Set(trimmed).size;
  if (uniqueCharacters <= 3) return true;

  const repeatedUnit = trimmed.match(/^(.{2,8})\1+$/);
  return Boolean(repeatedUnit);
}

function parseEmailDomain(value: string): string | null {
  const trimmed = value.trim();
  const bracketed = trimmed.match(/<([^<>\s]+@[^<>\s]+)>/);
  const email = bracketed?.[1] ?? trimmed.match(/^[^\s<>]+@[^\s<>]+$/)?.[0];
  const domain = email?.split("@").pop()?.toLowerCase().replace(/\.$/, "");
  return domain || null;
}

function isPlaceholderDomain(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return (
    host === "example.com" ||
    host === "example.net" ||
    host === "example.org" ||
    host.endsWith(".example") ||
    host.endsWith(".example.com") ||
    host.endsWith(".example.net") ||
    host.endsWith(".example.org")
  );
}

function hasPublicDomainName(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (isIP(host.replace(/^\[|\]$/g, ""))) return false;

  const labels = host.split(".");
  if (labels.length < 2) return false;

  const topLevelDomain = labels[labels.length - 1];
  if (!/^[a-z][a-z0-9-]{1,62}$/.test(topLevelDomain)) return false;

  return labels.every(
    (label) =>
      /^[a-z0-9][a-z0-9-]{0,62}$/.test(label) && !label.endsWith("-"),
  );
}

function isLocalOrPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host === "[::1]" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".invalid") ||
    host.endsWith(".test")
  ) {
    return true;
  }

  if (isIP(host) !== 4) return false;

  const [first, second] = host.split(".").map(Number);
  if (first === 10 || first === 127) return true;
  if (first === 169 && second === 254) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && second === 168) return true;

  return false;
}
