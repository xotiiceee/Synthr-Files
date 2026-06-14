import type { TaskType } from "../src/core/scheduler.js";
import { markTaskComplete } from "../src/core/scheduler.js";
import { getConfig } from "../src/core/persona.js";
import { runAutopost } from "../src/modes/autopost.js";
import { runMonitor } from "../src/modes/monitor.js";
import { runOutreach } from "../src/modes/outreach.js";
import { getContext, runInContext } from "./context.js";
import type { JobHandlerRegistry } from "./job-worker.js";
import type { EnqueueJobInput, Job, JobRepository } from "./jobs.js";
import { jobRepository } from "./jobs.js";
import { withTenantContext } from "./tenant.js";
import { incrementUsage } from "./db.js";
import { getHostedAutopilotWriteDecision } from "./account-safety.js";
import { areDurableSchedulerWritesEnabled } from "./durable-scheduler-config.js";
import {
  recordSchedulerMonitorUsageEvent,
  recordSchedulerTaskUsageEvent,
} from "./usage-events.js";
import {
  buildHostedAgentRuntimeConfigPreset,
  writeHostedAgentRuntimeConfig,
  type HostedAgentRuntimeConfigPreset,
} from "./agent-runtime-config.js";
import { resolveHostedBrandRuntimeContext } from "./brand-runtime-context.js";

export { areDurableSchedulerWritesEnabled } from "./durable-scheduler-config.js";

export const DURABLE_SCHEDULER_QUEUE = "scheduler";
export const DURABLE_SCHEDULER_JOB_TYPE_PREFIX = "scheduler.task";

export interface SchedulerTaskJobPayload extends Record<string, unknown> {
  tenantId: string;
  agentId: string;
  task: TaskType;
  runAt: string;
  runAtBucket: string;
}

export interface EnqueueSchedulerTaskJobInput {
  tenantId: string;
  agentId: string;
  task: TaskType;
  runAt: EnqueueJobInput["runAt"];
  runAtBucket?: string;
  orgId?: string;
  workspaceId?: string;
  brandId?: string;
  maxAttempts?: number;
}

export interface DurableSchedulerHandlerDependencies {
  withTenantContext: (
    tenantId: string,
    fn: () => Promise<Record<string, unknown>>,
  ) => Promise<Record<string, unknown>>;
  getAgent: (agentId: string) => HostedAgentRuntimeConfigPreset | null;
  withAgentRuntimeConfig: <T>(
    agent: HostedAgentRuntimeConfigPreset,
    fn: () => Promise<T>,
  ) => Promise<T>;
  runMonitor: typeof runMonitor;
  runAutopost: typeof runAutopost;
  runOutreach: typeof runOutreach;
  getConfig: typeof getConfig;
  getHostedAutopilotWriteDecision: typeof getHostedAutopilotWriteDecision;
  markTaskComplete: typeof markTaskComplete;
  incrementUsage: typeof incrementUsage;
  recordSchedulerMonitorUsageEvent: typeof recordSchedulerMonitorUsageEvent;
  recordSchedulerTaskUsageEvent: typeof recordSchedulerTaskUsageEvent;
}

export interface DurableSchedulerTaskSupport {
  durableExecution: boolean;
  autoBucketHours?: number;
  legacyFallback: boolean;
  guardrailReason?: string;
}

const DURABLE_SCHEDULER_TASK_SUPPORT: Record<
  TaskType,
  DurableSchedulerTaskSupport
> = {
  monitor: {
    durableExecution: true,
    autoBucketHours: 6,
    legacyFallback: true,
  },
  content: {
    durableExecution: false,
    autoBucketHours: 1,
    legacyFallback: true,
    guardrailReason:
      "content durable execution requires PULSE_DURABLE_SCHEDULER_WRITES=true after X write ledger crash-replay coverage passes",
  },
  outreach: {
    durableExecution: false,
    autoBucketHours: 1,
    legacyFallback: true,
    guardrailReason:
      "outreach durable execution requires PULSE_DURABLE_SCHEDULER_WRITES=true after X write ledger crash-replay coverage passes",
  },
  discovery: {
    durableExecution: false,
    legacyFallback: true,
  },
  adaptation: {
    durableExecution: false,
    legacyFallback: true,
  },
  follow: {
    durableExecution: false,
    legacyFallback: true,
  },
  unfollow: {
    durableExecution: false,
    legacyFallback: true,
  },
};

function requireNonBlank(value: string | undefined, field: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`Durable scheduler ${field} is required`);
  }
  return trimmed;
}

function normalizeRunAt(runAt: EnqueueJobInput["runAt"]): string {
  if (runAt instanceof Date) return runAt.toISOString();
  if (typeof runAt === "string" && runAt.trim()) return runAt;
  return new Date().toISOString();
}

function floorUtcHourBucket(runAtIso: string, hours: number): string {
  const runAt = new Date(runAtIso);
  if (Number.isNaN(runAt.getTime())) {
    throw new Error(`Durable scheduler runAt is invalid: ${runAtIso}`);
  }

  const hour = runAt.getUTCHours();
  runAt.setUTCHours(hour - (hour % hours), 0, 0, 0);
  return runAt.toISOString();
}

export function getSchedulerTaskJobType(task: TaskType): string {
  return `${DURABLE_SCHEDULER_JOB_TYPE_PREFIX}.${task}`;
}

export function getDurableSchedulerTaskSupport(
  task: TaskType,
  env: Record<string, string | undefined> = process.env,
): DurableSchedulerTaskSupport {
  const support = DURABLE_SCHEDULER_TASK_SUPPORT[task];
  if (
    (task === "content" || task === "outreach") &&
    areDurableSchedulerWritesEnabled(env)
  ) {
    return {
      ...support,
      durableExecution: true,
      guardrailReason: undefined,
    };
  }
  return support;
}

export function canRunTaskInDurableScheduler(task: TaskType): boolean {
  return getDurableSchedulerTaskSupport(task).durableExecution;
}

export function canRunTaskInDurableSchedulerWithEnv(
  task: TaskType,
  env: Record<string, string | undefined>,
): boolean {
  return getDurableSchedulerTaskSupport(task, env).durableExecution;
}

export function getDurableSchedulerTaskGuardrailReason(
  task: TaskType,
): string | null {
  return getDurableSchedulerTaskSupport(task).guardrailReason ?? null;
}

export function buildSchedulerTaskRunAtBucket(
  task: TaskType,
  runAt: EnqueueJobInput["runAt"],
): string {
  const runAtIso = normalizeRunAt(runAt);

  const support = getDurableSchedulerTaskSupport(task);
  if (!support.autoBucketHours) {
    const reason = support.guardrailReason
      ? `: ${support.guardrailReason}`
      : "";
    throw new Error(
      `Durable scheduler auto-bucketing is not enabled for task "${task}"${reason}`,
    );
  }

  return floorUtcHourBucket(runAtIso, support.autoBucketHours);
}

export function buildSchedulerTaskIdempotencyKey(
  input: Pick<
    EnqueueSchedulerTaskJobInput,
    "tenantId" | "agentId" | "task" | "runAt" | "runAtBucket"
  >,
): string {
  const tenantId = requireNonBlank(input.tenantId, "tenantId");
  const agentId = requireNonBlank(input.agentId, "agentId");
  const task = input.task;
  const runAtBucket =
    input.runAtBucket?.trim() ||
    buildSchedulerTaskRunAtBucket(task, input.runAt);

  return `scheduler:${tenantId}:${agentId}:${task}:${runAtBucket}`;
}

export function enqueueSchedulerTaskJob(
  input: EnqueueSchedulerTaskJobInput,
  repository: Pick<JobRepository, "enqueueJob"> = jobRepository,
): Job {
  const tenantId = requireNonBlank(input.tenantId, "tenantId");
  const agentId = requireNonBlank(input.agentId, "agentId");
  const task = input.task;
  const support = getDurableSchedulerTaskSupport(task);
  const runAt = normalizeRunAt(input.runAt);
  if (!support.durableExecution) {
    const reason = support.guardrailReason
      ? `: ${support.guardrailReason}`
      : "";
    throw new Error(
      `Durable scheduler execution is not enabled for task "${task}"${reason}`,
    );
  }
  const runAtBucket = input.runAtBucket?.trim()
    ? input.runAtBucket.trim()
    : buildSchedulerTaskRunAtBucket(task, runAt);

  const payload: SchedulerTaskJobPayload = {
    tenantId,
    agentId,
    task,
    runAt,
    runAtBucket,
  };

  return repository.enqueueJob({
    idempotencyKey: buildSchedulerTaskIdempotencyKey({
      tenantId,
      agentId,
      task,
      runAt,
      runAtBucket,
    }),
    type: getSchedulerTaskJobType(task),
    queue: DURABLE_SCHEDULER_QUEUE,
    tenantId,
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    brandId: input.brandId,
    agentId,
    payload,
    runAt,
    maxAttempts: input.maxAttempts,
  });
}

export function createDurableSchedulerHandlerRegistry(
  dependencies: Partial<DurableSchedulerHandlerDependencies> = {},
): JobHandlerRegistry {
  const deps: DurableSchedulerHandlerDependencies = {
    withTenantContext: dependencies.withTenantContext ?? withTenantContext,
    getAgent: dependencies.getAgent ?? (() => null),
    withAgentRuntimeConfig:
      dependencies.withAgentRuntimeConfig ?? withHostedAgentRuntimeConfig,
    runMonitor: dependencies.runMonitor ?? runMonitor,
    runAutopost: dependencies.runAutopost ?? runAutopost,
    runOutreach: dependencies.runOutreach ?? runOutreach,
    getConfig: dependencies.getConfig ?? getConfig,
    getHostedAutopilotWriteDecision:
      dependencies.getHostedAutopilotWriteDecision ??
      getHostedAutopilotWriteDecision,
    markTaskComplete: dependencies.markTaskComplete ?? markTaskComplete,
    incrementUsage: dependencies.incrementUsage ?? incrementUsage,
    recordSchedulerMonitorUsageEvent:
      dependencies.recordSchedulerMonitorUsageEvent ??
      recordSchedulerMonitorUsageEvent,
    recordSchedulerTaskUsageEvent:
      dependencies.recordSchedulerTaskUsageEvent ??
      recordSchedulerTaskUsageEvent,
  };

  return {
    [getSchedulerTaskJobType("monitor")]: async ({ job, payload }) => {
      const jobPayload = payload as SchedulerTaskJobPayload;
      const tenantId = requireNonBlank(jobPayload.tenantId, "tenantId");
      const agentId = requireNonBlank(jobPayload.agentId, "agentId");

      return deps.withTenantContext(tenantId, async () => {
        const agent =
          deps.getAgent(agentId) ??
          resolveHostedAgentRuntimeConfigPreset({ tenantId, agentId });
        if (!agent) {
          throw new Error(`Durable scheduler agent not found: ${agentId}`);
        }

        return deps.withAgentRuntimeConfig(agent, async () => {
          const startedAt = Date.now();
          const result = await deps.runMonitor();
          const durationMs = Math.max(0, Date.now() - startedAt);
          deps.markTaskComplete("monitor");

          const mentions = result.mentions.length;
          const competitorMentions = result.competitorMentions.length;
          const alerts = result.alerts.length;
          deps.recordSchedulerMonitorUsageEvent({
            job,
            task: "monitor",
            runAtBucket: requireNonBlank(jobPayload.runAtBucket, "runAtBucket"),
            counts: {
              mentions,
              competitorMentions,
              alerts,
            },
            durationMs,
          });

          return {
            task: "monitor",
            tenantId,
            agentId,
            runAt: normalizeRunAt(jobPayload.runAt),
            runAtBucket: requireNonBlank(jobPayload.runAtBucket, "runAtBucket"),
            mentions,
            competitorMentions,
            alerts,
          };
        });
      });
    },
    [getSchedulerTaskJobType("content")]: async ({ job, payload }) => {
      const jobPayload = payload as SchedulerTaskJobPayload;
      const tenantId = requireNonBlank(jobPayload.tenantId, "tenantId");
      const agentId = requireNonBlank(jobPayload.agentId, "agentId");
      const runAtBucket = requireNonBlank(
        jobPayload.runAtBucket,
        "runAtBucket",
      );

      return deps.withTenantContext(tenantId, async () => {
        const agent =
          deps.getAgent(agentId) ??
          resolveHostedAgentRuntimeConfigPreset({ tenantId, agentId });
        if (!agent) {
          throw new Error(`Durable scheduler agent not found: ${agentId}`);
        }

        return deps.withAgentRuntimeConfig(agent, async () => {
          const config = deps.getConfig() as any;
          if (config.autopost?.approvalMode === "auto_all") {
            const decision = deps.getHostedAutopilotWriteDecision({
              brandId: job.brand_id || tenantId,
              accountId: job.brand_id || tenantId,
              config,
            });
            if (!decision.allowed) {
              deps.markTaskComplete("content");
              return {
                task: "content",
                tenantId,
                agentId,
                runAt: normalizeRunAt(jobPayload.runAt),
                runAtBucket,
                skipped: true,
                reasons: decision.reasons,
              };
            }
          }
          const result = await deps.runAutopost({
            xWriteOperationIdPrefix: job.idempotency_key,
          });
          if (result.published > 0) {
            deps.incrementUsage(tenantId, "content_posts", result.published);
          }
          deps.markTaskComplete("content");
          deps.recordSchedulerTaskUsageEvent({
            scope: {
              tenantId,
              orgId: job.org_id || undefined,
              workspaceId: job.workspace_id || undefined,
              brandId: job.brand_id || undefined,
              agentId,
            },
            task: "content",
            runAtBucket,
            quantity: result.published || result.queued || result.generated || 1,
            metadata: {
              generated: result.generated,
              queued: result.queued,
              published: result.published,
              category: result.category,
              platform: result.platform,
              entryId: result.entryId,
            },
          });

          return {
            task: "content",
            tenantId,
            agentId,
            runAt: normalizeRunAt(jobPayload.runAt),
            runAtBucket,
            generated: result.generated,
            queued: result.queued,
            published: result.published,
            category: result.category,
            platform: result.platform,
            entryId: result.entryId,
          };
        });
      });
    },
    [getSchedulerTaskJobType("outreach")]: async ({ job, payload }) => {
      const jobPayload = payload as SchedulerTaskJobPayload;
      const tenantId = requireNonBlank(jobPayload.tenantId, "tenantId");
      const agentId = requireNonBlank(jobPayload.agentId, "agentId");
      const runAtBucket = requireNonBlank(
        jobPayload.runAtBucket,
        "runAtBucket",
      );

      return deps.withTenantContext(tenantId, async () => {
        const agent =
          deps.getAgent(agentId) ??
          resolveHostedAgentRuntimeConfigPreset({ tenantId, agentId });
        if (!agent) {
          throw new Error(`Durable scheduler agent not found: ${agentId}`);
        }

        return deps.withAgentRuntimeConfig(agent, async () => {
          const result = await deps.runOutreach({
            dryRun: false,
            xWriteOperationIdPrefix: job.idempotency_key,
          });
          deps.incrementUsage(tenantId, "outreach_runs");
          deps.markTaskComplete("outreach");
          deps.recordSchedulerTaskUsageEvent({
            scope: {
              tenantId,
              orgId: job.org_id || undefined,
              workspaceId: job.workspace_id || undefined,
              brandId: job.brand_id || undefined,
              agentId,
            },
            task: "outreach",
            runAtBucket,
            quantity: 1,
            metadata: { repliedCount: result.repliedCount },
          });

          return {
            task: "outreach",
            tenantId,
            agentId,
            runAt: normalizeRunAt(jobPayload.runAt),
            runAtBucket,
            repliedCount: result.repliedCount,
            likedCount: result.likedCount,
            searchedCount: result.searchedCount,
            candidatesFound: result.candidatesFound,
          };
        });
      });
    },
  };
}

async function withHostedAgentRuntimeConfig<T>(
  agent: HostedAgentRuntimeConfigPreset,
  fn: () => Promise<T>,
): Promise<T> {
  const context = getContext();
  if (!context) return fn();

  const runtimeConfigPath = writeHostedAgentRuntimeConfig({ agent });
  return runInContext(
    { ...context, configPath: runtimeConfigPath, selectedAgentId: agent.id },
    fn,
  );
}

function resolveHostedAgentRuntimeConfigPreset(input: {
  tenantId: string;
  agentId: string;
}): HostedAgentRuntimeConfigPreset | null {
  const context = resolveHostedBrandRuntimeContext({
    tenantId: input.tenantId,
    agentId: input.agentId,
  });
  return context ? buildHostedAgentRuntimeConfigPreset(context) : null;
}
