import { describe, expect, it } from "vitest";

import { APP_ROUTE_PATHS } from "../../hosted/ui/src/App.tsx";
import {
  buildUiProductionReadiness,
  type UiProductionSurfaceRemote,
  type UiUsageSnapshot,
} from "../../hosted/ui/src/lib/api.ts";

function makeRemote(
  overrides: Partial<UiProductionSurfaceRemote> = {},
): UiProductionSurfaceRemote {
  return {
    checkedAt: "2026-05-26T00:00:00.000Z",
    deployInfo: {
      service: "pulse-hosted",
      spaReady: true,
      deploy: { version: "2026.05.26", deployedAt: "2026-05-26T00:00:00.000Z" },
    },
    health: {
      status: "ok",
      service: "pulse-hosted",
      uptime: 123,
      timestamp: "2026-05-26T00:00:00.000Z",
      spaReady: true,
      deploy: { version: "2026.05.26" },
    },
    githubConnected: true,
    agents: [
      { id: "agent-1", name: "Agent 1", running: true, xConnected: true },
      { id: "agent-2", name: "Agent 2", running: false, xConnected: true },
    ],
    ...overrides,
  };
}

function makeUsage(
  overrides: Partial<UiUsageSnapshot> = {},
): UiUsageSnapshot {
  return {
    authProvider: "firstparty",
    credits: 240,
    spendToday: 18,
    spendMonth: 132,
    projection: {
      avgDailySpend: 21,
      daysRemaining: 11,
      burnRate: "moderate",
    },
    ...overrides,
  };
}

describe("hosted UI production surface", () => {
  it("keeps the expected top-level hosted routes available for smoke coverage", () => {
    expect(APP_ROUTE_PATHS).toEqual([
      "/",
      "/login",
      "/chat-setup",
      "/autopilot",
      "/create",
      "/knowledge",
      "/activity",
      "/growth",
      "/media",
      "/operations",
      "/brand",
      "/settings",
    ]);
  });

  it("reports a healthy production surface when deploy and connections are ready", () => {
    const checks = buildUiProductionReadiness(makeUsage(), makeRemote());

    expect(checks.find((check) => check.key === "credits")).toMatchObject({
      status: "ready",
    });
    expect(checks.find((check) => check.key === "agents")).toMatchObject({
      status: "ready",
    });
    expect(checks.find((check) => check.key === "multi-brand-ui")).toMatchObject({
      status: "ready",
    });
    expect(checks.find((check) => check.key === "deploy")).toMatchObject({
      status: "ready",
    });
    expect(checks.find((check) => check.key === "operations-ui")).toMatchObject({
      status: "ready",
    });
    expect(checks.find((check) => check.key === "client-reporting-ui")).toMatchObject({
      status: "ready",
    });
    expect(checks.find((check) => check.key === "approval-roles-ui")).toMatchObject({
      status: "ready",
    });
  });

  it("fails closed for exhausted credits, unhealthy deploy state, and missing X connections", () => {
    const checks = buildUiProductionReadiness(
      makeUsage({
        authProvider: "clawnet",
        credits: 0,
        projection: {
          avgDailySpend: 50,
          daysRemaining: 1,
          burnRate: "high",
        },
      }),
      makeRemote({
        deployInfo: { service: "pulse-hosted", spaReady: false, deploy: null },
        health: {
          status: "degraded",
          service: "pulse-hosted",
          uptime: 8,
          timestamp: "2026-05-26T00:00:00.000Z",
          spaReady: false,
          deploy: null,
        },
        githubConnected: false,
        agents: [
          { id: "agent-1", name: "Agent 1", running: true, xConnected: false },
        ],
      }),
    );

    expect(checks.find((check) => check.key === "auth-provider")).toMatchObject(
      { status: "info" },
    );
    expect(checks.find((check) => check.key === "credits")).toMatchObject({
      status: "critical",
    });
    expect(checks.find((check) => check.key === "projection")).toMatchObject({
      status: "critical",
    });
    expect(checks.find((check) => check.key === "agents")).toMatchObject({
      status: "critical",
    });
    expect(checks.find((check) => check.key === "multi-brand-ui")).toMatchObject({
      status: "info",
    });
    expect(checks.find((check) => check.key === "deploy")).toMatchObject({
      status: "critical",
    });
  });
});
