import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const ACTIVE_SURFACES = [
  ".env.example",
  "docs/operations",
  "docs/reference",
  "hosted",
  "scripts",
  "src",
];

const BLOCKED_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "legacy freeLimit capability field", pattern: /\bfreeLimit\b/ },
  { label: "free-tier positioning", pattern: /\bfree tier\b/i },
  { label: "free search allowance copy", pattern: /\bfree searches\b/i },
  { label: "free API-key claim", pattern: /\bfree key\b/i },
  { label: "blanket no-card claim", pattern: /\bno credit card\b/i },
  {
    label: "blanket all-keys-free claim",
    pattern: /\ball API keys are free\b/i,
  },
  {
    label: "unqualified unlimited platform limit",
    pattern: /\bUnlimited (reads|with bot token)\b/i,
  },
];

function walk(target: string): string[] {
  const fullPath = path.join(ROOT, target);
  if (!fs.existsSync(fullPath)) return [];
  const stat = fs.statSync(fullPath);
  if (stat.isFile()) return [fullPath];

  return fs.readdirSync(fullPath, { withFileTypes: true }).flatMap((entry) => {
    if (
      entry.name === "node_modules" ||
      entry.name === "dist" ||
      entry.name === "coverage" ||
      entry.name.startsWith(".")
    ) {
      return [];
    }
    return walk(path.join(target, entry.name));
  });
}

function checkedFiles(): Array<{ relativePath: string; content: string }> {
  return ACTIVE_SURFACES.flatMap(walk)
    .filter((file) => /\.(css|html|js|json|md|ts|tsx|yaml|yml|example)$/.test(file))
    .map((file) => ({
      relativePath: path.relative(ROOT, file),
      content: fs.readFileSync(file, "utf-8"),
    }));
}

describe("launch copy guards", () => {
  it("keeps active production surfaces away from free-tier positioning", () => {
    const violations = checkedFiles().flatMap(({ relativePath, content }) =>
      BLOCKED_PATTERNS.filter(({ pattern }) => pattern.test(content)).map(
        ({ label }) => `${relativePath}: ${label}`,
      ),
    );

    expect(violations).toEqual([]);
  });

  it("keeps the example env aligned with strict customer-launch gates", () => {
    const envExample = fs.readFileSync(path.join(ROOT, ".env.example"), "utf-8");

    expect(envExample).toContain("HOSTED_DB_PATH=/home/deploy/pulse/data/hosted.db");
    expect(envExample).toContain(
      "PULSE_HEART_PATH=/home/deploy/pulse/data/pulse-heart.json",
    );
    expect(envExample).toContain("AUTH_PROVIDER=firstparty");
    expect(envExample).toContain("BILLING_PROVIDER=stripe");
    expect(envExample).toContain("SCHEDULER_MODE=durable");
    expect(envExample).toContain("PULSE_DURABLE_SCHEDULER_WRITES=true");
    expect(envExample).toContain("PULSE_CUSTOMER_LAUNCH=false");
    expect(envExample).toContain("RESEND_API_KEY=");
    expect(envExample).toContain("RESEND_FROM=Pulse <notifications@your-pulse-domain.com>");
    expect(envExample).toContain("PULSE_SUPPORT_EMAIL=support@your-pulse-domain.com");
    expect(envExample).toContain("X_OAUTH_CLIENT_ID=");
    expect(envExample).toContain("X_OAUTH_CLIENT_SECRET=");
    expect(envExample).toContain("X_MONTHLY_POST_LIMIT=");
  });

  it("keeps canonical config docs away from customer-launch placeholder domains", () => {
    const configReference = fs.readFileSync(
      path.join(ROOT, "docs", "reference", "config.md"),
      "utf-8",
    );

    expect(configReference).toContain(
      "PULSE_URL=https://app.your-pulse-domain.com",
    );
    expect(configReference).toContain(
      "RESEND_FROM=Pulse <notifications@your-pulse-domain.com>",
    );
    expect(configReference).toContain(
      "PULSE_SUPPORT_EMAIL=support@your-pulse-domain.com",
    );
    expect(configReference).not.toContain("PULSE_URL=https://app.example.com");
    expect(configReference).not.toContain("notifications@example.com");
    expect(configReference).not.toContain("support@example.com");
  });
});
