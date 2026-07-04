import { afterEach, describe, expect, it, vi } from "vitest";

import { cleanupSqliteFiles, createTempHostedDbPath } from "./temp-db.js";

const dbPath = createTempHostedDbPath("pulse-scheduler-metering");
process.env.HOSTED_DB_PATH = dbPath;

const { getHostedDb, getUsageEventByIdempotencyKey, listUsageEvents } =
  await import("../../hosted/db.js");
const { createJobRepository } = await import("../../hosted/jobs.js");
const { runJobWorkerTick } = await import("../../hosted/job-worker.js");
const {
  DURABLE_SCHEDULER_QUEUE,
  createDurableSchedulerHandlerRegistry,
  enqueueSchedulerTaskJob,
} = await import("../../hosted/durable-scheduler.js");
const {
  buildSchedulerMonitorUsageIdempotencyKey,
  recordSchedulerMonitorUsageEvent,
} = await import("../../hosted/usage-events.js");

afterEach(() => {
  vi.restoreAllMocks();
  getHostedDb().exec("DELETE FROM usage_events; DELETE FROM jobs;");
});

function withAgentRuntimeConfigMock() {
  return vi.fn(async (_agent: unknown, fn: () => Promise<unknown>) => {
    return await fn();
  });
}

describe("scheduler monitor metering", () => {
  it("records durable monitor usage once on success and retains scope metadata", async () => {
    const repository = createJobRepository(getHostedDb());

    enqueueSchedulerTaskJob(
      {
        tenantId: "tn_meter",
        orgId: "org_meter",
        workspaceId: "ws_meter",
        brandId: "br_meter",
        agentId: "agent_meter",
        task: "monitor",
        runAt: "2026-05-26T12:30:00.000Z",
      },
      repository,
    );

    vi.spyOn(Date, "now").mockReturnValueOnce(1_000).mockReturnValueOnce(1_125);

    const result = await runJobWorkerTick({
      handlers: createDurableSchedulerHandlerRegistry({
        withTenantContext: vi.fn(async (_tenantId, fn) => await fn()),
        getAgent: vi.fn(() => ({
          id: "agent_meter",
          name: "Meter Agent",
          brandName: "Pulse",
          website: "",
          tagline: "",
          niche: "",
          xHandle: "",
          tone: "professional",
          agentRole: "",
          competitors: [],
          topics: [],
          contentThemes: [],
          createdAt: "2026-05-26T00:00:00.000Z",
          updatedAt: "2026-05-26T00:00:00.000Z",
        })),
        withAgentRuntimeConfig: withAgentRuntimeConfigMock(),
        runMonitor: vi.fn(async () => ({
          mentions: [{ id: "m_1" }, { id: "m_2" }],
          competitorMentions: [{ id: "c_1" }],
          alerts: ["a_1"],
        })) as never,
        markTaskComplete: vi.fn(),
      }),
      repository,
      queue: DURABLE_SCHEDULER_QUEUE,
      workerId: "worker_meter_success",
      now: "2026-05-26T12:30:00.000Z",
    });

    expect(result.status).toBe("completed");
    const events = listUsageEvents("tn_meter");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      tenant_id: "tn_meter",
      org_id: "org_meter",
      workspace_id: "ws_meter",
      brand_id: "br_meter",
      agent_id: "agent_meter",
      source: "scheduler",
      event_type: "scheduler.monitor.completed",
      quantity: 1,
      unit: "job",
    });
    expect(JSON.parse(events[0].metadata)).toEqual({
      task: "monitor",
      runAtBucket: "2026-05-26T12:00:00.000Z",
      counts: {
        mentions: 2,
        competitorMentions: 1,
        alerts: 1,
      },
      durationMs: 125,
    });
  });

  it("does not record a success usage event when monitor execution retries", async () => {
    const repository = createJobRepository(getHostedDb());

    enqueueSchedulerTaskJob(
      {
        tenantId: "tn_retry",
        agentId: "agent_retry",
        task: "monitor",
        runAt: "2026-05-26T18:30:00.000Z",
        maxAttempts: 2,
      },
      repository,
    );

    const result = await runJobWorkerTick({
      handlers: createDurableSchedulerHandlerRegistry({
        withTenantContext: vi.fn(async (_tenantId, fn) => await fn()),
        getAgent: vi.fn(() => ({
          id: "agent_retry",
          name: "Retry Agent",
          brandName: "Pulse",
          website: "",
          tagline: "",
          niche: "",
          xHandle: "",
          tone: "professional",
          agentRole: "",
          competitors: [],
          topics: [],
          contentThemes: [],
          createdAt: "2026-05-26T00:00:00.000Z",
          updatedAt: "2026-05-26T00:00:00.000Z",
        })),
        withAgentRuntimeConfig: withAgentRuntimeConfigMock(),
        runMonitor: vi.fn(async () => {
          throw new Error("monitor exploded");
        }) as never,
        markTaskComplete: vi.fn(),
      }),
      repository,
      queue: DURABLE_SCHEDULER_QUEUE,
      workerId: "worker_meter_retry",
      retryDelayMs: 30_000,
      now: "2026-05-26T18:30:00.000Z",
    });

    expect(result.status).toBe("retried");
    expect(listUsageEvents("tn_retry")).toEqual([]);
  });

  it("uses the scheduler job idempotency key to make duplicate monitor metering a no-op", () => {
    const first = recordSchedulerMonitorUsageEvent({
      job: {
        idempotency_key:
          "scheduler:tn_meter:agent_meter:monitor:2026-05-26T12:00:00.000Z",
        tenant_id: "tn_meter",
        org_id: "org_meter",
        workspace_id: "ws_meter",
        brand_id: "br_meter",
        agent_id: "agent_meter",
      },
      task: "monitor",
      runAtBucket: "2026-05-26T12:00:00.000Z",
      counts: {
        mentions: 2,
        competitorMentions: 1,
        alerts: 1,
      },
      durationMs: 125,
    });
    const second = recordSchedulerMonitorUsageEvent({
      job: {
        idempotency_key:
          "scheduler:tn_meter:agent_meter:monitor:2026-05-26T12:00:00.000Z",
        tenant_id: "tn_meter",
        org_id: "",
        workspace_id: "",
        brand_id: "",
        agent_id: "agent_meter",
      },
      task: "monitor",
      runAtBucket: "2026-05-26T12:00:00.000Z",
      counts: {
        mentions: 999,
        competitorMentions: 999,
        alerts: 999,
      },
      durationMs: 999,
    });

    expect(second).toEqual(first);
    expect(
      getUsageEventByIdempotencyKey(
        buildSchedulerMonitorUsageIdempotencyKey({
          schedulerJobIdempotencyKey:
            "scheduler:tn_meter:agent_meter:monitor:2026-05-26T12:00:00.000Z",
        }),
      ),
    ).toEqual(first);
  });
});

process.on("exit", () => {
  cleanupSqliteFiles(dbPath);
});
