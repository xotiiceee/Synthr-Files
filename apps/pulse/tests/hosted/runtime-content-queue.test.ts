import crypto from "node:crypto";
import fs from "node:fs";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { cleanupSqliteFiles, createTempHostedDbPath } from "./temp-db.js";

const dbPath = createTempHostedDbPath("pulse-runtime-content-queue");
process.env.HOSTED_DB_PATH = dbPath;

const { closeCRM } = await import("../../src/crm/database.js");
const { createOrg, createTenant, createWorkspace } =
  await import("../../hosted/db.js");
const { createBrandRepository } =
  await import("../../hosted/repositories/brands.js");
const { createRuntimeContentQueueRepository, resolveRuntimeContentQueueScope } =
  await import("../../hosted/repositories/runtime-content-queue.js");
const { getTenantDir, withTenantContext } =
  await import("../../hosted/tenant.js");
const {
  approveItem,
  createQueueItem,
  deleteItem,
  editItem,
  getQueue,
  rescheduleItem,
  skipItem,
} = await import("../../src/intelligence/content-queue.js");

const brands = createBrandRepository();
const repo = createRuntimeContentQueueRepository();
const tenantDirs = new Set<string>();

beforeEach(() => {
  closeCRM();
});

afterAll(() => {
  closeCRM();
  for (const dir of tenantDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  cleanupSqliteFiles(dbPath);
});

function createScope(label: string) {
  const tenant = createTenant(
    `content-${label}-${crypto.randomUUID()}`,
    `claw-content-${label}-${crypto.randomUUID()}`,
    `${label}-${crypto.randomUUID()}@example.test`,
    `Runtime Content ${label}`,
  );
  tenantDirs.add(getTenantDir(tenant.id));
  const org = createOrg({
    name: `Runtime Content Org ${label}`,
    legacyTenantId: tenant.id,
  });
  const workspace = createWorkspace(org.id, "Default");
  const brand = brands.createBrand({
    orgId: org.id,
    workspaceId: workspace.id,
    name: `Runtime Content Brand ${label}`,
    legacyTenantId: tenant.id,
    legacyAgentId: `agent_${label}`,
  });

  return {
    tenantId: tenant.id,
    orgId: org.id,
    workspaceId: workspace.id,
    brandId: brand.id,
    agentId: `agent_${label}`,
  };
}

describe("runtime content queue repository", () => {
  it("stores queue items with scheduled ordering and upsert parity", () => {
    const scope = createScope("repo");

    repo.upsertItem({
      scope,
      item: {
        id: 2,
        platform: "x",
        type: "post",
        content: "Later draft",
        theme: "launch",
        scheduledAt: "2026-05-27T12:00:00.000Z",
        publishedAt: null,
        status: "draft",
        postUrl: null,
        engagementScore: 0,
        createdAt: "2026-05-26T10:00:00.000Z",
      },
      metadata: { manual: false },
    });
    repo.upsertItem({
      scope,
      item: {
        id: 1,
        platform: "x",
        type: "post",
        content: "Earlier draft",
        theme: "education",
        scheduledAt: "2026-05-27T09:00:00.000Z",
        publishedAt: null,
        status: "draft",
        postUrl: null,
        engagementScore: 0,
        createdAt: "2026-05-26T09:00:00.000Z",
      },
    });
    repo.upsertItem({
      scope,
      item: {
        id: 1,
        platform: "x",
        type: "post",
        content: "Earlier draft edited",
        theme: "education",
        scheduledAt: "2026-05-27T09:00:00.000Z",
        publishedAt: null,
        status: "scheduled",
        postUrl: null,
        engagementScore: 0,
        createdAt: "2026-05-26T09:00:00.000Z",
      },
    });

    const rows = repo.listItems({ ...scope, limit: 10 });
    expect(rows.map((row) => row.item_id)).toEqual([1, 2]);
    expect(rows[0]).toMatchObject({
      item_id: 1,
      content: "Earlier draft edited",
      status: "scheduled",
      theme: "education",
    });
  });

  it("isolates content queue reads by org, workspace, brand, agent, and tenant", () => {
    const scope = createScope("isolation-a");
    const otherScope = createScope("isolation-b");

    repo.upsertItem({
      scope,
      item: {
        id: 11,
        platform: "x",
        type: "post",
        content: "Brand A",
        theme: null,
        scheduledAt: "2026-05-27T09:00:00.000Z",
        publishedAt: null,
        status: "draft",
        postUrl: null,
        engagementScore: 0,
        createdAt: "2026-05-26T09:00:00.000Z",
      },
    });
    repo.upsertItem({
      scope: otherScope,
      item: {
        id: 11,
        platform: "x",
        type: "post",
        content: "Brand B",
        theme: null,
        scheduledAt: "2026-05-27T10:00:00.000Z",
        publishedAt: null,
        status: "draft",
        postUrl: null,
        engagementScore: 0,
        createdAt: "2026-05-26T10:00:00.000Z",
      },
    });

    expect(repo.listItems(scope).map((row) => row.content)).toEqual([
      "Brand A",
    ]);
    expect(repo.listItems(otherScope).map((row) => row.content)).toEqual([
      "Brand B",
    ]);
    expect(repo.listItems({ ...scope, agentId: "wrong_agent" })).toEqual([]);
  });
});

describe("runtime content queue state bridge", () => {
  it("dual-writes hosted queue mutations and preserves scheduled ordering", async () => {
    const scope = createScope("bridge");

    await withTenantContext(scope.tenantId, async () => {
      const later = createQueueItem({
        platform: "x",
        type: "post",
        content: "Later hosted item",
        theme: "launch",
        scheduledAt: "2026-05-27T12:00:00.000Z",
        status: "draft",
      });
      const earlier = createQueueItem({
        platform: "x",
        type: "post",
        content: "Earlier hosted item",
        theme: "education",
        scheduledAt: "2026-05-27T09:00:00.000Z",
        status: "draft",
      });

      expect(getQueue().map((item) => item.id)).toEqual([earlier.id, later.id]);

      approveItem(earlier.id);
      editItem(later.id, "Later hosted item edited");
      rescheduleItem(later.id, "2026-05-27T08:30:00.000Z");
      skipItem(earlier.id);

      expect(getQueue().map((item) => item.id)).toEqual([later.id, earlier.id]);
      deleteItem(earlier.id);
      expect(getQueue().map((item) => item.id)).toEqual([later.id]);
    });

    const rows = repo.listItems({ ...scope, limit: 10 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      item_id: rows[0]!.item_id,
      content: "Later hosted item edited",
      scheduled_at: "2026-05-27T08:30:00.000Z",
      status: "draft",
    });
  });

  it("falls back to the tenant CRM queue when hosted SQL has no scoped rows yet", async () => {
    const scope = createScope("fallback");

    await withTenantContext(scope.tenantId, async () => {
      const item = createQueueItem({
        platform: "x",
        type: "post",
        content: "CRM-only content item",
        scheduledAt: "2026-05-27T09:00:00.000Z",
        status: "draft",
      });

      repo.deleteItem(scope, item.id);
      expect(resolveRuntimeContentQueueScope(scope)).toMatchObject({
        brandId: scope.brandId,
        agentId: scope.agentId,
      });
      expect(getQueue().map((entry) => entry.id)).toEqual([item.id]);
    });
  });
});
