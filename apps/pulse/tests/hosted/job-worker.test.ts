import { describe, expect, it, vi } from "vitest";

import { cleanupSqliteFiles, createTempHostedDbPath } from "./temp-db.js";

const dbPath = createTempHostedDbPath("pulse-job-worker");
process.env.HOSTED_DB_PATH = dbPath;

const { enqueueJob, getJob } = await import("../../hosted/jobs.js");
const {
  buildBillingOperationIdempotencyKey,
  createBillingOperationRepository,
} = await import("../../hosted/billing-operations.js");
const { createSpendLedgerRepository } = await import(
  "../../hosted/spend-ledger.js"
);
const { createJobWorker, parseSchedulerMode, runJobWorkerTick } =
  await import("../../hosted/job-worker.js");

describe("job worker", () => {
  it("parses scheduler mode with legacy as the fallback", () => {
    expect(parseSchedulerMode(undefined)).toBe("legacy");
    expect(parseSchedulerMode("legacy")).toBe("legacy");
    expect(parseSchedulerMode(" durable ")).toBe("durable");
    expect(parseSchedulerMode("unexpected")).toBe("legacy");
  });

  it("completes a leased job through the registered handler", async () => {
    const job = enqueueJob({
      idempotencyKey: "job-worker:complete",
      type: "worker.complete",
      queue: "worker-complete",
      payload: { postId: "post_123" },
      runAt: "2026-05-26T18:00:00.000Z",
    });

    const result = await runJobWorkerTick({
      handlers: {
        "worker.complete": async ({ payload }) => ({
          ok: true,
          postId: (payload as { postId: string }).postId,
        }),
      },
      queue: "worker-complete",
      workerId: "worker_a",
      now: "2026-05-26T18:00:00.000Z",
    });

    expect(result.status).toBe("completed");
    expect(result.job.id).toBe(job.id);
    expect(getJob(job.id)).toMatchObject({
      status: "completed",
      leased_by: "",
      completed_at: "2026-05-26T18:00:00.000Z",
    });
    expect(JSON.parse(getJob(job.id)!.result)).toEqual({
      ok: true,
      postId: "post_123",
    });
  });

  it("requeues a failed job for retry", async () => {
    const job = enqueueJob({
      idempotencyKey: "job-worker:retry",
      type: "worker.retry",
      queue: "worker-retry",
      payload: { task: "publish" },
      runAt: "2026-05-26T19:00:00.000Z",
      maxAttempts: 3,
    });

    const result = await runJobWorkerTick({
      handlers: {
        "worker.retry": async () => {
          throw new Error("temporary failure");
        },
      },
      queue: "worker-retry",
      workerId: "worker_b",
      retryDelayMs: 30_000,
      now: "2026-05-26T19:00:00.000Z",
    });

    expect(result.status).toBe("retried");
    expect(result.job.id).toBe(job.id);
    expect(getJob(job.id)).toMatchObject({
      status: "queued",
      attempts: 1,
      last_error: "temporary failure",
      run_at: "2026-05-26T19:00:30.000Z",
      lease_until: null,
    });
  });

  it("dead-letters jobs without a registered handler", async () => {
    const job = enqueueJob({
      idempotencyKey: "job-worker:missing-handler",
      type: "worker.unknown",
      queue: "worker-missing",
      runAt: "2026-05-26T20:00:00.000Z",
    });

    const result = await runJobWorkerTick({
      handlers: {},
      queue: "worker-missing",
      workerId: "worker_c",
      now: "2026-05-26T20:00:00.000Z",
    });

    expect(result.status).toBe("dead-lettered");
    expect(getJob(job.id)).toMatchObject({
      status: "dead",
      dead_letter_reason: 'No handler registered for job type "worker.unknown"',
      dead_lettered_at: "2026-05-26T20:00:00.000Z",
    });
  });

  it("dead-letters a job after the final failed attempt", async () => {
    const job = enqueueJob({
      idempotencyKey: "job-worker:max-attempts",
      type: "worker.fail-final",
      queue: "worker-dead",
      runAt: "2026-05-26T21:00:00.000Z",
      maxAttempts: 1,
    });

    const result = await runJobWorkerTick({
      handlers: {
        "worker.fail-final": async () => {
          throw new Error("permanent failure");
        },
      },
      queue: "worker-dead",
      workerId: "worker_d",
      now: "2026-05-26T21:00:00.000Z",
    });

    expect(result.status).toBe("dead-lettered");
    expect(getJob(job.id)).toMatchObject({
      status: "dead",
      attempts: 1,
      last_error: "permanent failure",
      dead_letter_reason: "permanent failure",
      dead_lettered_at: "2026-05-26T21:00:00.000Z",
    });
  });

  it("replays a crashed job without duplicating its post or charge when side effects use stable job-derived keys", async () => {
    const billingRepository = createBillingOperationRepository();
    const spendRepository = createSpendLedgerRepository();
    const postOperationResults = new Map<string, { postId: string }>();
    let crashedAfterSideEffects = false;

    const createExternalPost = vi.fn(async () => ({
      postId: `post_${postOperationResults.size + 1}`,
    }));
    const providerDeduct = vi.fn(async () => ({
      ok: true as const,
      remaining: 18,
    }));

    const job = enqueueJob({
      idempotencyKey: "scheduler:tn_restart_safe:agent_a:content:2026-05-26T23:00:00.000Z",
      type: "worker.restart-safe",
      queue: "worker-restart-safe",
      tenantId: "tn_restart_safe",
      runAt: "2026-05-26T23:00:00.000Z",
      maxAttempts: 2,
    });

    const handler = async ({
      job,
    }: {
      job: { idempotency_key: string; tenant_id: string; run_at: string };
    }) => {
      const postOperationId = `${job.idempotency_key}:publish`;
      let posted = postOperationResults.get(postOperationId);
      if (!posted) {
        posted = await createExternalPost();
        postOperationResults.set(postOperationId, posted);
      }

      await billingRepository.deduct({
        tenantId: job.tenant_id,
        apiKey: "cn-key",
        amount: 2,
        reason: "pulse:scheduler_post",
        idempotencyKey: buildBillingOperationIdempotencyKey({
          tenantId: job.tenant_id,
          action: "scheduler_post",
          operationId: postOperationId,
        }),
        now: job.run_at,
        provider: {
          name: "clawnet",
          isEnabled: () => true,
          deduct: providerDeduct,
          checkBalance: async () => 20,
          canAfford: async () => true,
        },
      });

      if (!crashedAfterSideEffects) {
        crashedAfterSideEffects = true;
        throw new Error("worker crashed after side effects");
      }

      return posted;
    };

    const first = await runJobWorkerTick({
      handlers: { "worker.restart-safe": handler },
      queue: "worker-restart-safe",
      workerId: "worker_restart_safe_a",
      retryDelayMs: 30_000,
      now: "2026-05-26T23:00:00.000Z",
    });
    const second = await runJobWorkerTick({
      handlers: { "worker.restart-safe": handler },
      queue: "worker-restart-safe",
      workerId: "worker_restart_safe_b",
      retryDelayMs: 30_000,
      now: "2026-05-26T23:00:30.000Z",
    });

    expect(first.status).toBe("retried");
    expect(second.status).toBe("completed");
    expect(postOperationResults).toEqual(
      new Map([[`${job.idempotency_key}:publish`, { postId: "post_1" }]]),
    );
    expect(createExternalPost).toHaveBeenCalledTimes(1);
    expect(providerDeduct).toHaveBeenCalledTimes(1);
    expect(getJob(job.id)).toMatchObject({
      status: "completed",
      attempts: 2,
      completed_at: "2026-05-26T23:00:30.000Z",
    });
    expect(JSON.parse(getJob(job.id)!.result)).toEqual({ postId: "post_1" });
    expect(
      billingRepository.getOperationByIdempotencyKey(
        buildBillingOperationIdempotencyKey({
          tenantId: "tn_restart_safe",
          action: "scheduler_post",
          operationId: `${job.idempotency_key}:publish`,
        }),
      ),
    ).toMatchObject({
      status: "succeeded",
      provider_remaining: 18,
    });
    expect(
      spendRepository.getDailySpendTotal({
        tenantId: "tn_restart_safe",
        date: "2026-05-26T23:59:59.000Z",
      }),
    ).toBe(2);
  });

  it("exposes a loopable worker without starting it automatically", async () => {
    enqueueJob({
      idempotencyKey: "job-worker:loop",
      type: "worker.loop",
      queue: "worker-loop",
      runAt: "2026-05-26T22:00:00.000Z",
    });

    const worker = createJobWorker({
      handlers: {
        "worker.loop": async () => ({ ok: true }),
      },
      queue: "worker-loop",
      workerId: "worker_loop",
      pollIntervalMs: 5,
    });

    const first = await worker.tick({ now: "2026-05-26T22:00:00.000Z" });
    const second = await worker.tick({ now: "2026-05-26T22:00:00.000Z" });

    expect(first.status).toBe("completed");
    expect(second.status).toBe("idle");
  });
});

process.on("exit", () => {
  cleanupSqliteFiles(dbPath);
});
