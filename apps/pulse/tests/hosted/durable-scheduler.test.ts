import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

const xMocks = vi.hoisted(() => ({
  post: vi.fn(),
  reply: vi.fn(),
  like: vi.fn(),
  isConfigured: vi.fn(() => true),
  uploadMedia: vi.fn(),
  setMediaAltText: vi.fn(),
}));

vi.mock("../../src/platforms/x.js", () => ({
  x: {
    isConfigured: xMocks.isConfigured,
    post: xMocks.post,
    reply: xMocks.reply,
    like: xMocks.like,
  },
  uploadMedia: xMocks.uploadMedia,
  setMediaAltText: xMocks.setMediaAltText,
}));

import { createJobWorker, runJobWorkerTick } from "../../hosted/job-worker.js";
import { createJobRepository } from "../../hosted/jobs.js";
import {
  DURABLE_SCHEDULER_QUEUE,
  areDurableSchedulerWritesEnabled,
  buildSchedulerTaskIdempotencyKey,
  buildSchedulerTaskRunAtBucket,
  canRunTaskInDurableScheduler,
  createDurableSchedulerHandlerRegistry,
  enqueueSchedulerTaskJob,
  getDurableSchedulerTaskGuardrailReason,
  getSchedulerTaskJobType,
} from "../../hosted/durable-scheduler.js";
import { createHostedXWriteIdempotencyHook } from "../../hosted/x-write-idempotency.js";
import { createXWriteOperationRepository } from "../../hosted/x-write-operations.js";
import {
  getXWriteClient,
  setXWriteIdempotencyHook,
  withXWriteUsage,
} from "../../src/platforms/x-write-client.js";
import { cleanupSqliteFiles, createTempHostedDbPath } from "./temp-db.js";

const dbs: Database.Database[] = [];
const dbPaths: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  setXWriteIdempotencyHook(null);
  delete process.env.PULSE_DURABLE_SCHEDULER_WRITES;

  while (dbs.length > 0) {
    dbs.pop()!.close();
  }
  while (dbPaths.length > 0) {
    cleanupSqliteFiles(dbPaths.pop()!);
  }
});

function createTempJobRepository() {
  const dbPath = createTempHostedDbPath("pulse-durable-scheduler");
  dbPaths.push(dbPath);
  const db = new Database(dbPath);
  dbs.push(db);
  return {
    db,
    repository: createJobRepository(db),
  };
}

function agentFixture(id: string): any {
  return {
    id,
    name: "Durable Agent",
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
  };
}

function withAgentRuntimeConfigMock() {
  return vi.fn(async (_agent: unknown, fn: () => Promise<unknown>) => {
    return await fn();
  });
}

describe("durable scheduler bridge", () => {
  it("enqueues monitor jobs idempotently with a stable six-hour bucket key", () => {
    const { repository } = createTempJobRepository();

    const first = enqueueSchedulerTaskJob(
      {
        tenantId: "tn_pulse",
        agentId: "agent_monitor",
        task: "monitor",
        runAt: "2026-05-26T11:59:59.000Z",
        orgId: "org_pulse",
        workspaceId: "ws_pulse",
        brandId: "br_pulse",
      },
      repository,
    );
    const second = enqueueSchedulerTaskJob(
      {
        tenantId: "tn_pulse",
        agentId: "agent_monitor",
        task: "monitor",
        runAt: "2026-05-26T06:01:00.000Z",
        orgId: "org_changed",
        workspaceId: "ws_changed",
        brandId: "br_changed",
      },
      repository,
    );

    expect(
      buildSchedulerTaskRunAtBucket("monitor", "2026-05-26T11:59:59.000Z"),
    ).toBe("2026-05-26T06:00:00.000Z");
    expect(
      buildSchedulerTaskIdempotencyKey({
        tenantId: "tn_pulse",
        agentId: "agent_monitor",
        task: "monitor",
        runAt: "2026-05-26T11:59:59.000Z",
      }),
    ).toBe("scheduler:tn_pulse:agent_monitor:monitor:2026-05-26T06:00:00.000Z");
    expect(second).toEqual(first);
    expect(first).toMatchObject({
      type: getSchedulerTaskJobType("monitor"),
      queue: DURABLE_SCHEDULER_QUEUE,
      tenant_id: "tn_pulse",
      org_id: "org_pulse",
      workspace_id: "ws_pulse",
      brand_id: "br_pulse",
      agent_id: "agent_monitor",
      status: "queued",
    });
    expect(JSON.parse(first.payload)).toEqual({
      tenantId: "tn_pulse",
      agentId: "agent_monitor",
      task: "monitor",
      runAt: "2026-05-26T11:59:59.000Z",
      runAtBucket: "2026-05-26T06:00:00.000Z",
    });
  });

  it("keeps content and outreach on the legacy runner until durable writes are explicitly enabled", () => {
    expect(canRunTaskInDurableScheduler("content")).toBe(false);
    expect(canRunTaskInDurableScheduler("outreach")).toBe(false);
    expect(getDurableSchedulerTaskGuardrailReason("content")).toContain(
      "PULSE_DURABLE_SCHEDULER_WRITES=true",
    );
    expect(getDurableSchedulerTaskGuardrailReason("outreach")).toContain(
      "PULSE_DURABLE_SCHEDULER_WRITES=true",
    );
    expect(areDurableSchedulerWritesEnabled()).toBe(false);

    expect(() =>
      enqueueSchedulerTaskJob(
        {
          tenantId: "tn_pulse",
          agentId: "agent_content",
          task: "content",
          runAt: "2026-05-26T12:00:00.000Z",
          runAtBucket: "2026-05-26T12:00:00.000Z",
        },
        createTempJobRepository().repository,
      ),
    ).toThrow('Durable scheduler execution is not enabled for task "content"');
    expect(
      buildSchedulerTaskRunAtBucket("outreach", "2026-05-26T12:59:59.000Z"),
    ).toBe("2026-05-26T12:00:00.000Z");
  });

  it("enables content and outreach durable jobs only behind the durable writes gate", () => {
    process.env.PULSE_DURABLE_SCHEDULER_WRITES = "true";
    const { repository } = createTempJobRepository();

    expect(areDurableSchedulerWritesEnabled()).toBe(true);
    expect(canRunTaskInDurableScheduler("content")).toBe(true);
    expect(canRunTaskInDurableScheduler("outreach")).toBe(true);
    expect(
      buildSchedulerTaskRunAtBucket("content", "2026-05-26T12:59:59.000Z"),
    ).toBe("2026-05-26T12:00:00.000Z");

    const content = enqueueSchedulerTaskJob(
      {
        tenantId: "tn_pulse",
        agentId: "agent_content",
        task: "content",
        runAt: "2026-05-26T12:59:59.000Z",
        orgId: "org_pulse",
        workspaceId: "ws_pulse",
        brandId: "br_pulse",
      },
      repository,
    );
    const outreach = enqueueSchedulerTaskJob(
      {
        tenantId: "tn_pulse",
        agentId: "agent_outreach",
        task: "outreach",
        runAt: "2026-05-26T12:30:00.000Z",
      },
      repository,
    );

    expect(content).toMatchObject({
      type: getSchedulerTaskJobType("content"),
      queue: DURABLE_SCHEDULER_QUEUE,
      idempotency_key:
        "scheduler:tn_pulse:agent_content:content:2026-05-26T12:00:00.000Z",
      brand_id: "br_pulse",
    });
    expect(outreach).toMatchObject({
      type: getSchedulerTaskJobType("outreach"),
      idempotency_key:
        "scheduler:tn_pulse:agent_outreach:outreach:2026-05-26T12:00:00.000Z",
    });
  });

  it("executes monitor jobs inside tenant context and marks completion after success", async () => {
    const { repository } = createTempJobRepository();
    const steps: string[] = [];

    const withTenantContext = vi.fn(
      async (tenantId: string, fn: () => Promise<Record<string, unknown>>) => {
        steps.push(`tenant:${tenantId}`);
        return await fn();
      },
    );
    const getAgent = vi.fn(() => ({
      id: "agent_monitor",
      name: "Monitor Agent",
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
    }));
    const withAgentRuntimeConfig = vi.fn(
      async (_agent, fn: () => Promise<Record<string, unknown>>) => {
        steps.push("agent-runtime");
        return await fn();
      },
    );
    const runMonitor = vi.fn(async () => {
      steps.push("run-monitor");
      return {
        mentions: [{ id: "m_1" }, { id: "m_2" }],
        competitorMentions: [{ id: "c_1" }],
        alerts: ["negative mention"],
      };
    });
    const markTaskComplete = vi.fn(() => {
      steps.push("mark-complete");
    });

    enqueueSchedulerTaskJob(
      {
        tenantId: "tn_pulse",
        agentId: "agent_monitor",
        task: "monitor",
        runAt: "2026-05-26T12:00:00.000Z",
      },
      repository,
    );

    const result = await runJobWorkerTick({
      handlers: createDurableSchedulerHandlerRegistry({
        withTenantContext,
        getAgent,
        withAgentRuntimeConfig,
        runMonitor: runMonitor as any,
        markTaskComplete,
      }),
      repository,
      queue: DURABLE_SCHEDULER_QUEUE,
      workerId: "worker_monitor",
      now: "2026-05-26T12:00:00.000Z",
    });

    expect(result.status).toBe("completed");
    expect(repository.getJob(result.job.id)).toMatchObject({
      status: "completed",
      completed_at: "2026-05-26T12:00:00.000Z",
      leased_by: "",
    });
    expect(JSON.parse(repository.getJob(result.job.id)!.result)).toEqual({
      task: "monitor",
      tenantId: "tn_pulse",
      agentId: "agent_monitor",
      runAt: "2026-05-26T12:00:00.000Z",
      runAtBucket: "2026-05-26T12:00:00.000Z",
      mentions: 2,
      competitorMentions: 1,
      alerts: 1,
    });
    expect(withTenantContext).toHaveBeenCalledWith(
      "tn_pulse",
      expect.any(Function),
    );
    expect(getAgent).toHaveBeenCalledWith("agent_monitor");
    expect(withAgentRuntimeConfig).toHaveBeenCalledTimes(1);
    expect(markTaskComplete).toHaveBeenCalledWith("monitor");
    expect(steps).toEqual([
      "tenant:tn_pulse",
      "agent-runtime",
      "run-monitor",
      "mark-complete",
    ]);
  });

  it("retries monitor jobs without marking scheduler completion when monitor fails", async () => {
    const { repository } = createTempJobRepository();

    enqueueSchedulerTaskJob(
      {
        tenantId: "tn_pulse",
        agentId: "agent_monitor",
        task: "monitor",
        runAt: "2026-05-26T18:00:00.000Z",
        maxAttempts: 2,
      },
      repository,
    );

    const markTaskComplete = vi.fn();
    const result = await runJobWorkerTick({
      handlers: createDurableSchedulerHandlerRegistry({
        withTenantContext: vi.fn(async (_tenantId, fn) => await fn()),
        getAgent: vi.fn(() => ({
          id: "agent_monitor",
          name: "Monitor Agent",
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
        }) as any,
        markTaskComplete,
      }),
      repository,
      queue: DURABLE_SCHEDULER_QUEUE,
      workerId: "worker_monitor_fail",
      retryDelayMs: 30_000,
      now: "2026-05-26T18:00:00.000Z",
    });

    expect(result.status).toBe("retried");
    expect(repository.getJob(result.job.id)).toMatchObject({
      status: "queued",
      attempts: 1,
      last_error: "monitor exploded",
      run_at: "2026-05-26T18:00:30.000Z",
      lease_until: null,
      completed_at: null,
    });
    expect(markTaskComplete).not.toHaveBeenCalled();
  });

  it("runs durable content with the scheduler job key as the X write operation prefix", async () => {
    process.env.PULSE_DURABLE_SCHEDULER_WRITES = "true";
    const { repository } = createTempJobRepository();
    const runAutopost = vi.fn(async () => ({
      generated: 1,
      queued: 0,
      published: 1,
      category: "launch",
      platform: "x",
      entryId: "entry_content",
    }));
    const incrementUsage = vi.fn();
    const markTaskComplete = vi.fn();
    const recordSchedulerTaskUsageEvent = vi.fn();

    const job = enqueueSchedulerTaskJob(
      {
        tenantId: "tn_content",
        agentId: "agent_content",
        task: "content",
        runAt: "2026-05-26T20:15:00.000Z",
        orgId: "org_content",
        workspaceId: "ws_content",
        brandId: "br_content",
      },
      repository,
    );

    const result = await runJobWorkerTick({
      handlers: createDurableSchedulerHandlerRegistry({
        withTenantContext: vi.fn(async (_tenantId, fn) => await fn()),
        getAgent: vi.fn(() => agentFixture("agent_content")),
        withAgentRuntimeConfig: withAgentRuntimeConfigMock(),
        getConfig: vi.fn(() => ({ autopost: { approvalMode: "review_all" } })),
        runAutopost: runAutopost as any,
        incrementUsage,
        markTaskComplete,
        recordSchedulerTaskUsageEvent: recordSchedulerTaskUsageEvent as any,
      }),
      repository,
      queue: DURABLE_SCHEDULER_QUEUE,
      workerId: "worker_content",
      now: "2026-05-26T20:15:00.000Z",
    });

    expect(result.status).toBe("completed");
    expect(runAutopost).toHaveBeenCalledWith({
      xWriteOperationIdPrefix: job.idempotency_key,
    });
    expect(incrementUsage).toHaveBeenCalledWith(
      "tn_content",
      "content_posts",
      1,
    );
    expect(markTaskComplete).toHaveBeenCalledWith("content");
    expect(recordSchedulerTaskUsageEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: {
          tenantId: "tn_content",
          orgId: "org_content",
          workspaceId: "ws_content",
          brandId: "br_content",
          agentId: "agent_content",
        },
        task: "content",
        runAtBucket: "2026-05-26T20:00:00.000Z",
      }),
    );
  });

  it("runs durable outreach with the scheduler job key as the X write operation prefix", async () => {
    process.env.PULSE_DURABLE_SCHEDULER_WRITES = "true";
    const { repository } = createTempJobRepository();
    const runOutreach = vi.fn(async () => ({
      repliedCount: 2,
      likedCount: 1,
      searchedCount: 3,
      candidatesFound: 4,
      skippedReasons: {},
      drafts: [],
    }));
    const incrementUsage = vi.fn();
    const markTaskComplete = vi.fn();

    const job = enqueueSchedulerTaskJob(
      {
        tenantId: "tn_outreach",
        agentId: "agent_outreach",
        task: "outreach",
        runAt: "2026-05-26T21:10:00.000Z",
      },
      repository,
    );

    const result = await runJobWorkerTick({
      handlers: createDurableSchedulerHandlerRegistry({
        withTenantContext: vi.fn(async (_tenantId, fn) => await fn()),
        getAgent: vi.fn(() => agentFixture("agent_outreach")),
        withAgentRuntimeConfig: withAgentRuntimeConfigMock(),
        runOutreach: runOutreach as any,
        incrementUsage,
        markTaskComplete,
        recordSchedulerTaskUsageEvent: vi.fn() as any,
      }),
      repository,
      queue: DURABLE_SCHEDULER_QUEUE,
      workerId: "worker_outreach",
      now: "2026-05-26T21:10:00.000Z",
    });

    expect(result.status).toBe("completed");
    expect(runOutreach).toHaveBeenCalledWith({
      dryRun: false,
      xWriteOperationIdPrefix: job.idempotency_key,
    });
    expect(incrementUsage).toHaveBeenCalledWith("tn_outreach", "outreach_runs");
    expect(markTaskComplete).toHaveBeenCalledWith("outreach");
  });

  it("replays a crashed durable content job without duplicating the external X post", async () => {
    process.env.PULSE_DURABLE_SCHEDULER_WRITES = "true";
    const { db, repository } = createTempJobRepository();
    const xWriteOperations = createXWriteOperationRepository(db);
    setXWriteIdempotencyHook(
      createHostedXWriteIdempotencyHook(xWriteOperations),
    );
    xMocks.post.mockResolvedValue({ ok: true, postId: "post_content_1" });
    let crashAfterWrite = true;

    const job = enqueueSchedulerTaskJob(
      {
        tenantId: "tn_replay",
        agentId: "agent_content",
        task: "content",
        runAt: "2026-05-26T22:00:00.000Z",
        maxAttempts: 2,
      },
      repository,
    );
    const runAutopost = vi.fn(
      async ({
        xWriteOperationIdPrefix,
      }: {
        xWriteOperationIdPrefix: string;
      }) => {
        const result = await getXWriteClient().post(
          withXWriteUsage(
            { text: "Durable launch post", type: "post" },
            {
              operationId: `${xWriteOperationIdPrefix}:publish`,
              metadata: { tenantId: "tn_replay", source: "autopost" },
            },
          ),
        );
        if (!result.ok) throw new Error(result.error || "post failed");
        if (crashAfterWrite) {
          crashAfterWrite = false;
          throw new Error("worker crashed after X post");
        }
        return {
          generated: 1,
          queued: 0,
          published: 1,
          category: "launch",
          platform: "x",
          entryId: "entry_replay",
        };
      },
    );
    const handlers = createDurableSchedulerHandlerRegistry({
      withTenantContext: vi.fn(async (_tenantId, fn) => await fn()),
      getAgent: vi.fn(() => agentFixture("agent_content")),
      withAgentRuntimeConfig: withAgentRuntimeConfigMock(),
      getConfig: vi.fn(() => ({ autopost: { approvalMode: "review_all" } })),
      runAutopost: runAutopost as any,
      incrementUsage: vi.fn(),
      markTaskComplete: vi.fn(),
      recordSchedulerTaskUsageEvent: vi.fn() as any,
    });

    const first = await runJobWorkerTick({
      handlers,
      repository,
      queue: DURABLE_SCHEDULER_QUEUE,
      workerId: "worker_content_a",
      retryDelayMs: 30_000,
      now: "2026-05-26T22:00:00.000Z",
    });
    const second = await runJobWorkerTick({
      handlers,
      repository,
      queue: DURABLE_SCHEDULER_QUEUE,
      workerId: "worker_content_b",
      retryDelayMs: 30_000,
      now: "2026-05-26T22:00:30.000Z",
    });

    expect(first.status).toBe("retried");
    expect(second.status).toBe("completed");
    expect(xMocks.post).toHaveBeenCalledTimes(1);
    expect(runAutopost).toHaveBeenCalledTimes(2);
    expect(
      xWriteOperations.getByIdempotencyKey(
        `x-write-client:tn_replay:${job.idempotency_key}:publish:x:post`,
      ),
    ).toMatchObject({
      status: "succeeded",
      external_post_id: "post_content_1",
    });
  });

  it("replays a crashed durable outreach job without duplicating the external X reply", async () => {
    process.env.PULSE_DURABLE_SCHEDULER_WRITES = "true";
    const { db, repository } = createTempJobRepository();
    const xWriteOperations = createXWriteOperationRepository(db);
    setXWriteIdempotencyHook(
      createHostedXWriteIdempotencyHook(xWriteOperations),
    );
    xMocks.reply.mockResolvedValue({ ok: true, postId: "reply_outreach_1" });
    let crashAfterWrite = true;

    const job = enqueueSchedulerTaskJob(
      {
        tenantId: "tn_replay_outreach",
        agentId: "agent_outreach",
        task: "outreach",
        runAt: "2026-05-26T23:00:00.000Z",
        maxAttempts: 2,
      },
      repository,
    );
    const runOutreach = vi.fn(
      async ({
        xWriteOperationIdPrefix,
      }: {
        xWriteOperationIdPrefix: string;
      }) => {
        const result = await getXWriteClient().reply(
          withXWriteUsage(
            {
              id: "root_outreach_1",
              platform: "x",
              url: "https://x.com/i/status/root_outreach_1",
              text: "Original outreach target",
              author: "target",
              topicId: "topic_outreach",
              createdAt: "2026-05-26T22:55:00.000Z",
              engagement: { likes: 0, replies: 0, reposts: 0 },
            },
            {
              operationId: `${xWriteOperationIdPrefix}:reply:root_outreach_1`,
              metadata: {
                tenantId: "tn_replay_outreach",
                source: "outreach",
              },
            },
          ),
          "Useful durable outreach reply",
        );
        if (!result.ok) throw new Error(result.error || "reply failed");
        if (crashAfterWrite) {
          crashAfterWrite = false;
          throw new Error("worker crashed after X reply");
        }
        return {
          repliedCount: 1,
          likedCount: 0,
          searchedCount: 1,
          candidatesFound: 1,
          skippedReasons: {},
          drafts: [],
        };
      },
    );
    const handlers = createDurableSchedulerHandlerRegistry({
      withTenantContext: vi.fn(async (_tenantId, fn) => await fn()),
      getAgent: vi.fn(() => agentFixture("agent_outreach")),
      withAgentRuntimeConfig: withAgentRuntimeConfigMock(),
      runOutreach: runOutreach as any,
      incrementUsage: vi.fn(),
      markTaskComplete: vi.fn(),
      recordSchedulerTaskUsageEvent: vi.fn() as any,
    });

    const first = await runJobWorkerTick({
      handlers,
      repository,
      queue: DURABLE_SCHEDULER_QUEUE,
      workerId: "worker_outreach_a",
      retryDelayMs: 30_000,
      now: "2026-05-26T23:00:00.000Z",
    });
    const second = await runJobWorkerTick({
      handlers,
      repository,
      queue: DURABLE_SCHEDULER_QUEUE,
      workerId: "worker_outreach_b",
      retryDelayMs: 30_000,
      now: "2026-05-26T23:00:30.000Z",
    });

    expect(first.status).toBe("retried");
    expect(second.status).toBe("completed");
    expect(xMocks.reply).toHaveBeenCalledTimes(1);
    expect(runOutreach).toHaveBeenCalledTimes(2);
    expect(
      xWriteOperations.getByIdempotencyKey(
        `x-write-client:tn_replay_outreach:${job.idempotency_key}:reply:root_outreach_1:x:reply`,
      ),
    ).toMatchObject({
      status: "succeeded",
      external_post_id: "reply_outreach_1",
      target_post_id: "root_outreach_1",
    });
  });

  it("exposes scheduler handlers without starting a worker loop", async () => {
    const { repository } = createTempJobRepository();

    enqueueSchedulerTaskJob(
      {
        tenantId: "tn_loop",
        agentId: "agent_loop",
        task: "monitor",
        runAt: "2026-05-26T20:00:00.000Z",
      },
      repository,
    );

    const worker = createJobWorker({
      handlers: createDurableSchedulerHandlerRegistry({
        withTenantContext: vi.fn(async (_tenantId, fn) => await fn()),
        getAgent: vi.fn(() => ({
          id: "agent_loop",
          name: "Loop Agent",
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
          mentions: [],
          competitorMentions: [],
          alerts: [],
        })) as any,
        markTaskComplete: vi.fn(),
      }),
      repository,
      queue: DURABLE_SCHEDULER_QUEUE,
      workerId: "worker_loop",
      pollIntervalMs: 5,
    });

    const first = await worker.tick({ now: "2026-05-26T20:00:00.000Z" });
    const second = await worker.tick({ now: "2026-05-26T20:00:00.000Z" });

    expect(first.status).toBe("completed");
    expect(second.status).toBe("idle");
  });
});
