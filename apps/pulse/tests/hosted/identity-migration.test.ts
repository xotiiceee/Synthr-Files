import { describe, expect, it } from "vitest";

import {
  buildBrandMigrationSources,
  buildOrgMigrationSource,
  buildTenantMigrationSource,
  buildWorkspaceMigrationSource,
  type LegacyAgentMigrationPreset,
} from "../../hosted/identity-migration.js";
import type { Tenant } from "../../hosted/db.js";

const tenant: Tenant = {
  id: "tn_legacy",
  api_key: "cn-test",
  clawnet_user_id: "claw_user",
  email: "founder@example.com",
  name: "Founder Account",
  plan: "credits",
  status: "active",
  created_at: "2026-05-01T00:00:00.000Z",
  updated_at: "2026-05-01T00:00:00.000Z",
};

function agent(
  overrides: Partial<LegacyAgentMigrationPreset>,
): LegacyAgentMigrationPreset {
  return {
    id: "acme-agent",
    name: "Acme Agent",
    brandName: "Acme",
    website: "https://acme.test",
    tagline: "",
    niche: "X automation",
    xHandle: "@acme",
    tone: "professional",
    agentRole: "",
    competitors: [],
    topics: [],
    contentThemes: [],
    createdAt: "2026-05-02T00:00:00.000Z",
    updatedAt: "2026-05-02T00:00:00.000Z",
    ...overrides,
  };
}

describe("identity migration source helpers", () => {
  it("builds org and workspace sources from a legacy tenant", () => {
    expect(buildOrgMigrationSource(tenant)).toEqual({
      name: "Founder Account",
      billingEmail: "founder@example.com",
      legacyTenantId: "tn_legacy",
    });
    expect(buildWorkspaceMigrationSource(tenant)).toEqual({
      name: "Default",
      legacyTenantId: "tn_legacy",
    });
  });

  it("builds brand sources from legacy agent presets", () => {
    const sources = buildBrandMigrationSources(tenant, [
      agent({ id: "acme", brandName: "Acme Labs", xHandle: "@acmelabs" }),
      agent({
        id: "quiet",
        name: "Quiet Brand",
        brandName: "",
        xHandle: "",
      }),
    ]);

    expect(sources).toEqual([
      {
        name: "Acme Labs",
        legacyTenantId: "tn_legacy",
        legacyAgentId: "acme",
        xHandle: "@acmelabs",
        website: "https://acme.test",
        niche: "X automation",
        connections: [
          {
            provider: "x",
            status: "disconnected",
            metadata: { handle: "@acmelabs" },
          },
        ],
      },
      {
        name: "Quiet Brand",
        legacyTenantId: "tn_legacy",
        legacyAgentId: "quiet",
        xHandle: "",
        website: "https://acme.test",
        niche: "X automation",
        connections: [],
      },
    ]);
  });

  it("falls back to a default brand when no legacy agents exist", () => {
    expect(buildTenantMigrationSource(tenant, []).brands).toEqual([
      {
        name: "Founder Account",
        legacyTenantId: "tn_legacy",
        legacyAgentId: "default",
        xHandle: "",
        website: "",
        niche: "",
        connections: [],
      },
    ]);
  });
});
