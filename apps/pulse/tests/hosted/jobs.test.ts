import { describe, expect, it } from "vitest";

import { cleanupSqliteFiles, createTempHostedDbPath } from "./temp-db.js";

const dbPath = createTempHostedDbPath("pulse-jobs");
process.env.HOSTED_DB_PATH = dbPath;

const {
  completeJob,
  deadLetterJob,
  enqueueJob,
  getJob,
  getJobByIdempotencyKey,
  leaseNextJob,
  retryJob,
} = await import("../../hosted/jobs.js");

describe("jobs repository", () => {
  it("creates the jobs table and enqueues jobs idempotently", () => {
    const first = enqueueJob({
      idempotencyKey: "scheduler:br_a:daily:2026-05-26",
      type: "scheduler.daily",
      queue: "scheduler",
      tenantId: "tn_a",
      orgId: "org_a",
      workspaceId: "ws_a",
      brandId: "br_a",
      agentId: "agent_a",
      payload: { task: "daily" },
    });
    const second = enqueueJob({
      idempotencyKey: "scheduler:br_a:daily:2026-05-26",
      type: "scheduler.daily",
      queue: "scheduler",
      payload: { task: "different" },
    });

    expect(second).toEqual(first);
    expect(getJobByIdempotencyKey(first.idempotency_key)).toEqual(first);
    expect(first).toMatchObject({
      status: "queued",
      queue: "scheduler",
      tenant_id: "tn_a",
      org_id: "org_a",
      workspace_id: "ws_a",
      brand_id: "br_a",
      agent_id: "agent_a",
      attempts: 0,
      max_attempts: 3,
    });
    expect(JSON.parse(first.payload)).toEqual({ task: "daily" });
  });

  it("leases due jobs without leasing future jobs", () => {
    const now = "2026-05-26T12:00:00.000Z";
    const due = enqueueJob({
      idempotencyKey: "jobs:due",
      type: "test.due",
      queue: "lease-test",
      runAt: "2026-05-26T11:59:00.000Z",
    });
    enqueueJob({
      idempotencyKey: "jobs:future",
      type: "test.future",
      queue: "lease-test",
      runAt: "2026-05-26T12:05:00.000Z",
    });

    const leased = leaseNextJob({
      queue: "lease-test",
      workerId: "worker_a",
      leaseMs: 30_000,
      now,
    });
    const none = leaseNextJob({
      queue: "lease-test",
      workerId: "worker_b",
      leaseMs: 30_000,
      now,
    });

    expect(leased?.id).toBe(due.id);
    expect(leased).toMatchObject({
      status: "leased",
      leased_by: "worker_a",
      attempts: 1,
      lease_until: "2026-05-26T12:00:30.000Z",
    });
    expect(none).toBeNull();
  });

  it("completes leased jobs idempotently", () => {
    const job = enqueueJob({
      idempotencyKey: "jobs:complete",
      type: "test.complete",
      queue: "complete-test",
      runAt: "2026-05-26T13:00:00.000Z",
    });
    leaseNextJob({
      queue: "complete-test",
      workerId: "worker_complete",
      now: "2026-05-26T13:00:00.000Z",
    });

    const completed = completeJob({
      jobId: job.id,
      result: { postId: "post_1" },
      now: "2026-05-26T13:01:00.000Z",
    });
    const completedAgain = completeJob({
      jobId: job.id,
      result: { postId: "post_2" },
      now: "2026-05-26T13:02:00.000Z",
    });

    expect(completed).toMatchObject({
      status: "completed",
      lease_until: null,
      leased_by: "",
      completed_at: "2026-05-26T13:01:00.000Z",
    });
    expect(JSON.parse(completed!.result)).toEqual({ postId: "post_1" });
    expect(completedAgain).toEqual(completed);
  });

  it("requeues failed jobs and dead-letters after max attempts", () => {
    const job = enqueueJob({
      idempotencyKey: "jobs:retry",
      type: "test.retry",
      queue: "retry-test",
      runAt: "2026-05-26T14:00:00.000Z",
      maxAttempts: 2,
    });

    expect(
      leaseNextJob({
        queue: "retry-test",
        workerId: "worker_retry",
        now: "2026-05-26T14:00:00.000Z",
      })?.attempts,
    ).toBe(1);

    const queued = retryJob({
      jobId: job.id,
      error: "temporary failure",
      runAt: "2026-05-26T14:05:00.000Z",
      now: "2026-05-26T14:01:00.000Z",
    });
    expect(queued).toMatchObject({
      status: "queued",
      run_at: "2026-05-26T14:05:00.000Z",
      last_error: "temporary failure",
      lease_until: null,
    });

    expect(
      leaseNextJob({
        queue: "retry-test",
        workerId: "worker_retry",
        now: "2026-05-26T14:05:00.000Z",
      })?.attempts,
    ).toBe(2);

    const dead = retryJob({
      jobId: job.id,
      error: "permanent failure",
      now: "2026-05-26T14:06:00.000Z",
    });
    expect(dead).toMatchObject({
      status: "dead",
      last_error: "permanent failure",
      dead_letter_reason: "permanent failure",
      dead_lettered_at: "2026-05-26T14:06:00.000Z",
    });
  });

  it("leases expired jobs again after a worker crash", () => {
    const job = enqueueJob({
      idempotencyKey: "jobs:crash",
      type: "test.crash",
      queue: "crash-test",
      runAt: "2026-05-26T14:59:59.000Z",
    });

    const firstLease = leaseNextJob({
      queue: "crash-test",
      workerId: "worker_crashed",
      leaseMs: 1_000,
      now: "2026-05-26T15:00:00.000Z",
    });
    const beforeExpiry = leaseNextJob({
      queue: "crash-test",
      workerId: "worker_early",
      leaseMs: 1_000,
      now: "2026-05-26T15:00:00.500Z",
    });
    const afterExpiry = leaseNextJob({
      queue: "crash-test",
      workerId: "worker_recovery",
      leaseMs: 1_000,
      now: "2026-05-26T15:00:01.000Z",
    });

    expect(firstLease?.id).toBe(job.id);
    expect(beforeExpiry).toBeNull();
    expect(afterExpiry).toMatchObject({
      id: job.id,
      status: "leased",
      leased_by: "worker_recovery",
      attempts: 2,
      lease_until: "2026-05-26T15:00:02.000Z",
    });
  });

  it("dead-letters active jobs and does not complete dead jobs", () => {
    const job = enqueueJob({
      idempotencyKey: "jobs:dead-letter",
      type: "test.dead",
      queue: "dead-letter-test",
    });

    const dead = deadLetterJob({
      jobId: job.id,
      reason: "manual quarantine",
      now: "2026-05-26T16:00:00.000Z",
    });

    expect(dead).toMatchObject({
      status: "dead",
      dead_letter_reason: "manual quarantine",
      dead_lettered_at: "2026-05-26T16:00:00.000Z",
    });
    expect(completeJob({ jobId: job.id })).toBeNull();
    expect(getJob(job.id)?.status).toBe("dead");
  });
});

process.on("exit", () => {
  cleanupSqliteFiles(dbPath);
});
