import { getHostedDb } from "../db.js";
import type { TaskType } from "../../src/core/scheduler.js";

export interface RuntimeScheduleStateRef {
  tenantId: string;
  agentId?: string;
  taskType: TaskType;
}

export interface RuntimeScheduleStateRow {
  tenant_id: string;
  agent_id: string;
  task_type: TaskType;
  last_run: string;
  updated_at: string;
}

export interface RuntimeScheduleStateRepository {
  getLastRun(ref: RuntimeScheduleStateRef): string;
  markTaskComplete(
    ref: RuntimeScheduleStateRef & { completedAt?: string },
  ): RuntimeScheduleStateRow;
}

function normalizeTenantId(value: string): string {
  const tenantId = value.trim();
  if (!tenantId) throw new Error("Runtime schedule tenantId is required");
  return tenantId;
}

function normalizeAgentId(value?: string): string {
  return value?.trim() || "";
}

export function createRuntimeScheduleStateRepository(): RuntimeScheduleStateRepository {
  return {
    getLastRun(ref) {
      const row = getHostedDb()
        .prepare(
          `SELECT last_run
             FROM runtime_schedule_state
            WHERE tenant_id = ?
              AND agent_id = ?
              AND task_type = ?`,
        )
        .get(
          normalizeTenantId(ref.tenantId),
          normalizeAgentId(ref.agentId),
          ref.taskType,
        ) as { last_run: string } | undefined;
      return row?.last_run ?? "";
    },

    markTaskComplete(ref) {
      const tenantId = normalizeTenantId(ref.tenantId);
      const agentId = normalizeAgentId(ref.agentId);
      const completedAt = ref.completedAt ?? new Date().toISOString();

      getHostedDb()
        .prepare(
          `INSERT INTO runtime_schedule_state
             (tenant_id, agent_id, task_type, last_run, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(tenant_id, agent_id, task_type)
           DO UPDATE SET
             last_run = excluded.last_run,
             updated_at = excluded.updated_at`,
        )
        .run(tenantId, agentId, ref.taskType, completedAt, completedAt);

      return getHostedDb()
        .prepare(
          `SELECT tenant_id, agent_id, task_type, last_run, updated_at
             FROM runtime_schedule_state
            WHERE tenant_id = ?
              AND agent_id = ?
              AND task_type = ?`,
        )
        .get(tenantId, agentId, ref.taskType) as RuntimeScheduleStateRow;
    },
  };
}

export const runtimeScheduleStateRepository =
  createRuntimeScheduleStateRepository();
