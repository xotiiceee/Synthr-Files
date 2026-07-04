import crypto from "node:crypto";
import fs from "node:fs";

import { afterAll, describe, expect, it } from "vitest";

import { cleanupSqliteFiles, createTempHostedDbPath } from "./temp-db.js";
import type { AutopostEntry } from "../../src/modes/autopost.js";

const dbPath = createTempHostedDbPath("pulse-runtime-autopost-queue");
process.env.HOSTED_DB_PATH = dbPath;

const { createOrg, createTenant, createWorkspace } =
  await import("../../hosted/db.js");
const { createBrandRepository } =
  await import("../../hosted/repositories/brands.js");
const { createRuntimeApprovalQueueRepository } =
  await import("../../hosted/repositories/runtime-approval-queue.js");
const { getTenantDir, withTenantContext } =
  await import("../../hosted/tenant.js");
const { saveState } = await import("../../src/core/state.js");
const { approveAutopost, editAutopost, getAutopostQueue } =
  await import("../../src/modes/autopost.js");

const brands = createBrandRepository();
const repo = createRuntimeApprovalQueueRepository();
const tenantDirs = new Set<string>();

afterAll(() => {
  for (const dir of tenantDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  cleanupSqliteFiles(dbPath);
});

function createScope(label: string) {
  const tenant = createTenant(
    `autopost-${label}-${crypto.randomUUID()}`,
    `claw-autopost-${label}-${crypto.randomUUID()}`,
    `${label}-${crypto.randomUUID()}@example.test`,
    `Runtime Autopost ${label}`,
  );
  tenantDirs.add(getTenantDir(tenant.id));
  const org = createOrg({
    name: `Runtime Autopost Org ${label}`,
    legacyTenantId: tenant.id,
  });
  const workspace = createWorkspace(org.id, "Default");
  const brand = brands.createBrand({
    orgId: org.id,
    workspaceId: workspace.id,
    name: `Runtime Autopost Brand ${label}`,
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

function autopostEntry(overrides: Partial<AutopostEntry> = {}): AutopostEntry {
  return {
    id: `autopost_${crypto.randomUUID()}`,
    category: "launch",
    format: "single",
    content: "Draft autopost",
    platform: "x",
    status: "pending",
    riskFlags: ["review"],
    voiceScore: 81,
    createdAt: "2026-05-26T10:00:00.000Z",
    ...overrides,
  };
}

describe("runtime autopost queue bridge", () => {
  it("mirrors hosted autopost queue entries into SQL and prefers hosted reads after a mutation", async () => {
    const scope = createScope("bridge");
    const entry = autopostEntry({ id: "autopost_bridge" });

    await withTenantContext(scope.tenantId, async () => {
      saveState("autopost-queue", [entry]);

      expect(getAutopostQueue().map((item) => item.id)).toEqual([entry.id]);

      expect(
        editAutopost(entry.id, "Edited hosted autopost draft"),
      ).toMatchObject({
        id: entry.id,
        content: "Edited hosted autopost draft",
      });

      const rows = repo.listItems({ ...scope, limit: 10 });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: entry.id,
        item_type: "autopost",
        content: "Edited hosted autopost draft",
        status: "pending",
      });

      expect(getAutopostQueue()).toMatchObject([
        {
          id: entry.id,
          content: "Edited hosted autopost draft",
          status: "pending",
        },
      ]);

      expect(approveAutopost(entry.id)).toMatchObject({
        id: entry.id,
        status: "approved",
      });
      expect(repo.getItem(scope, entry.id)?.status).toBe("approved");
      expect(getAutopostQueue()).toEqual([]);
    });
  });

  it("falls back to JSON autopost queue state when the hosted scoped row is missing", async () => {
    const scope = createScope("fallback");
    const entry = autopostEntry({ id: "autopost_fallback" });

    await withTenantContext(scope.tenantId, async () => {
      saveState("autopost-queue", [entry]);

      editAutopost(entry.id, "Fallback autopost draft");
      expect(repo.getItem(scope, entry.id)?.content).toBe(
        "Fallback autopost draft",
      );

      repo.deleteItem(scope, entry.id);

      expect(getAutopostQueue()).toMatchObject([
        {
          id: entry.id,
          content: "Fallback autopost draft",
          status: "pending",
        },
      ]);
    });
  });
});
