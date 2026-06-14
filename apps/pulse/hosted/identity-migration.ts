import type { Tenant } from "./db.js";

export interface LegacyAgentMigrationPreset {
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
  createdAt: string;
  updatedAt: string;
}

export interface OrgMigrationSource {
  name: string;
  billingEmail: string;
  legacyTenantId: string;
}

export interface WorkspaceMigrationSource {
  name: string;
  legacyTenantId: string;
}

export interface BrandConnectionMigrationSource {
  provider: string;
  status: "connected" | "disconnected" | "error";
  metadata: Record<string, unknown>;
}

export interface BrandMigrationSource {
  name: string;
  legacyTenantId: string;
  legacyAgentId: string;
  xHandle: string;
  website: string;
  niche: string;
  connections: BrandConnectionMigrationSource[];
}

export interface TenantMigrationSource {
  org: OrgMigrationSource;
  workspace: WorkspaceMigrationSource;
  brands: BrandMigrationSource[];
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function tenantDisplayName(tenant: Tenant): string {
  return cleanString(tenant.name) || cleanString(tenant.email) || tenant.id;
}

function brandDisplayName(
  agent: LegacyAgentMigrationPreset,
  tenant: Tenant,
): string {
  return (
    cleanString(agent.brandName) ||
    cleanString(agent.name) ||
    cleanString(agent.id) ||
    tenantDisplayName(tenant)
  );
}

function connectionSources(
  agent: LegacyAgentMigrationPreset,
): BrandConnectionMigrationSource[] {
  const handle = cleanString(agent.xHandle);
  if (!handle) return [];
  return [
    {
      provider: "x",
      status: "disconnected",
      metadata: { handle },
    },
  ];
}

export function buildOrgMigrationSource(tenant: Tenant): OrgMigrationSource {
  return {
    name: tenantDisplayName(tenant),
    billingEmail: cleanString(tenant.email),
    legacyTenantId: tenant.id,
  };
}

export function buildWorkspaceMigrationSource(
  tenant: Tenant,
): WorkspaceMigrationSource {
  return {
    name: "Default",
    legacyTenantId: tenant.id,
  };
}

export function buildBrandMigrationSources(
  tenant: Tenant,
  agents: LegacyAgentMigrationPreset[],
): BrandMigrationSource[] {
  const sourceAgents =
    agents.length > 0
      ? agents
      : [
          {
            id: "default",
            name: tenantDisplayName(tenant),
            brandName: tenantDisplayName(tenant),
            website: "",
            tagline: "",
            niche: "",
            xHandle: "",
            tone: "professional",
            agentRole: "",
            competitors: [],
            topics: [],
            contentThemes: [],
            createdAt: tenant.created_at,
            updatedAt: tenant.updated_at,
          } satisfies LegacyAgentMigrationPreset,
        ];

  return sourceAgents.map((agent) => ({
    name: brandDisplayName(agent, tenant),
    legacyTenantId: tenant.id,
    legacyAgentId: cleanString(agent.id) || "default",
    xHandle: cleanString(agent.xHandle),
    website: cleanString(agent.website),
    niche: cleanString(agent.niche),
    connections: connectionSources(agent),
  }));
}

export function buildTenantMigrationSource(
  tenant: Tenant,
  agents: LegacyAgentMigrationPreset[],
): TenantMigrationSource {
  return {
    org: buildOrgMigrationSource(tenant),
    workspace: buildWorkspaceMigrationSource(tenant),
    brands: buildBrandMigrationSources(tenant, agents),
  };
}
