import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

import Database from "better-sqlite3";
import { createSomaHeart } from "soma-heart";
import { getCryptoProvider } from "soma-heart/crypto-provider";
import { commitGenome, createGenome } from "soma-heart/core";

import { evaluateProductionReadiness } from "../hosted/production-readiness.js";

const workflowPath = join(".github", "workflows", "deploy-production.yml");
const deployScriptPath = join("scripts", "deploy.sh");
const patchPath = join("docs", "operations", "deploy-production-pin.patch");

mkdirSync(resolve("data"), { recursive: true });
const tempRoot = mkdtempSync(resolve("data", "pulse-deploy-pin-"));
const verificationDbPath = join(tempRoot, "hosted.db");
const verificationHeartPath = join(tempRoot, "pulse-heart.json");

try {
  const db = new Database(verificationDbPath);
  db.exec("CREATE TABLE deploy_pin_verification (value TEXT)");
  db.close();
  writeFileSync(
    verificationHeartPath,
    createSerializedPulseHeart(
      process.env.PULSE_HEART_SECRET ||
        "pulse_heart_secret_live_verifier_2026",
    ),
  );

  mkdirSync(dirname(join(tempRoot, workflowPath)), { recursive: true });
  cpSync(workflowPath, join(tempRoot, workflowPath), {
    recursive: true,
  });

  const absolutePatchPath = resolve(patchPath);
  execFileSync("git", ["apply", "--check", absolutePatchPath], {
    cwd: tempRoot,
    stdio: "inherit",
  });
  execFileSync("git", ["apply", absolutePatchPath], {
    cwd: tempRoot,
    stdio: "inherit",
  });

  const patchedWorkflow = readFileSync(join(tempRoot, workflowPath), "utf-8");
  const report = evaluateProductionReadiness(
    buildVerificationEnv({
      hostedDbPath: verificationDbPath,
      pulseHeartPath: verificationHeartPath,
    }),
    {
      standaloneLaunch: true,
      customerLaunch: true,
      productionDeployWorkflow: patchedWorkflow,
      productionDeployScript: readFileSync(deployScriptPath, "utf-8"),
    },
  );

  if (!report.ok) {
    console.error("Production deploy pin patch verification failed:");
    for (const issue of report.errors) {
      console.error(`- ${issue.code}: ${issue.message}`);
    }
    process.exitCode = 1;
  } else {
    console.log("Production deploy pin patch verifies successfully.");
  }
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

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

function buildVerificationEnv(paths: {
  hostedDbPath: string;
  pulseHeartPath: string;
}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV || "production",
    PULSE_URL: process.env.PULSE_URL || "https://app.pulse.com",
    HOSTED_DB_PATH: process.env.HOSTED_DB_PATH || paths.hostedDbPath,
    PULSE_HEART_PATH:
      process.env.PULSE_HEART_PATH || paths.pulseHeartPath,
    TENANT_ENCRYPTION_KEY:
      process.env.TENANT_ENCRYPTION_KEY ||
      "0123456789abcdef0123456789abcdeffedcba9876543210fedcba9876543210",
    ADMIN_API_KEY:
      process.env.ADMIN_API_KEY || "pulse_admin_key_live_verifier_2026",
    AUTH_PROVIDER: process.env.AUTH_PROVIDER || "firstparty",
    BILLING_PROVIDER: process.env.BILLING_PROVIDER || "stripe",
    STRIPE_WEBHOOK_SECRET:
      process.env.STRIPE_WEBHOOK_SECRET || "whsec_verification",
    SCHEDULER_MODE: process.env.SCHEDULER_MODE || "durable",
    PULSE_DURABLE_SCHEDULER_WRITES:
      process.env.PULSE_DURABLE_SCHEDULER_WRITES || "true",
    GROQ_API_KEY: process.env.GROQ_API_KEY || "gsk_verification",
    SEARCH_PROVIDER: process.env.SEARCH_PROVIDER || "serper",
    SERPER_API_KEY: process.env.SERPER_API_KEY || "serper_verification",
    PULSE_HEART_SECRET:
      process.env.PULSE_HEART_SECRET || "pulse_heart_secret_live_verifier_2026",
    RESEND_API_KEY: process.env.RESEND_API_KEY || "re_verification",
    RESEND_FROM:
      process.env.RESEND_FROM || "Pulse <notifications@pulse.com>",
    PULSE_SUPPORT_EMAIL:
      process.env.PULSE_SUPPORT_EMAIL || "support@pulse.com",
    X_OAUTH_CLIENT_ID: process.env.X_OAUTH_CLIENT_ID || "x_client_verification",
    X_OAUTH_CLIENT_SECRET:
      process.env.X_OAUTH_CLIENT_SECRET || "x_secret_verification",
    X_MONTHLY_POST_LIMIT: process.env.X_MONTHLY_POST_LIMIT || "3000",
    PULSE_CUSTOMER_LAUNCH: process.env.PULSE_CUSTOMER_LAUNCH || "true",
  };
}
