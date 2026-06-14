import {
  createBrand,
  createOrg,
  createWorkspace,
  getHostedDb,
  getTenant,
  type Brand,
} from "./db.js";

export interface HostedTenantRuntimeContext {
  tenantId: string;
  orgId?: string;
  workspaceId?: string;
  brandId?: string;
  brandName?: string;
  legacyAgentId?: string;
  selectedAgentId?: string;
}

export interface HostedBrandRuntimeContext {
  tenantId: string;
  orgId: string;
  workspaceId: string;
  brandId: string;
  brandName: string;
  legacyAgentId: string;
  selectedAgentId: string;
  runtimeEnabled: boolean;
  deletedAt: string;
  runtimeConfig: HostedBrandRuntimeConfig;
}

export interface EnsureHostedBrandRuntimeContextInput {
  tenantId: string;
  legacyAgentId: string;
  brandName: string;
  workspaceName?: string;
  runtimeConfig?: Partial<HostedBrandRuntimeConfig>;
}

export interface HostedBrandRuntimeConfig {
  name: string;
  brandName: string;
  website: string;
  tagline: string;
  niche: string;
  xHandle: string;
  tone: string;
  agentRole: string;
  competitors: string[];
  topics: Array<{ id: string; query: string; textMustMatch: string[] }>;
  contentThemes: string[];
  idealCustomer: string;
  problemSolved: string;
  uniqueValue: string;
  account?: object;
  connections?: object;
  createdAt?: string;
  updatedAt?: string;
}

export interface LegacyAgentCompatibilityInput {
  id: string;
  name?: string;
  brandName?: string;
  website?: string;
  tagline?: string;
  niche?: string;
  xHandle?: string;
  tone?: string;
  agentRole?: string;
  competitors?: string[];
  topics?: Array<{ id: string; query: string; textMustMatch: string[] }>;
  contentThemes?: string[];
  idealCustomer?: string;
  problemSolved?: string;
  uniqueValue?: string;
  account?: object;
  connections?: object;
  running?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface HostedAgentCompatibilityView
  extends LegacyAgentCompatibilityInput {
  id: string;
  name: string;
  brandName: string;
  website: string;
  tagline: string;
  niche: string;
  xHandle: string;
  tone: string;
  agentRole: string;
  competitors: string[];
  topics: Array<{ id: string; query: string; textMustMatch: string[] }>;
  contentThemes: string[];
  running: boolean;
  brandId: string;
  orgId: string;
  workspaceId: string;
}

export function resolveHostedTenantRuntimeContext(input: {
  tenantId: string;
  agentId?: string | null;
}): HostedTenantRuntimeContext {
  const tenantId = input.tenantId.trim();
  if (!tenantId) return { tenantId: "" };

  const brand = resolveHostedBrandRuntimeContext({
    tenantId,
    agentId: input.agentId,
  });
  if (brand) return brand;

  const org = getHostedDb()
    .prepare(
      `SELECT id
         FROM orgs
        WHERE legacy_tenant_id = ?
        ORDER BY updated_at DESC, created_at DESC, id DESC
        LIMIT 1`,
    )
    .get(tenantId) as { id: string } | undefined;

  return {
    tenantId,
    orgId: org?.id,
    selectedAgentId: input.agentId?.trim() || undefined,
  };
}

export function listHostedBrandRuntimeContexts(input: {
  tenantId: string;
  includeDeleted?: boolean;
}): HostedBrandRuntimeContext[] {
  const tenantId = input.tenantId.trim();
  if (!tenantId) return [];

  const rows = getHostedDb()
    .prepare(
      `SELECT id, org_id, workspace_id, name, legacy_agent_id
              , runtime_config_json, runtime_enabled, deleted_at
         FROM brands
        WHERE legacy_tenant_id = ?
          ${input.includeDeleted ? "" : "AND deleted_at = ''"}
        ORDER BY updated_at DESC, created_at DESC, id DESC`,
    )
    .all(tenantId) as Array<{
    id: string;
    org_id: string;
    workspace_id: string | null;
    name: string;
    legacy_agent_id: string;
    runtime_config_json: string;
    runtime_enabled: 0 | 1;
    deleted_at: string;
  }>;

  return rows.map((row) => ({
    tenantId,
    orgId: row.org_id,
    workspaceId: row.workspace_id || "",
    brandId: row.id,
    brandName: row.name,
    legacyAgentId: row.legacy_agent_id,
    selectedAgentId: row.legacy_agent_id || "default",
    runtimeEnabled: row.runtime_enabled === 1,
    deletedAt: row.deleted_at,
    runtimeConfig: parseRuntimeConfig(row.runtime_config_json, {
      name: row.name,
      brandName: row.name,
    }),
  }));
}

export function listHostedRunnableBrandRuntimeContexts(input: {
  tenantId: string;
}): HostedBrandRuntimeContext[] {
  return listHostedBrandRuntimeContexts({ tenantId: input.tenantId }).filter(
    (context) => context.runtimeEnabled,
  );
}

export function listHostedAgentCompatibilityViews(input: {
  tenantId: string;
  legacyAgents: LegacyAgentCompatibilityInput[];
}): HostedAgentCompatibilityView[] {
  const contexts = listHostedBrandRuntimeContexts({ tenantId: input.tenantId });
  const legacyById = new Map(input.legacyAgents.map((agent) => [agent.id, agent]));

  return contexts.map((context) => {
    const legacy = legacyById.get(context.legacyAgentId);
    const sqlConfig = context.runtimeConfig;
    return {
      ...(legacy ?? {}),
      id: context.legacyAgentId || context.selectedAgentId,
      name: sqlConfig.name || legacy?.name || context.brandName,
      brandName: sqlConfig.brandName || legacy?.brandName || context.brandName,
      website: sqlConfig.website || legacy?.website || "",
      tagline: sqlConfig.tagline || legacy?.tagline || "",
      niche: sqlConfig.niche || legacy?.niche || "",
      xHandle: sqlConfig.xHandle || legacy?.xHandle || "",
      tone: sqlConfig.tone || legacy?.tone || "professional",
      agentRole: sqlConfig.agentRole || legacy?.agentRole || "",
      competitors: sqlConfig.competitors.length
        ? sqlConfig.competitors
        : legacy?.competitors || [],
      topics: sqlConfig.topics.length ? sqlConfig.topics : legacy?.topics || [],
      contentThemes: sqlConfig.contentThemes.length
        ? sqlConfig.contentThemes
        : legacy?.contentThemes || [],
      idealCustomer: sqlConfig.idealCustomer || legacy?.idealCustomer,
      problemSolved: sqlConfig.problemSolved || legacy?.problemSolved,
      uniqueValue: sqlConfig.uniqueValue || legacy?.uniqueValue,
      account: sqlConfig.account || legacy?.account,
      connections: sqlConfig.connections || legacy?.connections,
      createdAt: sqlConfig.createdAt || legacy?.createdAt,
      updatedAt: sqlConfig.updatedAt || legacy?.updatedAt,
      running: context.runtimeEnabled,
      brandId: context.brandId,
      orgId: context.orgId,
      workspaceId: context.workspaceId,
    };
  });
}

export function ensureHostedBrandRuntimeContext(
  input: EnsureHostedBrandRuntimeContextInput,
): HostedBrandRuntimeContext {
  const tenantId = input.tenantId.trim();
  if (!tenantId) throw new Error("Hosted brand runtime tenantId is required");
  const legacyAgentId = input.legacyAgentId.trim() || "default";
  const brandName = input.brandName.trim() || legacyAgentId;

  const existing = resolveHostedBrandRuntimeContext({
    tenantId,
    agentId: legacyAgentId,
    includeDeleted: true,
  });
  if (existing) {
    const runtimeConfig = normalizeRuntimeConfig({
      ...existing.runtimeConfig,
      ...(input.runtimeConfig ?? {}),
      name:
        input.runtimeConfig?.name || existing.runtimeConfig.name || brandName,
      brandName,
    });
    getHostedDb()
      .prepare(
        `UPDATE brands
            SET name = ?,
                runtime_config_json = ?,
                deleted_at = '',
                updated_at = datetime('now')
          WHERE id = ?`,
      )
      .run(brandName, JSON.stringify(runtimeConfig), existing.brandId);
    return { ...existing, brandName, deletedAt: "", runtimeConfig };
  }

  const runtimeConfig = normalizeRuntimeConfig({
    name: input.runtimeConfig?.name || brandName,
    brandName,
    ...input.runtimeConfig,
  });

  const orgId = ensureOrgForTenant(tenantId);
  const workspaceId = ensureWorkspaceForOrg(
    orgId,
    input.workspaceName?.trim() || "Default",
  );
  const brand = createBrand({
    orgId,
    workspaceId,
    name: brandName,
    legacyTenantId: tenantId,
    legacyAgentId,
  });
  getHostedDb()
    .prepare(
      `UPDATE brands
          SET runtime_config_json = ?,
              updated_at = datetime('now')
        WHERE id = ?`,
    )
    .run(JSON.stringify(runtimeConfig), brand.id);
  return { ...mapBrandRowToRuntimeContext(tenantId, brand), runtimeConfig };
}

export function setHostedBrandRuntimeEnabled(input: {
  tenantId: string;
  legacyAgentId: string;
  enabled: boolean;
}): HostedBrandRuntimeContext | null {
  const context = resolveHostedBrandRuntimeContext({
    tenantId: input.tenantId,
    agentId: input.legacyAgentId,
  });
  if (!context) return null;

  getHostedDb()
    .prepare(
      `UPDATE brands
          SET runtime_enabled = ?, updated_at = datetime('now')
        WHERE id = ?`,
    )
    .run(input.enabled ? 1 : 0, context.brandId);

  return { ...context, runtimeEnabled: input.enabled };
}

export function updateHostedBrandRuntimeConfig(input: {
  tenantId: string;
  legacyAgentId: string;
  runtimeConfig: Partial<HostedBrandRuntimeConfig>;
}): HostedBrandRuntimeContext | null {
  const context = resolveHostedBrandRuntimeContext({
    tenantId: input.tenantId,
    agentId: input.legacyAgentId,
  });
  if (!context) return null;

  const runtimeConfig = normalizeRuntimeConfig({
    ...context.runtimeConfig,
    ...input.runtimeConfig,
    brandName:
      input.runtimeConfig.brandName ||
      context.runtimeConfig.brandName ||
      context.brandName,
  });
  const brandName = runtimeConfig.brandName || context.brandName;

  getHostedDb()
    .prepare(
      `UPDATE brands
          SET name = ?,
              runtime_config_json = ?,
              updated_at = datetime('now')
        WHERE id = ?`,
    )
    .run(brandName, JSON.stringify(runtimeConfig), context.brandId);

  return { ...context, brandName, runtimeConfig };
}

export function markHostedBrandRuntimeDeleted(input: {
  tenantId: string;
  legacyAgentId: string;
  deletedAt?: string;
}): HostedBrandRuntimeContext | null {
  const context = resolveHostedBrandRuntimeContext({
    tenantId: input.tenantId,
    agentId: input.legacyAgentId,
  });
  if (!context) return null;
  const deletedAt = input.deletedAt || new Date().toISOString();

  getHostedDb()
    .prepare(
      `UPDATE brands
          SET runtime_enabled = 0,
              deleted_at = ?,
              updated_at = datetime('now')
        WHERE id = ?`,
    )
    .run(deletedAt, context.brandId);

  return { ...context, runtimeEnabled: false, deletedAt };
}

export function getHostedSelectedRuntimeAgentId(input: {
  tenantId: string;
}): string {
  const tenantId = input.tenantId.trim();
  if (!tenantId) return "";

  const row = getHostedDb()
    .prepare(
      `SELECT selected_runtime_agent_id
         FROM tenants
        WHERE id = ?
        LIMIT 1`,
    )
    .get(tenantId) as { selected_runtime_agent_id: string } | undefined;
  const selectedAgentId = row?.selected_runtime_agent_id?.trim() || "";
  if (
    selectedAgentId &&
    resolveHostedBrandRuntimeContext({ tenantId, agentId: selectedAgentId })
  ) {
    return selectedAgentId;
  }

  const contexts = listHostedBrandRuntimeContexts({ tenantId });
  if (contexts.length === 1) return contexts[0].selectedAgentId;
  return "";
}

export function setHostedSelectedRuntimeAgentId(input: {
  tenantId: string;
  agentId: string;
}): HostedBrandRuntimeContext | null {
  const context = resolveHostedBrandRuntimeContext({
    tenantId: input.tenantId,
    agentId: input.agentId,
  });
  if (!context) return null;

  getHostedDb()
    .prepare(
      `UPDATE tenants
          SET selected_runtime_agent_id = ?,
              updated_at = datetime('now')
        WHERE id = ?`,
    )
    .run(context.selectedAgentId, context.tenantId);

  return context;
}

export function resolveHostedBrandRuntimeContext(input: {
  tenantId: string;
  agentId?: string | null;
  includeDeleted?: boolean;
}): HostedBrandRuntimeContext | null {
  const tenantId = input.tenantId.trim();
  if (!tenantId) return null;

  const requestedAgentId = input.agentId?.trim() || "";
  const rows = listHostedBrandRuntimeContexts({
    tenantId,
    includeDeleted: input.includeDeleted,
  });

  if (rows.length === 0) return null;

  const exactMatch =
    requestedAgentId &&
    rows.find((row) => row.legacyAgentId === requestedAgentId);
  const unscopedRows = rows.filter((row) => !row.legacyAgentId);
  const singleUnscopedBrand =
    unscopedRows.length === 1 ? unscopedRows[0] : null;
  const match = requestedAgentId
    ? exactMatch || singleUnscopedBrand
    : rows.length === 1
      ? rows[0]
      : singleUnscopedBrand;
  if (!match) return null;

  return {
    ...match,
    selectedAgentId: requestedAgentId || match.legacyAgentId || "default",
  };
}

function ensureOrgForTenant(tenantId: string): string {
  const existing = getHostedDb()
    .prepare(
      `SELECT id
         FROM orgs
        WHERE legacy_tenant_id = ?
        ORDER BY updated_at DESC, created_at DESC, id DESC
        LIMIT 1`,
    )
    .get(tenantId) as { id: string } | undefined;
  if (existing) return existing.id;

  const tenant = getTenant(tenantId);
  const org = createOrg({
    name: tenant?.name || tenant?.email || "Pulse Organization",
    billingEmail: tenant?.email || "",
    legacyTenantId: tenantId,
  });
  return org.id;
}

function ensureWorkspaceForOrg(orgId: string, name: string): string {
  const existing = getHostedDb()
    .prepare(
      `SELECT id
         FROM workspaces
        WHERE org_id = ?
        ORDER BY updated_at DESC, created_at DESC, id DESC
        LIMIT 1`,
    )
    .get(orgId) as { id: string } | undefined;
  if (existing) return existing.id;

  return createWorkspace(orgId, name).id;
}

function mapBrandRowToRuntimeContext(
  tenantId: string,
  brand: Brand,
): HostedBrandRuntimeContext {
  return {
    tenantId,
    orgId: brand.org_id,
    workspaceId: brand.workspace_id || "",
    brandId: brand.id,
    brandName: brand.name,
    legacyAgentId: brand.legacy_agent_id,
    selectedAgentId: brand.legacy_agent_id || "default",
    runtimeEnabled: brand.runtime_enabled === 1,
    deletedAt: brand.deleted_at,
    runtimeConfig: parseRuntimeConfig(brand.runtime_config_json, {
      name: brand.name,
      brandName: brand.name,
    }),
  };
}

function parseRuntimeConfig(
  value: string | undefined,
  fallback: Partial<HostedBrandRuntimeConfig>,
): HostedBrandRuntimeConfig {
  try {
    return normalizeRuntimeConfig({
      ...fallback,
      ...(value ? JSON.parse(value) : {}),
    });
  } catch {
    return normalizeRuntimeConfig(fallback);
  }
}

function normalizeRuntimeConfig(
  value: Partial<HostedBrandRuntimeConfig>,
): HostedBrandRuntimeConfig {
  return {
    name: stringValue(value.name),
    brandName: stringValue(value.brandName || value.name),
    website: stringValue(value.website),
    tagline: stringValue(value.tagline),
    niche: stringValue(value.niche),
    xHandle: stringValue(value.xHandle),
    tone: stringValue(value.tone),
    agentRole: stringValue(value.agentRole),
    competitors: stringArray(value.competitors),
    topics: normalizeTopics(value.topics),
    contentThemes: stringArray(value.contentThemes),
    idealCustomer: stringValue(value.idealCustomer),
    problemSolved: stringValue(value.problemSolved),
    uniqueValue: stringValue(value.uniqueValue),
    account: isObject(value.account) ? value.account : undefined,
    connections: isObject(value.connections) ? value.connections : undefined,
    createdAt: stringValue(value.createdAt) || undefined,
    updatedAt: stringValue(value.updatedAt) || undefined,
  };
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function normalizeTopics(
  value: unknown,
): Array<{ id: string; query: string; textMustMatch: string[] }> {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isObject)
    .map((topic) => ({
      id: stringValue(topic.id),
      query: stringValue(topic.query),
      textMustMatch: stringArray(topic.textMustMatch),
    }))
    .filter((topic) => topic.id || topic.query);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
