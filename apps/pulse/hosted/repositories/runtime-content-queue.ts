import { getHostedDb, type RuntimeContentQueueRow } from "../db.js";
import { resolveHostedBrandRuntimeContext } from "../brand-runtime-context.js";
import type { QueueItem } from "../../src/intelligence/content-queue.js";

export interface RuntimeContentQueueScope {
  orgId: string;
  workspaceId?: string | null;
  brandId: string;
  agentId: string;
  tenantId?: string | null;
}

export interface UpsertContentQueueItemInput {
  scope: RuntimeContentQueueScope;
  item: QueueItem;
  metadata?: Record<string, unknown>;
}

export interface ListContentQueueItemsInput extends RuntimeContentQueueScope {
  id?: number;
  status?: string;
  platform?: string;
  limit?: number;
}

export interface ResolveRuntimeContentQueueScopeInput {
  tenantId: string;
  agentId?: string | null;
}

export interface RuntimeContentQueueRepository {
  upsertItem(input: UpsertContentQueueItemInput): RuntimeContentQueueRow;
  getItem(
    scope: RuntimeContentQueueScope,
    id: number,
  ): RuntimeContentQueueRow | null;
  listItems(input: ListContentQueueItemsInput): RuntimeContentQueueRow[];
  deleteItem(scope: RuntimeContentQueueScope, id: number): boolean;
}

function normalizeOptional(value?: string | null): string {
  return value ?? "";
}

function normalizeRequired(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`Runtime content queue ${field} is required`);
  }
  return normalized;
}

function getById(
  scope: RuntimeContentQueueScope,
  id: number,
): RuntimeContentQueueRow | null {
  return (
    (getHostedDb()
      .prepare(
        `SELECT tenant_id, org_id, workspace_id, brand_id, agent_id, item_id,
                platform, item_type, content, theme, scheduled_at, published_at,
                status, post_url, engagement_score, created_at, metadata,
                updated_at
           FROM runtime_content_queue
          WHERE tenant_id = ?
            AND org_id = ?
            AND workspace_id = ?
            AND brand_id = ?
            AND agent_id = ?
            AND item_id = ?`,
      )
      .get(
        normalizeOptional(scope.tenantId),
        scope.orgId,
        normalizeOptional(scope.workspaceId),
        scope.brandId,
        scope.agentId,
        id,
      ) as RuntimeContentQueueRow | undefined) ?? null
  );
}

export function resolveRuntimeContentQueueScope(
  input: ResolveRuntimeContentQueueScopeInput,
): RuntimeContentQueueScope | null {
  const tenantId = normalizeRequired(input.tenantId, "tenantId");
  const context = resolveHostedBrandRuntimeContext({
    tenantId,
    agentId: input.agentId,
  });
  if (!context) return null;

  return {
    tenantId: context.tenantId,
    orgId: context.orgId,
    workspaceId: context.workspaceId,
    brandId: context.brandId,
    agentId: context.selectedAgentId,
  };
}

export function createRuntimeContentQueueRepository(): RuntimeContentQueueRepository {
  return {
    upsertItem({ scope, item, metadata }) {
      getHostedDb()
        .prepare(
          `INSERT INTO runtime_content_queue (
             tenant_id, org_id, workspace_id, brand_id, agent_id, item_id,
             platform, item_type, content, theme, scheduled_at, published_at,
             status, post_url, engagement_score, created_at, metadata, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(tenant_id, org_id, workspace_id, brand_id, agent_id, item_id)
           DO UPDATE SET
             platform = excluded.platform,
             item_type = excluded.item_type,
             content = excluded.content,
             theme = excluded.theme,
             scheduled_at = excluded.scheduled_at,
             published_at = excluded.published_at,
             status = excluded.status,
             post_url = excluded.post_url,
             engagement_score = excluded.engagement_score,
             created_at = excluded.created_at,
             metadata = excluded.metadata,
             updated_at = excluded.updated_at`,
        )
        .run(
          normalizeOptional(scope.tenantId),
          scope.orgId,
          normalizeOptional(scope.workspaceId),
          scope.brandId,
          scope.agentId,
          item.id,
          item.platform,
          item.type,
          item.content,
          item.theme ?? "",
          item.scheduledAt,
          item.publishedAt ?? "",
          item.status,
          item.postUrl ?? "",
          item.engagementScore,
          item.createdAt,
          JSON.stringify(metadata ?? {}),
          new Date().toISOString(),
        );

      return getById(scope, item.id)!;
    },

    getItem(scope, id) {
      return getById(scope, id);
    },

    listItems(input) {
      const limit = Math.max(1, Math.min(input.limit ?? 200, 500));
      const idClause = typeof input.id === "number" ? " AND item_id = ?" : "";
      const statusClause = input.status ? " AND status = ?" : "";
      const platformClause = input.platform ? " AND platform = ?" : "";
      const rows = getHostedDb()
        .prepare(
          `SELECT tenant_id, org_id, workspace_id, brand_id, agent_id, item_id,
                  platform, item_type, content, theme, scheduled_at, published_at,
                  status, post_url, engagement_score, created_at, metadata,
                  updated_at
             FROM runtime_content_queue
            WHERE tenant_id = ?
              AND org_id = ?
              AND workspace_id = ?
              AND brand_id = ?
              AND agent_id = ?
              ${idClause}
              ${statusClause}
              ${platformClause}
            ORDER BY scheduled_at ASC, item_id ASC
            LIMIT ?`,
        )
        .all(
          normalizeOptional(input.tenantId),
          input.orgId,
          normalizeOptional(input.workspaceId),
          input.brandId,
          input.agentId,
          ...(typeof input.id === "number" ? [input.id] : []),
          ...(input.status ? [input.status] : []),
          ...(input.platform ? [input.platform] : []),
          limit,
        );
      return rows as RuntimeContentQueueRow[];
    },

    deleteItem(scope, id) {
      const result = getHostedDb()
        .prepare(
          `DELETE FROM runtime_content_queue
            WHERE tenant_id = ?
              AND org_id = ?
              AND workspace_id = ?
              AND brand_id = ?
              AND agent_id = ?
              AND item_id = ?`,
        )
        .run(
          normalizeOptional(scope.tenantId),
          scope.orgId,
          normalizeOptional(scope.workspaceId),
          scope.brandId,
          scope.agentId,
          id,
        );
      return result.changes > 0;
    },
  };
}

export const runtimeContentQueueRepository =
  createRuntimeContentQueueRepository();
