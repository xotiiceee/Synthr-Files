import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { createJobRepository, type JobRepository } from "../hosted/jobs.js";
import { runJobWorkerTick } from "../hosted/job-worker.js";

interface MeasureOptions {
  jobs: number;
  workers: number;
  queue: string;
  dbPath: string;
  keepDb: boolean;
}

interface QueueDepth {
  queued: number;
  leased: number;
  completed: number;
  dead: number;
}

interface DuplicatePreventionResult {
  duplicateAttempts: number;
  uniqueJobsAfterDuplicates: number;
  suppressedDuplicates: number;
}

interface PerBrandFairnessResult {
  brands: number;
  expectedPerBrand: number;
  minCompleted: number;
  maxCompleted: number;
  maxSkewFromExpected: number;
  completedByBrand: Record<string, number>;
}

const DEFAULT_JOBS = 1_000;
const DEFAULT_WORKERS = 4;

function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, got "${value}"`);
  }
  return parsed;
}

function parseArgs(argv: string[]): MeasureOptions {
  const options: MeasureOptions = {
    jobs: DEFAULT_JOBS,
    workers: DEFAULT_WORKERS,
    queue: "measure-durable-jobs",
    dbPath: path.join(
      os.tmpdir(),
      `pulse-durable-jobs-${process.pid}-${Date.now()}.db`,
    ),
    keepDb: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const readValue = () => {
      const value = argv[index + 1];
      if (!value) throw new Error(`Missing value for ${arg}`);
      index += 1;
      return value;
    };

    if (arg === "--jobs")
      options.jobs = parsePositiveInteger(readValue(), options.jobs);
    else if (arg === "--workers")
      options.workers = parsePositiveInteger(readValue(), options.workers);
    else if (arg === "--queue") options.queue = readValue();
    else if (arg === "--db") options.dbPath = readValue();
    else if (arg === "--keep-db") options.keepDb = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`Usage: npm run measure:durable-jobs -- [options]

Options:
  --jobs <n>       Number of synthetic jobs to enqueue (default ${DEFAULT_JOBS})
  --workers <n>    Number of logical workers to rotate through (default ${DEFAULT_WORKERS})
  --queue <name>   Queue name to measure (default measure-durable-jobs)
  --db <path>      SQLite DB path (default temp file)
  --keep-db        Keep the SQLite DB after the run
`);
}

function cleanupDb(dbPath: string): void {
  for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try {
      fs.unlinkSync(file);
    } catch {}
  }
}

function getQueueDepth(db: Database.Database, queue: string): QueueDepth {
  const rows = db
    .prepare(
      `SELECT status, COUNT(*) AS count
       FROM jobs
       WHERE queue = ?
       GROUP BY status`,
    )
    .all(queue) as Array<{ status: keyof QueueDepth; count: number }>;
  const depth: QueueDepth = { queued: 0, leased: 0, completed: 0, dead: 0 };
  for (const row of rows) depth[row.status] = row.count;
  return depth;
}

function enqueueSyntheticJobs(
  repository: JobRepository,
  options: MeasureOptions,
): void {
  const runAt = "2026-05-26T00:00:00.000Z";
  for (let index = 0; index < options.jobs; index += 1) {
    repository.enqueueJob({
      idempotencyKey: `measure:${options.queue}:${index}`,
      type: "measure.noop",
      queue: options.queue,
      tenantId: `tn_${index % Math.max(1, options.workers)}`,
      brandId: `brand_${index % Math.max(1, options.workers)}`,
      agentId: `agent_${index % Math.max(1, options.workers)}`,
      payload: { index },
      runAt,
      maxAttempts: 3,
    });
  }
}

function countJobs(db: Database.Database, queue: string): number {
  const row = db
    .prepare("SELECT COUNT(*) AS count FROM jobs WHERE queue = ?")
    .get(queue) as { count: number };
  return row.count;
}

function measureDuplicatePrevention(
  db: Database.Database,
  repository: JobRepository,
  options: MeasureOptions,
): DuplicatePreventionResult {
  const duplicateAttempts = Math.min(
    options.jobs,
    Math.max(1, options.workers),
  );
  for (let index = 0; index < duplicateAttempts; index += 1) {
    repository.enqueueJob({
      idempotencyKey: `measure:${options.queue}:${index}`,
      type: "measure.noop",
      queue: options.queue,
      tenantId: `tn_${index % Math.max(1, options.workers)}`,
      brandId: `brand_${index % Math.max(1, options.workers)}`,
      agentId: `agent_${index % Math.max(1, options.workers)}`,
      payload: { index, duplicateProbe: true },
      runAt: "2026-05-26T00:00:00.000Z",
      maxAttempts: 3,
    });
  }

  const uniqueJobsAfterDuplicates = countJobs(db, options.queue);
  return {
    duplicateAttempts,
    uniqueJobsAfterDuplicates,
    suppressedDuplicates:
      duplicateAttempts - Math.max(0, uniqueJobsAfterDuplicates - options.jobs),
  };
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[index];
}

function measurePerBrandFairness(
  completedByBrand: Map<string, number>,
  totalJobs: number,
): PerBrandFairnessResult {
  const completedEntries = [...completedByBrand.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const brands = completedEntries.length;
  const values = completedEntries.map(([, count]) => count);
  const expectedPerBrand = brands > 0 ? totalJobs / brands : 0;
  return {
    brands,
    expectedPerBrand: Math.round(expectedPerBrand * 100) / 100,
    minCompleted: values.length ? Math.min(...values) : 0,
    maxCompleted: values.length ? Math.max(...values) : 0,
    maxSkewFromExpected: values.length
      ? Math.round(
          Math.max(
            ...values.map((count) => Math.abs(count - expectedPerBrand)),
          ) * 100,
        ) / 100
      : 0,
    completedByBrand: Object.fromEntries(completedEntries),
  };
}

async function runMeasurement(options: MeasureOptions): Promise<void> {
  cleanupDb(options.dbPath);
  const db = new Database(options.dbPath);
  const repository = createJobRepository(db);
  const memoryStart = process.memoryUsage().rss;
  const enqueueStarted = performance.now();
  enqueueSyntheticJobs(repository, options);
  const enqueueMs = performance.now() - enqueueStarted;
  const duplicatePrevention = measureDuplicatePrevention(
    db,
    repository,
    options,
  );
  const initialDepth = getQueueDepth(db, options.queue);

  let completed = 0;
  let dead = 0;
  let idleTicks = 0;
  const tickLatenciesMs: number[] = [];
  const completedByBrand = new Map<string, number>();
  const workerStarted = performance.now();

  while (completed + dead < options.jobs) {
    const workerId = `measure-worker-${(completed + dead) % options.workers}`;
    const tickStarted = performance.now();
    const tick = await runJobWorkerTick({
      handlers: {
        "measure.noop": ({ payload }) => payload as Record<string, unknown>,
      },
      queue: options.queue,
      workerId,
      leaseMs: 30_000,
      retryDelayMs: 0,
      now: "2026-05-26T00:00:00.000Z",
      repository,
    });
    tickLatenciesMs.push(performance.now() - tickStarted);

    if (tick.status === "completed") {
      completed += 1;
      const brandId = tick.job.brand_id || "(unscoped)";
      completedByBrand.set(brandId, (completedByBrand.get(brandId) ?? 0) + 1);
    } else if (tick.status === "dead-lettered") dead += 1;
    else if (tick.status === "idle") {
      idleTicks += 1;
      break;
    }
  }

  const workerMs = performance.now() - workerStarted;
  const finalDepth = getQueueDepth(db, options.queue);
  const memoryEnd = process.memoryUsage().rss;
  const throughput = completed / Math.max(workerMs / 1000, 0.001);

  console.log(
    JSON.stringify(
      {
        queue: options.queue,
        jobs: options.jobs,
        workers: options.workers,
        dbPath: options.dbPath,
        enqueueMs: Math.round(enqueueMs),
        workerMs: Math.round(workerMs),
        throughputJobsPerSecond: Math.round(throughput * 100) / 100,
        tickLatencyMs: {
          p50: Math.round(percentile(tickLatenciesMs, 50) * 100) / 100,
          p95: Math.round(percentile(tickLatenciesMs, 95) * 100) / 100,
          max: Math.round(Math.max(0, ...tickLatenciesMs) * 100) / 100,
        },
        completed,
        dead,
        idleTicks,
        duplicatePrevention,
        perBrandFairness: measurePerBrandFairness(
          completedByBrand,
          options.jobs,
        ),
        initialDepth,
        finalDepth,
        memoryRssDeltaMb:
          Math.round(((memoryEnd - memoryStart) / 1024 / 1024) * 100) / 100,
      },
      null,
      2,
    ),
  );

  db.close();
  if (!options.keepDb) cleanupDb(options.dbPath);
}

runMeasurement(parseArgs(process.argv.slice(2))).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
