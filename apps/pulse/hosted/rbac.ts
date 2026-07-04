import type { Membership } from "./db.js";

export type StandaloneRole = Membership["role"];

export type StandalonePermission =
  | "org:admin"
  | "billing:manage"
  | "brand:manage"
  | "automation:configure"
  | "draft:approve"
  | "draft:create"
  | "analytics:read";

const ROLE_PERMISSIONS: Record<
  StandaloneRole,
  ReadonlySet<StandalonePermission>
> = {
  owner: new Set([
    "org:admin",
    "billing:manage",
    "brand:manage",
    "automation:configure",
    "draft:approve",
    "draft:create",
    "analytics:read",
  ]),
  admin: new Set([
    "brand:manage",
    "automation:configure",
    "draft:approve",
    "draft:create",
    "analytics:read",
  ]),
  approver: new Set(["draft:approve", "draft:create", "analytics:read"]),
  operator: new Set(["draft:create", "analytics:read"]),
  viewer: new Set(["analytics:read"]),
};

export function isStandaloneRole(value: string): value is StandaloneRole {
  return (
    value === "owner" ||
    value === "admin" ||
    value === "approver" ||
    value === "operator" ||
    value === "viewer"
  );
}

export function roleCan(
  role: StandaloneRole,
  permission: StandalonePermission,
): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

export function membershipCan(
  membership: Pick<Membership, "role"> | null | undefined,
  permission: StandalonePermission,
): boolean {
  return membership ? roleCan(membership.role, permission) : false;
}
