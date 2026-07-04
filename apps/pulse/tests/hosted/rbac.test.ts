import { describe, expect, it } from "vitest";

import {
  isStandaloneRole,
  membershipCan,
  roleCan,
  type StandalonePermission,
  type StandaloneRole,
} from "../../hosted/rbac.js";

describe("standalone RBAC helpers", () => {
  it("recognizes the standalone role set", () => {
    expect(isStandaloneRole("owner")).toBe(true);
    expect(isStandaloneRole("admin")).toBe(true);
    expect(isStandaloneRole("approver")).toBe(true);
    expect(isStandaloneRole("operator")).toBe(true);
    expect(isStandaloneRole("viewer")).toBe(true);
    expect(isStandaloneRole("guest")).toBe(false);
  });

  it("keeps billing and org admin permissions owner-only", () => {
    const roles: StandaloneRole[] = [
      "owner",
      "admin",
      "approver",
      "operator",
      "viewer",
    ];

    expect(roles.filter((role) => roleCan(role, "billing:manage"))).toEqual([
      "owner",
    ]);
    expect(roles.filter((role) => roleCan(role, "org:admin"))).toEqual([
      "owner",
    ]);
  });

  it("allows approvers to approve drafts without managing automation", () => {
    expect(roleCan("approver", "draft:approve")).toBe(true);
    expect(roleCan("approver", "draft:create")).toBe(true);
    expect(roleCan("approver", "automation:configure")).toBe(false);
    expect(roleCan("operator", "draft:approve")).toBe(false);
  });

  it("checks membership permissions defensively", () => {
    const permission: StandalonePermission = "analytics:read";

    expect(membershipCan({ role: "viewer" }, permission)).toBe(true);
    expect(membershipCan(null, permission)).toBe(false);
    expect(membershipCan(undefined, permission)).toBe(false);
  });
});
