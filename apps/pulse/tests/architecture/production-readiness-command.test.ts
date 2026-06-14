import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const readinessCommand = fs.readFileSync(
  path.join(process.cwd(), "scripts", "check-production-readiness.ts"),
  "utf-8",
);
const productionReadinessRunbook = fs.readFileSync(
  path.join(process.cwd(), "docs", "operations", "production-readiness.md"),
  "utf-8",
);

describe("production readiness command posture", () => {
  it("can validate the external env file used by the deployed service", () => {
    expect(readinessCommand).toContain(
      "process.env.PULSE_ENV_FILE || process.env.ENV_FILE",
    );
    expect(readinessCommand).toContain(
      "Production readiness env file not found",
    );
    expect(readinessCommand).toContain(
      "Could not load production readiness env file",
    );
    expect(readinessCommand).toContain(
      "loadDotenv(envFile ? { path: envFile } : undefined)",
    );
  });

  it("documents checking the production env file directly", () => {
    expect(productionReadinessRunbook).toContain(
      "ENV_FILE=/etc/pulse/pulse.env npm run check:production",
    );
    expect(productionReadinessRunbook).toContain(
      "ENV_FILE=/etc/pulse/pulse.env npm run check:customer-launch",
    );
  });

  it("loads readiness values from ENV_FILE at runtime", () => {
    expect(runReadinessWithEnvFile("ENV_FILE")).toContain(
      "UNSAFE_PRODUCTION_DEPLOY_BRANCH_INPUT",
    );
  });

  it("loads readiness values from PULSE_ENV_FILE at runtime", () => {
    expect(runReadinessWithEnvFile("PULSE_ENV_FILE")).toContain(
      "UNSAFE_PRODUCTION_DEPLOY_BRANCH_INPUT",
    );
  });

  it("prefers PULSE_ENV_FILE over ENV_FILE when both are set", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-readiness-env-"));
    try {
      const badEnvFile = path.join(root, "bad.env");
      const goodEnvFile = path.join(root, "good.env");
      fs.writeFileSync(
        badEnvFile,
        [
          "NODE_ENV=production",
          "PULSE_URL=https://bad.example.com",
          "TENANT_ENCRYPTION_KEY=bad",
          "ADMIN_API_KEY=bad",
        ].join("\n"),
      );
      writeValidReadinessEnv(goodEnvFile);

      const output = runReadinessCommand({
        ENV_FILE: badEnvFile,
        PULSE_ENV_FILE: goodEnvFile,
        root,
      });

      expect(output).toContain("UNSAFE_PRODUCTION_DEPLOY_BRANCH_INPUT");
      expect(output).not.toContain("PULSE_URL_PLACEHOLDER_DOMAIN");
      expect(output).not.toContain("INVALID_TENANT_ENCRYPTION_KEY");
      expect(output).not.toContain("WEAK_ADMIN_API_KEY");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

function runReadinessWithEnvFile(envKey: "ENV_FILE" | "PULSE_ENV_FILE"): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-readiness-env-"));
  try {
    const envFile = path.join(root, "pulse.env");
    writeValidReadinessEnv(envFile);

    const output = runReadinessCommand({ [envKey]: envFile, root });

    expect(output).not.toContain("MISSING_PULSE_URL");
    expect(output).not.toContain("MISSING_TENANT_ENCRYPTION_KEY");
    expect(output).not.toContain("MISSING_ADMIN_API_KEY");
    return output;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function writeValidReadinessEnv(file: string): void {
  fs.writeFileSync(
    file,
    [
      "NODE_ENV=production",
      "PULSE_URL=https://app.pulse.com",
      "TENANT_ENCRYPTION_KEY=0123456789abcdef0123456789abcdeffedcba9876543210fedcba9876543210",
      "ADMIN_API_KEY=pulse_admin_key_runtime_file_2026",
      "AUTH_PROVIDER=firstparty",
      "BILLING_PROVIDER=stripe",
      "STRIPE_WEBHOOK_SECRET=whsec_runtime_file",
      "SCHEDULER_MODE=durable",
      "GROQ_API_KEY=gsk_runtime_file",
      "SEARCH_PROVIDER=serper",
      "SERPER_API_KEY=serper_runtime_file",
      "PULSE_HEART_SECRET=pulse_heart_secret_runtime_file_2026",
    ].join("\n"),
  );
}

function runReadinessCommand(options: {
  root: string;
  ENV_FILE?: string;
  PULSE_ENV_FILE?: string;
}): string {
  try {
    execFileSync("npx", ["tsx", "scripts/check-production-readiness.ts"], {
      cwd: process.cwd(),
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        XDG_CONFIG_HOME:
          process.env.XDG_CONFIG_HOME || path.join(options.root, "xdg-config"),
        ...(options.ENV_FILE ? { ENV_FILE: options.ENV_FILE } : {}),
        ...(options.PULSE_ENV_FILE
          ? { PULSE_ENV_FILE: options.PULSE_ENV_FILE }
          : {}),
      },
      encoding: "utf-8",
      stdio: "pipe",
    });
    return "";
  } catch (error) {
    const result = error as { stdout?: string; stderr?: string };
    return `${result.stdout ?? ""}${result.stderr ?? ""}`;
  }
}
