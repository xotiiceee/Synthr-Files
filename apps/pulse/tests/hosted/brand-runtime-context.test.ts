import { describe, expect, it } from "vitest";

import { cleanupSqliteFiles, createTempHostedDbPath } from "./temp-db.js";

const dbPath = createTempHostedDbPath("pulse-brand-runtime-context");
process.env.HOSTED_DB_PATH = dbPath;

const { createBrand, createOrg, createTenant, createWorkspace } = await import(
  "../../hosted/db.js"
);
const {
  ensureHostedBrandRuntimeContext,
  getHostedSelectedRuntimeAgentId,
  listHostedAgentCompatibilityViews,
  listHostedBrandRuntimeContexts,
  listHostedRunnableBrandRuntimeContexts,
  markHostedBrandRuntimeDeleted,
  resolveHostedBrandRuntimeContext,
  resolveHostedTenantRuntimeContext,
  setHostedSelectedRuntimeAgentId,
  setHostedBrandRuntimeEnabled,
  updateHostedBrandRuntimeConfig,
} = await import("../../hosted/brand-runtime-context.js");

function seedBrand(label: string, agentId: string) {
  const tenant = createTenant(
    `runtime-${label}`,
    `claw-runtime-${label}`,
    `${label}@example.test`,
    `Runtime ${label}`,
  );
  const org = createOrg({ name: `Runtime Org ${label}`, legacyTenantId: tenant.id });
  const workspace = createWorkspace(org.id, "Default");
  const brand = createBrand({
    orgId: org.id,
    workspaceId: workspace.id,
    name: `Runtime Brand ${label}`,
    legacyTenantId: tenant.id,
    legacyAgentId: agentId,
  });
  return { tenant, org, workspace, brand, agentId };
}

describe("hosted brand runtime context", () => {
  it("resolves explicit tenant and legacy agent ids to SQL brand scope", () => {
    const scoped = seedBrand("scoped", "agent_runtime");
    seedBrand("other", "agent_other");

    expect(
      resolveHostedBrandRuntimeContext({
        tenantId: scoped.tenant.id,
        agentId: scoped.agentId,
      }),
    ).toMatchObject({
      tenantId: scoped.tenant.id,
      orgId: scoped.org.id,
      workspaceId: scoped.workspace.id,
      brandId: scoped.brand.id,
      brandName: scoped.brand.name,
      legacyAgentId: scoped.agentId,
      selectedAgentId: scoped.agentId,
    });
  });

  it("lists all SQL brand contexts for a legacy tenant", () => {
    const first = seedBrand("list-first", "agent_list_first");
    const secondBrand = createBrand({
      orgId: first.org.id,
      workspaceId: first.workspace.id,
      name: "Runtime Brand List Second",
      legacyTenantId: first.tenant.id,
      legacyAgentId: "agent_list_second",
    });

    expect(
      listHostedBrandRuntimeContexts({ tenantId: first.tenant.id }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tenantId: first.tenant.id,
          orgId: first.org.id,
          workspaceId: first.workspace.id,
          brandId: first.brand.id,
          selectedAgentId: "agent_list_first",
        }),
        expect.objectContaining({
          tenantId: first.tenant.id,
          orgId: first.org.id,
          workspaceId: first.workspace.id,
          brandId: secondBrand.id,
          selectedAgentId: "agent_list_second",
        }),
      ]),
    );
  });

  it("ensures SQL org, workspace, and brand rows for a legacy agent", () => {
    const tenant = createTenant(
      "runtime-ensure",
      "claw-runtime-ensure",
      "ensure@example.test",
      "Runtime Ensure",
    );

    const created = ensureHostedBrandRuntimeContext({
      tenantId: tenant.id,
      legacyAgentId: "agent_ensure",
      brandName: "Ensured Brand",
      runtimeConfig: {
        name: "Ensured Agent",
        niche: "sql runtime config",
        tone: "technical",
        contentThemes: ["Runtime"],
      },
    });
    const updated = ensureHostedBrandRuntimeContext({
      tenantId: tenant.id,
      legacyAgentId: "agent_ensure",
      brandName: "Ensured Brand Updated",
    });

    expect(created).toMatchObject({
      tenantId: tenant.id,
      brandName: "Ensured Brand",
      legacyAgentId: "agent_ensure",
      selectedAgentId: "agent_ensure",
      runtimeConfig: expect.objectContaining({
        name: "Ensured Agent",
        brandName: "Ensured Brand",
        niche: "sql runtime config",
        tone: "technical",
        contentThemes: ["Runtime"],
      }),
    });
    expect(updated).toMatchObject({
      brandId: created.brandId,
      orgId: created.orgId,
      workspaceId: created.workspaceId,
      brandName: "Ensured Brand Updated",
    });
    expect(
      listHostedBrandRuntimeContexts({ tenantId: tenant.id }).filter(
        (context) => context.legacyAgentId === "agent_ensure",
      ),
    ).toHaveLength(1);
  });

  it("tracks runtime enabled and deleted compatibility state", () => {
    const tenant = createTenant(
      "runtime-state",
      "claw-runtime-state",
      "runtime-state@example.test",
      "Runtime State",
    );
    const created = ensureHostedBrandRuntimeContext({
      tenantId: tenant.id,
      legacyAgentId: "agent_state",
      brandName: "Runtime State Brand",
    });

    expect(created.runtimeEnabled).toBe(false);
    expect(
      setHostedBrandRuntimeEnabled({
        tenantId: tenant.id,
        legacyAgentId: "agent_state",
        enabled: true,
      }),
    ).toMatchObject({
      brandId: created.brandId,
      runtimeEnabled: true,
      deletedAt: "",
    });

    expect(
      markHostedBrandRuntimeDeleted({
        tenantId: tenant.id,
        legacyAgentId: "agent_state",
        deletedAt: "2026-05-27T08:00:00.000Z",
      }),
    ).toMatchObject({
      brandId: created.brandId,
      runtimeEnabled: false,
      deletedAt: "2026-05-27T08:00:00.000Z",
    });
    expect(
      resolveHostedBrandRuntimeContext({
        tenantId: tenant.id,
        agentId: "agent_state",
      }),
    ).toBeNull();
    expect(
      listHostedBrandRuntimeContexts({
        tenantId: tenant.id,
        includeDeleted: true,
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          brandId: created.brandId,
          deletedAt: "2026-05-27T08:00:00.000Z",
        }),
      ]),
    );
  });

  it("lists only SQL runtime-enabled brand contexts for scheduler selection", () => {
    const tenant = createTenant(
      "runtime-runnable",
      "claw-runtime-runnable",
      "runnable@example.test",
      "Runtime Runnable",
    );
    ensureHostedBrandRuntimeContext({
      tenantId: tenant.id,
      legacyAgentId: "agent_enabled",
      brandName: "Enabled Brand",
    });
    ensureHostedBrandRuntimeContext({
      tenantId: tenant.id,
      legacyAgentId: "agent_disabled",
      brandName: "Disabled Brand",
    });
    setHostedBrandRuntimeEnabled({
      tenantId: tenant.id,
      legacyAgentId: "agent_enabled",
      enabled: true,
    });

    expect(
      listHostedRunnableBrandRuntimeContexts({ tenantId: tenant.id }),
    ).toEqual([
      expect.objectContaining({
        tenantId: tenant.id,
        legacyAgentId: "agent_enabled",
        runtimeEnabled: true,
      }),
    ]);
  });

  it("stores selected runtime agent id in SQL tenant context", () => {
    const tenant = createTenant(
      "runtime-selected",
      "claw-runtime-selected",
      "selected@example.test",
      "Runtime Selected",
    );
    const first = ensureHostedBrandRuntimeContext({
      tenantId: tenant.id,
      legacyAgentId: "agent_selected_first",
      brandName: "First Brand",
    });
    const second = ensureHostedBrandRuntimeContext({
      tenantId: tenant.id,
      legacyAgentId: "agent_selected_second",
      brandName: "Second Brand",
    });

    expect(getHostedSelectedRuntimeAgentId({ tenantId: tenant.id })).toBe("");
    expect(
      setHostedSelectedRuntimeAgentId({
        tenantId: tenant.id,
        agentId: second.legacyAgentId,
      }),
    ).toMatchObject({
      brandId: second.brandId,
      selectedAgentId: second.legacyAgentId,
    });
    expect(getHostedSelectedRuntimeAgentId({ tenantId: tenant.id })).toBe(
      second.legacyAgentId,
    );

    markHostedBrandRuntimeDeleted({
      tenantId: tenant.id,
      legacyAgentId: second.legacyAgentId,
      deletedAt: "2026-05-27T10:00:00.000Z",
    });
    expect(getHostedSelectedRuntimeAgentId({ tenantId: tenant.id })).toBe(
      first.legacyAgentId,
    );
    expect(
      setHostedSelectedRuntimeAgentId({
        tenantId: tenant.id,
        agentId: first.legacyAgentId,
      }),
    ).toMatchObject({ brandId: first.brandId });
  });

  it("patches SQL runtime config without legacy preset mutation", () => {
    const tenant = createTenant(
      "runtime-config-patch",
      "claw-runtime-config-patch",
      "runtime-config-patch@example.test",
      "Runtime Config Patch",
    );
    const created = ensureHostedBrandRuntimeContext({
      tenantId: tenant.id,
      legacyAgentId: "agent_config_patch",
      brandName: "Runtime Config Patch",
      runtimeConfig: {
        name: "Runtime Config Agent",
        account: { aiProvider: "openai" },
      },
    });

    expect(
      updateHostedBrandRuntimeConfig({
        tenantId: tenant.id,
        legacyAgentId: "agent_config_patch",
        runtimeConfig: {
          account: { aiProvider: "anthropic" },
          connections: { x: { enabled: true, maxPerDay: 12 } },
        },
      }),
    ).toMatchObject({
      brandId: created.brandId,
      runtimeConfig: expect.objectContaining({
        name: "Runtime Config Agent",
        brandName: "Runtime Config Patch",
        account: { aiProvider: "anthropic" },
        connections: { x: { enabled: true, maxPerDay: 12 } },
      }),
    });
  });

  it("builds SQL-first hosted agent compatibility views", () => {
    const tenant = createTenant(
      "runtime-agent-view",
      "claw-runtime-agent-view",
      "agent-view@example.test",
      "Runtime Agent View",
    );
    const active = ensureHostedBrandRuntimeContext({
      tenantId: tenant.id,
      legacyAgentId: "agent_view",
      brandName: "SQL Brand Name",
    });
    setHostedBrandRuntimeEnabled({
      tenantId: tenant.id,
      legacyAgentId: "agent_view",
      enabled: true,
    });
    ensureHostedBrandRuntimeContext({
      tenantId: tenant.id,
      legacyAgentId: "sql_only",
      brandName: "SQL Only",
      runtimeConfig: {
        name: "SQL Only Agent",
        website: "https://sql-only.example.test",
        niche: "standalone runtime",
        tone: "authoritative",
        topics: [
          {
            id: "topic_sql",
            query: "serious automation",
            textMustMatch: ["automation"],
          },
        ],
        contentThemes: ["SQL Runtime"],
      },
    });

    expect(
      listHostedAgentCompatibilityViews({
        tenantId: tenant.id,
        legacyAgents: [
          {
            id: "agent_view",
            name: "Legacy Agent Name",
            brandName: "Legacy Brand Name",
            niche: "serious X automation",
            tone: "technical",
            topics: [
              {
                id: "topic_1",
                query: "x automation",
                textMustMatch: ["automation"],
              },
            ],
            competitors: ["Competitor"],
            contentThemes: ["Launch"],
            running: false,
          },
        ],
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "agent_view",
          name: "SQL Brand Name",
          brandName: "SQL Brand Name",
          niche: "serious X automation",
          tone: "technical",
          running: true,
          brandId: active.brandId,
          topics: [
            {
              id: "topic_1",
              query: "x automation",
              textMustMatch: ["automation"],
            },
          ],
        }),
        expect.objectContaining({
          id: "sql_only",
          name: "SQL Only Agent",
          brandName: "SQL Only",
          website: "https://sql-only.example.test",
          niche: "standalone runtime",
          tone: "authoritative",
          topics: [
            {
              id: "topic_sql",
              query: "serious automation",
              textMustMatch: ["automation"],
            },
          ],
          contentThemes: ["SQL Runtime"],
          running: false,
        }),
      ]),
    );
  });

  it("falls back to a single unscoped brand for legacy default contexts", () => {
    const tenant = createTenant(
      "runtime-unscoped",
      "claw-runtime-unscoped",
      "unscoped@example.test",
      "Runtime Unscoped",
    );
    const org = createOrg({ name: "Runtime Unscoped", legacyTenantId: tenant.id });
    const brand = createBrand({
      orgId: org.id,
      name: "Unscoped Brand",
      legacyTenantId: tenant.id,
    });

    expect(
      resolveHostedBrandRuntimeContext({ tenantId: tenant.id }),
    ).toMatchObject({
      tenantId: tenant.id,
      orgId: org.id,
      workspaceId: "",
      brandId: brand.id,
      legacyAgentId: "",
      selectedAgentId: "default",
    });
  });

  it("does not guess when several scoped brands exist without a selected agent", () => {
    const tenant = createTenant(
      "runtime-ambiguous",
      "claw-runtime-ambiguous",
      "ambiguous@example.test",
      "Runtime Ambiguous",
    );
    const org = createOrg({ name: "Runtime Ambiguous", legacyTenantId: tenant.id });
    createBrand({
      orgId: org.id,
      name: "First Ambiguous Brand",
      legacyTenantId: tenant.id,
      legacyAgentId: "first",
    });
    createBrand({
      orgId: org.id,
      name: "Second Ambiguous Brand",
      legacyTenantId: tenant.id,
      legacyAgentId: "second",
    });

    expect(resolveHostedBrandRuntimeContext({ tenantId: tenant.id })).toBeNull();
  });

  it("does not match a different scoped brand for an explicit legacy agent id", () => {
    const scoped = seedBrand("explicit-miss", "agent_existing");

    expect(
      resolveHostedBrandRuntimeContext({
        tenantId: scoped.tenant.id,
        agentId: "agent_missing",
      }),
    ).toBeNull();
  });

  it("falls back to org scope when no brand can be resolved", () => {
    const tenant = createTenant(
      "runtime-org-only",
      "claw-runtime-org-only",
      "org-only@example.test",
      "Runtime Org Only",
    );
    const org = createOrg({
      name: "Runtime Org Only",
      legacyTenantId: tenant.id,
    });

    expect(
      resolveHostedTenantRuntimeContext({
        tenantId: tenant.id,
        agentId: "pending_brand",
      }),
    ).toMatchObject({
      tenantId: tenant.id,
      orgId: org.id,
      selectedAgentId: "pending_brand",
    });
  });
});

process.on("exit", () => {
  cleanupSqliteFiles(dbPath);
});
