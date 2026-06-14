import {
  createPrivacyRequest,
  getHostedDb,
  getPrivacyRequest,
  listPrivacyRequests,
  recordAuditEvent,
  type CreatePrivacyRequestInput,
  type Org,
  type PrivacyRequest,
  type Tenant,
  type User,
  updatePrivacyRequest,
  updateTenantStatus,
} from "./db.js";
import { withTenantContext } from "./tenant.js";

import type { PulseProfileExport } from "./profile-export.js";

type JsonRecord = Record<string, unknown>;

export interface PrivacyExportScope {
  subjectType: "tenant" | "org" | "user";
  subjectId: string;
  tenantIds: string[];
  orgIds: string[];
  userIds: string[];
}

export interface PrivacyExportPayload {
  $schema: "pulse-privacy-export";
  version: 1;
  exportedAt: string;
  scope: PrivacyExportScope;
  tenants: Array<Omit<Tenant, "api_key">>;
  orgs: Org[];
  users: Array<Omit<User, "password_hash"> & { memberships: JsonRecord[] }>;
  workspaces: JsonRecord[];
  brands: JsonRecord[];
  brandConnections: JsonRecord[];
  brandProfiles: JsonRecord[];
  brandKnowledgeNotes: JsonRecord[];
  tenantUsage: JsonRecord[];
  usageEvents: JsonRecord[];
  notes: JsonRecord[];
  feedback: JsonRecord[];
  preferenceProfiles: JsonRecord[];
  preferenceSignals: JsonRecord[];
  auditEvents: JsonRecord[];
  safetyEvents: JsonRecord[];
  runtimeActionLogs: JsonRecord[];
  runtimeApprovalQueue: JsonRecord[];
  runtimeContentQueue: JsonRecord[];
  runtimeScheduleState: JsonRecord[];
  runtimeOutreachDedup: JsonRecord[];
  runtimeXRateCounters: JsonRecord[];
  xWriteOperations: JsonRecord[];
  githubConnections: JsonRecord[];
  githubRepoLinks: JsonRecord[];
  githubRepoAgentLinks: JsonRecord[];
  privacyRequests: PrivacyRequest[];
  profileExports: Array<{
    tenantId: string;
    profile: PulseProfileExport | null;
  }>;
  excluded: {
    tenantApiKeys: true;
    userPasswordHashes: true;
    tenantSecretValues: true;
    tenantSecretKeys: Record<string, string[]>;
  };
}

export interface RequestPrivacyActionInput extends CreatePrivacyRequestInput {
  execute?: boolean;
}

function parseJson(value: unknown, fallback: unknown): unknown {
  if (typeof value !== "string" || value.trim() === "") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function unique(values: Array<string | null | undefined>): string[] {
  return [
    ...new Set(values.filter((value): value is string => Boolean(value))),
  ];
}

function getTenantsForScope(scope: {
  subjectType: PrivacyExportScope["subjectType"];
  subjectId: string;
}): Tenant[] {
  const db = getHostedDb();
  if (scope.subjectType === "tenant") {
    const tenant = db
      .prepare("SELECT * FROM tenants WHERE id = ?")
      .get(scope.subjectId) as Tenant | undefined;
    return tenant ? [tenant] : [];
  }
  if (scope.subjectType === "org") {
    return db
      .prepare(
        `SELECT DISTINCT t.*
         FROM tenants t
         LEFT JOIN orgs o ON o.legacy_tenant_id = t.id
         LEFT JOIN brands b ON b.legacy_tenant_id = t.id
         WHERE o.id = ? OR b.org_id = ?`,
      )
      .all(scope.subjectId, scope.subjectId) as Tenant[];
  }
  return db
    .prepare(
      `SELECT DISTINCT t.*
       FROM tenants t
       JOIN orgs o ON o.legacy_tenant_id = t.id
       JOIN memberships m ON m.org_id = o.id
       WHERE m.user_id = ?`,
    )
    .all(scope.subjectId) as Tenant[];
}

function getOrgsForScope(scope: {
  subjectType: PrivacyExportScope["subjectType"];
  subjectId: string;
  tenantIds: string[];
}): Org[] {
  const db = getHostedDb();
  if (scope.subjectType === "org") {
    return db
      .prepare("SELECT * FROM orgs WHERE id = ?")
      .all(scope.subjectId) as Org[];
  }
  if (scope.subjectType === "user") {
    return db
      .prepare(
        `SELECT DISTINCT o.*
         FROM orgs o
         JOIN memberships m ON m.org_id = o.id
         WHERE m.user_id = ?`,
      )
      .all(scope.subjectId) as Org[];
  }
  if (scope.tenantIds.length === 0) return [];
  const placeholders = scope.tenantIds.map(() => "?").join(", ");
  return db
    .prepare(
      `SELECT * FROM orgs WHERE legacy_tenant_id IN (${placeholders}) ORDER BY created_at ASC`,
    )
    .all(...scope.tenantIds) as Org[];
}

function getUsersForOrgs(
  orgIds: string[],
): Array<Omit<User, "password_hash"> & { memberships: JsonRecord[] }> {
  if (orgIds.length === 0) return [];
  const db = getHostedDb();
  const placeholders = orgIds.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT
         u.id,
         u.email,
         u.name,
         u.created_at,
         u.updated_at,
         m.org_id,
         m.role,
         m.created_at AS membership_created_at
       FROM users u
       JOIN memberships m ON m.user_id = u.id
       WHERE m.org_id IN (${placeholders})
       ORDER BY u.created_at ASC, m.created_at ASC`,
    )
    .all(...orgIds) as Array<
    Omit<User, "password_hash"> & {
      org_id: string;
      role: string;
      membership_created_at: string;
    }
  >;

  const byUser = new Map<
    string,
    Omit<User, "password_hash"> & { memberships: JsonRecord[] }
  >();
  for (const row of rows) {
    const existing =
      byUser.get(row.id) ||
      ({
        id: row.id,
        email: row.email,
        name: row.name,
        created_at: row.created_at,
        updated_at: row.updated_at,
        memberships: [],
      } satisfies Omit<User, "password_hash"> & { memberships: JsonRecord[] });
    existing.memberships.push({
      orgId: row.org_id,
      role: row.role,
      createdAt: row.membership_created_at,
    });
    byUser.set(row.id, existing);
  }
  return [...byUser.values()];
}

function getUserForScope(
  userId: string,
  orgIds: string[],
): (Omit<User, "password_hash"> & { memberships: JsonRecord[] }) | null {
  const db = getHostedDb();
  const base = db
    .prepare(
      "SELECT id, email, name, created_at, updated_at FROM users WHERE id = ?",
    )
    .get(userId) as Omit<User, "password_hash"> | undefined;
  if (!base) return null;
  const memberships =
    orgIds.length === 0
      ? ((
          db
            .prepare(
              "SELECT org_id, role, created_at FROM memberships WHERE user_id = ? ORDER BY created_at ASC",
            )
            .all(userId) as Array<{
            org_id: string;
            role: string;
            created_at: string;
          }>
        ).map((row) => ({
          orgId: row.org_id,
          role: row.role,
          createdAt: row.created_at,
        })) as JsonRecord[])
      : getUsersForOrgs(orgIds).find((user) => user.id === userId)
          ?.memberships || [];
  return { ...base, memberships };
}

function sanitizeTenantRows(rows: Tenant[]): Array<Omit<Tenant, "api_key">> {
  return rows.map(({ api_key: _apiKey, ...tenant }) => tenant);
}

function sanitizeMetadataRows(
  rows: Array<Record<string, unknown>>,
): JsonRecord[] {
  return rows.map((row) => ({
    ...row,
    metadata: parseJson(row.metadata, {}),
  }));
}

function tableExists(tableName: string): boolean {
  const row = getHostedDb()
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { name: string } | undefined;
  return Boolean(row);
}

function listRowsByTenantIds(
  tableName: string,
  tenantIds: string[],
  orderBy: string,
): JsonRecord[] {
  if (tenantIds.length === 0 || !tableExists(tableName)) return [];
  return getHostedDb()
    .prepare(
      `SELECT * FROM ${tableName} WHERE tenant_id IN (${tenantIds.map(() => "?").join(", ")}) ORDER BY ${orderBy}`,
    )
    .all(...tenantIds) as JsonRecord[];
}

function listRowsByBrandIds(
  tableName: string,
  brandIds: string[],
  orderBy: string,
): JsonRecord[] {
  if (brandIds.length === 0 || !tableExists(tableName)) return [];
  return getHostedDb()
    .prepare(
      `SELECT * FROM ${tableName} WHERE brand_id IN (${brandIds.map(() => "?").join(", ")}) ORDER BY ${orderBy}`,
    )
    .all(...brandIds) as JsonRecord[];
}

function sanitizeRuntimeApprovalRows(rows: JsonRecord[]): JsonRecord[] {
  return rows.map((row) => ({
    ...row,
    risk_flags: parseJson(row.risk_flags, []),
    metadata: parseJson(row.metadata, {}),
  }));
}

function sanitizeRuntimeContentRows(rows: JsonRecord[]): JsonRecord[] {
  return rows.map((row) => ({
    ...row,
    metadata: parseJson(row.metadata, {}),
  }));
}

function sanitizeRuntimeActionRows(rows: JsonRecord[]): JsonRecord[] {
  return rows.map((row) => ({
    ...row,
    engagement: parseJson(row.engagement, null),
  }));
}

async function exportProfilesForTenants(
  tenantIds: string[],
): Promise<Array<{ tenantId: string; profile: PulseProfileExport | null }>> {
  const results: Array<{
    tenantId: string;
    profile: PulseProfileExport | null;
  }> = [];
  for (const tenantId of tenantIds) {
    let profile: PulseProfileExport | null = null;
    try {
      profile = await withTenantContext(tenantId, async () => {
        const { exportAgentProfile } = await import("./profile-export.js");
        return exportAgentProfile();
      });
    } catch {
      profile = null;
    }
    results.push({ tenantId, profile });
  }
  return results;
}

export async function exportPrivacyData(scope: {
  subjectType: PrivacyExportScope["subjectType"];
  subjectId: string;
  includeProfileExport?: boolean;
}): Promise<PrivacyExportPayload> {
  const db = getHostedDb();
  const tenants = getTenantsForScope(scope);
  const tenantIds = tenants.map((tenant) => tenant.id);
  const orgs = getOrgsForScope({
    subjectType: scope.subjectType,
    subjectId: scope.subjectId,
    tenantIds,
  });
  const orgIds = orgs.map((org) => org.id);
  const users =
    scope.subjectType === "user"
      ? unique([scope.subjectId]).flatMap((userId) => {
          const user = getUserForScope(userId, orgIds);
          return user ? [user] : [];
        })
      : getUsersForOrgs(orgIds);
  const userIds =
    scope.subjectType === "user"
      ? unique([scope.subjectId, ...users.map((user) => user.id)])
      : users.map((user) => user.id);

  const workspaceRows =
    orgIds.length === 0
      ? []
      : (db
          .prepare(
            `SELECT * FROM workspaces WHERE org_id IN (${orgIds.map(() => "?").join(", ")}) ORDER BY created_at ASC`,
          )
          .all(...orgIds) as JsonRecord[]);
  const brandRows =
    orgIds.length === 0
      ? []
      : scope.subjectType === "tenant" && tenantIds.length > 0
        ? (db
            .prepare(
              `SELECT * FROM brands
                WHERE org_id IN (${orgIds.map(() => "?").join(", ")})
                  AND legacy_tenant_id IN (${tenantIds.map(() => "?").join(", ")})
                ORDER BY created_at ASC`,
            )
            .all(...orgIds, ...tenantIds) as JsonRecord[])
        : (db
            .prepare(
              `SELECT * FROM brands WHERE org_id IN (${orgIds.map(() => "?").join(", ")}) ORDER BY created_at ASC`,
            )
            .all(...orgIds) as JsonRecord[]);
  const brandIds = brandRows.map((brand) => String(brand.id));
  const brandConnectionRows =
    brandIds.length === 0
      ? []
      : (db
          .prepare(
            `SELECT * FROM brand_connections WHERE brand_id IN (${brandIds.map(() => "?").join(", ")}) ORDER BY created_at ASC`,
          )
          .all(...brandIds) as JsonRecord[]);
  const brandProfileRows =
    brandIds.length === 0
      ? []
      : (
          db
            .prepare(
              `SELECT * FROM brand_profiles WHERE brand_id IN (${brandIds.map(() => "?").join(", ")}) ORDER BY updated_at DESC`,
            )
            .all(...brandIds) as JsonRecord[]
        ).map((row) => ({
          ...row,
          profile_json: parseJson(row.profile_json, {}),
        }));
  const brandKnowledgeNoteRows =
    brandIds.length === 0
      ? []
      : (
          db
            .prepare(
              `SELECT * FROM brand_knowledge_notes WHERE brand_id IN (${brandIds.map(() => "?").join(", ")}) ORDER BY updated_at DESC`,
            )
            .all(...brandIds) as JsonRecord[]
        ).map((row) => ({
          ...row,
          tags: parseJson(row.tags, []),
        }));

  const tenantUsageRows =
    tenantIds.length === 0
      ? []
      : (db
          .prepare(
            `SELECT * FROM tenant_usage WHERE tenant_id IN (${tenantIds.map(() => "?").join(", ")}) ORDER BY date DESC`,
          )
          .all(...tenantIds) as JsonRecord[]);
  const usageEventRows =
    scope.subjectType === "org" && orgIds.length > 0
      ? sanitizeMetadataRows(
          db
            .prepare(
              `SELECT * FROM usage_events WHERE org_id IN (${orgIds.map(() => "?").join(", ")}) ORDER BY created_at DESC`,
            )
            .all(...orgIds) as Array<Record<string, unknown>>,
        )
      : tenantIds.length > 0
        ? sanitizeMetadataRows(
            db
              .prepare(
                `SELECT * FROM usage_events WHERE tenant_id IN (${tenantIds.map(() => "?").join(", ")}) ORDER BY created_at DESC`,
              )
              .all(...tenantIds) as Array<Record<string, unknown>>,
          )
        : [];
  const noteRows =
    tenantIds.length === 0
      ? []
      : (
          db
            .prepare(
              `SELECT * FROM tenant_notes WHERE tenant_id IN (${tenantIds.map(() => "?").join(", ")}) ORDER BY updated_at DESC`,
            )
            .all(...tenantIds) as JsonRecord[]
        ).map((row) => ({
          ...row,
          tags: parseJson(row.tags, []),
        }));
  const feedbackRows =
    tenantIds.length === 0
      ? []
      : (db
          .prepare(
            `SELECT * FROM feedback WHERE tenant_id IN (${tenantIds.map(() => "?").join(", ")}) ORDER BY created_at DESC`,
          )
          .all(...tenantIds) as JsonRecord[]);
  const preferenceProfileRows =
    tenantIds.length === 0
      ? []
      : (db
          .prepare(
            `SELECT * FROM preference_profiles WHERE tenant_id IN (${tenantIds.map(() => "?").join(", ")}) ORDER BY updated_at DESC`,
          )
          .all(...tenantIds) as JsonRecord[]);
  const preferenceSignalRows =
    tenantIds.length === 0
      ? []
      : (
          db
            .prepare(
              `SELECT * FROM preference_signals WHERE tenant_id IN (${tenantIds.map(() => "?").join(", ")}) ORDER BY created_at DESC`,
            )
            .all(...tenantIds) as JsonRecord[]
        ).map((row) => ({
          ...row,
          signal_data: parseJson(row.signal_data, {}),
        }));
  const auditEventRows =
    scope.subjectType === "user"
      ? sanitizeMetadataRows(
          db
            .prepare(
              "SELECT * FROM audit_events WHERE actor_id = ? ORDER BY created_at DESC",
            )
            .all(scope.subjectId) as Array<Record<string, unknown>>,
        )
      : scope.subjectType === "org" && orgIds.length > 0
        ? sanitizeMetadataRows(
            db
              .prepare(
                `SELECT * FROM audit_events WHERE org_id IN (${orgIds.map(() => "?").join(", ")}) ORDER BY created_at DESC`,
              )
              .all(...orgIds) as Array<Record<string, unknown>>,
          )
        : tenantIds.length > 0
          ? sanitizeMetadataRows(
              db
                .prepare(
                  `SELECT * FROM audit_events WHERE tenant_id IN (${tenantIds.map(() => "?").join(", ")}) ORDER BY created_at DESC`,
                )
                .all(...tenantIds) as Array<Record<string, unknown>>,
            )
          : [];
  const safetyEventRows =
    scope.subjectType === "org" && orgIds.length > 0
      ? sanitizeMetadataRows(
          db
            .prepare(
              `SELECT * FROM safety_events WHERE org_id IN (${orgIds.map(() => "?").join(", ")}) ORDER BY created_at DESC`,
            )
            .all(...orgIds) as Array<Record<string, unknown>>,
        )
      : tenantIds.length > 0
        ? sanitizeMetadataRows(
            db
              .prepare(
                `SELECT * FROM safety_events WHERE tenant_id IN (${tenantIds.map(() => "?").join(", ")}) ORDER BY created_at DESC`,
              )
              .all(...tenantIds) as Array<Record<string, unknown>>,
          )
        : [];
  const runtimeActionLogRows = sanitizeRuntimeActionRows(
    listRowsByBrandIds("runtime_action_logs", brandIds, "timestamp DESC"),
  );
  const runtimeApprovalQueueRows = sanitizeRuntimeApprovalRows(
    listRowsByBrandIds("runtime_approval_queue", brandIds, "created_at DESC"),
  );
  const runtimeContentQueueRows = sanitizeRuntimeContentRows(
    listRowsByBrandIds(
      "runtime_content_queue",
      brandIds,
      "scheduled_at ASC, item_id ASC",
    ),
  );
  const runtimeScheduleStateRows = listRowsByTenantIds(
    "runtime_schedule_state",
    tenantIds,
    "updated_at DESC",
  );
  const runtimeOutreachDedupRows = listRowsByTenantIds(
    "runtime_outreach_dedup",
    tenantIds,
    "first_seen_at DESC",
  );
  const runtimeXRateCounterRows = listRowsByTenantIds(
    "runtime_x_rate_counters",
    tenantIds,
    "updated_at DESC",
  );
  const xWriteOperationRows = sanitizeMetadataRows(
    listRowsByTenantIds("x_write_operations", tenantIds, "started_at DESC"),
  );
  const githubConnections =
    tenantIds.length === 0
      ? []
      : (db
          .prepare(
            `SELECT * FROM github_connections WHERE tenant_id IN (${tenantIds.map(() => "?").join(", ")}) ORDER BY created_at ASC`,
          )
          .all(...tenantIds) as JsonRecord[]);
  const githubRepoLinks =
    tenantIds.length === 0
      ? []
      : (
          db
            .prepare(
              `SELECT * FROM github_repo_links WHERE tenant_id IN (${tenantIds.map(() => "?").join(", ")}) ORDER BY full_name ASC`,
            )
            .all(...tenantIds) as JsonRecord[]
        ).map((row) => ({
          ...row,
          allowed_paths: parseJson(row.allowed_paths, []),
        }));
  const githubRepoAgentLinks =
    tenantIds.length === 0
      ? []
      : (db
          .prepare(
            `SELECT grl.tenant_id, grl.repo_id, gral.agent_id
             FROM github_repo_agent_links gral
             JOIN github_repo_links grl ON grl.id = gral.repo_link_id
             WHERE grl.tenant_id IN (${tenantIds.map(() => "?").join(", ")})
             ORDER BY grl.repo_id ASC, gral.agent_id ASC`,
          )
          .all(...tenantIds) as JsonRecord[]);
  const privacyRequests = listPrivacyRequests({
    tenantId: scope.subjectType === "tenant" ? scope.subjectId : undefined,
    orgId: scope.subjectType === "org" ? scope.subjectId : undefined,
    userId: scope.subjectType === "user" ? scope.subjectId : undefined,
    limit: 200,
  });
  const secretKeyRows =
    tenantIds.length === 0
      ? []
      : (db
          .prepare(
            `SELECT tenant_id, key_name FROM tenant_secrets WHERE tenant_id IN (${tenantIds.map(() => "?").join(", ")}) ORDER BY tenant_id ASC, key_name ASC`,
          )
          .all(...tenantIds) as Array<{ tenant_id: string; key_name: string }>);
  const tenantSecretKeys = secretKeyRows.reduce<Record<string, string[]>>(
    (acc, row) => {
      acc[row.tenant_id] ||= [];
      acc[row.tenant_id].push(row.key_name);
      return acc;
    },
    {},
  );

  return {
    $schema: "pulse-privacy-export",
    version: 1,
    exportedAt: new Date().toISOString(),
    scope: {
      subjectType: scope.subjectType,
      subjectId: scope.subjectId,
      tenantIds,
      orgIds,
      userIds,
    },
    tenants: sanitizeTenantRows(tenants),
    orgs,
    users,
    workspaces: workspaceRows,
    brands: brandRows,
    brandConnections: brandConnectionRows.map((row) => ({
      ...row,
      metadata: parseJson(row.metadata, {}),
    })),
    brandProfiles: brandProfileRows,
    brandKnowledgeNotes: brandKnowledgeNoteRows,
    tenantUsage: tenantUsageRows,
    usageEvents: usageEventRows,
    notes: noteRows,
    feedback: feedbackRows,
    preferenceProfiles: preferenceProfileRows,
    preferenceSignals: preferenceSignalRows,
    auditEvents: auditEventRows,
    safetyEvents: safetyEventRows,
    runtimeActionLogs: runtimeActionLogRows,
    runtimeApprovalQueue: runtimeApprovalQueueRows,
    runtimeContentQueue: runtimeContentQueueRows,
    runtimeScheduleState: runtimeScheduleStateRows,
    runtimeOutreachDedup: runtimeOutreachDedupRows,
    runtimeXRateCounters: runtimeXRateCounterRows,
    xWriteOperations: xWriteOperationRows,
    githubConnections,
    githubRepoLinks,
    githubRepoAgentLinks,
    privacyRequests,
    profileExports:
      scope.includeProfileExport === false
        ? []
        : await exportProfilesForTenants(tenantIds),
    excluded: {
      tenantApiKeys: true,
      userPasswordHashes: true,
      tenantSecretValues: true,
      tenantSecretKeys,
    },
  };
}

function getDefaultPrivacyRequestStatus(
  input: CreatePrivacyRequestInput,
): PrivacyRequest["status"] {
  if (input.action === "export") return "pending";
  if (
    input.subjectType === "tenant" &&
    (input.mode || "record_only") === "soft_delete"
  ) {
    return "pending";
  }
  return "manual_review_required";
}

export function recordPrivacyRequest(
  input: CreatePrivacyRequestInput,
): PrivacyRequest {
  return createPrivacyRequest({
    ...input,
    status: input.status || getDefaultPrivacyRequestStatus(input),
  });
}

export async function executePrivacyRequest(requestId: string): Promise<
  | { request: PrivacyRequest; exportData: PrivacyExportPayload }
  | {
      request: PrivacyRequest;
      result: "soft_deleted" | "manual_review_required";
    }
> {
  const request = getPrivacyRequest(requestId);
  if (!request) {
    throw new Error(`Privacy request not found: ${requestId}`);
  }

  updatePrivacyRequest(request.id, { status: "in_progress" });

  if (request.action === "export") {
    const exportData = await exportPrivacyData({
      subjectType: request.subject_type,
      subjectId: request.subject_id,
      includeProfileExport: true,
    });
    updatePrivacyRequest(request.id, {
      status: "completed",
      metadata: {
        exportedAt: exportData.exportedAt,
        tenantCount: exportData.scope.tenantIds.length,
        orgCount: exportData.scope.orgIds.length,
        userCount: exportData.scope.userIds.length,
      },
    });
    return { request: getPrivacyRequest(request.id)!, exportData };
  }

  if (
    request.subject_type === "tenant" &&
    request.mode === "soft_delete" &&
    request.subject_id.trim()
  ) {
    updateTenantStatus(request.subject_id, "deleted");
    recordAuditEvent({
      tenantId: request.subject_id,
      orgId: request.org_id || undefined,
      actorId: request.requested_by || undefined,
      action:
        request.action === "anonymize"
          ? "privacy.anonymize.soft_delete"
          : "privacy.delete.soft_delete",
      targetType: "tenant",
      targetId: request.subject_id,
      metadata: {
        requestId: request.id,
        mode: request.mode,
        note: "Tenant marked deleted. No tenant-scoped hard deletion or secret erasure was performed by this foundation path.",
      },
    });
    updatePrivacyRequest(request.id, {
      status: "completed",
      metadata: {
        appliedTenantStatus: "deleted",
        destructiveDeletionPerformed: false,
      },
    });
    return {
      request: getPrivacyRequest(request.id)!,
      result: "soft_deleted",
    };
  }

  updatePrivacyRequest(request.id, {
    status: "manual_review_required",
    metadata: {
      destructiveDeletionPerformed: false,
      reason:
        "Automatic execution is limited to tenant soft-delete requests. Org and user delete/anonymize requests remain recorded for manual handling.",
    },
  });
  return {
    request: getPrivacyRequest(request.id)!,
    result: "manual_review_required",
  };
}

export async function requestPrivacyAction(
  input: RequestPrivacyActionInput,
): Promise<
  | { request: PrivacyRequest }
  | { request: PrivacyRequest; exportData: PrivacyExportPayload }
  | {
      request: PrivacyRequest;
      result: "soft_deleted" | "manual_review_required";
    }
> {
  const request = recordPrivacyRequest(input);
  if (!input.execute) return { request };
  return executePrivacyRequest(request.id);
}
