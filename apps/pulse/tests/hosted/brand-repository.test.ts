import { describe, expect, it } from "vitest";

import { cleanupSqliteFiles, createTempHostedDbPath } from "./temp-db.js";

const dbPath = createTempHostedDbPath("pulse-brand-repository");
process.env.HOSTED_DB_PATH = dbPath;

const { createOrg, createTenant, createWorkspace } =
  await import("../../hosted/db.js");
const { createBrandRepository } =
  await import("../../hosted/repositories/brands.js");

const brands = createBrandRepository();

describe("brand repository", () => {
  it("creates and reads brands with stable scoped interfaces", () => {
    const tenant = createTenant(
      "brand-repository-key",
      "claw_brand_repository",
      "repository@example.test",
      "Repository Tenant",
    );
    const org = createOrg({ name: "Repository Org" });
    const workspace = createWorkspace(org.id, "Default");
    const brand = brands.createBrand({
      orgId: org.id,
      workspaceId: workspace.id,
      name: "Repository Brand",
      legacyTenantId: tenant.id,
      legacyAgentId: "agent_legacy",
    });

    expect(brands.getBrand({ brandId: brand.id })).toMatchObject({
      id: brand.id,
      org_id: org.id,
      workspace_id: workspace.id,
      name: "Repository Brand",
      legacy_tenant_id: tenant.id,
      legacy_agent_id: "agent_legacy",
    });
    expect(
      brands.getBrandForOrg({ orgId: org.id, brandId: brand.id })?.id,
    ).toBe(brand.id);
    expect(
      brands
        .listBrandsForWorkspace({ workspaceId: workspace.id })
        .map((row) => row.id),
    ).toEqual([brand.id]);
  });

  it("does not leak org-scoped brand reads across organizations", () => {
    const firstOrg = createOrg({ name: "First Repository Org" });
    const secondOrg = createOrg({ name: "Second Repository Org" });
    const firstBrand = brands.createBrand({
      orgId: firstOrg.id,
      name: "First Repository Brand",
    });
    brands.createBrand({
      orgId: secondOrg.id,
      name: "Second Repository Brand",
    });

    expect(
      brands.listBrandsForOrg({ orgId: firstOrg.id }).map((brand) => brand.id),
    ).toEqual([firstBrand.id]);
    expect(
      brands.getBrandForOrg({ orgId: secondOrg.id, brandId: firstBrand.id }),
    ).toBeNull();
  });

  it("updates brand rows through brand scope", () => {
    const org = createOrg({ name: "Update Repository Org" });
    const firstWorkspace = createWorkspace(org.id, "First");
    const secondWorkspace = createWorkspace(org.id, "Second");
    const brand = brands.createBrand({
      orgId: org.id,
      workspaceId: firstWorkspace.id,
      name: "Before Update",
    });

    const updated = brands.updateBrand(
      { brandId: brand.id },
      { name: "After Update", workspaceId: secondWorkspace.id },
    );

    expect(updated).toMatchObject({
      id: brand.id,
      name: "After Update",
      workspace_id: secondWorkspace.id,
    });
    expect(
      brands.updateBrand({ brandId: "br_missing" }, { name: "Nope" }),
    ).toBeNull();
  });

  it("upserts provider connections without exposing object metadata to callers", () => {
    const org = createOrg({ name: "Connection Repository Org" });
    const brand = brands.createBrand({
      orgId: org.id,
      name: "Connection Brand",
    });

    const created = brands.upsertBrandConnection({
      brandId: brand.id,
      provider: "x",
      status: "disconnected",
      metadata: { handle: "@old" },
    });
    const updated = brands.upsertBrandConnection({
      brandId: brand.id,
      provider: "x",
      status: "connected",
      metadata: { handle: "@new", accountId: "x_1" },
    });

    expect(updated.id).toBe(created.id);
    expect(updated.status).toBe("connected");
    expect(JSON.parse(updated.metadata)).toEqual({
      handle: "@new",
      accountId: "x_1",
    });
    expect(
      brands.getBrandConnection({ brandId: brand.id, provider: "x" })?.id,
    ).toBe(created.id);
    expect(brands.listBrandConnections({ brandId: brand.id })).toHaveLength(1);
  });
});

process.on("exit", () => {
  cleanupSqliteFiles(dbPath);
});
