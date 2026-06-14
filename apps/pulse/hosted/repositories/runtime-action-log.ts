import { getHostedDb, type RuntimeActionLogRow } from "../db.js";
import { resolveHostedBrandRuntimeContext } from "../brand-runtime-context.js";
import type { ActionRecord } from "../../src/core/state.js";

export interface RuntimeActionLogScope {
  orgId: string;
  workspaceId?: string | null;
  brandId: string;
  agentId: string;
  tenantId?: string | null;
}

export interface ListRuntimeActionLogInput extends RuntimeActionLogScope {
  since?: string;
  limit?: number;
}

export interface ResolveRuntimeActionLogScopeInput {
  tenantId: string;
  agentId?: string | null;
}

export interface RuntimeActionLogRepository {
  appendAction(
    scope: RuntimeActionLogScope,
    action: ActionRecord,
  ): ActionRecord;
  listActions(input: ListRuntimeActionLogInput): ActionRecord[];
}

function normalizeOptional(value?: string): string {
  return value ?? "";
}

function decodeEngagement(
  value: string,
): ActionRecord["engagement"] | undefined {
  if (!value) return undefined;
  return JSON.parse(value) as ActionRecord["engagement"];
}

function mapRowToActionRecord(row: RuntimeActionLogRow): ActionRecord {
  return {
    id: row.id,
    timestamp: row.timestamp,
    platform: row.platform,
    type: row.action_type,
    topicId: row.topic_id,
    content: row.content,
    targetText: row.target_text || undefined,
    targetUrl: row.target_url || undefined,
    theme: row.theme || undefined,
    engagement: decodeEngagement(row.engagement),
  };
}

function normalizeRequired(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`Runtime action log ${field} is required`);
  return normalized;
}

export function resolveRuntimeActionLogScope(
  input: ResolveRuntimeActionLogScopeInput,
): RuntimeActionLogScope | null {
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

export function createRuntimeActionLogRepository(): RuntimeActionLogRepository {
  return {
    appendAction(scope, action) {
      getHostedDb()
        .prepare(
          `INSERT INTO runtime_action_logs (
             id, tenant_id, org_id, workspace_id, brand_id, agent_id,
             timestamp, platform, action_type, topic_id, content,
             target_text, target_url, theme, engagement
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          action.id,
          scope.tenantId ?? "",
          scope.orgId,
          scope.workspaceId ?? "",
          scope.brandId,
          scope.agentId,
          action.timestamp,
          action.platform,
          action.type,
          action.topicId,
          action.content,
          normalizeOptional(action.targetText),
          normalizeOptional(action.targetUrl),
          normalizeOptional(action.theme),
          action.engagement ? JSON.stringify(action.engagement) : "",
        );

      return action;
    },

    listActions(input) {
      const limit = Math.max(1, Math.min(input.limit ?? 500, 500));
      const rows = input.since
        ? getHostedDb()
            .prepare(
              `SELECT id, tenant_id, org_id, workspace_id, brand_id, agent_id,
                      timestamp, platform, action_type, topic_id, content,
                      target_text, target_url, theme, engagement, created_at
                 FROM (
                   SELECT id, tenant_id, org_id, workspace_id, brand_id, agent_id,
                          timestamp, platform, action_type, topic_id, content,
                          target_text, target_url, theme, engagement, created_at
                     FROM runtime_action_logs
                    WHERE org_id = ?
                      AND tenant_id = ?
                      AND brand_id = ?
                      AND agent_id = ?
                      AND workspace_id = ?
                      AND timestamp >= ?
                    ORDER BY timestamp DESC, created_at DESC, id DESC
                    LIMIT ?
                 )
                ORDER BY timestamp ASC, created_at ASC, id ASC`,
            )
            .all(
              input.orgId,
              input.tenantId ?? "",
              input.brandId,
              input.agentId,
              input.workspaceId ?? "",
              input.since,
              limit,
            )
        : getHostedDb()
            .prepare(
              `SELECT id, tenant_id, org_id, workspace_id, brand_id, agent_id,
                      timestamp, platform, action_type, topic_id, content,
                      target_text, target_url, theme, engagement, created_at
                 FROM (
                   SELECT id, tenant_id, org_id, workspace_id, brand_id, agent_id,
                          timestamp, platform, action_type, topic_id, content,
                          target_text, target_url, theme, engagement, created_at
                     FROM runtime_action_logs
                    WHERE org_id = ?
                      AND tenant_id = ?
                      AND brand_id = ?
                      AND agent_id = ?
                      AND workspace_id = ?
                    ORDER BY timestamp DESC, created_at DESC, id DESC
                    LIMIT ?
                 )
                ORDER BY timestamp ASC, created_at ASC, id ASC`,
            )
            .all(
              input.orgId,
              input.tenantId ?? "",
              input.brandId,
              input.agentId,
              input.workspaceId ?? "",
              limit,
            );

      return (rows as RuntimeActionLogRow[]).map(mapRowToActionRecord);
    },
  };
}

export const runtimeActionLogRepository = createRuntimeActionLogRepository();
