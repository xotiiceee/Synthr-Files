import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createJobRepository } from "../../hosted/jobs.js";
import { cleanupSqliteFiles, createTempHostedDbPath } from "./temp-db.js";

const mocks = vi.hoisted(() => ({
  getDueTasks: vi.fn<() => string[]>(() => []),
  markTaskComplete: vi.fn(),
  getFollowStats: vi.fn(() => ({ today: 1, month: 3, monthLimit: 300 })),
  runUnfollowCron: vi.fn(async () => ({ unfollowed: 1 })),
  runMonitor: vi.fn(async () => ({
    mentions: [],
    competitorMentions: [],
    alerts: [],
  })),
  runOutreach: vi.fn(async () => ({ repliedCount: 2 })),
  runAutopost: vi.fn(async () => ({
    generated: 1,
    queued: 1,
    published: 0,
    category: "x automation",
    platform: "x",
    entryId: "entry_1",
  })),
  discoverOpportunities: vi.fn(async () => [{ id: "opp_1" }, { id: "opp_2" }]),
  runAdaptation: vi.fn(async () => undefined),
  getConfig: vi.fn(() => ({
    autopost: { approvalMode: "review_all" },
    autopilot: { mode: "off" },
  })),
  getHostedAutopilotWriteDecision: vi.fn(() => ({
    allowed: false,
    reasons: ["autopilot_write_not_enabled:off"],
    mode: "off",
    fullAutoEnabled: false,
    safety: { allowed: true, reasons: [] },
  })),
  isAccountAllowed: vi.fn(() => ({ allowed: true, reasons: [] })),
  ensureTopicsExist: vi.fn(async () => undefined),
  detectMentions: vi.fn(async () => undefined),
  processPendingMentions: vi.fn(async () => []),
  markMentionReplied: vi.fn(),
  xReply: vi.fn(async () => ({ ok: true })),
  checkEngagement: vi.fn(async () => ({
    checked: 0,
    updated: 0,
    highPerformers: 0,
  })),
  loadState: vi.fn(() => ({})),
  recordUsageEvent: vi.fn((event: { idempotencyKey: string }) => ({
    id: "use_test",
    idempotency_key: event.idempotencyKey,
  })),
}));

vi.mock("../../hosted/db.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../hosted/db.js")>()),
  listTenants: vi.fn(() => []),
  incrementUsage: vi.fn(),
  recordUsageEvent: mocks.recordUsageEvent,
}));

vi.mock("../../hosted/tenant.js", () => ({
  withTenantContext: vi.fn(
    async (_tenantId: string, fn: () => Promise<unknown>) => fn(),
  ),
  hasTenantXKeys: vi.fn(() => true),
}));

vi.mock("../../hosted/limits.js", () => ({
  checkLimit: vi.fn(() => ({ allowed: true })),
}));

vi.mock("../../src/core/scheduler.js", () => ({
  getDueTasks: mocks.getDueTasks,
  markTaskComplete: mocks.markTaskComplete,
  getSchedulerQuietHoursDecision: vi.fn(
    (input?: {
      now?: Date | string;
      config?: {
        humanBehavior?: {
          timing?: {
            timezone?: string;
            activeWindows?: Array<{ start: string; end: string }>;
          };
        };
        autopilot?: {
          activeHours?: { start: string; end: string };
        };
      };
      timezone?: string | null;
    }) => {
      const timezone =
        input?.timezone ??
        input?.config?.humanBehavior?.timing?.timezone ??
        "UTC";
      const activeWindows =
        input?.config?.humanBehavior?.timing?.activeWindows ??
        (input?.config?.autopilot?.activeHours
          ? [input.config.autopilot.activeHours]
          : []);
      const date =
        input?.now instanceof Date
          ? input.now
          : new Date(input?.now ?? "2026-05-26T12:00:00.000Z");
      const formatter = new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone === "Mars/Olympus" ? "UTC" : timezone,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      const [hour, minute] = formatter.format(date).split(":").map(Number);
      const localMinutes = hour * 60 + minute;
      const allowed =
        activeWindows.length === 0 ||
        activeWindows.some((window) => {
          const [startHour, startMinute] = window.start.split(":").map(Number);
          const [endHour, endMinute] = window.end.split(":").map(Number);
          const start = startHour * 60 + startMinute;
          const end = endHour * 60 + endMinute;
          if (start === end) return true;
          if (start < end) return localMinutes >= start && localMinutes < end;
          return localMinutes >= start || localMinutes < end;
        });

      return {
        allowed,
        reason:
          activeWindows.length === 0
            ? "no_active_windows"
            : allowed
              ? "inside_active_window"
              : "outside_active_window",
        timezone: timezone === "Mars/Olympus" ? "UTC" : timezone,
        localTime: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
        activeWindows,
      };
    },
  ),
}));

vi.mock("../../src/core/persona.js", () => ({
  getConfig: mocks.getConfig,
}));

vi.mock("../../hosted/account-safety.js", () => ({
  getHostedAutopilotWriteDecision: mocks.getHostedAutopilotWriteDecision,
  isAccountAllowed: mocks.isAccountAllowed,
}));

vi.mock("../../src/platforms/x-follow.js", () => ({
  getFollowStats: mocks.getFollowStats,
}));

vi.mock("../../src/core/unfollow-cron.js", () => ({
  runUnfollowCron: mocks.runUnfollowCron,
}));

vi.mock("../../src/modes/monitor.js", () => ({
  runMonitor: mocks.runMonitor,
}));

vi.mock("../../src/modes/outreach.js", () => ({
  runOutreach: mocks.runOutreach,
}));

vi.mock("../../src/modes/autopost.js", () => ({
  runAutopost: mocks.runAutopost,
}));

vi.mock("../../src/core/opportunity-engine.js", () => ({
  discoverOpportunities: mocks.discoverOpportunities,
}));

vi.mock("../../src/intelligence/adaptation.js", () => ({
  runAdaptation: mocks.runAdaptation,
}));

vi.mock("../../src/intelligence/topic-discovery.js", () => ({
  ensureTopicsExist: mocks.ensureTopicsExist,
}));

vi.mock("../../src/intelligence/mention-detector.js", () => ({
  detectMentions: mocks.detectMentions,
  processPendingMentions: mocks.processPendingMentions,
  markMentionReplied: mocks.markMentionReplied,
}));

vi.mock("../../src/platforms/x-write-client.js", () => ({
  getXWriteClient: vi.fn(() => ({
    reply: mocks.xReply,
  })),
  withXWriteUsage: vi.fn((value, usage) => ({
    ...value,
    metadata: {
      ...(value.metadata ?? {}),
      __pulseUsageEvent: usage,
    },
  })),
}));

vi.mock("../../src/intelligence/engagement-monitor.js", () => ({
  checkEngagement: mocks.checkEngagement,
}));

vi.mock("../../src/core/state.js", () => ({
  loadState: mocks.loadState,
}));

vi.mock("../../src/intelligence/github-context.js", () => ({
  buildGitHubContextBlock: vi.fn(async () => ""),
}));

const { createDurableSchedulerWorker, runAgentTasks } =
  await import("../../hosted/scheduler.js");
const {
  getHostedSchedulerAutopilotWriteDecision,
  getSchedulerBrandFairnessDecision,
} = await import("../../hosted/scheduler.js");
const {
  DURABLE_SCHEDULER_QUEUE,
  enqueueSchedulerTaskJob,
  getSchedulerTaskJobType,
} = await import("../../hosted/durable-scheduler.js");

const dbs: Database.Database[] = [];
const dbPaths: string[] = [];

const tenant = {
  id: "tn_runtime",
  api_key: "key_runtime",
  clawnet_user_id: "",
  email: "runtime@example.com",
  name: "Runtime",
  plan: "credits" as const,
  status: "active" as const,
  created_at: "2026-05-26T00:00:00.000Z",
  updated_at: "2026-05-26T00:00:00.000Z",
};

beforeEach(() => {
  mocks.getDueTasks.mockReturnValue([]);
  mocks.getConfig.mockReturnValue({
    autopost: { approvalMode: "review_all" },
    autopilot: { mode: "off" },
  });
  mocks.getHostedAutopilotWriteDecision.mockReturnValue({
    allowed: false,
    reasons: ["autopilot_write_not_enabled:off"],
    mode: "off",
    fullAutoEnabled: false,
    safety: { allowed: true, reasons: [] },
  });
  mocks.isAccountAllowed.mockReturnValue({ allowed: true, reasons: [] });
  mocks.processPendingMentions.mockResolvedValue([]);
  mocks.xReply.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.SCHEDULER_MODE;
  delete process.env.PULSE_DURABLE_SCHEDULER_WRITES;

  while (dbs.length > 0) {
    dbs.pop()!.close();
  }
  while (dbPaths.length > 0) {
    cleanupSqliteFiles(dbPaths.pop()!);
  }
});

function createTempRepository() {
  const dbPath = createTempHostedDbPath("pulse-scheduler-runtime");
  dbPaths.push(dbPath);
  const db = new Database(dbPath);
  dbs.push(db);
  return createJobRepository(db);
}

describe("scheduler runtime mode wiring", () => {
  it("keeps legacy monitor execution as the default", async () => {
    mocks.getDueTasks.mockReturnValue(["monitor"]);

    const enqueueSchedulerTaskJob = vi.fn();
    await runAgentTasks(tenant, "agent_runtime", {
      enqueueSchedulerTaskJob: enqueueSchedulerTaskJob as never,
      runAlwaysTasks: false,
    });

    expect(mocks.runMonitor).toHaveBeenCalledTimes(1);
    expect(mocks.markTaskComplete).toHaveBeenCalledWith("monitor");
    expect(enqueueSchedulerTaskJob).not.toHaveBeenCalled();
  });

  it("enqueues monitor jobs instead of running monitor in durable mode", async () => {
    mocks.getDueTasks.mockReturnValue(["monitor"]);

    const runAt = new Date("2026-05-26T12:34:56.000Z");
    const enqueueSchedulerTaskJob = vi.fn(() => ({ id: "job_monitor" }));
    await runAgentTasks(tenant, "agent_runtime", {
      mode: "durable",
      enqueueSchedulerTaskJob: enqueueSchedulerTaskJob as never,
      now: () => runAt,
      runAlwaysTasks: false,
    });

    expect(enqueueSchedulerTaskJob).toHaveBeenCalledWith({
      tenantId: "tn_runtime",
      agentId: "agent_runtime",
      task: "monitor",
      runAt,
    });
    expect(mocks.runMonitor).not.toHaveBeenCalled();
    expect(mocks.markTaskComplete).not.toHaveBeenCalled();
  });

  it("keeps content and outreach on the legacy path in durable mode and meters them there", async () => {
    mocks.getDueTasks.mockReturnValue(["outreach", "content"]);

    const enqueueSchedulerTaskJob = vi.fn(() => ({ id: "job_unexpected" }));
    await runAgentTasks(tenant, "agent_runtime", {
      mode: "durable",
      enqueueSchedulerTaskJob: enqueueSchedulerTaskJob as never,
      now: () => new Date("2026-05-26T12:15:00.000Z"),
      runAlwaysTasks: false,
    });

    expect(enqueueSchedulerTaskJob).not.toHaveBeenCalled();
    expect(mocks.runOutreach).toHaveBeenCalledTimes(1);
    expect(mocks.runOutreach).toHaveBeenCalledWith({
      dryRun: false,
      xWriteOperationIdPrefix:
        "scheduler:tn_runtime:agent_runtime:outreach:2026-05-26T12:15:00.000Z",
    });
    expect(mocks.runAutopost).toHaveBeenCalledTimes(1);
    expect(mocks.runAutopost).toHaveBeenCalledWith({
      githubContextBlock: undefined,
      xWriteOperationIdPrefix:
        "scheduler:tn_runtime:agent_runtime:content:2026-05-26T12:15:00.000Z",
    });
    expect(mocks.recordUsageEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey:
          "scheduler-usage:legacy:tn_runtime:agent_runtime:outreach:2026-05-26T12:15:00.000Z",
        eventType: "scheduler.outreach.completed",
      }),
    );
    expect(mocks.recordUsageEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey:
          "scheduler-usage:legacy:tn_runtime:agent_runtime:content:2026-05-26T12:15:00.000Z",
        eventType: "scheduler.content.completed",
      }),
    );
    expect(mocks.markTaskComplete).toHaveBeenCalledWith("outreach");
    expect(mocks.markTaskComplete).toHaveBeenCalledWith("content");
  });

  it("enqueues content and outreach in durable mode when durable scheduler writes are enabled", async () => {
    process.env.PULSE_DURABLE_SCHEDULER_WRITES = "true";
    mocks.getDueTasks.mockReturnValue(["outreach", "content"]);

    const runAt = new Date("2026-05-26T12:15:00.000Z");
    const enqueueSchedulerTaskJob = vi.fn((input: { task: string }) => ({
      id: `job_${input.task}`,
    }));
    await runAgentTasks(tenant, "agent_runtime", {
      mode: "durable",
      enqueueSchedulerTaskJob: enqueueSchedulerTaskJob as never,
      now: () => runAt,
      runAlwaysTasks: false,
    });

    expect(enqueueSchedulerTaskJob).toHaveBeenCalledWith({
      tenantId: "tn_runtime",
      agentId: "agent_runtime",
      task: "outreach",
      runAt,
    });
    expect(enqueueSchedulerTaskJob).toHaveBeenCalledWith({
      tenantId: "tn_runtime",
      agentId: "agent_runtime",
      task: "content",
      runAt,
    });
    expect(mocks.runOutreach).not.toHaveBeenCalled();
    expect(mocks.runAutopost).not.toHaveBeenCalled();
    expect(mocks.markTaskComplete).not.toHaveBeenCalledWith("outreach");
    expect(mocks.markTaskComplete).not.toHaveBeenCalledWith("content");
  });

  it("rolls monitor back to direct legacy execution when mode is legacy", async () => {
    mocks.getDueTasks.mockReturnValue(["monitor"]);

    const enqueueSchedulerTaskJob = vi.fn(() => ({ id: "job_monitor" }));
    await runAgentTasks(tenant, "agent_runtime", {
      mode: "legacy",
      enqueueSchedulerTaskJob: enqueueSchedulerTaskJob as never,
      runAlwaysTasks: false,
    });

    expect(mocks.runMonitor).toHaveBeenCalledTimes(1);
    expect(mocks.markTaskComplete).toHaveBeenCalledWith("monitor");
    expect(enqueueSchedulerTaskJob).not.toHaveBeenCalled();
  });

  it("meters successful legacy scheduler work with stable task idempotency", async () => {
    mocks.getDueTasks.mockReturnValue([
      "outreach",
      "content",
      "discovery",
      "adaptation",
    ]);

    await runAgentTasks(tenant, "agent_runtime", {
      now: () => new Date("2026-05-26T12:00:00.000Z"),
      runAlwaysTasks: false,
    });

    expect(mocks.recordUsageEvent).toHaveBeenCalledTimes(4);
    expect(mocks.recordUsageEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tn_runtime",
        agentId: "agent_runtime",
        idempotencyKey:
          "scheduler-usage:legacy:tn_runtime:agent_runtime:outreach:2026-05-26T12:00:00.000Z",
        source: "scheduler",
        eventType: "scheduler.outreach.completed",
        quantity: 1,
        unit: "task",
        metadata: {
          task: "outreach",
          runAtBucket: "2026-05-26T12:00:00.000Z",
          repliedCount: 2,
        },
      }),
    );
    expect(mocks.recordUsageEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey:
          "scheduler-usage:legacy:tn_runtime:agent_runtime:content:2026-05-26T12:00:00.000Z",
        eventType: "scheduler.content.completed",
        quantity: 1,
        metadata: expect.objectContaining({
          task: "content",
          queued: 1,
          published: 0,
        }),
      }),
    );
    expect(mocks.markTaskComplete).toHaveBeenCalledWith("outreach");
    expect(mocks.markTaskComplete).toHaveBeenCalledWith("content");
    expect(mocks.markTaskComplete).toHaveBeenCalledWith("discovery");
    expect(mocks.markTaskComplete).toHaveBeenCalledWith("adaptation");
  });

  it("blocks scheduled auto-publish content unless hosted write policy allows it", async () => {
    mocks.getDueTasks.mockReturnValue(["content"]);
    mocks.getConfig.mockReturnValue({
      autopost: { approvalMode: "auto_all" },
      autopilot: { mode: "semi" },
    });

    await runAgentTasks(tenant, "agent_runtime", {
      now: () => new Date("2026-05-26T12:05:00.000Z"),
      runAlwaysTasks: false,
    });

    expect(mocks.getHostedAutopilotWriteDecision).toHaveBeenCalledWith({
      brandId: "tn_runtime",
      accountId: "tn_runtime",
      config: {
        autopost: { approvalMode: "auto_all" },
        autopilot: { mode: "semi" },
      },
    });
    expect(mocks.runAutopost).not.toHaveBeenCalled();
    expect(mocks.recordUsageEvent).not.toHaveBeenCalled();
    expect(mocks.markTaskComplete).toHaveBeenCalledWith("content");
  });

  it("treats autopilot safety pauses as a hard stop for scheduled auto-publish content", async () => {
    mocks.getDueTasks.mockReturnValue(["content"]);
    mocks.getConfig.mockReturnValue({
      autopost: { approvalMode: "auto_all" },
      autopilot: { mode: "full" },
    });
    mocks.getHostedAutopilotWriteDecision.mockReturnValue({
      allowed: false,
      reasons: [
        "brand:autopilot_pause:automatic pause after x_write_post circuit breaker",
      ],
      mode: "full",
      fullAutoEnabled: true,
      safety: {
        allowed: false,
        reasons: [
          "brand:autopilot_pause:automatic pause after x_write_post circuit breaker",
        ],
      },
    });

    await runAgentTasks(tenant, "agent_runtime", {
      now: () => new Date("2026-05-26T12:06:00.000Z"),
      runAlwaysTasks: false,
    });

    expect(mocks.runAutopost).not.toHaveBeenCalled();
    expect(mocks.recordUsageEvent).not.toHaveBeenCalled();
    expect(mocks.markTaskComplete).toHaveBeenCalledWith("content");
  });

  it("blocks scheduled auto-publish content during quiet hours when WS-L guards are enabled", async () => {
    mocks.getDueTasks.mockReturnValue(["content"]);
    mocks.getConfig.mockReturnValue({
      autopost: { approvalMode: "auto_all" },
      autopilot: { mode: "full" },
      humanBehavior: {
        timing: {
          timezone: "America/New_York",
          activeWindows: [{ start: "09:00", end: "17:00" }],
        },
      },
    });
    mocks.getHostedAutopilotWriteDecision.mockReturnValue({
      allowed: true,
      reasons: [],
      mode: "full",
      fullAutoEnabled: true,
      safety: { allowed: true, reasons: [] },
    });

    await runAgentTasks(tenant, "agent_runtime", {
      now: () => new Date("2026-05-26T12:00:00.000Z"),
      runAlwaysTasks: false,
      schedulerWriteGuardsEnabled: true,
    });

    expect(mocks.runAutopost).not.toHaveBeenCalled();
    expect(mocks.recordUsageEvent).not.toHaveBeenCalled();
    expect(mocks.markTaskComplete).toHaveBeenCalledWith("content");
  });

  it("rotates brand eligibility deterministically when fairness quota is smaller than the candidate set", () => {
    const candidates = [
      { brandId: "brand-a" },
      { brandId: "brand-b" },
      { brandId: "brand-c" },
    ];

    const first = getSchedulerBrandFairnessDecision({
      brandId: "brand-c",
      candidates,
      maxBrandsPerTick: 2,
      runAt: "2026-05-26T12:00:00.000Z",
    });
    const second = getSchedulerBrandFairnessDecision({
      brandId: "brand-c",
      candidates,
      maxBrandsPerTick: 2,
      runAt: "2026-05-26T12:05:00.000Z",
    });

    expect(first).toMatchObject({
      allowed: false,
      selectedBrandIds: ["brand-a", "brand-b"],
      deferredBrandIds: ["brand-c"],
      rotationOffset: 0,
      reason: "deferred",
    });
    expect(second).toMatchObject({
      allowed: true,
      selectedBrandIds: ["brand-b", "brand-c"],
      deferredBrandIds: ["brand-a"],
      rotationOffset: 1,
      reason: "selected",
    });
  });

  it("combines quiet-hours and fairness helper decisions for scheduler auto-write gating", () => {
    mocks.getHostedAutopilotWriteDecision.mockReturnValue({
      allowed: true,
      reasons: [],
      mode: "full",
      fullAutoEnabled: true,
      safety: { allowed: true, reasons: [] },
    });

    const decision = getHostedSchedulerAutopilotWriteDecision({
      brandId: "brand-c",
      accountId: "account-c",
      now: "2026-05-26T12:00:00.000Z",
      config: {
        autopost: { approvalMode: "auto_all" },
        autopilot: { mode: "full" },
        humanBehavior: {
          timing: {
            timezone: "America/New_York",
            activeWindows: [{ start: "09:00", end: "17:00" }],
          },
        },
      },
      fairness: getSchedulerBrandFairnessDecision({
        brandId: "brand-c",
        candidates: [
          { brandId: "brand-a" },
          { brandId: "brand-b" },
          { brandId: "brand-c" },
        ],
        maxBrandsPerTick: 2,
        runAt: "2026-05-26T12:00:00.000Z",
      }),
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toEqual([
      "scheduler_quiet_hours:America/New_York:08:00",
      "scheduler_brand_fairness:2026-05-26T12:00:00.000Z:0",
    ]);
  });

  it("does not post scheduler mention replies when account safety blocks writes", async () => {
    mocks.getDueTasks.mockReturnValue([]);
    mocks.getHostedAutopilotWriteDecision.mockReturnValue({
      allowed: true,
      reasons: [],
      mode: "full",
      fullAutoEnabled: true,
      safety: { allowed: true, reasons: [] },
    });
    mocks.processPendingMentions.mockResolvedValue([
      {
        id: "mention_1",
        url: "https://x.test/m/1",
        text: "hello",
        author: "customer",
        detectedAt: "2026-05-26T12:10:00.000Z",
        suggestedReply: "Thanks for the note",
      },
    ]);
    mocks.isAccountAllowed.mockReturnValue({
      allowed: false,
      reasons: ["brand:pause:manual review"],
    });

    await runAgentTasks(tenant, "agent_runtime", {
      now: () => new Date("2026-05-26T12:10:00.000Z"),
    });

    expect(mocks.detectMentions).toHaveBeenCalledTimes(1);
    expect(mocks.processPendingMentions).toHaveBeenCalledTimes(1);
    expect(mocks.xReply).not.toHaveBeenCalled();
    expect(mocks.markMentionReplied).not.toHaveBeenCalled();
  });

  it("does not post scheduler mention replies when autopilot writes are not enabled", async () => {
    mocks.getDueTasks.mockReturnValue([]);
    mocks.getHostedAutopilotWriteDecision.mockReturnValue({
      allowed: false,
      reasons: ["autopilot_write_not_enabled:semi"],
      mode: "semi",
      fullAutoEnabled: false,
      safety: { allowed: true, reasons: [] },
    });
    mocks.processPendingMentions.mockResolvedValue([
      {
        id: "mention_autopilot",
        url: "https://x.test/m/autopilot",
        text: "hello",
        author: "customer",
        detectedAt: "2026-05-26T12:11:00.000Z",
        suggestedReply: "Thanks for the note",
      },
    ]);

    await runAgentTasks(tenant, "agent_runtime", {
      now: () => new Date("2026-05-26T12:11:00.000Z"),
    });

    expect(mocks.detectMentions).toHaveBeenCalledTimes(1);
    expect(mocks.processPendingMentions).toHaveBeenCalledTimes(1);
    expect(mocks.xReply).not.toHaveBeenCalled();
    expect(mocks.markMentionReplied).not.toHaveBeenCalled();
  });

  it("posts scheduler mention replies with stable X write operation ids", async () => {
    mocks.getDueTasks.mockReturnValue([]);
    mocks.getHostedAutopilotWriteDecision.mockReturnValue({
      allowed: true,
      reasons: [],
      mode: "full",
      fullAutoEnabled: true,
      safety: { allowed: true, reasons: [] },
    });
    mocks.processPendingMentions.mockResolvedValue([
      {
        id: "mention_2",
        url: "https://x.test/m/2",
        text: "can you help?",
        author: "customer",
        detectedAt: "2026-05-26T12:12:00.000Z",
        suggestedReply: "Yes, here is the next step",
      },
    ]);

    await runAgentTasks(tenant, "agent_runtime", {
      now: () => new Date("2026-05-26T12:12:00.000Z"),
    });

    expect(mocks.xReply).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "mention_2",
        metadata: {
          __pulseUsageEvent: {
            operationId:
              "scheduler:tn_runtime:agent_runtime:mentions:2026-05-26T12:12:00.000Z:mention_2",
            metadata: {
              source: "scheduler_mentions",
              tenantId: "tn_runtime",
              agentId: "agent_runtime",
              mentionId: "mention_2",
              author: "customer",
            },
          },
        },
      }),
      "Yes, here is the next step",
    );
    expect(mocks.markMentionReplied).toHaveBeenCalledWith("mention_2");
  });

  it("removes follow churn from the hosted scheduler path", async () => {
    mocks.getDueTasks.mockReturnValue(["follow", "unfollow"]);

    await runAgentTasks(tenant, "agent_runtime", {
      runAlwaysTasks: false,
    });

    expect(mocks.getFollowStats).not.toHaveBeenCalled();
    expect(mocks.runUnfollowCron).not.toHaveBeenCalled();
    expect(mocks.markTaskComplete).toHaveBeenCalledWith("follow");
    expect(mocks.markTaskComplete).toHaveBeenCalledWith("unfollow");
  });

  it("processes scheduler queue jobs through the durable worker factory", async () => {
    const repository = createTempRepository();
    const schedulerJob = enqueueSchedulerTaskJob(
      {
        tenantId: "tn_runtime",
        agentId: "agent_runtime",
        task: "monitor",
        runAt: "2026-05-26T18:00:00.000Z",
      },
      repository,
    );
    repository.enqueueJob({
      idempotencyKey: "other-queue:monitor",
      type: getSchedulerTaskJobType("monitor"),
      queue: "other",
      runAt: "2026-05-26T18:00:00.000Z",
    });

    const worker = createDurableSchedulerWorker({
      repository,
      handlers: {
        [getSchedulerTaskJobType("monitor")]: async ({ payload }) => ({
          processedTenant: (payload as { tenantId: string }).tenantId,
        }),
      },
      workerId: "worker_runtime",
    });

    const result = await worker.tick({ now: "2026-05-26T18:00:00.000Z" });

    expect(result.status).toBe("completed");
    expect(result.job.id).toBe(schedulerJob.id);
    expect(repository.getJob(schedulerJob.id)).toMatchObject({
      queue: DURABLE_SCHEDULER_QUEUE,
      status: "completed",
    });
  });
});
