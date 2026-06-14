import { getHostedDb } from "../db.js";
import { resolveHostedBrandRuntimeContext } from "../brand-runtime-context.js";
import type {
  ApprovalQueueItem,
  QueueItemStatus,
} from "../../src/intelligence/approval-queue.js";

export interface RuntimeApprovalQueueScope {
  orgId: string;
  workspaceId?: string | null;
  brandId: string;
  agentId: string;
  tenantId?: string | null;
}

export interface RuntimeApprovalQueueRow {
  id: string;
  tenant_id: string;
  org_id: string;
  workspace_id: string;
  brand_id: string;
  agent_id: string;
  item_type: string;
  platform: string;
  content: string;
  status: QueueItemStatus;
  risk_flags: string;
  metadata: string;
  created_at: string;
  expires_at: string;
  reviewed_at: string;
  updated_at: string;
}

export interface UpsertApprovalQueueItemInput {
  scope: RuntimeApprovalQueueScope;
  item: ApprovalQueueItem;
  metadata?: Record<string, unknown>;
}

export interface ListApprovalQueueItemsInput extends RuntimeApprovalQueueScope {
  id?: string;
  status?: QueueItemStatus;
  limit?: number;
}

export interface ResolveRuntimeApprovalQueueScopeInput {
  tenantId: string;
  agentId?: string | null;
}

export interface RuntimeApprovalQueueRepository {
  upsertItem(input: UpsertApprovalQueueItemInput): RuntimeApprovalQueueRow;
  getItem(
    scope: RuntimeApprovalQueueScope,
    id: string,
  ): RuntimeApprovalQueueRow | null;
  listItems(input: ListApprovalQueueItemsInput): RuntimeApprovalQueueRow[];
  deleteItem(scope: RuntimeApprovalQueueScope, id: string): boolean;
  markStatus(input: {
    scope: RuntimeApprovalQueueScope;
    id: string;
    status: QueueItemStatus;
    reviewedAt?: string;
  }): RuntimeApprovalQueueRow | null;
}

function normalizeOptional(value?: string | null): string {
  return value ?? "";
}

function normalizeRequired(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`Runtime approval queue ${field} is required`);
  }
  return normalized;
}

function encodeMetadata(
  item: ApprovalQueueItem,
  metadata: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    mentionId: item.mentionId,
    mentionText: item.mentionText,
    mentionAuthor: item.mentionAuthor,
    mentionUrl: item.mentionUrl,
    mentionSentiment: item.mentionSentiment,
    category: item.category,
    format: item.format,
    sourceUrl: item.sourceUrl,
    voiceScore: item.voiceScore,
    editHistory: item.editHistory,
    rejectReason: item.rejectReason,
    ...metadata,
  });
}

function getById(
  scope: RuntimeApprovalQueueScope,
  id: string,
): RuntimeApprovalQueueRow | null {
  return (
    (getHostedDb()
      .prepare(
        `SELECT id, tenant_id, org_id, workspace_id, brand_id, agent_id,
                item_type, platform, content, status, risk_flags, metadata,
                created_at, expires_at, reviewed_at, updated_at
           FROM runtime_approval_queue
          WHERE id = ?
            AND tenant_id = ?
            AND org_id = ?
            AND workspace_id = ?
            AND brand_id = ?
            AND agent_id = ?`,
      )
      .get(
        id,
        normalizeOptional(scope.tenantId),
        scope.orgId,
        normalizeOptional(scope.workspaceId),
        scope.brandId,
        scope.agentId,
      ) as RuntimeApprovalQueueRow | undefined) ?? null
  );
}

export function resolveRuntimeApprovalQueueScope(
  input: ResolveRuntimeApprovalQueueScopeInput,
): RuntimeApprovalQueueScope | null {
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

export function createRuntimeApprovalQueueRepository(): RuntimeApprovalQueueRepository {
  return {
    upsertItem({ scope, item, metadata }) {
      getHostedDb()
        .prepare(
          `INSERT INTO runtime_approval_queue (
             id, tenant_id, org_id, workspace_id, brand_id, agent_id,
             item_type, platform, content, status, risk_flags, metadata,
             created_at, expires_at, reviewed_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             item_type = excluded.item_type,
             platform = excluded.platform,
             content = excluded.content,
             status = excluded.status,
             risk_flags = excluded.risk_flags,
             metadata = excluded.metadata,
             expires_at = excluded.expires_at,
             reviewed_at = excluded.reviewed_at,
             updated_at = excluded.updated_at`,
        )
        .run(
          item.id,
          normalizeOptional(scope.tenantId),
          scope.orgId,
          normalizeOptional(scope.workspaceId),
          scope.brandId,
          scope.agentId,
          item.type,
          item.platform,
          item.content,
          item.status,
          JSON.stringify(item.riskFlags),
          encodeMetadata(item, metadata),
          item.createdAt,
          item.expiresAt,
          item.reviewedAt ?? "",
          new Date().toISOString(),
        );

      return getById(scope, item.id)!;
    },

    getItem(scope, id) {
      return getById(scope, id);
    },

    listItems(input) {
      const limit = Math.max(1, Math.min(input.limit ?? 200, 500));
      const idClause = input.id ? " AND id = ?" : "";
      const statusClause = input.status ? " AND status = ?" : "";
      const rows = getHostedDb()
        .prepare(
          `SELECT id, tenant_id, org_id, workspace_id, brand_id, agent_id,
                  item_type, platform, content, status, risk_flags, metadata,
                  created_at, expires_at, reviewed_at, updated_at
             FROM runtime_approval_queue
            WHERE tenant_id = ?
              AND org_id = ?
              AND workspace_id = ?
              AND brand_id = ?
              AND agent_id = ?
              ${idClause}
              ${statusClause}
            ORDER BY created_at DESC, id DESC
            LIMIT ?`,
        )
        .all(
          normalizeOptional(input.tenantId),
          input.orgId,
          normalizeOptional(input.workspaceId),
          input.brandId,
          input.agentId,
          ...(input.id ? [input.id] : []),
          ...(input.status ? [input.status] : []),
          limit,
        );
      return rows as RuntimeApprovalQueueRow[];
    },

    deleteItem(scope, id) {
      const result = getHostedDb()
        .prepare(
          `DELETE FROM runtime_approval_queue
            WHERE id = ?
              AND tenant_id = ?
              AND org_id = ?
              AND workspace_id = ?
              AND brand_id = ?
              AND agent_id = ?`,
        )
        .run(
          id,
          normalizeOptional(scope.tenantId),
          scope.orgId,
          normalizeOptional(scope.workspaceId),
          scope.brandId,
          scope.agentId,
        );
      return result.changes > 0;
    },

    markStatus({ scope, id, status, reviewedAt }) {
      getHostedDb()
        .prepare(
          `UPDATE runtime_approval_queue
              SET status = ?,
                  reviewed_at = ?,
                  updated_at = ?
            WHERE id = ?
              AND tenant_id = ?
              AND org_id = ?
              AND workspace_id = ?
              AND brand_id = ?
              AND agent_id = ?`,
        )
        .run(
          status,
          reviewedAt ?? new Date().toISOString(),
          new Date().toISOString(),
          id,
          normalizeOptional(scope.tenantId),
          scope.orgId,
          normalizeOptional(scope.workspaceId),
          scope.brandId,
          scope.agentId,
        );
      return getById(scope, id);
    },
  };
}

export const runtimeApprovalQueueRepository =
  createRuntimeApprovalQueueRepository();
