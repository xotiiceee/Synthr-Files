import { afterAll, describe, expect, it } from "vitest";

import { cleanupSqliteFiles, createTempHostedDbPath } from "./temp-db.js";

const dbPath = createTempHostedDbPath("pulse-account-permissions");
process.env.HOSTED_DB_PATH = dbPath;

const { addMembership, createOrg, createTenant, createUser } = await import(
  "../../hosted/db.js"
);
const { resolveAccountPermissions } = await import(
  "../../hosted/account-permissions.js"
);
const { createSession, SESSION_COOKIE } = await import(
  "../../hosted/sessions.js"
);

function cookieHeader(token: string) {
  return `${SESSION_COOKIE.name}=${encodeURIComponent(token)}`;
}

afterAll(() => {
  cleanupSqliteFiles(dbPath);
});

describe("account permission smoke coverage", () => {
  it("keeps ClawNet sessions owner-equivalent for rollback mode", () => {
    const permissions = resolveAccountPermissions({
      authProvider: "clawnet",
    });

    expect(permissions).toMatchObject({
      role: "owner",
      permissions: {
        orgAdmin: true,
        brandManage: true,
        draftApprove: true,
        draftCreate: true,
      },
    });
  });

  it("fails closed to viewer when first-party auth has no scoped session", () => {
    const tenant = createTenant(
      "cn_permissions_missing_session",
      "",
      "missing-session@example.test",
    );
    createOrg({ name: "Missing Session Org", legacyTenantId: tenant.id });

    const permissions = resolveAccountPermissions({
      authProvider: "firstparty",
      tenantId: tenant.id,
    });

    expect(permissions).toMatchObject({
      role: "viewer",
      permissions: {
        draftApprove: false,
        draftCreate: false,
        analyticsRead: true,
      },
    });
  });

  it("maps first-party org membership to draft approval controls", () => {
    const tenant = createTenant(
      "cn_permissions_approver",
      "",
      "approver@example.test",
    );
    const org = createOrg({ name: "Approver Org", legacyTenantId: tenant.id });
    const user = createUser({ email: "approver-ui@example.test" });
    addMembership(org.id, user.id, "approver");
    const { token } = createSession({ userId: user.id, orgId: org.id });

    const permissions = resolveAccountPermissions({
      authProvider: "firstparty",
      cookieHeader: cookieHeader(token),
      tenantId: tenant.id,
    });

    expect(permissions).toMatchObject({
      role: "approver",
      permissions: {
        orgAdmin: false,
        automationConfigure: false,
        draftApprove: true,
        draftCreate: true,
        analyticsRead: true,
      },
    });
  });

  it("does not apply a first-party membership from another tenant org", () => {
    const tenant = createTenant(
      "cn_permissions_cross_org",
      "",
      "cross-org@example.test",
    );
    createOrg({ name: "Tenant Org", legacyTenantId: tenant.id });
    const otherOrg = createOrg({ name: "Other Org" });
    const user = createUser({ email: "cross-org-permissions@example.test" });
    addMembership(otherOrg.id, user.id, "owner");
    const { token } = createSession({ userId: user.id, orgId: otherOrg.id });

    const permissions = resolveAccountPermissions({
      authProvider: "firstparty",
      cookieHeader: cookieHeader(token),
      tenantId: tenant.id,
    });

    expect(permissions).toMatchObject({
      role: "viewer",
      permissions: {
        orgAdmin: false,
        brandManage: false,
        draftApprove: false,
        draftCreate: false,
        analyticsRead: true,
      },
    });
  });
});
