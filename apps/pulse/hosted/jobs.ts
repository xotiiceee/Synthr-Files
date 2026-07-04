import crypto from "node:crypto";
import type Database from "better-sqlite3";

import { getHostedDb } from "./db.js";

export type JobStatus = "queued" | "leased" | "completed" | "dead";

export interface Job {
  id: string;
  idempotency_key: string;
  type: string;
  queue: string;
  status: JobStatus;
  tenant_id: string;
  org_id: string;
  workspace_id: string;
  brand_id: string;
  agent_id: string;
  payload: string;
  result: string;
  run_at: string;
  lease_until: string | null;
  leased_by: string;
  attempts: number;
  max_attempts: number;
  last_error: string;
  dead_letter_reason: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  dead_lettered_at: string | null;
}

export interface EnqueueJobInput {
  idempotencyKey: string;
  type: string;
  queue?: string;
  tenantId?: string;
  orgId?: string;
  workspaceId?: string;
  brandId?: string;
  agentId?: string;
  payload?: Record<string, unknown>;
  runAt?: Date | string;
  maxAttempts?: number;
}

export interface LeaseJobInput {
  queue?: string;
  workerId: string;
  leaseMs?: number;
  now?: Date | string;
}

export interface CompleteJobInput {
  jobId: string;
  result?: Record<string, unknown>;
  now?: Date | string;
}

export interface RetryJobInput {
  jobId: string;
  error: string;
  runAt?: Date | string;
  now?: Date | string;
}

export interface DeadLetterJobInput {
  jobId: string;
  reason: string;
  now?: Date | string;
}

export interface JobRepository {
  enqueueJob(input: EnqueueJobInput): Job;
  leaseNextJob(input: LeaseJobInput): Job | null;
  completeJob(input: CompleteJobInput): Job | null;
  retryJob(input: RetryJobInput): Job | null;
  deadLetterJob(input: DeadLetterJobInput): Job | null;
  getJob(jobId: string): Job | null;
  getJobByIdempotencyKey(idempotencyKey: string): Job | null;
}

export function initJobsTable(db: Database.Database = getHostedDb()): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT UNIQUE NOT NULL,
      type TEXT NOT NULL,
      queue TEXT NOT NULL DEFAULT 'default',
      status TEXT NOT NULL DEFAULT 'queued',
      tenant_id TEXT NOT NULL DEFAULT '',
      org_id TEXT NOT NULL DEFAULT '',
      workspace_id TEXT NOT NULL DEFAULT '',
      brand_id TEXT NOT NULL DEFAULT '',
      agent_id TEXT NOT NULL DEFAULT '',
      payload TEXT NOT NULL DEFAULT '{}',
      result TEXT NOT NULL DEFAULT '{}',
      run_at TEXT NOT NULL,
      lease_until TEXT,
      leased_by TEXT NOT NULL DEFAULT '',
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      last_error TEXT NOT NULL DEFAULT '',
      dead_letter_reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      dead_lettered_at TEXT,
      CHECK(status IN ('queued', 'leased', 'completed', 'dead')),
      CHECK(attempts >= 0),
      CHECK(max_attempts > 0)
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_ready
      ON jobs(queue, status, run_at, lease_until, created_at);
    CREATE INDEX IF NOT EXISTS idx_jobs_status_updated
      ON jobs(status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_jobs_brand_status
      ON jobs(brand_id, status, run_at);
  `);
}

function iso(value: Date | string | undefined, fallback = new Date()): string {
  if (!value) return fallback.toISOString();
  if (value instanceof Date) return value.toISOString();
  return value;
}

function requireNonBlank(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`Job ${field} is required`);
  return trimmed;
}

function normalizeMaxAttempts(value: number | undefined): number {
  if (value === undefined) return 3;
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("Job maxAttempts must be a positive integer");
  }
  return value;
}

function createJobId(): string {
  return "job_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
}

export function createJobRepository(
  db: Database.Database = getHostedDb(),
): JobRepository {
  initJobsTable(db);

  const getJob = (jobId: string): Job | null =>
    (db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as Job | null) ??
    null;

  const getJobByIdempotencyKey = (idempotencyKey: string): Job | null =>
    (db
      .prepare("SELECT * FROM jobs WHERE idempotency_key = ?")
      .get(idempotencyKey) as Job | null) ?? null;

  const leaseTransaction = db.transaction(
    ({ queue, workerId, leaseMs = 60_000, now }: LeaseJobInput): Job | null => {
      if (!Number.isInteger(leaseMs) || leaseMs <= 0) {
        throw new Error("Job leaseMs must be a positive integer");
      }

      const nowIso = iso(now);
      const leaseUntil = new Date(
        new Date(nowIso).getTime() + leaseMs,
      ).toISOString();
      const params: unknown[] = [nowIso, nowIso];
      const queueFilter = queue ? "AND queue = ?" : "";
      if (queue) params.push(queue);

      const candidate = db
        .prepare(
          `SELECT *
           FROM jobs
           WHERE status IN ('queued', 'leased')
             AND run_at <= ?
             AND (status = 'queued' OR lease_until <= ?)
             AND attempts < max_attempts
             ${queueFilter}
           ORDER BY run_at ASC, created_at ASC
           LIMIT 1`,
        )
        .get(...params) as Job | undefined;
      if (!candidate) return null;

      const result = db
        .prepare(
          `UPDATE jobs
         SET status = 'leased',
             lease_until = ?,
             leased_by = ?,
             attempts = attempts + 1,
             updated_at = ?
         WHERE id = ?
           AND status IN ('queued', 'leased')
           AND run_at <= ?
           AND (status = 'queued' OR lease_until <= ?)
           AND attempts < max_attempts`,
        )
        .run(leaseUntil, workerId, nowIso, candidate.id, nowIso, nowIso);
      if (result.changes === 0) return null;

      return getJob(candidate.id);
    },
  );

  return {
    enqueueJob(input) {
      const idempotencyKey = requireNonBlank(
        input.idempotencyKey,
        "idempotencyKey",
      );
      const type = requireNonBlank(input.type, "type");
      const now = new Date();
      const nowIso = now.toISOString();
      const runAt = iso(input.runAt, now);
      const id = createJobId();

      db.prepare(
        `INSERT INTO jobs
         (id, idempotency_key, type, queue, tenant_id, org_id, workspace_id,
          brand_id, agent_id, payload, run_at, max_attempts, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(idempotency_key) DO NOTHING`,
      ).run(
        id,
        idempotencyKey,
        type,
        input.queue || "default",
        input.tenantId || "",
        input.orgId || "",
        input.workspaceId || "",
        input.brandId || "",
        input.agentId || "",
        JSON.stringify(input.payload || {}),
        runAt,
        normalizeMaxAttempts(input.maxAttempts),
        nowIso,
        nowIso,
      );

      return getJobByIdempotencyKey(idempotencyKey)!;
    },

    leaseNextJob(input) {
      requireNonBlank(input.workerId, "workerId");
      return leaseTransaction(input);
    },

    completeJob(input) {
      const current = getJob(input.jobId);
      if (!current) return null;
      if (current.status === "completed") return current;
      if (current.status !== "leased") return null;

      const nowIso = iso(input.now);
      db.prepare(
        `UPDATE jobs
         SET status = 'completed',
             result = ?,
             lease_until = NULL,
             leased_by = '',
             updated_at = ?,
             completed_at = ?
         WHERE id = ? AND status = 'leased'`,
      ).run(JSON.stringify(input.result || {}), nowIso, nowIso, input.jobId);

      return getJob(input.jobId);
    },

    retryJob(input) {
      const current = getJob(input.jobId);
      if (!current) return null;
      if (current.status === "completed" || current.status === "dead") {
        return current;
      }

      const nowIso = iso(input.now);
      if (current.attempts >= current.max_attempts) {
        db.prepare(
          `UPDATE jobs
           SET status = 'dead',
               lease_until = NULL,
               leased_by = '',
               last_error = ?,
               dead_letter_reason = ?,
               updated_at = ?,
               dead_lettered_at = ?
           WHERE id = ? AND status != 'completed'`,
        ).run(input.error, input.error, nowIso, nowIso, input.jobId);
      } else {
        db.prepare(
          `UPDATE jobs
           SET status = 'queued',
               run_at = ?,
               lease_until = NULL,
               leased_by = '',
               last_error = ?,
               updated_at = ?
           WHERE id = ? AND status IN ('queued', 'leased')`,
        ).run(
          iso(input.runAt, new Date(nowIso)),
          input.error,
          nowIso,
          input.jobId,
        );
      }

      return getJob(input.jobId);
    },

    deadLetterJob(input) {
      const current = getJob(input.jobId);
      if (!current) return null;
      if (current.status === "dead") return current;
      if (current.status === "completed") return null;

      const nowIso = iso(input.now);
      db.prepare(
        `UPDATE jobs
         SET status = 'dead',
             lease_until = NULL,
             leased_by = '',
             dead_letter_reason = ?,
             last_error = CASE WHEN last_error = '' THEN ? ELSE last_error END,
             updated_at = ?,
             dead_lettered_at = ?
         WHERE id = ? AND status != 'completed'`,
      ).run(input.reason, input.reason, nowIso, nowIso, input.jobId);

      return getJob(input.jobId);
    },

    getJob,
    getJobByIdempotencyKey,
  };
}

export const jobRepository = createJobRepository();

export function enqueueJob(input: EnqueueJobInput): Job {
  return jobRepository.enqueueJob(input);
}

export function leaseNextJob(input: LeaseJobInput): Job | null {
  return jobRepository.leaseNextJob(input);
}

export function completeJob(input: CompleteJobInput): Job | null {
  return jobRepository.completeJob(input);
}

export function retryJob(input: RetryJobInput): Job | null {
  return jobRepository.retryJob(input);
}

export function deadLetterJob(input: DeadLetterJobInput): Job | null {
  return jobRepository.deadLetterJob(input);
}

export function getJob(jobId: string): Job | null {
  return jobRepository.getJob(jobId);
}

export function getJobByIdempotencyKey(idempotencyKey: string): Job | null {
  return jobRepository.getJobByIdempotencyKey(idempotencyKey);
}
