import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { cleanupSqliteFiles, createTempHostedDbPath } from "./temp-db.js";

const dbPath = createTempHostedDbPath("pulse-runtime-schedule-state");
process.env.HOSTED_DB_PATH = dbPath;

const { runInContext } = await import("../../hosted/context.js");
const { createRuntimeScheduleStateRepository } =
  await import("../../hosted/repositories/runtime-schedule-state.js");
const { isTaskDue, markTaskComplete } =
  await import("../../src/core/scheduler.js");

const scheduleState = createRuntimeScheduleStateRepository();

function tenantContext(tenantId: string) {
  return {
    tenantId,
    dataDir: `/tmp/${tenantId}`,
    configPath: `/tmp/${tenantId}/pulse.yaml`,
    secrets: {},
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-26T12:00:00.000Z"));
});

afterAll(() => {
  vi.useRealTimers();
  cleanupSqliteFiles(dbPath);
});

describe("runtime schedule state", () => {
  it("persists hosted task completion by tenant and task", () => {
    const first = scheduleState.markTaskComplete({
      tenantId: "tn_schedule",
      taskType: "content",
      completedAt: "2026-05-26T12:00:00.000Z",
    });

    expect(first).toMatchObject({
      tenant_id: "tn_schedule",
      agent_id: "",
      task_type: "content",
      last_run: "2026-05-26T12:00:00.000Z",
    });
    expect(
      scheduleState.getLastRun({
        tenantId: "tn_schedule",
        taskType: "content",
      }),
    ).toBe("2026-05-26T12:00:00.000Z");
    expect(
      scheduleState.getLastRun({
        tenantId: "tn_schedule",
        taskType: "outreach",
      }),
    ).toBe("");
  });

  it("uses SQL schedule state from hosted tenant context while isolating tenants", async () => {
    await runInContext(tenantContext("tn_schedule_a"), async () => {
      expect(isTaskDue("content")).toBe(true);
      markTaskComplete("content");
      expect(isTaskDue("content")).toBe(false);
    });

    await runInContext(tenantContext("tn_schedule_b"), async () => {
      expect(isTaskDue("content")).toBe(true);
      markTaskComplete("outreach");
      expect(isTaskDue("outreach")).toBe(false);
    });

    expect(
      scheduleState.getLastRun({
        tenantId: "tn_schedule_a",
        taskType: "content",
      }),
    ).toBe("2026-05-26T12:00:00.000Z");
    expect(
      scheduleState.getLastRun({
        tenantId: "tn_schedule_b",
        taskType: "content",
      }),
    ).toBe("");
  });
});
