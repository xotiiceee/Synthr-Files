/**
 * Simple cron-like scheduler for PULSE.
 * Coordinates outreach, content, monitoring, and adaptation on schedule.
 * Designed for single-run cron invocation (not a long-running daemon).
 */

import { getConfig } from "./persona.js";
import type { PulseConfig } from "./persona.js";
import { loadState, saveState, getTodayKey } from "./state.js";

export type TaskType =
  | "outreach"
  | "content"
  | "monitor"
  | "adaptation"
  | "discovery"
  | "follow"
  | "unfollow";

export interface SchedulerTimeWindow {
  start: string;
  end: string;
}

export interface SchedulerQuietHoursDecision {
  allowed: boolean;
  reason:
    | "inside_active_window"
    | "outside_active_window"
    | "no_active_windows";
  timezone: string;
  localTime: string;
  activeWindows: SchedulerTimeWindow[];
}

interface ScheduleState {
  lastRun: Record<TaskType, string>; // ISO timestamps
}

const DEFAULT_SCHEDULE: ScheduleState = {
  lastRun: {
    outreach: "",
    content: "",
    monitor: "",
    adaptation: "",
    discovery: "",
    follow: "",
    unfollow: "",
  },
};

let _getContext: (() => { tenantId: string } | undefined) | null = null;
let _runtimeScheduleState:
  | typeof import("../../hosted/repositories/runtime-schedule-state.js").runtimeScheduleStateRepository
  | null = null;
try {
  const ctx = await import("../../hosted/context.js");
  _getContext = ctx.getContext;
  const scheduleState =
    await import("../../hosted/repositories/runtime-schedule-state.js");
  _runtimeScheduleState = scheduleState.runtimeScheduleStateRepository;
} catch {
  /* self-hosted mode — hosted repository not available */
}

function getHostedTenantId(): string | undefined {
  return _getContext?.()?.tenantId;
}

function getLastRun(task: TaskType): string {
  const tenantId = getHostedTenantId();
  if (tenantId && _runtimeScheduleState) {
    return _runtimeScheduleState.getLastRun({ tenantId, taskType: task });
  }
  return loadState<ScheduleState>("schedule", DEFAULT_SCHEDULE).lastRun[task];
}

function normalizeTimezone(timezone?: string | null): string {
  const candidate = timezone?.trim();
  if (!candidate) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(
      new Date(),
    );
    return candidate;
  } catch {
    return "UTC";
  }
}

function parseClockValue(value: string): number | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function normalizeActiveWindows(
  config?: Pick<PulseConfig, "autopilot" | "humanBehavior">,
): SchedulerTimeWindow[] {
  const humanBehaviorWindows =
    config?.humanBehavior?.timing?.activeWindows
      ?.map((window) => ({
        start: window.start.trim(),
        end: window.end.trim(),
      }))
      .filter(
        (window) =>
          parseClockValue(window.start) !== null &&
          parseClockValue(window.end) !== null,
      ) ?? [];

  if (humanBehaviorWindows.length > 0) return humanBehaviorWindows;

  const autopilotWindow = config?.autopilot?.activeHours;
  if (
    autopilotWindow &&
    parseClockValue(autopilotWindow.start) !== null &&
    parseClockValue(autopilotWindow.end) !== null
  ) {
    return [
      {
        start: autopilotWindow.start.trim(),
        end: autopilotWindow.end.trim(),
      },
    ];
  }

  return [];
}

function getLocalClockParts(
  now: Date,
  timezone: string,
): {
  hours: number;
  minutes: number;
} {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(
    parts.find((part) => part.type === "minute")?.value ?? "0",
  );
  return { hours: hour, minutes: minute };
}

function isMinuteInWindow(
  localMinuteOfDay: number,
  window: SchedulerTimeWindow,
): boolean {
  const start = parseClockValue(window.start);
  const end = parseClockValue(window.end);
  if (start === null || end === null) return false;
  if (start === end) return true;
  if (start < end) {
    return localMinuteOfDay >= start && localMinuteOfDay < end;
  }
  return localMinuteOfDay >= start || localMinuteOfDay < end;
}

export function getSchedulerQuietHoursDecision(input?: {
  now?: Date | string;
  config?: Pick<PulseConfig, "autopilot" | "humanBehavior">;
  timezone?: string | null;
}): SchedulerQuietHoursDecision {
  const config = input?.config;
  const timezone = normalizeTimezone(
    input?.timezone ?? config?.humanBehavior?.timing?.timezone ?? null,
  );
  const activeWindows = normalizeActiveWindows(config);
  const now =
    input?.now instanceof Date
      ? input.now
      : new Date(input?.now ?? new Date().toISOString());
  const localClock = getLocalClockParts(now, timezone);
  const localMinuteOfDay = localClock.hours * 60 + localClock.minutes;
  const localTime = `${String(localClock.hours).padStart(2, "0")}:${String(localClock.minutes).padStart(2, "0")}`;

  if (activeWindows.length === 0) {
    return {
      allowed: true,
      reason: "no_active_windows",
      timezone,
      localTime,
      activeWindows,
    };
  }

  const allowed = activeWindows.some((window) =>
    isMinuteInWindow(localMinuteOfDay, window),
  );

  return {
    allowed,
    reason: allowed ? "inside_active_window" : "outside_active_window",
    timezone,
    localTime,
    activeWindows,
  };
}

/**
 * Check if a task is due based on its interval.
 */
export function isTaskDue(task: TaskType): boolean {
  const config = getConfig();
  const lastRun = getLastRun(task);

  if (!lastRun) return true; // Never run before

  const elapsed = Date.now() - new Date(lastRun).getTime();

  switch (task) {
    case "outreach":
      return elapsed >= config.schedule.outreachIntervalHours * 3600_000;
    case "content":
      // Content runs once per day
      return getTodayKey() !== lastRun.slice(0, 10);
    case "monitor":
      // Monitor runs every 6 hours
      return elapsed >= 6 * 3600_000;
    case "adaptation":
      return elapsed >= config.schedule.adaptationIntervalDays * 86400_000;
    case "discovery":
      return elapsed >= config.schedule.outreachIntervalHours * 3600_000;
    default:
      return false;
  }
}

/**
 * Mark a task as just completed.
 */
export function markTaskComplete(task: TaskType): void {
  const tenantId = getHostedTenantId();
  if (tenantId && _runtimeScheduleState) {
    _runtimeScheduleState.markTaskComplete({ tenantId, taskType: task });
    return;
  }

  const state = loadState<ScheduleState>("schedule", DEFAULT_SCHEDULE);
  state.lastRun[task] = new Date().toISOString();
  saveState("schedule", state);
}

/**
 * Get all tasks that are currently due.
 */
export function getDueTasks(): TaskType[] {
  const tasks: TaskType[] = [
    "discovery",
    "outreach",
    "content",
    "monitor",
    "adaptation",
  ];
  return tasks.filter(isTaskDue);
}
