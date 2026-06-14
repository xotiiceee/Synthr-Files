import crypto from "node:crypto";
import fs from "node:fs";

import { afterAll, describe, expect, it } from "vitest";

import { cleanupSqliteFiles, createTempHostedDbPath } from "./temp-db.js";

const dbPath = createTempHostedDbPath("pulse-runtime-action-log");
process.env.HOSTED_DB_PATH = dbPath;
process.env.TENANT_ENCRYPTION_KEY ||= crypto.randomBytes(32).toString("hex");

const { createOrg, createTenant, createWorkspace, getHostedDb } =
  await import("../../hosted/db.js");
const { createBrandRepository } =
  await import("../../hosted/repositories/brands.js");
const { createRuntimeActionLogRepository, resolveRuntimeActionLogScope } =
  await import("../../hosted/repositories/runtime-action-log.js");
const { getTenantDir, withTenantContext } =
  await import("../../hosted/tenant.js");
const { saveState, getActions, logAction } =
  await import("../../src/core/state.js");

const brands = createBrandRepository();
const actions = createRuntimeActionLogRepository();
const tenantDirs = new Set<string>();
let legacyActiveAgentId = "";

Object.assign(globalThis, {
  __pulseGetLegacyActiveAgentId: () => legacyActiveAgentId,
});

function createTenantFixture(label: string) {
  const tenant = createTenant(
    `cn-${label}-${crypto.randomUUID()}`,
    `claw-${label}-${crypto.randomUUID()}`,
    `${label}-${crypto.randomUUID()}@example.test`,
    label,
  );
  tenantDirs.add(getTenantDir(tenant.id));
  return tenant;
}

afterAll(() => {
  for (const dir of tenantDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  cleanupSqliteFiles(dbPath);
});

describe("runtime action log repository", () => {
  it("preserves append/list parity, chronological ordering, and bounded reads", () => {
    const tenant = createTenantFixture("runtime-action-log");
    const org = createOrg({
      name: "Runtime Action Log Org",
      legacyTenantId: tenant.id,
    });
    const workspace = createWorkspace(org.id, "Default");
    const brand = brands.createBrand({
      orgId: org.id,
      workspaceId: workspace.id,
      name: "Runtime Action Brand",
      legacyTenantId: tenant.id,
      legacyAgentId: "agent_runtime",
    });
    const scope = {
      tenantId: tenant.id,
      orgId: org.id,
      workspaceId: workspace.id,
      brandId: brand.id,
      agentId: "agent_runtime",
    };

    const inserted = [
      {
        id: "act_sql_2",
        timestamp: "2026-05-26T11:00:00.000Z",
        platform: "x",
        type: "post" as const,
        topicId: "topic_beta",
        content: "Second response",
      },
      {
        id: "act_sql_1",
        timestamp: "2026-05-26T10:00:00.000Z",
        platform: "x",
        type: "reply" as const,
        topicId: "topic_alpha",
        content: "First response",
        targetText: "Original post",
        targetUrl: "https://x.example/post/1",
        theme: "launch",
        engagement: {
          likes: 3,
          replies: 1,
          reposts: 0,
        },
      },
      {
        id: "act_sql_3",
        timestamp: "2026-05-26T12:00:00.000Z",
        platform: "x",
        type: "comment" as const,
        topicId: "topic_gamma",
        content: "Third response",
      },
    ];

    for (const action of inserted) {
      actions.appendAction(scope, action);
    }

    expect(actions.listActions(scope)).toEqual([
      inserted[1],
      inserted[0],
      inserted[2],
    ]);
    expect(
      actions.listActions({
        ...scope,
        limit: 2,
      }),
    ).toEqual([inserted[0], inserted[2]]);
    expect(
      actions.listActions({
        ...scope,
        since: "2026-05-26T10:30:00.000Z",
      }),
    ).toEqual([inserted[0], inserted[2]]);
  });

  it("enforces org, workspace, brand, and agent isolation on reads", () => {
    const tenant = createTenantFixture("runtime-action-log-isolation");
    const firstOrg = createOrg({
      name: "Isolation Org A",
      legacyTenantId: tenant.id,
    });
    const secondOrg = createOrg({ name: "Isolation Org B" });
    const firstWorkspace = createWorkspace(firstOrg.id, "Workspace A");
    const secondWorkspace = createWorkspace(firstOrg.id, "Workspace B");
    const firstBrand = brands.createBrand({
      orgId: firstOrg.id,
      workspaceId: firstWorkspace.id,
      name: "Brand A",
      legacyTenantId: tenant.id,
      legacyAgentId: "agent_a",
    });
    const secondBrand = brands.createBrand({
      orgId: firstOrg.id,
      workspaceId: secondWorkspace.id,
      name: "Brand B",
      legacyTenantId: tenant.id,
      legacyAgentId: "agent_b",
    });
    const thirdBrand = brands.createBrand({
      orgId: secondOrg.id,
      name: "Brand C",
      legacyAgentId: "agent_c",
    });

    const brandAScope = {
      tenantId: tenant.id,
      orgId: firstOrg.id,
      workspaceId: firstWorkspace.id,
      brandId: firstBrand.id,
      agentId: "agent_a",
    };
    const brandAOtherAgentScope = {
      ...brandAScope,
      agentId: "agent_b",
    };
    const brandBScope = {
      tenantId: tenant.id,
      orgId: firstOrg.id,
      workspaceId: secondWorkspace.id,
      brandId: secondBrand.id,
      agentId: "agent_b",
    };
    const brandCScope = {
      tenantId: "",
      orgId: secondOrg.id,
      workspaceId: "",
      brandId: thirdBrand.id,
      agentId: "agent_c",
    };

    actions.appendAction(brandAScope, {
      id: "act_isolation_1",
      timestamp: "2026-05-26T12:00:00.000Z",
      platform: "x",
      type: "reply",
      topicId: "topic_a",
      content: "Brand A / agent A",
    });
    actions.appendAction(brandAOtherAgentScope, {
      id: "act_isolation_2",
      timestamp: "2026-05-26T12:01:00.000Z",
      platform: "x",
      type: "reply",
      topicId: "topic_a_agent_b",
      content: "Brand A / agent B",
    });
    actions.appendAction(brandBScope, {
      id: "act_isolation_3",
      timestamp: "2026-05-26T12:02:00.000Z",
      platform: "x",
      type: "post",
      topicId: "topic_b",
      content: "Brand B / agent B",
    });
    actions.appendAction(brandCScope, {
      id: "act_isolation_4",
      timestamp: "2026-05-26T12:03:00.000Z",
      platform: "x",
      type: "comment",
      topicId: "topic_c",
      content: "Brand C / agent C",
    });

    expect(actions.listActions(brandAScope).map((action) => action.id)).toEqual(
      ["act_isolation_1"],
    );
    expect(
      actions.listActions(brandAOtherAgentScope).map((action) => action.id),
    ).toEqual(["act_isolation_2"]);
    expect(actions.listActions(brandBScope).map((action) => action.id)).toEqual(
      ["act_isolation_3"],
    );
    expect(actions.listActions(brandCScope).map((action) => action.id)).toEqual(
      ["act_isolation_4"],
    );
    expect(
      actions.listActions({
        ...brandAScope,
        workspaceId: secondWorkspace.id,
      }),
    ).toEqual([]);
    expect(
      actions.listActions({
        ...brandAScope,
        orgId: secondOrg.id,
      }),
    ).toEqual([]);
  });

  it("treats tenant_id as an independent read partition during legacy migration", () => {
    const tenantA = createTenantFixture("runtime-action-log-tenant-a");
    const tenantB = createTenantFixture("runtime-action-log-tenant-b");
    const org = createOrg({
      name: "Tenant Partition Org",
      legacyTenantId: tenantA.id,
    });
    const workspace = createWorkspace(org.id, "Tenant Partition Workspace");
    const brand = brands.createBrand({
      orgId: org.id,
      workspaceId: workspace.id,
      name: "Tenant Partition Brand",
      legacyTenantId: tenantA.id,
      legacyAgentId: "agent_partition",
    });

    const baseScope = {
      orgId: org.id,
      workspaceId: workspace.id,
      brandId: brand.id,
      agentId: "agent_partition",
    };
    const tenantAScope = {
      ...baseScope,
      tenantId: tenantA.id,
    };
    const tenantBScope = {
      ...baseScope,
      tenantId: tenantB.id,
    };

    actions.appendAction(tenantAScope, {
      id: "act_tenant_partition_a",
      timestamp: "2026-05-26T13:00:00.000Z",
      platform: "x",
      type: "post",
      topicId: "topic_partition_a",
      content: "Tenant A only",
    });
    actions.appendAction(tenantBScope, {
      id: "act_tenant_partition_b",
      timestamp: "2026-05-26T13:01:00.000Z",
      platform: "x",
      type: "post",
      topicId: "topic_partition_b",
      content: "Tenant B only",
    });

    expect(
      actions.listActions(tenantAScope).map((action) => action.id),
    ).toEqual(["act_tenant_partition_a"]);
    expect(
      actions.listActions(tenantBScope).map((action) => action.id),
    ).toEqual(["act_tenant_partition_b"]);
    expect(
      actions
        .listActions({
          ...baseScope,
          tenantId: "",
        })
        .map((action) => action.id),
    ).toEqual([]);
  });
});

describe("runtime action log state bridge", () => {
  it("dual-writes hosted actions to SQL and reads them back via the hosted scope", async () => {
    const tenant = createTenantFixture("runtime-state-action-log");
    const org = createOrg({
      name: "Runtime State Action Log Org",
      legacyTenantId: tenant.id,
    });
    const workspace = createWorkspace(org.id, "Default");
    const brand = brands.createBrand({
      orgId: org.id,
      workspaceId: workspace.id,
      name: "Runtime State Action Brand",
      legacyTenantId: tenant.id,
      legacyAgentId: "agent_runtime",
    });
    const expected = [
      {
        id: "act_state_1",
        timestamp: "2026-05-26T14:00:00.000Z",
        platform: "x",
        type: "reply" as const,
        topicId: "topic_state_a",
        content: "First hosted state action",
      },
      {
        id: "act_state_2",
        timestamp: "2026-05-26T15:00:00.000Z",
        platform: "x",
        type: "post" as const,
        topicId: "topic_state_b",
        content: "Second hosted state action",
      },
    ];

    await withTenantContext(tenant.id, async () => {
      for (const action of expected) {
        logAction(action);
      }
      expect(getActions()).toEqual(expected);
      expect(getActions("2026-05-26T14:30:00.000Z")).toEqual(expected.slice(1));
    });

    expect(
      actions.listActions({
        tenantId: tenant.id,
        orgId: org.id,
        workspaceId: workspace.id,
        brandId: brand.id,
        agentId: "agent_runtime",
      }),
    ).toEqual(expected);
  });

  it("falls back to JSON when hosted SQL scope is unresolved or empty", async () => {
    const tenant = createTenantFixture("runtime-state-fallback");
    const legacyOnlyActions = [
      {
        id: "act_fallback_1",
        timestamp: "2026-05-26T16:00:00.000Z",
        platform: "x",
        type: "comment" as const,
        topicId: "topic_fallback_a",
        content: "JSON-only action",
      },
    ];

    await withTenantContext(tenant.id, async () => {
      legacyActiveAgentId = "agent_unmapped";
      saveState("actions", legacyOnlyActions);
      expect(
        resolveRuntimeActionLogScope({
          tenantId: tenant.id,
          agentId: "agent_unmapped",
        }),
      ).toBeNull();
      expect(getActions()).toEqual(legacyOnlyActions);
    });
  });

  it("falls back to JSON after dual-write SQL action rows are removed", async () => {
    const tenant = createTenantFixture("runtime-state-rollback");
    const org = createOrg({
      name: "Runtime State Action Rollback Org",
      legacyTenantId: tenant.id,
    });
    const workspace = createWorkspace(org.id, "Default");
    const brand = brands.createBrand({
      orgId: org.id,
      workspaceId: workspace.id,
      name: "Runtime State Action Rollback Brand",
      legacyTenantId: tenant.id,
      legacyAgentId: "agent_rollback",
    });
    const scope = {
      tenantId: tenant.id,
      orgId: org.id,
      workspaceId: workspace.id,
      brandId: brand.id,
      agentId: "agent_rollback",
    };
    const rollbackAction = {
      id: "act_rollback_1",
      timestamp: "2026-05-26T17:00:00.000Z",
      platform: "x",
      type: "reply" as const,
      topicId: "topic_rollback",
      content: "JSON rollback action",
      targetText: "Original target",
      theme: "launch",
      engagement: {
        likes: 1,
        replies: 0,
        reposts: 0,
      },
    };

    await withTenantContext(tenant.id, async () => {
      logAction(rollbackAction);
      expect(actions.listActions(scope)).toEqual([rollbackAction]);

      getHostedDb()
        .prepare(
          `DELETE FROM runtime_action_logs
            WHERE tenant_id = ?
              AND org_id = ?
              AND workspace_id = ?
              AND brand_id = ?
              AND agent_id = ?
              AND id = ?`,
        )
        .run(
          scope.tenantId,
          scope.orgId,
          scope.workspaceId,
          scope.brandId,
          scope.agentId,
          rollbackAction.id,
        );

      expect(getActions()).toEqual([rollbackAction]);
      expect(getActions("2026-05-26T16:30:00.000Z")).toEqual([rollbackAction]);
    });
  });
});
