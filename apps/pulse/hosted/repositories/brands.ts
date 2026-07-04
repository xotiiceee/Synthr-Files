import type { Brand, BrandConnection } from "../db.js";
import {
  createBrand,
  getBrand,
  getHostedDb,
  listBrandConnections,
  listBrandsForOrg,
  upsertBrandConnection,
} from "../db.js";

export type BrandConnectionMetadata = Record<string, unknown>;

export interface BrandScope {
  brandId: string;
}

export interface OrgBrandScope extends BrandScope {
  orgId: string;
}

export interface WorkspaceScope {
  workspaceId: string;
}

export interface CreateBrandInput {
  orgId: string;
  workspaceId?: string | null;
  name: string;
  legacyTenantId?: string | null;
  legacyAgentId?: string;
}

export interface UpdateBrandInput {
  name?: string;
  workspaceId?: string | null;
}

export interface UpsertBrandConnectionInput extends BrandScope {
  provider: string;
  status?: BrandConnection["status"];
  metadata?: BrandConnectionMetadata;
}

export interface BrandConnectionScope extends BrandScope {
  provider: string;
}

export interface BrandRepository {
  createBrand(input: CreateBrandInput): Brand;
  getBrand(scope: BrandScope): Brand | null;
  getBrandForOrg(scope: OrgBrandScope): Brand | null;
  listBrandsForOrg(scope: { orgId: string }): Brand[];
  listBrandsForWorkspace(scope: WorkspaceScope): Brand[];
  updateBrand(scope: BrandScope, input: UpdateBrandInput): Brand | null;
  upsertBrandConnection(input: UpsertBrandConnectionInput): BrandConnection;
  getBrandConnection(scope: BrandConnectionScope): BrandConnection | null;
  listBrandConnections(scope: BrandScope): BrandConnection[];
}

export function createBrandRepository(): BrandRepository {
  return {
    createBrand(input) {
      return createBrand(input);
    },

    getBrand(scope) {
      return getBrand(scope.brandId) ?? null;
    },

    getBrandForOrg(scope) {
      const row = getHostedDb()
        .prepare("SELECT * FROM brands WHERE id = ? AND org_id = ?")
        .get(scope.brandId, scope.orgId) as Brand | null;
      return row ?? null;
    },

    listBrandsForOrg(scope) {
      return listBrandsForOrg(scope.orgId);
    },

    listBrandsForWorkspace(scope) {
      return getHostedDb()
        .prepare(
          "SELECT * FROM brands WHERE workspace_id = ? ORDER BY created_at DESC",
        )
        .all(scope.workspaceId) as Brand[];
    },

    updateBrand(scope, input) {
      const current = getBrand(scope.brandId);
      if (!current) return null;

      getHostedDb()
        .prepare(
          `UPDATE brands
           SET name = ?, workspace_id = ?, updated_at = datetime('now')
           WHERE id = ?`,
        )
        .run(
          input.name ?? current.name,
          input.workspaceId === undefined
            ? current.workspace_id
            : input.workspaceId,
          scope.brandId,
        );

      return getBrand(scope.brandId) ?? null;
    },

    upsertBrandConnection(input) {
      return upsertBrandConnection({
        brandId: input.brandId,
        provider: input.provider,
        status: input.status,
        metadata: input.metadata,
      });
    },

    getBrandConnection(scope) {
      const row = getHostedDb()
        .prepare(
          "SELECT * FROM brand_connections WHERE brand_id = ? AND provider = ?",
        )
        .get(scope.brandId, scope.provider) as BrandConnection | null;
      return row ?? null;
    },

    listBrandConnections(scope) {
      return listBrandConnections(scope.brandId);
    },
  };
}

export const brandRepository = createBrandRepository();
