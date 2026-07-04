/**
 * Multi-Tenant Scheduler for Hosted Pulse.
 *
 * Processes active tenants in parallel batches (configurable concurrency).
 * Each tenant runs in its own AsyncLocalStorage context.
 */

import { listTenants, incrementUsage, type Tenant } from "./db.js";
import { withTenantContext, hasTenantXKeys } from "./tenant.js";
import { checkLimit } from "./limits.js";
import { getSchedulerQuietHoursDecision } from "../src/core/scheduler.js";
import {
  getHostedAutopilotWriteDecision,
  type HostedAutopilotWriteDecision as AccountSafetyAutopilotWriteDecision,
} from "./account-safety.js";
import {
  DURABLE_SCHEDULER_QUEUE,
  canRunTaskInDurableScheduler,
  createDurableSchedulerHandlerRegistry,
  enqueueSchedulerTaskJob as enqueueDurableSchedulerTaskJob,
} from "./durable-scheduler.js";
import type { TaskType } from "../src/core/scheduler.js";
import { recordSchedulerTaskUsageEvent } from "./usage-events.js";
import {
  createJobWorker,
  parseSchedulerMode,
  type JobHandlerRegistry,
  type JobWorker,
  type SchedulerMode,
} from "./job-worker.js";
import type { JobRepository } from "./jobs.js";
import { installHostedXWriteSafetyHooks } from "./x-write-safety.js";
import { installHostedXWriteIdempotencyHooks } from "./x-write-idempotency.js";
import { getContext, runInContext } from "./context.js";
import {
  buildHostedAgentRuntimeConfigPreset,
  writeHostedAgentRuntimeConfig,
} from "./agent-runtime-config.js";
import { loadHostedRuntimeState } from "./runtime-agent.js";

const SCHEDULER_INTERVAL_MS = 5 * 60 * 1000;
const GITHUB_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const BATCH_CONCURRENCY = 10; // Process 10 tenants in parallel
const FAIRNESS_ROTATION_INTERVAL_MS = SCHEDULER_INTERVAL_MS;
let schedulerTimer: NodeJS.Timeout | null = null;
let githubSyncTimer: NodeJS.Timeout | null = null;
let durableSchedulerWorkerAbortController: AbortController | null = null;
let tickRunning = false; // Mutex — prevents overlapping ticks

export interface SchedulerRuntimeOptions {
  mode?: SchedulerMode;
  enqueueSchedulerTaskJob?: typeof enqueueDurableSchedulerTaskJob;
  now?: () => Date;
  runAlwaysTasks?: boolean;
  schedulerWriteGuardsEnabled?: boolean;
}

export interface DurableSchedulerWorkerOptions {
  handlers?: JobHandlerRegistry;
  repository?: JobRepository;
  workerId?: string;
  pollIntervalMs?: number;
}

export interface SchedulerBrandFairnessCandidate {
  brandId: string;
}

export interface SchedulerBrandFairnessDecision {
  allowed: boolean;
  brandId: string;
  selectedBrandIds: string[];
  deferredBrandIds: string[];
  maxBrandsPerTick: number;
  rotationOffset: number;
  runAtBucket: string;
  reason: "under_quota" | "selected" | "deferred";
}

export interface HostedSchedulerAutopilotWriteDecision {
  allowed: boolean;
  reasons: string[];
  safety: AccountSafetyAutopilotWriteDecision;
  quietHours: ReturnType<typeof getSchedulerQuietHoursDecision>;
  fairness?: SchedulerBrandFairnessDecision;
}

function resolveSchedulerMode(mode?: SchedulerMode): SchedulerMode {
  return mode ?? parseSchedulerMode();
}

function areSchedulerWriteGuardsEnabled(
  options: SchedulerRuntimeOptions = {},
): boolean {
  if (options.schedulerWriteGuardsEnabled !== undefined) {
    return options.schedulerWriteGuardsEnabled;
  }
  const flag = process.env.SCHEDULER_WS_L_WRITE_GUARDS?.trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "on";
}

function normalizeRunAt(input?: Date | string): Date {
  if (input instanceof Date) return input;
  return new Date(input ?? new Date().toISOString());
}

function buildFairnessRunAtBucket(runAt: Date): string {
  const bucketMs =
    Math.floor(runAt.getTime() / FAIRNESS_ROTATION_INTERVAL_MS) *
    FAIRNESS_ROTATION_INTERVAL_MS;
  return new Date(bucketMs).toISOString();
}

export function getSchedulerBrandFairnessDecision<
  T extends SchedulerBrandFairnessCandidate,
>(input: {
  brandId: string;
  candidates: readonly T[];
  maxBrandsPerTick: number;
  runAt?: Date | string;
}): SchedulerBrandFairnessDecision {
  const uniqueBrandIds = [
    ...new Set(input.candidates.map((item) => item.brandId)),
  ]
    .filter((brandId) => brandId.trim().length > 0)
    .sort((left, right) => left.localeCompare(right));
  const runAt = normalizeRunAt(input.runAt);
  const runAtBucket = buildFairnessRunAtBucket(runAt);
  const maxBrandsPerTick = Math.max(1, Math.floor(input.maxBrandsPerTick));

  if (uniqueBrandIds.length <= maxBrandsPerTick) {
    return {
      allowed: uniqueBrandIds.includes(input.brandId),
      brandId: input.brandId,
      selectedBrandIds: uniqueBrandIds,
      deferredBrandIds: [],
      maxBrandsPerTick,
      rotationOffset: 0,
      runAtBucket,
      reason: "under_quota",
    };
  }

  const rotationOffset =
    Math.floor(runAt.getTime() / FAIRNESS_ROTATION_INTERVAL_MS) %
    uniqueBrandIds.length;
  const selectedBrandIds = Array.from(
    { length: maxBrandsPerTick },
    (_, index) => {
      const selectedIndex = (rotationOffset + index) % uniqueBrandIds.length;
      return uniqueBrandIds[selectedIndex]!;
    },
  );
  const selectedBrandIdSet = new Set(selectedBrandIds);
  const deferredBrandIds = uniqueBrandIds.filter(
    (brandId) => !selectedBrandIdSet.has(brandId),
  );

  return {
    allowed: selectedBrandIdSet.has(input.brandId),
    brandId: input.brandId,
    selectedBrandIds,
    deferredBrandIds,
    maxBrandsPerTick,
    rotationOffset,
    runAtBucket,
    reason: selectedBrandIdSet.has(input.brandId) ? "selected" : "deferred",
  };
}

export function getHostedSchedulerAutopilotWriteDecision(input: {
  brandId: string;
  accountId: string;
  config: Record<string, unknown>;
  now?: Date | string;
  fairness?: SchedulerBrandFairnessDecision;
}): HostedSchedulerAutopilotWriteDecision {
  const safety = getHostedAutopilotWriteDecision({
    brandId: input.brandId,
    accountId: input.accountId,
    config: input.config,
    now: input.now,
  });
  const quietHours = getSchedulerQuietHoursDecision({
    now: input.now,
    config: input.config as never,
  });
  const reasons = [...safety.reasons];

  if (!quietHours.allowed) {
    reasons.push(
      `scheduler_quiet_hours:${quietHours.timezone}:${quietHours.localTime}`,
    );
  }
  if (input.fairness && !input.fairness.allowed) {
    reasons.push(
      `scheduler_brand_fairness:${input.fairness.runAtBucket}:${input.fairness.rotationOffset}`,
    );
  }

  return {
    allowed:
      safety.allowed &&
      quietHours.allowed &&
      (input.fairness ? input.fairness.allowed : true),
    reasons,
    safety,
    quietHours,
    fairness: input.fairness,
  };
}

function shouldEnqueueDurableSchedulerTask(
  mode: SchedulerMode,
  task: TaskType,
): boolean {
  return mode === "durable" && canRunTaskInDurableScheduler(task);
}

export function createDurableSchedulerWorker(
  options: DurableSchedulerWorkerOptions = {},
): JobWorker {
  return createJobWorker({
    handlers: options.handlers ?? createDurableSchedulerHandlerRegistry(),
    repository: options.repository,
    queue: DURABLE_SCHEDULER_QUEUE,
    workerId: options.workerId ?? `scheduler-${process.pid}`,
    pollIntervalMs: options.pollIntervalMs,
  });
}

async function runTenantTasks(
  tenant: Tenant,
  options: SchedulerRuntimeOptions = {},
): Promise<void> {
  if (tenant.status !== "active") return;

  await withTenantContext(tenant.id, async () => {
    try {
      const {
        listHostedRunnableBrandRuntimeContexts,
      } = await import("./brand-runtime-context.js");
      const tenantContext = getContext();
      if (!tenantContext) return;

      const runnableContexts = listHostedRunnableBrandRuntimeContexts({
        tenantId: tenant.id,
      });
      if (runnableContexts.length === 0) return;

      for (const context of runnableContexts) {
        const agent = buildHostedAgentRuntimeConfigPreset(context);
        // Check if this agent (or tenant) has X keys
        if (!hasTenantXKeys(tenant.id, context.legacyAgentId)) continue;
        const runtimeConfigPath = writeHostedAgentRuntimeConfig({ agent });
        await runInContext(
          {
            ...tenantContext,
            configPath: runtimeConfigPath,
            selectedAgentId: context.legacyAgentId,
          },
          () => runAgentTasks(tenant, context.legacyAgentId, options),
        );
      }
    } catch (err) {
      console.error(
        `  [Scheduler] ${tenant.id} error:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  });
}

export async function runAgentTasks(
  tenant: Tenant,
  agentId: string,
  options: SchedulerRuntimeOptions = {},
): Promise<void> {
  const mode = resolveSchedulerMode(options.mode);
  const enqueueSchedulerTaskJob =
    options.enqueueSchedulerTaskJob ?? enqueueDurableSchedulerTaskJob;
  const now = options.now ?? (() => new Date());
  const runAt = now();
  const runAtBucket = runAt.toISOString();

  // Build GitHub repo context block once per agent tick; passed into runAutopost below.
  // Computed here (hosted layer) so src/modes/autopost.ts stays free of hosted/ imports.
  let githubContextBlock: string | undefined;
  try {
    const { buildGitHubContextBlock } =
      await import("../src/intelligence/github-context.js");
    const { listGitHubRepoLinks } = await import("./db.js");
    const { loadState } = await import("../src/core/state.js");
    const block = await buildGitHubContextBlock(
      tenant.id,
      listGitHubRepoLinks,
      loadState,
    );
    if (block) githubContextBlock = block;
  } catch {}

  const { getDueTasks, markTaskComplete } =
    await import("../src/core/scheduler.js");
  const dueTasks = getDueTasks();

  for (const task of dueTasks) {
    if (
      (task === "outreach" || task === "discovery") &&
      !checkLimit(tenant, "outreach_runs").allowed
    )
      continue;
    if (task === "content" && !checkLimit(tenant, "content_posts").allowed)
      continue;

    let completedByLegacyRunner = true;
    let metering:
      | { quantity?: number; metadata?: Record<string, unknown> }
      | undefined;
    try {
      switch (task) {
        case "outreach": {
          if (shouldEnqueueDurableSchedulerTask(mode, task)) {
            const job = enqueueSchedulerTaskJob({
              tenantId: tenant.id,
              agentId,
              task: "outreach",
              runAt,
            });
            completedByLegacyRunner = false;
            console.log(
              `  [Scheduler] ${tenant.id}/${agentId}: outreach enqueued — ${job.id}`,
            );
            break;
          }

          const { runOutreach } = await import("../src/modes/outreach.js");
          const result = await runOutreach({
            dryRun: false,
            xWriteOperationIdPrefix: `scheduler:${tenant.id}:${agentId}:outreach:${runAtBucket}`,
          });
          incrementUsage(tenant.id, "outreach_runs");
          metering = {
            quantity: 1,
            metadata: { repliedCount: result.repliedCount },
          };
          console.log(
            `  [Scheduler] ${tenant.id}/${agentId}: outreach — ${result.repliedCount} replies`,
          );
          break;
        }
        case "content": {
          if (shouldEnqueueDurableSchedulerTask(mode, task)) {
            const job = enqueueSchedulerTaskJob({
              tenantId: tenant.id,
              agentId,
              task: "content",
              runAt,
            });
            completedByLegacyRunner = false;
            console.log(
              `  [Scheduler] ${tenant.id}/${agentId}: content enqueued — ${job.id}`,
            );
            break;
          }

          const { getConfig } = await import("../src/core/persona.js");
          const config = getConfig() as any;
          if (config.autopost?.approvalMode === "auto_all") {
            const decision = areSchedulerWriteGuardsEnabled(options)
              ? getHostedSchedulerAutopilotWriteDecision({
                  brandId: tenant.id,
                  accountId: tenant.id,
                  config,
                  now: runAt,
                })
              : {
                  ...getHostedAutopilotWriteDecision({
                    brandId: tenant.id,
                    accountId: tenant.id,
                    config,
                  }),
                  quietHours: null,
                  fairness: undefined,
                };
            if (!decision.allowed) {
              console.log(
                `  [Scheduler] ${tenant.id}/${agentId}: content skipped — ${decision.reasons.join(", ")}`,
              );
              break;
            }
          }
          const { runAutopost } = await import("../src/modes/autopost.js");
          const result = await runAutopost({
            githubContextBlock,
            xWriteOperationIdPrefix: `scheduler:${tenant.id}:${agentId}:content:${runAtBucket}`,
          });
          if (result.published > 0)
            incrementUsage(tenant.id, "content_posts", result.published);
          metering = {
            quantity:
              result.published || result.queued || result.generated || 1,
            metadata: {
              generated: result.generated,
              queued: result.queued,
              published: result.published,
              category: result.category,
              platform: result.platform,
              entryId: result.entryId,
            },
          };
          break;
        }
        case "monitor": {
          if (shouldEnqueueDurableSchedulerTask(mode, task)) {
            const job = enqueueSchedulerTaskJob({
              tenantId: tenant.id,
              agentId,
              task: "monitor",
              runAt,
            });
            completedByLegacyRunner = false;
            console.log(
              `  [Scheduler] ${tenant.id}/${agentId}: monitor enqueued — ${job.id}`,
            );
            break;
          }

          const { runMonitor } = await import("../src/modes/monitor.js");
          const result = await runMonitor();
          metering = {
            quantity: 1,
            metadata: {
              mentions: result.mentions?.length ?? 0,
              competitorMentions: result.competitorMentions?.length ?? 0,
              alerts: result.alerts?.length ?? 0,
            },
          };
          break;
        }
        case "discovery": {
          const { discoverOpportunities } =
            await import("../src/core/opportunity-engine.js");
          const opps = await discoverOpportunities();
          incrementUsage(tenant.id, "outreach_runs");
          metering = {
            quantity: 1,
            metadata: { opportunities: opps.length },
          };
          console.log(
            `  [Scheduler] ${tenant.id}/${agentId}: discovery — ${opps.length} opps`,
          );
          break;
        }
        case "adaptation": {
          const { runAdaptation } =
            await import("../src/intelligence/adaptation.js");
          await runAdaptation();
          metering = { quantity: 1 };
          break;
        }
        case "follow": {
          console.log(
            `  [Scheduler] ${tenant.id}/${agentId}: follow skipped — hosted follow churn is disabled`,
          );
          break;
        }
        case "unfollow": {
          console.log(
            `  [Scheduler] ${tenant.id}/${agentId}: unfollow skipped — hosted follow churn is disabled`,
          );
          break;
        }
      }
      if (completedByLegacyRunner) {
        if (metering) {
          recordSchedulerTaskUsageEvent({
            scope: {
              tenantId: tenant.id,
              agentId,
            },
            task,
            runAtBucket,
            quantity: metering.quantity,
            metadata: metering.metadata,
          });
        }
        markTaskComplete(task);
      }
    } catch (err) {
      console.error(
        `  [Scheduler] ${tenant.id}/${agentId}/${task} failed:`,
        err instanceof Error ? err.message : String(err),
      );
      if (err instanceof Error && err.stack)
        console.error(
          `  [Scheduler] Stack:`,
          err.stack.split("\n").slice(1, 4).join(" | "),
        );
    }
  }

  // ── Always-run tasks (not gated by scheduler intervals) ─────────────────
  if (options.runAlwaysTasks === false) return;

  // Ensure search topics exist (LLM-generated, runs once per agent)
  try {
    const { ensureTopicsExist } =
      await import("../src/intelligence/topic-discovery.js");
    await ensureTopicsExist(agentId);
  } catch {}

  // Mention detection — find and reply to @mentions on supported X API tiers.
  try {
    const { detectMentions, processPendingMentions, markMentionReplied } =
      await import("../src/intelligence/mention-detector.js");
    const { getXWriteClient, withXWriteUsage } =
      await import("../src/platforms/x-write-client.js");
    const { isAccountAllowed } = await import("./account-safety.js");

    // Step 1: Detect new mentions
    await detectMentions();

    // Step 2: Process pending (generate replies for ready ones)
    const ready = await processPendingMentions();

    const { getConfig } = await import("../src/core/persona.js");
    const config = getConfig() as unknown as Record<string, unknown>;
    const writeDecision = areSchedulerWriteGuardsEnabled(options)
      ? getHostedSchedulerAutopilotWriteDecision({
          brandId: tenant.id,
          accountId: tenant.id,
          config,
          now: runAt,
        })
      : {
          ...getHostedAutopilotWriteDecision({
            brandId: tenant.id,
            accountId: tenant.id,
            config,
          }),
          quietHours: null,
          fairness: undefined,
        };
    if (!writeDecision.allowed) {
      console.log(
        `  [Scheduler] ${tenant.id}/${agentId}: mention replies skipped — ${writeDecision.reasons.join(", ")}`,
      );
      return;
    }

    const safety = isAccountAllowed({
      brandId: tenant.id,
      accountId: tenant.id,
    });
    if (!safety.allowed) {
      console.log(
        `  [Scheduler] ${tenant.id}/${agentId}: mention replies skipped — ${safety.reasons.join(", ")}`,
      );
      return;
    }

    // Step 3: Post replies
    let replied = 0;
    for (const mention of ready) {
      if (!mention.suggestedReply) continue;
      try {
        const result = await getXWriteClient().reply(
          withXWriteUsage(
            {
              id: mention.id,
              platform: "x",
              url: mention.url,
              text: mention.text,
              author: mention.author,
              topicId: "",
              createdAt: mention.detectedAt,
              engagement: { likes: 0, replies: 0, reposts: 0 },
            },
            {
              operationId: [
                "scheduler",
                tenant.id,
                agentId,
                "mentions",
                runAtBucket,
                mention.id,
              ].join(":"),
              metadata: {
                source: "scheduler_mentions",
                tenantId: tenant.id,
                agentId,
                mentionId: mention.id,
                author: mention.author,
              },
            },
          ),
          mention.suggestedReply,
        );
        if (result.ok) {
          markMentionReplied(mention.id);
          replied++;
          console.log(
            `  [Mentions] Replied to @${mention.author}: ${mention.suggestedReply.slice(0, 80)}...`,
          );
        }
      } catch {}
    }
    if (replied > 0) {
      console.log(
        `  [Scheduler] ${tenant.id}/${agentId}: mentions — ${replied} replies`,
      );
    }
  } catch {}

  // Engagement feedback — check how posts are performing (self-throttles: 4h min per post)
  try {
    const { checkEngagement } =
      await import("../src/intelligence/engagement-monitor.js");
    const engResult = await checkEngagement();
    if (engResult.checked > 0) {
      console.log(
        `  [Scheduler] ${tenant.id}/${agentId}: engagement — ${engResult.updated} updated, ${engResult.highPerformers} high performers`,
      );
    }
  } catch {}

  // Weekly niche refresh (check if it's been 7+ days since last research)
  try {
    const domain = loadHostedRuntimeState<{ refreshedAt?: string; niche?: string }>(
      "domain-knowledge",
      {},
    );
    if (domain.niche) {
      const lastRefresh = domain.refreshedAt
        ? new Date(domain.refreshedAt).getTime()
        : 0;
      const daysSince = (Date.now() - lastRefresh) / (24 * 3600_000);
      if (daysSince >= 7) {
        const { refreshNicheTrends } =
          await import("../src/intelligence/auto-research.js");
        await refreshNicheTrends(domain.niche);
        console.log(
          `  [Scheduler] ${tenant.id}/${agentId}: niche trends refreshed`,
        );
      }
    }
  } catch {}
}

/** Process an array in parallel batches of `size`. */
async function batchProcess<T>(
  items: T[],
  size: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    const batch = items.slice(i, i + size);
    await Promise.allSettled(batch.map(fn));
  }
}

export async function schedulerTick(
  options: SchedulerRuntimeOptions = {},
): Promise<void> {
  if (tickRunning) {
    console.log("[Scheduler] Tick skipped — previous tick still running");
    return;
  }
  tickRunning = true;

  try {
    const tenants = listTenants("active");
    const started = Date.now();
    console.log(
      `[Scheduler] Tick — ${tenants.length} active tenants (concurrency: ${BATCH_CONCURRENCY})`,
    );

    await batchProcess(tenants, BATCH_CONCURRENCY, async (tenant) => {
      try {
        await runTenantTasks(tenant, options);
      } catch (err) {
        console.error(
          `[Scheduler] Fatal for ${tenant.id}:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    });

    console.log(
      `[Scheduler] Tick complete — ${Math.round((Date.now() - started) / 1000)}s`,
    );
  } finally {
    tickRunning = false;
  }
}

async function githubSyncTick(): Promise<void> {
  const tenants = listTenants("active");
  for (const tenant of tenants) {
    await withTenantContext(tenant.id, async () => {
      try {
        const { listGitHubRepoLinks } = await import("./db.js");
        const repos = listGitHubRepoLinks(tenant.id);
        if (!repos.some((r) => r.sync_enabled)) return;
        const { syncAllLinkedRepos } = await import("./github.js");
        const { saveState } = await import("../src/core/state.js");
        await syncAllLinkedRepos(tenant.id, listGitHubRepoLinks, saveState);
      } catch (err) {
        console.error(
          `[GitHub Sync] ${tenant.id}:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    });
  }
}

export function startScheduler(): void {
  installHostedXWriteSafetyHooks();
  installHostedXWriteIdempotencyHooks();

  const mode = parseSchedulerMode();
  console.log(
    `[Scheduler] Starting — mode: ${mode}, interval: ${SCHEDULER_INTERVAL_MS / 1000}s, concurrency: ${BATCH_CONCURRENCY}`,
  );

  if (mode === "durable" && !durableSchedulerWorkerAbortController) {
    durableSchedulerWorkerAbortController = new AbortController();
    const worker = createDurableSchedulerWorker();
    worker
      .run(durableSchedulerWorkerAbortController.signal)
      .catch((err) =>
        console.error(
          "[Scheduler] Durable worker error:",
          err instanceof Error ? err.message : String(err),
        ),
      );
  }

  setTimeout(() => {
    schedulerTick({ mode }).catch((err) =>
      console.error("[Scheduler] Tick error:", err),
    );
    schedulerTimer = setInterval(() => {
      schedulerTick({ mode }).catch((err) =>
        console.error("[Scheduler] Tick error:", err),
      );
    }, SCHEDULER_INTERVAL_MS);
  }, 30_000);

  // GitHub sync — first tick after 10 min, then every 6 hours
  setTimeout(
    () => {
      githubSyncTick().catch((err) =>
        console.error("[GitHub Sync] Tick error:", err),
      );
      githubSyncTimer = setInterval(() => {
        githubSyncTick().catch((err) =>
          console.error("[GitHub Sync] Tick error:", err),
        );
      }, GITHUB_SYNC_INTERVAL_MS);
    },
    10 * 60 * 1000,
  );
}

export function stopScheduler(): void {
  if (durableSchedulerWorkerAbortController) {
    durableSchedulerWorkerAbortController.abort();
    durableSchedulerWorkerAbortController = null;
  }
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
    console.log("[Scheduler] Stopped");
  }
  if (githubSyncTimer) {
    clearInterval(githubSyncTimer);
    githubSyncTimer = null;
  }
}
