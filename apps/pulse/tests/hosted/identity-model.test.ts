import { describe, expect, it } from "vitest";

import { cleanupSqliteFiles, createTempHostedDbPath } from "./temp-db.js";

const dbPath = createTempHostedDbPath("pulse-identity");
process.env.HOSTED_DB_PATH = dbPath;

const {
  addMembership,
  createBrand,
  createOrg,
  createTenant,
  createUser,
  createWorkspace,
  getBrand,
  getMembership,
  getOrg,
  getUserByEmail,
  listBrandConnections,
  listBrandsForOrg,
  listMembershipsForUser,
  upsertBrandConnection,
} = await import("../../hosted/db.js");

describe("standalone identity model", () => {
  it("creates org, user, membership, workspace, and brand records", () => {
    const tenant = createTenant(
      "cn-identity-test",
      "claw_user_1",
      "legacy@example.com",
      "Legacy Tenant",
    );
    const org = createOrg({
      name: "Acme Growth",
      billingEmail: "billing@acme.test",
      legacyTenantId: tenant.id,
    });
    const user = createUser({
      email: "founder@acme.test",
      name: "Founder",
      passwordHash: "hash",
    });
    const membership = addMembership(org.id, user.id, "owner");
    const workspace = createWorkspace(org.id, "Default");
    const brand = createBrand({
      orgId: org.id,
      workspaceId: workspace.id,
      name: "Acme",
      legacyTenantId: tenant.id,
      legacyAgentId: "default",
    });

    expect(getOrg(org.id)).toMatchObject({
      id: org.id,
      name: "Acme Growth",
      billing_email: "billing@acme.test",
      legacy_tenant_id: tenant.id,
    });
    expect(getUserByEmail("founder@acme.test")).toMatchObject({
      id: user.id,
      name: "Founder",
      password_hash: "hash",
    });
    expect(membership).toMatchObject({
      org_id: org.id,
      user_id: user.id,
      role: "owner",
    });
    expect(listMembershipsForUser(user.id)).toHaveLength(1);
    expect(addMembership(org.id, user.id, "approver").role).toBe("approver");
    expect(getMembership(org.id, user.id)?.role).toBe("approver");
    expect(getBrand(brand.id)).toMatchObject({
      org_id: org.id,
      workspace_id: workspace.id,
      legacy_tenant_id: tenant.id,
      legacy_agent_id: "default",
    });
  });

  it("scopes brand listing to the owning org", () => {
    const firstOrg = createOrg({ name: "First Org" });
    const secondOrg = createOrg({ name: "Second Org" });
    const firstBrand = createBrand({ orgId: firstOrg.id, name: "First Brand" });
    createBrand({ orgId: secondOrg.id, name: "Second Brand" });

    expect(listBrandsForOrg(firstOrg.id).map((brand) => brand.id)).toEqual([
      firstBrand.id,
    ]);
  });

  it("upserts brand provider connections", () => {
    const org = createOrg({ name: "Connection Org" });
    const brand = createBrand({ orgId: org.id, name: "Connected Brand" });

    const created = upsertBrandConnection({
      brandId: brand.id,
      provider: "x",
      status: "disconnected",
      metadata: { handle: "@old" },
    });
    const updated = upsertBrandConnection({
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
    expect(listBrandConnections(brand.id)).toHaveLength(1);
  });
});

process.on("exit", () => {
  cleanupSqliteFiles(dbPath);
});
