import { getHostedDb } from "../db.js";

export interface RuntimeOutreachDedupScope {
  tenantId: string;
  agentId?: string;
  platform?: string;
}

export interface RuntimeOutreachDedupRow {
  tenant_id: string;
  agent_id: string;
  platform: string;
  post_id: string;
  first_seen_at: string;
  updated_at: string;
}

export interface RuntimeOutreachDedupRepository {
  upsertRepliedIds(
    input: RuntimeOutreachDedupScope & { postIds: string[]; now?: string },
  ): void;
  listRepliedIds(
    input: RuntimeOutreachDedupScope & { limit?: number },
  ): string[];
}

function normalizeTenantId(value: string): string {
  const tenantId = value.trim();
  if (!tenantId) throw new Error("Runtime outreach dedup tenantId is required");
  return tenantId;
}

function normalizeOptional(value?: string): string {
  return value?.trim() || "";
}

function normalizePostIds(postIds: string[]): string[] {
  return [...new Set(postIds.map((id) => id.trim()).filter(Boolean))];
}

export function createRuntimeOutreachDedupRepository(): RuntimeOutreachDedupRepository {
  return {
    upsertRepliedIds(input) {
      const tenantId = normalizeTenantId(input.tenantId);
      const agentId = normalizeOptional(input.agentId);
      const platform = normalizeOptional(input.platform);
      const now = input.now ?? new Date().toISOString();
      const postIds = normalizePostIds(input.postIds);
      if (postIds.length === 0) return;

      const insert = getHostedDb().prepare(
        `INSERT INTO runtime_outreach_dedup
           (tenant_id, agent_id, platform, post_id, first_seen_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(tenant_id, agent_id, platform, post_id)
         DO UPDATE SET updated_at = excluded.updated_at`,
      );
      const tx = getHostedDb().transaction((ids: string[]) => {
        for (const postId of ids) {
          insert.run(tenantId, agentId, platform, postId, now, now);
        }
      });
      tx(postIds);
    },

    listRepliedIds(input) {
      const limit = Math.max(1, Math.min(input.limit ?? 2000, 5000));
      const rows = getHostedDb()
        .prepare(
          `SELECT post_id
             FROM (
               SELECT post_id, first_seen_at
                 FROM runtime_outreach_dedup
                WHERE tenant_id = ?
                  AND agent_id = ?
                  AND platform = ?
                ORDER BY first_seen_at DESC, post_id DESC
                LIMIT ?
             )
            ORDER BY first_seen_at ASC, post_id ASC`,
        )
        .all(
          normalizeTenantId(input.tenantId),
          normalizeOptional(input.agentId),
          normalizeOptional(input.platform),
          limit,
        ) as Array<{ post_id: string }>;
      return rows.map((row) => row.post_id);
    },
  };
}

export const runtimeOutreachDedupRepository =
  createRuntimeOutreachDedupRepository();
