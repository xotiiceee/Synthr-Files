import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

import { getContext } from "./context.js";
import { getConfig, resetConfigCache } from "../src/core/persona.js";
import type { HostedBrandRuntimeContext } from "./brand-runtime-context.js";

export interface HostedAgentRuntimeConfigPreset {
  id: string;
  name?: string;
  brandName: string;
  website: string;
  tagline: string;
  niche: string;
  xHandle: string;
  tone: string;
  idealCustomer?: string;
  problemSolved?: string;
  uniqueValue?: string;
  agentRole: string;
  competitors: string[];
  topics: Array<{ id: string; query: string; textMustMatch: string[] }>;
  contentThemes: string[];
  account?: object;
  connections?: object;
}

export function buildHostedAgentRuntimeConfigPreset(
  context: HostedBrandRuntimeContext,
): HostedAgentRuntimeConfigPreset {
  const config = context.runtimeConfig;
  return {
    id: context.legacyAgentId || context.selectedAgentId,
    name: config.name || context.brandName,
    brandName: config.brandName || context.brandName,
    website: config.website,
    tagline: config.tagline,
    niche: config.niche,
    xHandle: config.xHandle,
    tone: config.tone || "professional",
    idealCustomer: config.idealCustomer,
    problemSolved: config.problemSolved,
    uniqueValue: config.uniqueValue,
    agentRole: config.agentRole,
    competitors: config.competitors,
    topics: config.topics,
    contentThemes: config.contentThemes,
    account: config.account,
    connections: config.connections,
  };
}

export function writeHostedAgentRuntimeConfig(input: {
  agent: HostedAgentRuntimeConfigPreset;
}): string {
  const context = getContext();
  if (!context) {
    throw new Error("Hosted agent runtime config requires tenant context");
  }

  const agent = input.agent;
  const baseConfig = structuredClone(getConfig()) as unknown as Record<
    string,
    unknown
  >;
  const runtimeConfig = {
    ...baseConfig,
    persona: {
      ...((baseConfig.persona as Record<string, unknown> | undefined) ?? {}),
      brandName: agent.brandName,
      website: agent.website,
      tagline: agent.tagline,
      niche: agent.niche,
      xHandle: agent.xHandle,
      tone: agent.tone,
      idealCustomer: agent.idealCustomer || "",
      problemSolved: agent.problemSolved || "",
      uniqueValue: agent.uniqueValue || "",
    },
    agentRole: agent.agentRole,
    competitors: agent.competitors,
    topics: agent.topics,
    contentThemes: agent.contentThemes,
    account:
      agent.account ??
      (baseConfig.account as Record<string, unknown> | undefined),
    connections:
      agent.connections ??
      (baseConfig.connections as Record<string, unknown> | undefined),
  };

  const runtimeDir = path.join(context.dataDir, "runtime", "agents", agent.id);
  fs.mkdirSync(runtimeDir, { recursive: true });

  const runtimeConfigPath = path.join(runtimeDir, "pulse.yaml");
  fs.writeFileSync(
    runtimeConfigPath,
    YAML.stringify(runtimeConfig, { lineWidth: 120 }),
  );
  resetConfigCache();

  return runtimeConfigPath;
}
