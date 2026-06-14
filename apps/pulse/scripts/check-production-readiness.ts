import { config as loadDotenv } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { evaluateProductionReadiness } from "../hosted/production-readiness.js";

const envFile = process.env.PULSE_ENV_FILE || process.env.ENV_FILE;
if (envFile && !existsSync(envFile)) {
  console.error(`Production readiness env file not found: ${envFile}`);
  process.exit(1);
}
const dotenvResult = loadDotenv(envFile ? { path: envFile } : undefined);
if (envFile && dotenvResult.error) {
  const message =
    dotenvResult.error instanceof Error
      ? dotenvResult.error.message
      : String(dotenvResult.error);
  console.error(`Could not load production readiness env file: ${message}`);
  process.exit(1);
}

const report = evaluateProductionReadiness(process.env, {
  standaloneLaunch: true,
  productionDeployWorkflow: readOptionalFile(
    join(process.cwd(), ".github", "workflows", "deploy-production.yml"),
  ),
  productionDeployScript: readOptionalFile(
    join(process.cwd(), "scripts", "deploy.sh"),
  ),
});

if (report.errors.length > 0) {
  console.error("Production readiness errors:");
  for (const issue of report.errors) {
    console.error(`- ${issue.code}: ${issue.message}`);
  }
}

if (report.warnings.length > 0) {
  console.warn("Production readiness warnings:");
  for (const issue of report.warnings) {
    console.warn(`- ${issue.code}: ${issue.message}`);
  }
}

if (report.ok) {
  console.log("Production readiness check passed.");
}

process.exitCode = report.ok ? 0 : 1;

function readOptionalFile(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf-8") : null;
}
