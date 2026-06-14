import {
  completeJob,
  deadLetterJob,
  jobRepository,
  leaseNextJob,
  retryJob,
  type Job,
  type JobRepository,
} from "./jobs.js";

export type SchedulerMode = "legacy" | "durable";

export interface JobHandlerContext<TPayload = unknown> {
  job: Job;
  payload: TPayload;
}

export type JobHandlerResult = Record<string, unknown> | void;

export type JobHandler<TPayload = unknown> = (
  context: JobHandlerContext<TPayload>,
) => Promise<JobHandlerResult> | JobHandlerResult;

export type JobHandlerRegistry = Record<string, JobHandler>;

export type JobWorkerTickResult =
  | { status: "idle" }
  | { status: "completed"; job: Job }
  | { status: "retried"; job: Job }
  | { status: "dead-lettered"; job: Job }
  | { status: "skipped" };

export interface RunJobWorkerTickOptions {
  handlers: JobHandlerRegistry;
  workerId: string;
  queue?: string;
  leaseMs?: number;
  retryDelayMs?: number;
  now?: Date | string;
  repository?: JobRepository;
}

export interface CreateJobWorkerOptions extends RunJobWorkerTickOptions {
  pollIntervalMs?: number;
}

export interface JobWorker {
  tick(
    options?: Pick<RunJobWorkerTickOptions, "now">,
  ): Promise<JobWorkerTickResult>;
  run(signal?: AbortSignal): Promise<void>;
}

const DEFAULT_RETRY_DELAY_MS = 0;
const DEFAULT_POLL_INTERVAL_MS = 1_000;

export function parseSchedulerMode(
  value: string | undefined = process.env.SCHEDULER_MODE,
): SchedulerMode {
  const normalized = value?.trim().toLowerCase();
  return normalized === "durable" ? "durable" : "legacy";
}

export async function runJobWorkerTick(
  options: RunJobWorkerTickOptions,
): Promise<JobWorkerTickResult> {
  const repository = options.repository ?? {
    ...jobRepository,
    completeJob,
    deadLetterJob,
    leaseNextJob,
    retryJob,
  };
  const job = repository.leaseNextJob({
    queue: options.queue,
    workerId: options.workerId,
    leaseMs: options.leaseMs,
    now: options.now,
  });
  if (!job) return { status: "idle" };

  const handler = options.handlers[job.type];
  if (!handler) {
    const updated = repository.deadLetterJob({
      jobId: job.id,
      reason: `No handler registered for job type "${job.type}"`,
      now: options.now,
    });
    return { status: "dead-lettered", job: updated ?? job };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(job.payload);
  } catch {
    const updated = repository.deadLetterJob({
      jobId: job.id,
      reason: `Invalid JSON payload for job type "${job.type}"`,
      now: options.now,
    });
    return { status: "dead-lettered", job: updated ?? job };
  }

  try {
    const result = await handler({ job, payload });
    const completed = repository.completeJob({
      jobId: job.id,
      result: result ?? {},
      now: options.now,
    });
    return { status: "completed", job: completed ?? job };
  } catch (error) {
    const retryAt = addDelay(
      options.now,
      options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
    );
    const updated = repository.retryJob({
      jobId: job.id,
      error: formatJobError(error),
      runAt: retryAt,
      now: options.now,
    });
    const status = updated?.status === "dead" ? "dead-lettered" : "retried";
    return { status, job: updated ?? job };
  }
}

export function createJobWorker(options: CreateJobWorkerOptions): JobWorker {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  let tickInFlight = false;

  return {
    async tick(overrides) {
      if (tickInFlight) return { status: "skipped" };
      tickInFlight = true;

      try {
        return await runJobWorkerTick({ ...options, ...overrides });
      } finally {
        tickInFlight = false;
      }
    },

    async run(signal) {
      while (!signal?.aborted) {
        const result = await this.tick();
        if (signal?.aborted) break;
        if (result.status === "idle") {
          await sleep(pollIntervalMs, signal);
        }
      }
    },
  };
}

function addDelay(
  now: Date | string | undefined,
  delayMs: number,
): string | undefined {
  if (!Number.isFinite(delayMs) || delayMs < 0) {
    throw new Error("Job worker retryDelayMs must be a non-negative number");
  }
  if (!now && delayMs === 0) return undefined;

  const base = normalizeDate(now);
  return new Date(base.getTime() + delayMs).toISOString();
}

function normalizeDate(value: Date | string | undefined): Date {
  if (value instanceof Date) return value;
  if (typeof value === "string") return new Date(value);
  return new Date();
}

function formatJobError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
