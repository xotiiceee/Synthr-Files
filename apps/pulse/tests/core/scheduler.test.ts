import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  scheduleState: {
    lastRun: {
      outreach: "",
      content: "",
      monitor: "",
      adaptation: "",
      discovery: "",
      follow: "",
      unfollow: "",
    },
  },
  saveState: vi.fn(),
  getTodayKey: vi.fn(() => "2026-05-26"),
  getConfig: vi.fn(() => ({
    schedule: {
      outreachIntervalHours: 3,
      contentPostsPerDay: 3,
      adaptationIntervalDays: 7,
    },
  })),
}));

vi.mock("../../src/core/state.js", () => ({
  loadState: vi.fn(() => mocks.scheduleState),
  saveState: mocks.saveState,
  getTodayKey: mocks.getTodayKey,
}));

vi.mock("../../src/core/persona.js", () => ({
  getConfig: mocks.getConfig,
}));

import {
  getDueTasks,
  getSchedulerQuietHoursDecision,
  isTaskDue,
  markTaskComplete,
} from "../../src/core/scheduler.js";

function resetScheduleState() {
  mocks.scheduleState.lastRun = {
    outreach: "",
    content: "",
    monitor: "",
    adaptation: "",
    discovery: "",
    follow: "",
    unfollow: "",
  };
}

describe("scheduler task due behavior", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-26T12:00:00.000Z"));
    vi.clearAllMocks();
    resetScheduleState();
    mocks.getTodayKey.mockReturnValue("2026-05-26");
  });

  it("treats never-run scheduled tasks as due", () => {
    expect(isTaskDue("discovery")).toBe(true);
    expect(isTaskDue("outreach")).toBe(true);
    expect(isTaskDue("content")).toBe(true);
    expect(isTaskDue("monitor")).toBe(true);
    expect(isTaskDue("adaptation")).toBe(true);
  });

  it("uses outreach interval for outreach and discovery", () => {
    mocks.scheduleState.lastRun.outreach = "2026-05-26T10:00:00.000Z";
    mocks.scheduleState.lastRun.discovery = "2026-05-26T08:59:59.000Z";

    expect(isTaskDue("outreach")).toBe(false);
    expect(isTaskDue("discovery")).toBe(true);
  });

  it("runs content at most once per day based on the date string", () => {
    mocks.scheduleState.lastRun.content = "2026-05-26T00:01:00.000Z";
    expect(isTaskDue("content")).toBe(false);

    mocks.scheduleState.lastRun.content = "2026-05-25T23:59:00.000Z";
    expect(isTaskDue("content")).toBe(true);
  });

  it("uses fixed monitor interval and configured adaptation interval", () => {
    mocks.scheduleState.lastRun.monitor = "2026-05-26T06:00:01.000Z";
    mocks.scheduleState.lastRun.adaptation = "2026-05-20T12:00:00.000Z";

    expect(isTaskDue("monitor")).toBe(false);
    expect(isTaskDue("adaptation")).toBe(false);

    mocks.scheduleState.lastRun.monitor = "2026-05-26T06:00:00.000Z";
    mocks.scheduleState.lastRun.adaptation = "2026-05-19T12:00:00.000Z";

    expect(isTaskDue("monitor")).toBe(true);
    expect(isTaskDue("adaptation")).toBe(true);
  });

  it("treats never-run follow and unfollow tasks as due when checked directly", () => {
    expect(isTaskDue("follow")).toBe(true);
    expect(isTaskDue("unfollow")).toBe(true);

    mocks.scheduleState.lastRun.follow = "2026-05-26T00:00:00.000Z";
    mocks.scheduleState.lastRun.unfollow = "2026-05-26T00:00:00.000Z";

    expect(isTaskDue("follow")).toBe(false);
    expect(isTaskDue("unfollow")).toBe(false);
  });

  it("returns only the five canonical due tasks", () => {
    expect(getDueTasks()).toEqual([
      "discovery",
      "outreach",
      "content",
      "monitor",
      "adaptation",
    ]);
  });

  it("marks a task complete by saving the current timestamp", () => {
    markTaskComplete("content");

    expect(mocks.scheduleState.lastRun.content).toBe(
      "2026-05-26T12:00:00.000Z",
    );
    expect(mocks.saveState).toHaveBeenCalledWith(
      "schedule",
      mocks.scheduleState,
    );
  });

  it("blocks scheduler writes outside configured quiet-hours windows", () => {
    const decision = getSchedulerQuietHoursDecision({
      now: "2026-05-26T12:00:00.000Z",
      config: {
        humanBehavior: {
          timing: {
            timezone: "America/New_York",
            activeWindows: [{ start: "09:00", end: "17:00" }],
          },
        },
      },
    });

    expect(decision).toMatchObject({
      allowed: false,
      reason: "outside_active_window",
      timezone: "America/New_York",
      localTime: "08:00",
      activeWindows: [{ start: "09:00", end: "17:00" }],
    });
  });

  it("falls back to UTC for invalid timezones and allows writes when no windows are configured", () => {
    const decision = getSchedulerQuietHoursDecision({
      now: "2026-05-26T12:00:00.000Z",
      timezone: "Mars/Olympus",
      config: {},
    });

    expect(decision).toMatchObject({
      allowed: true,
      reason: "no_active_windows",
      timezone: "UTC",
      localTime: "12:00",
      activeWindows: [],
    });
  });
});
