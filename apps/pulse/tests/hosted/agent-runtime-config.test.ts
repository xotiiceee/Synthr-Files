import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { afterEach, describe, expect, it } from "vitest";

import { runInContext } from "../../hosted/context.js";
import {
  writeHostedAgentRuntimeConfig,
  type HostedAgentRuntimeConfigPreset,
} from "../../hosted/agent-runtime-config.js";
import { getConfig, resetConfigCache } from "../../src/core/persona.js";

const tempDirs: string[] = [];

afterEach(() => {
  resetConfigCache();
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

function createTenantConfig() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-runtime-config-"));
  tempDirs.push(dataDir);
  const configPath = path.join(dataDir, "pulse.yaml");
  const baseConfig = {
    persona: {
      name: "Pulse",
      brandName: "Base Brand",
      website: "https://base.example",
      tagline: "Base tagline",
      niche: "base",
      xHandle: "@base",
      tone: "professional",
      idealCustomer: "Base customer",
      problemSolved: "Base problem",
      uniqueValue: "Base value",
      neverSay: [],
    },
    platforms: {
      x: { enabled: true, maxPerDay: 8, maxPerRun: 3 },
    },
    topics: [],
    contentThemes: [],
    competitors: [],
    schedule: {
      outreachIntervalHours: 3,
      contentPostsPerDay: 2,
      adaptationIntervalDays: 7,
    },
    aggressiveness: "moderate",
    account: { aiProvider: "openai" },
    connections: { x: { enabled: true, maxPerDay: 8 } },
  };
  fs.writeFileSync(configPath, YAML.stringify(baseConfig));
  return { dataDir, configPath };
}

function agentFixture(): HostedAgentRuntimeConfigPreset {
  return {
    id: "agent_runtime",
    name: "Runtime Agent",
    brandName: "Runtime Brand",
    website: "https://runtime.example",
    tagline: "Runtime tagline",
    niche: "serious X automation",
    xHandle: "@runtime",
    tone: "technical",
    agentRole: "Builds serious X automation workflows.",
    competitors: ["Competitor"],
    topics: [
      {
        id: "topic_runtime",
        query: "x automation",
        textMustMatch: ["automation"],
      },
    ],
    contentThemes: ["Automation"],
    idealCustomer: "Operators",
    problemSolved: "Manual X work",
    uniqueValue: "Reliable automation",
    account: { aiProvider: "anthropic" },
    connections: { x: { enabled: true, maxPerDay: 12 } },
  };
}

describe("hosted agent runtime config", () => {
  it("writes an agent-scoped runtime config without mutating tenant pulse.yaml", async () => {
    const { dataDir, configPath } = createTenantConfig();
    const runtimeConfigPath = await runInContext(
      {
        tenantId: "tn_runtime_config",
        dataDir,
        configPath,
        secrets: {},
      },
      async () => writeHostedAgentRuntimeConfig({ agent: agentFixture() }),
    );

    const tenantConfig = YAML.parse(fs.readFileSync(configPath, "utf-8"));
    expect(tenantConfig.persona.brandName).toBe("Base Brand");

    await runInContext(
      {
        tenantId: "tn_runtime_config",
        dataDir,
        configPath: runtimeConfigPath,
        secrets: {},
      },
      async () => {
        const config = getConfig() as any;
        expect(config.persona.brandName).toBe("Runtime Brand");
        expect(config.persona.niche).toBe("serious X automation");
        expect(config.agentRole).toBe("Builds serious X automation workflows.");
        expect(config.topics).toEqual([
          {
            id: "topic_runtime",
            query: "x automation",
            textMustMatch: ["automation"],
          },
        ]);
        expect(config.account.aiProvider).toBe("anthropic");
        expect(config.connections.x.maxPerDay).toBe(12);
      },
    );
  });
});
