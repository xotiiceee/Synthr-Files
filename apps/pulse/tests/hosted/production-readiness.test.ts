import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { createSomaHeart } from "soma-heart";
import { getCryptoProvider } from "soma-heart/crypto-provider";
import { commitGenome, createGenome } from "soma-heart/core";
import { afterAll, describe, expect, it } from "vitest";

import { evaluateProductionReadiness } from "../../hosted/production-readiness.js";

fs.mkdirSync(path.resolve("data"), { recursive: true });
const persistenceRoot = fs.mkdtempSync(
  path.resolve("data", "pulse-readiness-"),
);
const hostedDbPath = path.join(persistenceRoot, "hosted.db");
const pulseHeartPath = path.join(persistenceRoot, "pulse-heart.json");
const db = new Database(hostedDbPath);
db.exec("CREATE TABLE readiness_marker (value TEXT)");
db.close();
const pulseHeartSecret = "heart_secret_".padEnd(32, "x");
fs.writeFileSync(pulseHeartPath, createSerializedPulseHeart(pulseHeartSecret));

const validEnv = {
  NODE_ENV: "production",
  PULSE_URL: "https://app.pulse.example",
  HOSTED_DB_PATH: hostedDbPath,
  PULSE_HEART_PATH: pulseHeartPath,
  TENANT_ENCRYPTION_KEY:
    "0123456789abcdef0123456789abcdeffedcba9876543210fedcba9876543210",
  ADMIN_API_KEY: "admin_key_".padEnd(32, "x"),
  AUTH_PROVIDER: "firstparty",
  BILLING_PROVIDER: "clawnet",
  STRIPE_WEBHOOK_SECRET: "whsec_live_secret",
  SCHEDULER_MODE: "durable",
  GROQ_API_KEY: "gsk_live_secret",
  SEARCH_PROVIDER: "serper",
  SERPER_API_KEY: "serper_live_secret",
  PULSE_HEART_SECRET: pulseHeartSecret,
  X_OAUTH_CLIENT_ID: "x_client",
  X_OAUTH_CLIENT_SECRET: "x_secret",
  X_MONTHLY_POST_LIMIT: "3000",
  RESEND_API_KEY: "re_live_secret",
  RESEND_FROM: "Pulse <notifications@pulse.com>",
  PULSE_SUPPORT_EMAIL: "support@pulse.com",
};

describe("production readiness", () => {
  afterAll(() => {
    fs.rmSync(persistenceRoot, { recursive: true, force: true });
  });

  it("fails closed when required hosted production secrets are absent", () => {
    const report = evaluateProductionReadiness({}, { standaloneLaunch: true });

    expect(report.ok).toBe(false);
    expect(report.errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "MISSING_PULSE_URL",
        "MISSING_TENANT_ENCRYPTION_KEY",
        "MISSING_ADMIN_API_KEY",
        "MISSING_LLM_PROVIDER_KEY",
        "MISSING_SEARCH_PROVIDER_KEY",
      ]),
    );
  });

  it("accepts a deployable standalone runtime while warning on unfinished billing", () => {
    const report = evaluateProductionReadiness(validEnv, {
      standaloneLaunch: true,
    });

    expect(report.ok).toBe(true);
    expect(report.warnings.map((issue) => issue.code)).toContain(
      "BILLING_PROVIDER_NOT_STANDALONE",
    );
  });

  it("accepts Stripe as the standalone billing provider", () => {
    const report = evaluateProductionReadiness(
      {
        ...validEnv,
        BILLING_PROVIDER: "stripe",
      },
      { standaloneLaunch: true },
    );

    expect(report.ok).toBe(true);
    expect(report.warnings.map((issue) => issue.code)).not.toContain(
      "BILLING_PROVIDER_NOT_STANDALONE",
    );
  });

  it("fails strict customer launch while autonomous write durability and domain gates are open", () => {
    const report = evaluateProductionReadiness(
      {
        ...validEnv,
        BILLING_PROVIDER: "stripe",
        PULSE_CUSTOMER_LAUNCH: "true",
      },
      { standaloneLaunch: true, customerLaunch: true },
    );

    expect(report.ok).toBe(false);
    expect(report.errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "PULSE_URL_PLACEHOLDER_DOMAIN",
        "SCHEDULER_WRITES_NOT_DURABLE",
      ]),
    );
  });

  it("treats common truthy customer-launch env values as strict mode", () => {
    const report = evaluateProductionReadiness({
      ...validEnv,
      PULSE_URL: "https://app.pulse.com",
      BILLING_PROVIDER: "stripe",
      PULSE_CUSTOMER_LAUNCH: "1",
      PULSE_DURABLE_SCHEDULER_WRITES: "true",
      NODE_ENV: "development",
    });

    expect(report.ok).toBe(false);
    expect(report.errors.map((issue) => issue.code)).toContain(
      "NODE_ENV_NOT_PRODUCTION",
    );
  });

  it("requires explicit durable persistence paths for strict customer launch", () => {
    const {
      HOSTED_DB_PATH: _dbPath,
      PULSE_HEART_PATH: _heartPath,
      ...envWithoutPersistencePaths
    } = validEnv;
    const report = evaluateProductionReadiness(
      {
        ...envWithoutPersistencePaths,
        PULSE_URL: "https://app.pulse.com",
        BILLING_PROVIDER: "stripe",
        PULSE_CUSTOMER_LAUNCH: "true",
        PULSE_DURABLE_SCHEDULER_WRITES: "true",
      },
      { standaloneLaunch: true, customerLaunch: true },
    );

    expect(report.ok).toBe(false);
    expect(report.errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "MISSING_HOSTED_DB_PATH",
        "MISSING_PULSE_HEART_PATH",
      ]),
    );
  });

  it("blocks relative or temporary persistence paths for strict customer launch", () => {
    const report = evaluateProductionReadiness(
      {
        ...validEnv,
        PULSE_URL: "https://app.pulse.com",
        BILLING_PROVIDER: "stripe",
        PULSE_CUSTOMER_LAUNCH: "true",
        PULSE_DURABLE_SCHEDULER_WRITES: "true",
        HOSTED_DB_PATH: "data/hosted.db",
        PULSE_HEART_PATH: "/tmp/pulse-heart.json",
      },
      { standaloneLaunch: true, customerLaunch: true },
    );

    expect(report.ok).toBe(false);
    expect(report.errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "HOSTED_DB_PATH_NOT_ABSOLUTE",
        "PULSE_HEART_PATH_TEMP_PATH",
      ]),
    );
  });

  it("blocks missing persistence files for strict customer launch", () => {
    const report = evaluateProductionReadiness(
      {
        ...validEnv,
        PULSE_URL: "https://app.pulse.com",
        BILLING_PROVIDER: "stripe",
        PULSE_CUSTOMER_LAUNCH: "true",
        PULSE_DURABLE_SCHEDULER_WRITES: "true",
        HOSTED_DB_PATH: path.join(persistenceRoot, "missing-hosted.db"),
        PULSE_HEART_PATH: path.join(persistenceRoot, "missing-heart.json"),
      },
      { standaloneLaunch: true, customerLaunch: true },
    );

    expect(report.ok).toBe(false);
    expect(report.errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "HOSTED_DB_PATH_NOT_FOUND",
        "PULSE_HEART_PATH_NOT_FOUND",
      ]),
    );
  });

  it("blocks directory persistence paths for strict customer launch", () => {
    const dbDirectory = path.join(persistenceRoot, "hosted-db-dir");
    const heartDirectory = path.join(persistenceRoot, "heart-dir");
    fs.mkdirSync(dbDirectory);
    fs.mkdirSync(heartDirectory);

    const report = evaluateProductionReadiness(
      {
        ...validEnv,
        PULSE_URL: "https://app.pulse.com",
        BILLING_PROVIDER: "stripe",
        PULSE_CUSTOMER_LAUNCH: "true",
        PULSE_DURABLE_SCHEDULER_WRITES: "true",
        HOSTED_DB_PATH: dbDirectory,
        PULSE_HEART_PATH: heartDirectory,
      },
      { standaloneLaunch: true, customerLaunch: true },
    );

    expect(report.ok).toBe(false);
    expect(report.errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "HOSTED_DB_PATH_NOT_FILE",
        "PULSE_HEART_PATH_NOT_FILE",
      ]),
    );
  });

  it("blocks unreadable hosted DB files for strict customer launch", () => {
    const corruptDbPath = path.join(persistenceRoot, "corrupt-hosted.db");
    fs.writeFileSync(corruptDbPath, "not sqlite");

    const report = evaluateProductionReadiness(
      {
        ...validEnv,
        PULSE_URL: "https://app.pulse.com",
        BILLING_PROVIDER: "stripe",
        PULSE_CUSTOMER_LAUNCH: "true",
        PULSE_DURABLE_SCHEDULER_WRITES: "true",
        HOSTED_DB_PATH: corruptDbPath,
      },
      { standaloneLaunch: true, customerLaunch: true },
    );

    expect(report.ok).toBe(false);
    expect(report.errors.map((issue) => issue.code)).toContain(
      "HOSTED_DB_PATH_UNREADABLE",
    );
  });

  it("blocks unreadable Pulse heart files for strict customer launch", () => {
    const corruptHeartPath = path.join(persistenceRoot, "corrupt-heart.json");
    fs.writeFileSync(corruptHeartPath, "{}");

    const report = evaluateProductionReadiness(
      {
        ...validEnv,
        PULSE_URL: "https://app.pulse.com",
        BILLING_PROVIDER: "stripe",
        PULSE_CUSTOMER_LAUNCH: "true",
        PULSE_DURABLE_SCHEDULER_WRITES: "true",
        PULSE_HEART_PATH: corruptHeartPath,
      },
      { standaloneLaunch: true, customerLaunch: true },
    );

    expect(report.ok).toBe(false);
    expect(report.errors.map((issue) => issue.code)).toContain(
      "PULSE_HEART_PATH_UNREADABLE",
    );
  });

  it("blocks reserved example launch domains for customer launch", () => {
    const report = evaluateProductionReadiness(
      {
        ...validEnv,
        PULSE_URL: "https://app.example.com",
        BILLING_PROVIDER: "stripe",
        PULSE_CUSTOMER_LAUNCH: "true",
        PULSE_DURABLE_SCHEDULER_WRITES: "true",
        X_OAUTH_CALLBACK_URL: "https://auth.example.net/auth/x/callback",
        RESEND_FROM: "Pulse <notifications@example.org>",
        PULSE_SUPPORT_EMAIL: "support@example.com",
      },
      { standaloneLaunch: true, customerLaunch: true },
    );

    expect(report.ok).toBe(false);
    expect(report.errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "PULSE_URL_PLACEHOLDER_DOMAIN",
        "X_OAUTH_CALLBACK_URL_PLACEHOLDER_DOMAIN",
        "RESEND_FROM_PLACEHOLDER_DOMAIN",
        "PULSE_SUPPORT_EMAIL_PLACEHOLDER_DOMAIN",
      ]),
    );
  });

  it("accepts strict customer launch after durable write and real-domain gates are closed", () => {
    const report = evaluateProductionReadiness(
      {
        ...validEnv,
        PULSE_URL: "https://app.pulse.com",
        BILLING_PROVIDER: "stripe",
        PULSE_CUSTOMER_LAUNCH: "true",
        PULSE_DURABLE_SCHEDULER_WRITES: "true",
      },
      { standaloneLaunch: true, customerLaunch: true },
    );

    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
  });

  it("blocks non-origin Pulse URLs for strict customer launch", () => {
    const report = evaluateProductionReadiness(
      {
        ...validEnv,
        PULSE_URL: "https://app.pulse.com/dashboard?tenant=demo#top",
        BILLING_PROVIDER: "stripe",
        PULSE_CUSTOMER_LAUNCH: "true",
        PULSE_DURABLE_SCHEDULER_WRITES: "true",
      },
      { standaloneLaunch: true, customerLaunch: true },
    );

    expect(report.ok).toBe(false);
    expect(report.errors.map((issue) => issue.code)).toContain(
      "PULSE_URL_NOT_ORIGIN",
    );
  });

  it("blocks non-canonical raw Pulse URL origins for strict customer launch", () => {
    const withTrailingSlash = evaluateProductionReadiness(
      {
        ...validEnv,
        PULSE_URL: "https://app.pulse.com/",
        BILLING_PROVIDER: "stripe",
        PULSE_CUSTOMER_LAUNCH: "true",
        PULSE_DURABLE_SCHEDULER_WRITES: "true",
      },
      { standaloneLaunch: true, customerLaunch: true },
    );
    const withDefaultPort = evaluateProductionReadiness(
      {
        ...validEnv,
        PULSE_URL: "https://app.pulse.com:443",
        BILLING_PROVIDER: "stripe",
        PULSE_CUSTOMER_LAUNCH: "true",
        PULSE_DURABLE_SCHEDULER_WRITES: "true",
      },
      { standaloneLaunch: true, customerLaunch: true },
    );

    expect(withTrailingSlash.ok).toBe(false);
    expect(withTrailingSlash.errors.map((issue) => issue.code)).toContain(
      "PULSE_URL_NOT_CANONICAL_ORIGIN",
    );
    expect(withDefaultPort.ok).toBe(false);
    expect(withDefaultPort.errors.map((issue) => issue.code)).toContain(
      "PULSE_URL_NOT_CANONICAL_ORIGIN",
    );
  });

  it("blocks Pulse URLs with credentials or explicit ports for strict customer launch", () => {
    const withCredentials = evaluateProductionReadiness(
      {
        ...validEnv,
        PULSE_URL: "https://operator:secret@app.pulse.com",
        BILLING_PROVIDER: "stripe",
        PULSE_CUSTOMER_LAUNCH: "true",
        PULSE_DURABLE_SCHEDULER_WRITES: "true",
      },
      { standaloneLaunch: true, customerLaunch: true },
    );
    const withPort = evaluateProductionReadiness(
      {
        ...validEnv,
        PULSE_URL: "https://app.pulse.com:8443",
        BILLING_PROVIDER: "stripe",
        PULSE_CUSTOMER_LAUNCH: "true",
        PULSE_DURABLE_SCHEDULER_WRITES: "true",
      },
      { standaloneLaunch: true, customerLaunch: true },
    );

    expect(withCredentials.ok).toBe(false);
    expect(withCredentials.errors.map((issue) => issue.code)).toContain(
      "PULSE_URL_HAS_CREDENTIALS",
    );
    expect(withPort.ok).toBe(false);
    expect(withPort.errors.map((issue) => issue.code)).toContain(
      "PULSE_URL_HAS_PORT",
    );
  });

  it("blocks hosted follow churn opt-in for strict customer launch", () => {
    const report = evaluateProductionReadiness(
      {
        ...validEnv,
        PULSE_URL: "https://app.pulse.com",
        BILLING_PROVIDER: "stripe",
        PULSE_CUSTOMER_LAUNCH: "true",
        PULSE_DURABLE_SCHEDULER_WRITES: "true",
        PULSE_ALLOW_FOLLOW_CHURN: "true",
      },
      { standaloneLaunch: true, customerLaunch: true },
    );

    expect(report.ok).toBe(false);
    expect(report.errors.map((issue) => issue.code)).toContain(
      "FOLLOW_CHURN_ENABLED_FOR_CUSTOMER_LAUNCH",
    );
  });

  it("blocks strict customer launch outside production runtime mode", () => {
    const report = evaluateProductionReadiness(
      {
        ...validEnv,
        NODE_ENV: "development",
        PULSE_URL: "https://app.pulse.com",
        BILLING_PROVIDER: "stripe",
        PULSE_CUSTOMER_LAUNCH: "true",
        PULSE_DURABLE_SCHEDULER_WRITES: "true",
      },
      { standaloneLaunch: true, customerLaunch: true },
    );

    expect(report.ok).toBe(false);
    expect(report.errors.map((issue) => issue.code)).toContain(
      "NODE_ENV_NOT_PRODUCTION",
    );
  });

  it("warns on non-production runtime mode before strict customer launch", () => {
    const { NODE_ENV: _nodeEnv, ...envWithoutNodeEnv } = validEnv;
    const report = evaluateProductionReadiness(envWithoutNodeEnv, {
      standaloneLaunch: true,
    });

    expect(report.ok).toBe(true);
    expect(report.warnings.map((issue) => issue.code)).toContain(
      "NODE_ENV_NOT_PRODUCTION",
    );
  });

  it("blocks production deploy workflows that can deploy arbitrary branches", () => {
    const report = evaluateProductionReadiness(
      {
        ...validEnv,
        PULSE_URL: "https://app.pulse.com",
        BILLING_PROVIDER: "stripe",
        PULSE_CUSTOMER_LAUNCH: "true",
        PULSE_DURABLE_SCHEDULER_WRITES: "true",
      },
      {
        standaloneLaunch: true,
        customerLaunch: true,
        productionDeployWorkflow: `
          on:
            workflow_dispatch:
              inputs:
                branch:
                  default: master
          jobs:
            deploy:
              steps:
                - uses: actions/checkout@v5
                  with:
                    ref: \${{ inputs.branch }}
                - run: AUTO_SWITCH_BRANCH=1 bash scripts/deploy.sh
        `,
      },
    );

    expect(report.ok).toBe(false);
    expect(report.errors.map((issue) => issue.code)).toContain(
      "UNSAFE_PRODUCTION_DEPLOY_BRANCH_INPUT",
    );
  });

  it("blocks production deploy workflows without environment and deploy-info gates", () => {
    const report = evaluateProductionReadiness(
      {
        ...validEnv,
        PULSE_URL: "https://app.pulse.com",
        BILLING_PROVIDER: "stripe",
        PULSE_CUSTOMER_LAUNCH: "true",
        PULSE_DURABLE_SCHEDULER_WRITES: "true",
      },
      {
        standaloneLaunch: true,
        customerLaunch: true,
        productionDeployWorkflow: `
          on:
            workflow_dispatch:
          jobs:
            deploy:
              runs-on: ubuntu-latest
              steps:
                - uses: actions/checkout@93cb6efe18208431cddfb8368fd83d5badbf9bfd
                - run: ssh deploy@host "cd /home/deploy/pulse && GIT_BRANCH=master bash scripts/deploy.sh"
        `,
      },
    );

    expect(report.ok).toBe(false);
    expect(report.errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "MISSING_PRODUCTION_DEPLOY_ENVIRONMENT",
        "MISSING_PRODUCTION_DEPLOY_INFO_VERIFICATION",
      ]),
    );
  });

  it("accepts production deploy workflows with environment and deploy-info gates", () => {
    const report = evaluateProductionReadiness(
      {
        ...validEnv,
        PULSE_URL: "https://app.pulse.com",
        BILLING_PROVIDER: "stripe",
        PULSE_CUSTOMER_LAUNCH: "true",
        PULSE_DURABLE_SCHEDULER_WRITES: "true",
      },
      {
        standaloneLaunch: true,
        customerLaunch: true,
        productionDeployWorkflow: `
          on:
            workflow_dispatch:
          jobs:
            deploy:
              runs-on: ubuntu-latest
              environment: production
              steps:
                - uses: actions/checkout@93cb6efe18208431cddfb8368fd83d5badbf9bfd
                - run: ssh deploy@host "cd /home/deploy/pulse && GIT_BRANCH=master bash scripts/deploy.sh"
                - env:
                    PUBLIC_APP_URL: \${{ vars.PUBLIC_APP_URL }}
                  run: curl --fail --silent --show-error "\${PUBLIC_APP_URL%/}/api/deploy-info"
        `,
      },
    );

    expect(report.errors.map((issue) => issue.code)).not.toEqual(
      expect.arrayContaining([
        "MISSING_PRODUCTION_DEPLOY_ENVIRONMENT",
        "MISSING_PRODUCTION_DEPLOY_INFO_VERIFICATION",
      ]),
    );
  });

  it("blocks server-side deploy scripts without branch switching and allowlist guards", () => {
    const report = evaluateProductionReadiness(
      {
        ...validEnv,
        PULSE_URL: "https://app.pulse.com",
        BILLING_PROVIDER: "stripe",
        PULSE_CUSTOMER_LAUNCH: "true",
        PULSE_DURABLE_SCHEDULER_WRITES: "true",
      },
      {
        standaloneLaunch: true,
        customerLaunch: true,
        productionDeployScript: `
          TARGET_BRANCH="\${GIT_BRANCH:-master}"
          git fetch origin "$TARGET_BRANCH"
          git checkout "$TARGET_BRANCH"
          git pull --ff-only origin "$TARGET_BRANCH"
          sudo systemctl restart pulse-hosted
        `,
      },
    );

    expect(report.ok).toBe(false);
    expect(report.errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "UNSAFE_DEPLOY_SCRIPT_BRANCH_SWITCH",
        "MISSING_DEPLOY_SCRIPT_BRANCH_ALLOWLIST",
      ]),
    );
  });

  it("blocks server-side deploy scripts without dirty tree, env file, and deploy-info guards", () => {
    const report = evaluateProductionReadiness(
      {
        ...validEnv,
        PULSE_URL: "https://app.pulse.com",
        BILLING_PROVIDER: "stripe",
        PULSE_CUSTOMER_LAUNCH: "true",
        PULSE_DURABLE_SCHEDULER_WRITES: "true",
      },
      {
        standaloneLaunch: true,
        customerLaunch: true,
        productionDeployScript: `
          ALLOW_DEPLOY_BRANCH_SWITCH="\${ALLOW_DEPLOY_BRANCH_SWITCH:-0}"
          DEPLOY_BRANCH_ALLOWLIST="\${DEPLOY_BRANCH_ALLOWLIST:-master main}"
          ALLOW_UNLISTED_DEPLOY_BRANCH="\${ALLOW_UNLISTED_DEPLOY_BRANCH:-0}"
          git check-ref-format --branch "$TARGET_BRANCH"
          echo "branch switching is disabled for deploys"
          echo "deploy target branch is not allowlisted"
          sudo systemctl restart "$SERVICE_NAME"
        `,
      },
    );

    expect(report.ok).toBe(false);
    expect(report.errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "MISSING_DEPLOY_SCRIPT_DIRTY_TREE_GUARD",
        "MISSING_DEPLOY_SCRIPT_ENV_FILE_CHECK",
        "MISSING_DEPLOY_SCRIPT_DEPLOY_INFO_VERIFICATION",
      ]),
    );
  });

  it("accepts the server-side deploy script when branch guards are present", () => {
    const report = evaluateProductionReadiness(
      {
        ...validEnv,
        PULSE_URL: "https://app.pulse.com",
        BILLING_PROVIDER: "stripe",
        PULSE_CUSTOMER_LAUNCH: "true",
        PULSE_DURABLE_SCHEDULER_WRITES: "true",
      },
      {
        standaloneLaunch: true,
        customerLaunch: true,
        productionDeployScript: fs.readFileSync(
          path.join(process.cwd(), "scripts", "deploy.sh"),
          "utf-8",
        ),
      },
    );

    expect(report.errors.map((issue) => issue.code)).not.toEqual(
      expect.arrayContaining([
        "UNSAFE_DEPLOY_SCRIPT_BRANCH_SWITCH",
        "MISSING_DEPLOY_SCRIPT_BRANCH_ALLOWLIST",
        "MISSING_DEPLOY_SCRIPT_DIRTY_TREE_GUARD",
        "MISSING_DEPLOY_SCRIPT_ENV_FILE_CHECK",
        "MISSING_DEPLOY_SCRIPT_DEPLOY_INFO_VERIFICATION",
      ]),
    );
  });

  it("requires STRIPE_WEBHOOK_SECRET when Stripe billing is enabled", () => {
    const report = evaluateProductionReadiness(
      {
        ...validEnv,
        BILLING_PROVIDER: "stripe",
        STRIPE_WEBHOOK_SECRET: "",
      },
      { standaloneLaunch: true },
    );

    expect(report.ok).toBe(false);
    expect(report.errors.map((issue) => issue.code)).toContain(
      "MISSING_STRIPE_WEBHOOK_SECRET",
    );
  });

  it("requires a Stripe endpoint secret format when Stripe billing is enabled", () => {
    const report = evaluateProductionReadiness(
      {
        ...validEnv,
        BILLING_PROVIDER: "stripe",
        STRIPE_WEBHOOK_SECRET: "sk_test_not_a_webhook_secret",
      },
      { standaloneLaunch: true },
    );

    expect(report.ok).toBe(false);
    expect(report.errors.map((issue) => issue.code)).toContain(
      "INVALID_STRIPE_WEBHOOK_SECRET",
    );
  });

  it("blocks placeholder provider credentials for strict customer launch", () => {
    const report = evaluateProductionReadiness(
      {
        ...validEnv,
        PULSE_URL: "https://app.pulse.com",
        BILLING_PROVIDER: "stripe",
        STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
        PULSE_CUSTOMER_LAUNCH: "true",
        PULSE_DURABLE_SCHEDULER_WRITES: "true",
        GROQ_API_KEY: "gsk_test",
        SERPER_API_KEY: "serper_example",
        RESEND_API_KEY: "re_placeholder",
        X_OAUTH_CLIENT_SECRET: "dummy-x-secret",
      },
      { standaloneLaunch: true, customerLaunch: true },
    );

    expect(report.ok).toBe(false);
    expect(report.errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "PLACEHOLDER_STRIPE_WEBHOOK_SECRET",
        "PLACEHOLDER_GROQ_API_KEY",
        "PLACEHOLDER_SERPER_API_KEY",
        "PLACEHOLDER_RESEND_API_KEY",
        "PLACEHOLDER_X_OAUTH_CLIENT_SECRET",
      ]),
    );
  });

  it("blocks invalid runtime flags", () => {
    const report = evaluateProductionReadiness(
      {
        ...validEnv,
        AUTH_PROVIDER: "oauth",
        BILLING_PROVIDER: "paypal",
        SCHEDULER_MODE: "cron",
      },
      { standaloneLaunch: true },
    );

    expect(report.ok).toBe(false);
    expect(report.errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "INVALID_AUTH_PROVIDER",
        "INVALID_BILLING_PROVIDER",
        "INVALID_SCHEDULER_MODE",
      ]),
    );
  });

  it("blocks weak hosted operator secrets", () => {
    const report = evaluateProductionReadiness(
      {
        ...validEnv,
        ADMIN_API_KEY: "short",
        PULSE_HEART_SECRET: "also_short",
      },
      { standaloneLaunch: true },
    );

    expect(report.ok).toBe(false);
    expect(report.errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["WEAK_ADMIN_API_KEY", "WEAK_PULSE_HEART_SECRET"]),
    );
  });

  it("blocks low-entropy server secrets for strict customer launch", () => {
    const report = evaluateProductionReadiness(
      {
        ...validEnv,
        PULSE_URL: "https://app.pulse.com",
        BILLING_PROVIDER: "stripe",
        PULSE_CUSTOMER_LAUNCH: "true",
        PULSE_DURABLE_SCHEDULER_WRITES: "true",
        TENANT_ENCRYPTION_KEY: "a".repeat(64),
        ADMIN_API_KEY: "k".repeat(40),
        PULSE_HEART_SECRET: "heart".repeat(8),
      },
      { standaloneLaunch: true, customerLaunch: true },
    );

    expect(report.ok).toBe(false);
    expect(report.errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "LOW_ENTROPY_TENANT_ENCRYPTION_KEY",
        "LOW_ENTROPY_ADMIN_API_KEY",
        "LOW_ENTROPY_PULSE_HEART_SECRET",
      ]),
    );
  });

  it("warns when customer launch still points at ClawNet defaults", () => {
    const report = evaluateProductionReadiness(
      {
        ...validEnv,
        PULSE_URL: "https://pulse.claw-net.org",
        AUTH_PROVIDER: "clawnet",
        SCHEDULER_MODE: "legacy",
      },
      { standaloneLaunch: true },
    );

    expect(report.ok).toBe(true);
    expect(report.warnings.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "PULSE_URL_STILL_CLAWNET",
        "AUTH_PROVIDER_NOT_STANDALONE",
        "SCHEDULER_NOT_DURABLE",
      ]),
    );
  });

  it("turns standalone rollback warnings into errors for customer launch", () => {
    const report = evaluateProductionReadiness(
      {
        ...validEnv,
        PULSE_URL: "https://pulse.claw-net.org",
        AUTH_PROVIDER: "clawnet",
        BILLING_PROVIDER: "clawnet",
        SCHEDULER_MODE: "legacy",
      },
      { standaloneLaunch: true, customerLaunch: true },
    );

    expect(report.ok).toBe(false);
    expect(report.errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "PULSE_URL_STILL_CLAWNET",
        "AUTH_PROVIDER_NOT_STANDALONE",
        "BILLING_PROVIDER_NOT_STANDALONE",
        "SCHEDULER_NOT_DURABLE",
      ]),
    );
  });

  it("requires the Pulse heart secret for strict customer launch", () => {
    const { PULSE_HEART_SECRET: _heartSecret, ...envWithoutHeartSecret } =
      validEnv;
    const report = evaluateProductionReadiness(
      {
        ...envWithoutHeartSecret,
        PULSE_URL: "https://app.pulse.com",
        BILLING_PROVIDER: "stripe",
        PULSE_CUSTOMER_LAUNCH: "true",
        PULSE_DURABLE_SCHEDULER_WRITES: "true",
      },
      { standaloneLaunch: true, customerLaunch: true },
    );

    expect(report.ok).toBe(false);
    expect(report.errors.map((issue) => issue.code)).toContain(
      "MISSING_PULSE_HEART_SECRET",
    );
  });

  it("blocks ClawNet email sender defaults for customer launch", () => {
    const report = evaluateProductionReadiness(
      {
        ...validEnv,
        PULSE_URL: "https://app.pulse.com",
        BILLING_PROVIDER: "stripe",
        PULSE_CUSTOMER_LAUNCH: "true",
        PULSE_DURABLE_SCHEDULER_WRITES: "true",
        RESEND_FROM: "Pulse <notifications@claw-net.org>",
        PULSE_SUPPORT_EMAIL: "hello@claw-net.org",
      },
      { standaloneLaunch: true, customerLaunch: true },
    );

    expect(report.ok).toBe(false);
    expect(report.errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "RESEND_FROM_STILL_CLAWNET",
        "SUPPORT_EMAIL_STILL_CLAWNET",
      ]),
    );
  });

  it("requires email provider, sender, and support address for customer launch", () => {
    const {
      RESEND_API_KEY: _resendApiKey,
      RESEND_FROM: _resendFrom,
      PULSE_SUPPORT_EMAIL: _supportEmail,
      ...envWithoutEmailPosture
    } = validEnv;
    const report = evaluateProductionReadiness(
      {
        ...envWithoutEmailPosture,
        PULSE_URL: "https://app.pulse.com",
        BILLING_PROVIDER: "stripe",
        PULSE_CUSTOMER_LAUNCH: "true",
        PULSE_DURABLE_SCHEDULER_WRITES: "true",
      },
      { standaloneLaunch: true, customerLaunch: true },
    );

    expect(report.ok).toBe(false);
    expect(report.errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "MISSING_RESEND_API_KEY",
        "MISSING_RESEND_FROM",
        "MISSING_PULSE_SUPPORT_EMAIL",
      ]),
    );
  });

  it("blocks placeholder and local email domains for customer launch", () => {
    const report = evaluateProductionReadiness(
      {
        ...validEnv,
        PULSE_URL: "https://app.pulse.com",
        BILLING_PROVIDER: "stripe",
        PULSE_CUSTOMER_LAUNCH: "true",
        PULSE_DURABLE_SCHEDULER_WRITES: "true",
        RESEND_FROM: "Pulse <notifications@pulse.example>",
        PULSE_SUPPORT_EMAIL: "support@pulse.internal",
      },
      { standaloneLaunch: true, customerLaunch: true },
    );

    expect(report.ok).toBe(false);
    expect(report.errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "RESEND_FROM_PLACEHOLDER_DOMAIN",
        "PULSE_SUPPORT_EMAIL_NOT_PUBLIC_DOMAIN",
      ]),
    );
  });

  it("blocks malformed customer-launch email addresses", () => {
    const report = evaluateProductionReadiness(
      {
        ...validEnv,
        PULSE_URL: "https://app.pulse.com",
        BILLING_PROVIDER: "stripe",
        PULSE_CUSTOMER_LAUNCH: "true",
        PULSE_DURABLE_SCHEDULER_WRITES: "true",
        RESEND_FROM: "Pulse notifications",
        PULSE_SUPPORT_EMAIL: "support pulse",
      },
      { standaloneLaunch: true, customerLaunch: true },
    );

    expect(report.ok).toBe(false);
    expect(report.errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "INVALID_RESEND_FROM",
        "INVALID_PULSE_SUPPORT_EMAIL",
      ]),
    );
  });

  it("blocks legacy OAuth callback URLs for customer launch", () => {
    const report = evaluateProductionReadiness(
      {
        ...validEnv,
        PULSE_URL: "https://app.pulse.com",
        BILLING_PROVIDER: "stripe",
        PULSE_CUSTOMER_LAUNCH: "true",
        PULSE_DURABLE_SCHEDULER_WRITES: "true",
        GITHUB_CALLBACK_URL: "https://pulse.claw-net.org/auth/github/callback",
        X_OAUTH_CALLBACK_URL: "https://pulse.example/auth/x/callback",
      },
      { standaloneLaunch: true, customerLaunch: true },
    );

    expect(report.ok).toBe(false);
    expect(report.errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "GITHUB_CALLBACK_URL_STILL_CLAWNET",
        "X_OAUTH_CALLBACK_URL_PLACEHOLDER_DOMAIN",
      ]),
    );
  });

  it("blocks local or private launch domains for customer launch", () => {
    const report = evaluateProductionReadiness(
      {
        ...validEnv,
        PULSE_URL: "https://127.0.0.1",
        BILLING_PROVIDER: "stripe",
        PULSE_CUSTOMER_LAUNCH: "true",
        PULSE_DURABLE_SCHEDULER_WRITES: "true",
        X_OAUTH_CALLBACK_URL:
          "https://local.pulse.test/auth/x/callback",
        GITHUB_CALLBACK_URL:
          "https://pulse.internal/auth/github/callback",
        GITHUB_OAUTH_CLIENT_ID: "github_client",
        GITHUB_OAUTH_CLIENT_SECRET: "github_secret",
      },
      { standaloneLaunch: true, customerLaunch: true },
    );

    expect(report.ok).toBe(false);
    expect(report.errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "PULSE_URL_NOT_PUBLIC_DOMAIN",
        "X_OAUTH_CALLBACK_URL_NOT_PUBLIC_DOMAIN",
        "GITHUB_CALLBACK_URL_NOT_PUBLIC_DOMAIN",
      ]),
    );
  });

  it("blocks IPv6 loopback launch domains for customer launch", () => {
    const report = evaluateProductionReadiness(
      {
        ...validEnv,
        PULSE_URL: "https://[::1]",
        BILLING_PROVIDER: "stripe",
        PULSE_CUSTOMER_LAUNCH: "true",
        PULSE_DURABLE_SCHEDULER_WRITES: "true",
      },
      { standaloneLaunch: true, customerLaunch: true },
    );

    expect(report.ok).toBe(false);
    expect(report.errors.map((issue) => issue.code)).toContain(
      "PULSE_URL_NOT_PUBLIC_DOMAIN",
    );
  });

  it("blocks single-label launch domains for customer launch", () => {
    const report = evaluateProductionReadiness(
      {
        ...validEnv,
        PULSE_URL: "https://pulse",
        BILLING_PROVIDER: "stripe",
        PULSE_CUSTOMER_LAUNCH: "true",
        PULSE_DURABLE_SCHEDULER_WRITES: "true",
        X_OAUTH_CALLBACK_URL: "https://pulse/auth/x/callback",
        RESEND_FROM: "Pulse <notifications@pulse>",
        PULSE_SUPPORT_EMAIL: "support@pulse",
      },
      { standaloneLaunch: true, customerLaunch: true },
    );

    expect(report.ok).toBe(false);
    expect(report.errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "PULSE_URL_NOT_PUBLIC_DOMAIN",
        "X_OAUTH_CALLBACK_URL_NOT_PUBLIC_DOMAIN",
        "RESEND_FROM_NOT_PUBLIC_DOMAIN",
        "PULSE_SUPPORT_EMAIL_NOT_PUBLIC_DOMAIN",
      ]),
    );
  });

  it("blocks OAuth callback URLs with invalid paths", () => {
    const report = evaluateProductionReadiness(
      {
        ...validEnv,
        GITHUB_CALLBACK_URL: "https://app.pulse.com/auth/wrong",
        X_CALLBACK_URL: "http://app.pulse.com/auth/x/callback",
      },
      { standaloneLaunch: true },
    );

    expect(report.ok).toBe(false);
    expect(report.errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "GITHUB_CALLBACK_URL_UNEXPECTED_PATH",
        "X_CALLBACK_URL_NOT_HTTPS",
      ]),
    );
  });

  it("blocks OAuth callback URLs that do not match the Pulse URL origin", () => {
    const report = evaluateProductionReadiness(
      {
        ...validEnv,
        PULSE_URL: "https://app.pulse.com",
        BILLING_PROVIDER: "stripe",
        PULSE_CUSTOMER_LAUNCH: "true",
        PULSE_DURABLE_SCHEDULER_WRITES: "true",
        GITHUB_CALLBACK_URL: "https://auth.pulse.com/auth/github/callback",
        GITHUB_OAUTH_CLIENT_ID: "github_client",
        GITHUB_OAUTH_CLIENT_SECRET: "github_secret",
        X_OAUTH_CALLBACK_URL: "https://auth.pulse.com/auth/x/callback",
      },
      { standaloneLaunch: true, customerLaunch: true },
    );

    expect(report.ok).toBe(false);
    expect(report.errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "GITHUB_CALLBACK_URL_ORIGIN_MISMATCH",
        "X_OAUTH_CALLBACK_URL_ORIGIN_MISMATCH",
      ]),
    );
  });

  it("blocks OAuth callback URLs with credentials, ports, query strings, or fragments", () => {
    const report = evaluateProductionReadiness(
      {
        ...validEnv,
        PULSE_URL: "https://app.pulse.com",
        BILLING_PROVIDER: "stripe",
        PULSE_CUSTOMER_LAUNCH: "true",
        PULSE_DURABLE_SCHEDULER_WRITES: "true",
        GITHUB_CALLBACK_URL:
          "https://operator:secret@app.pulse.com/auth/github/callback?code=demo",
        GITHUB_OAUTH_CLIENT_ID: "github_client",
        GITHUB_OAUTH_CLIENT_SECRET: "github_secret",
        X_OAUTH_CALLBACK_URL:
          "https://app.pulse.com:8443/auth/x/callback#provider",
      },
      { standaloneLaunch: true, customerLaunch: true },
    );

    expect(report.ok).toBe(false);
    expect(report.errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "GITHUB_CALLBACK_URL_HAS_QUERY_OR_FRAGMENT",
        "GITHUB_CALLBACK_URL_HAS_CREDENTIALS",
        "X_OAUTH_CALLBACK_URL_HAS_QUERY_OR_FRAGMENT",
        "X_OAUTH_CALLBACK_URL_HAS_PORT",
        "X_OAUTH_CALLBACK_URL_ORIGIN_MISMATCH",
      ]),
    );
  });

  it("requires X OAuth credentials for strict customer launch", () => {
    const {
      X_OAUTH_CLIENT_ID: _clientId,
      X_OAUTH_CLIENT_SECRET: _clientSecret,
      ...envWithoutXOAuth
    } = validEnv;
    const report = evaluateProductionReadiness(
      {
        ...envWithoutXOAuth,
        PULSE_URL: "https://app.pulse.com",
        BILLING_PROVIDER: "stripe",
        PULSE_CUSTOMER_LAUNCH: "true",
        PULSE_DURABLE_SCHEDULER_WRITES: "true",
      },
      { standaloneLaunch: true, customerLaunch: true },
    );

    expect(report.ok).toBe(false);
    expect(report.errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "MISSING_X_OAUTH_CLIENT_ID",
        "MISSING_X_OAUTH_CLIENT_SECRET",
      ]),
    );
  });

  it("requires an explicit X monthly post limit for strict customer launch", () => {
    const { X_MONTHLY_POST_LIMIT: _limit, ...envWithoutLimit } = validEnv;
    const report = evaluateProductionReadiness(
      {
        ...envWithoutLimit,
        PULSE_URL: "https://app.pulse.com",
        BILLING_PROVIDER: "stripe",
        PULSE_CUSTOMER_LAUNCH: "true",
        PULSE_DURABLE_SCHEDULER_WRITES: "true",
      },
      { standaloneLaunch: true, customerLaunch: true },
    );

    expect(report.ok).toBe(false);
    expect(report.errors.map((issue) => issue.code)).toContain(
      "MISSING_X_MONTHLY_POST_LIMIT",
    );
  });

  it("blocks invalid X monthly post limits", () => {
    const report = evaluateProductionReadiness(
      {
        ...validEnv,
        X_MONTHLY_POST_LIMIT: "0",
      },
      { standaloneLaunch: true },
    );

    expect(report.ok).toBe(false);
    expect(report.errors.map((issue) => issue.code)).toContain(
      "INVALID_X_MONTHLY_POST_LIMIT",
    );
  });

  it("requires GitHub OAuth credentials when the GitHub callback is configured", () => {
    const report = evaluateProductionReadiness(
      {
        ...validEnv,
        GITHUB_CALLBACK_URL: "https://app.pulse.com/auth/github/callback",
      },
      { standaloneLaunch: true },
    );

    expect(report.ok).toBe(false);
    expect(report.errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "MISSING_GITHUB_OAUTH_CLIENT_ID",
        "MISSING_GITHUB_OAUTH_CLIENT_SECRET",
      ]),
    );
  });
});

function createSerializedPulseHeart(secret: string): string {
  const provider = getCryptoProvider();
  const keyPair = provider.signing.generateKeyPair();
  const genome = createGenome(
    {
      modelProvider: "pulse",
      modelId: "operator",
      modelVersion: "1",
      systemPrompt: "Pulse operator heart",
      toolManifest: "{}",
      runtimeId: "pulse-operator",
    },
    provider,
  );
  const commitment = commitGenome(genome, keyPair, provider);
  const heart = createSomaHeart({
    genome: commitment,
    signingKeyPair: keyPair,
    modelApiKey: "n/a",
    modelBaseUrl: "https://api.anthropic.com/v1",
    modelId: "claude-sonnet-4-6",
    cryptoProvider: provider,
  });
  return heart.serialize(secret);
}
