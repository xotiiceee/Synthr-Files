import crypto from "node:crypto";
import fs from "node:fs";
import { afterAll, describe, expect, it } from "vitest";

import { cleanupSqliteFiles, createTempHostedDbPath } from "./temp-db.js";

const dbPath = createTempHostedDbPath("pulse-tenant-context-isolation");
process.env.HOSTED_DB_PATH = dbPath;
process.env.TENANT_ENCRYPTION_KEY ||= crypto.randomBytes(32).toString("hex");

const {
  getContext,
  getContextAgentId,
  getContextConfigPath,
  getContextDataDir,
  getContextSecret,
  runInContext,
} = await import("../../hosted/context.js");
const { createTenant } = await import("../../hosted/db.js");
const {
  ensureHostedBrandRuntimeContext,
  setHostedSelectedRuntimeAgentId,
} = await import("../../hosted/brand-runtime-context.js");
const {
  getTenantConfigPath,
  getTenantDir,
  initTenantConfig,
  storeTenantXKeys,
  withTenantContext,
} = await import("../../hosted/tenant.js");
const { getConfigPath } = await import("../../src/core/persona.js");
const { getDataDir, loadState, saveState } =
  await import("../../src/core/state.js");
const {
  currentRuntimeAgentId,
  loadRuntimeAgentState,
  saveRuntimeAgentState,
} = await import("../../src/core/runtime-agent-state.js");

const originalDataDir = getDataDir();
const originalConfigPath = getConfigPath();
const createdTenantDirs = new Set<string>();

function createTenantFixture(label: string) {
  const tenant = createTenant(
    `cn-${label}-${crypto.randomUUID()}`,
    `claw-${label}-${crypto.randomUUID()}`,
    `${label}-${crypto.randomUUID()}@example.test`,
    label,
  );
  initTenantConfig(tenant.id, { brandName: `${label} brand` });
  storeTenantXKeys(tenant.id, {
    apiKey: `${label}-api-key`,
    apiSecret: `${label}-api-secret`,
    accessToken: `${label}-access-token`,
    accessTokenSecret: `${label}-access-token-secret`,
  });
  createdTenantDirs.add(getTenantDir(tenant.id));
  return tenant;
}

afterAll(() => {
  for (const dir of createdTenantDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  cleanupSqliteFiles(dbPath);
});

describe("tenant context isolation", () => {
  it("isolates secrets and sequential JSON state by tenant context", async () => {
    const tenantA = createTenantFixture("tenant-a");
    const tenantB = createTenantFixture("tenant-b");

    const resultA = await withTenantContext(tenantA.id, async () => {
      expect(getContext()).toMatchObject({
        tenantId: tenantA.id,
        dataDir: getTenantDir(tenantA.id),
        configPath: getTenantConfigPath(tenantA.id),
      });
      expect(getContextDataDir()).toBe(getTenantDir(tenantA.id));
      expect(getContextConfigPath()).toBe(getTenantConfigPath(tenantA.id));
      expect(getContextSecret("X_API_KEY")).toBe("tenant-a-api-key");
      expect(getContextSecret("X_ACCESS_TOKEN")).toBe("tenant-a-access-token");

      saveState("tenant-isolation-check", { tenant: tenantA.id, value: "A" });
      return loadState("tenant-isolation-check", null);
    });

    const resultB = await withTenantContext(tenantB.id, async () => {
      expect(getContext()).toMatchObject({
        tenantId: tenantB.id,
        dataDir: getTenantDir(tenantB.id),
        configPath: getTenantConfigPath(tenantB.id),
      });
      expect(getContextSecret("X_API_KEY")).toBe("tenant-b-api-key");
      expect(loadState("tenant-isolation-check", null)).toBeNull();

      saveState("tenant-isolation-check", { tenant: tenantB.id, value: "B" });
      return loadState("tenant-isolation-check", null);
    });

    const secondReadA = await withTenantContext(tenantA.id, async () =>
      loadState("tenant-isolation-check", null),
    );

    expect(resultA).toEqual({ tenant: tenantA.id, value: "A" });
    expect(resultB).toEqual({ tenant: tenantB.id, value: "B" });
    expect(secondReadA).toEqual({ tenant: tenantA.id, value: "A" });
    expect(getContext()).toBeUndefined();
    expect(getDataDir()).toBe(originalDataDir);
    expect(getConfigPath()).toBe(originalConfigPath);
  });

  it("keeps async-local secrets, paths, and JSON state isolated across overlapping tenant contexts", async () => {
    const tenantA = createTenantFixture("overlap-a");
    const tenantB = createTenantFixture("overlap-b");
    const steps: string[] = [];
    let releaseA = () => {};
    let releaseB = () => {};
    const waitA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    const waitB = new Promise<void>((resolve) => {
      releaseB = resolve;
    });

    const runA = withTenantContext(tenantA.id, async () => {
      steps.push(`a:${getContextSecret("X_API_KEY")}`);
      expect(getContextDataDir()).toBe(getTenantDir(tenantA.id));
      releaseA();
      await waitB;
      expect(getContextSecret("X_API_KEY")).toBe("overlap-a-api-key");
      expect(getContextConfigPath()).toBe(getTenantConfigPath(tenantA.id));
      expect(getDataDir()).toBe(getTenantDir(tenantA.id));
      saveState("overlap-state", { tenant: tenantA.id, value: "A" });
      expect(loadState("overlap-state", null)).toEqual({
        tenant: tenantA.id,
        value: "A",
      });
    });

    const runB = withTenantContext(tenantB.id, async () => {
      await waitA;
      steps.push(`b:${getContextSecret("X_API_KEY")}`);
      expect(getContextDataDir()).toBe(getTenantDir(tenantB.id));
      releaseB();
      expect(getContextSecret("X_API_KEY")).toBe("overlap-b-api-key");
      expect(getContextConfigPath()).toBe(getTenantConfigPath(tenantB.id));
      expect(getDataDir()).toBe(getTenantDir(tenantB.id));
      saveState("overlap-state", { tenant: tenantB.id, value: "B" });
      expect(loadState("overlap-state", null)).toEqual({
        tenant: tenantB.id,
        value: "B",
      });
    });

    await Promise.all([runA, runB]);

    expect(steps).toEqual(["a:overlap-a-api-key", "b:overlap-b-api-key"]);
    expect(getContext()).toBeUndefined();
    await withTenantContext(tenantA.id, async () => {
      expect(loadState("overlap-state", null)).toEqual({
        tenant: tenantA.id,
        value: "A",
      });
    });
    await withTenantContext(tenantB.id, async () => {
      expect(loadState("overlap-state", null)).toEqual({
        tenant: tenantB.id,
        value: "B",
      });
    });
  });

  it("uses selected async-local agent id for agent-scoped state", async () => {
    const tenant = createTenantFixture("agent-context");

    await withTenantContext(tenant.id, async () => {
      const context = getContext()!;
      await runInContext(
        { ...context, selectedAgentId: "agent_context" },
        async () => {
          expect(getContextAgentId()).toBe("agent_context");
          expect(currentRuntimeAgentId()).toBe("agent_context");
          saveRuntimeAgentState("agent-context-check", { scoped: true });
          expect(loadRuntimeAgentState("agent-context-check", null)).toEqual({
            scoped: true,
          });
        },
      );

      expect(
        loadState("agent-context-check-agent_context", null),
      ).toEqual({ scoped: true });
    });
  });

  it("hydrates selected agent id from SQL runtime context for hosted requests", async () => {
    const tenant = createTenantFixture("selected-agent");
    const context = ensureHostedBrandRuntimeContext({
      tenantId: tenant.id,
      legacyAgentId: "agent_selected_context",
      brandName: "Selected Agent Brand",
    });
    setHostedSelectedRuntimeAgentId({
      tenantId: tenant.id,
      agentId: context.legacyAgentId,
    });

    await withTenantContext(tenant.id, async () => {
      expect(getContextAgentId()).toBe("agent_selected_context");
      expect(currentRuntimeAgentId()).toBe("agent_selected_context");
    });
  });
});
