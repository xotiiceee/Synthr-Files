import { describe, expect, it } from "vitest";

import { cleanupSqliteFiles, createTempHostedDbPath } from "./temp-db.js";

const dbPath = createTempHostedDbPath("pulse-brand-memory-context");
process.env.HOSTED_DB_PATH = dbPath;

const { createOrg, createTenant, createWorkspace } = await import(
  "../../hosted/db.js"
);
const { createBrandRepository } = await import(
  "../../hosted/repositories/brands.js"
);
const {
  createBrandKnowledgeNotesRepository,
  createBrandProfileRepository,
} = await import("../../hosted/repositories/brand-memory.js");
const { getHostedChatMemoryContext, resolveHostedBrandMemoryScope } =
  await import("../../hosted/brand-memory-context.js");

function seedBrand(label: string, agentId: string) {
  const tenant = createTenant(
    `memory-${label}`,
    `claw-memory-${label}`,
    `${label}@example.test`,
    `Memory ${label}`,
  );
  const org = createOrg({ name: `Org ${label}`, legacyTenantId: tenant.id });
  const workspace = createWorkspace(org.id, "Default");
  const brand = createBrandRepository().createBrand({
    orgId: org.id,
    workspaceId: workspace.id,
    name: `Brand ${label}`,
    legacyTenantId: tenant.id,
    legacyAgentId: agentId,
  });
  return { tenant, org, workspace, brand, agentId };
}

describe("hosted brand memory chat context", () => {
  it("resolves tenant/agent scoped durable memory for chat context", () => {
    const scoped = seedBrand("scoped", "agent_memory");
    const other = seedBrand("other", "agent_other");
    const profiles = createBrandProfileRepository();
    const notes = createBrandKnowledgeNotesRepository();

    profiles.upsertProfile({
      scope: {
        tenantId: scoped.tenant.id,
        orgId: scoped.org.id,
        workspaceId: scoped.workspace.id,
        brandId: scoped.brand.id,
        agentId: scoped.agentId,
      },
      profile: {
        identity: { keyFacts: ["serious X automation tools"] },
      },
      source: "chat",
      lockState: "locked",
    });
    notes.saveNote({
      scope: {
        tenantId: scoped.tenant.id,
        orgId: scoped.org.id,
        workspaceId: scoped.workspace.id,
        brandId: scoped.brand.id,
        agentId: scoped.agentId,
      },
      title: "Voice rule",
      content: "Prefer operationally precise language.",
      tags: ["layer:preferences"],
      locked: true,
    });
    notes.saveNote({
      scope: {
        tenantId: other.tenant.id,
        orgId: other.org.id,
        workspaceId: other.workspace.id,
        brandId: other.brand.id,
        agentId: other.agentId,
      },
      title: "Other brand",
      content: "This should not leak.",
    });

    expect(
      resolveHostedBrandMemoryScope({
        tenantId: scoped.tenant.id,
        agentId: scoped.agentId,
      }),
    ).toMatchObject({
      tenantId: scoped.tenant.id,
      orgId: scoped.org.id,
      workspaceId: scoped.workspace.id,
      brandId: scoped.brand.id,
      agentId: scoped.agentId,
    });

    const context = getHostedChatMemoryContext({
      tenantId: scoped.tenant.id,
      agentId: scoped.agentId,
      query: "voice for serious X automation tools",
    });

    expect(context).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Brand identity",
          content: expect.stringContaining("serious X automation tools"),
          priority: 3,
        }),
        expect.objectContaining({
          title: "Voice rule",
          content: "Prefer operationally precise language.",
          priority: 3,
        }),
      ]),
    );
    expect(JSON.stringify(context)).not.toContain("This should not leak");
  });
});

process.on("exit", () => {
  cleanupSqliteFiles(dbPath);
});
