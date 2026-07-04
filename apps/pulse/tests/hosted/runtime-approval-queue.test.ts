import crypto from "node:crypto";
import fs from "node:fs";

import { afterAll, describe, expect, it } from "vitest";

import { cleanupSqliteFiles, createTempHostedDbPath } from "./temp-db.js";
import type { ApprovalQueueItem } from "../../src/intelligence/approval-queue.js";

const dbPath = createTempHostedDbPath("pulse-runtime-approval-queue");
process.env.HOSTED_DB_PATH = dbPath;

const { createOrg, createTenant, createWorkspace } =
  await import("../../hosted/db.js");
const { createBrandRepository } =
  await import("../../hosted/repositories/brands.js");
const {
  createRuntimeApprovalQueueRepository,
  resolveRuntimeApprovalQueueScope,
} = await import("../../hosted/repositories/runtime-approval-queue.js");
const { getTenantDir, withTenantContext } =
  await import("../../hosted/tenant.js");
const { saveState } = await import("../../src/core/state.js");
const { addToQueue, approveItem, getQueue } =
  await import("../../src/intelligence/approval-queue.js");

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
    `approval-${label}-${crypto.randomUUID()}`,
    `claw-approval-${label}-${crypto.randomUUID()}`,
    `${label}-${crypto.randomUUID()}@example.test`,
    `Runtime Approval ${label}`,
  );
  tenantDirs.add(getTenantDir(tenant.id));
  const org = createOrg({
    name: `Runtime Approval Org ${label}`,
    legacyTenantId: tenant.id,
  });
  const workspace = createWorkspace(org.id, "Default");
  const brand = brands.createBrand({
    orgId: org.id,
    workspaceId: workspace.id,
    name: `Runtime Approval Brand ${label}`,
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

function approvalItem(
  overrides: Partial<ApprovalQueueItem> = {},
): ApprovalQueueItem {
  return {
    id: "approval_1",
    type: "autopost",
    platform: "x",
    content: "Draft post",
    category: "launch",
    format: "single",
    riskFlags: ["needs_review"],
    createdAt: "2026-05-26T10:00:00.000Z",
    expiresAt: "2026-05-28T10:00:00.000Z",
    status: "pending",
    ...overrides,
  };
}

describe("runtime approval queue repository", () => {
  it("stores approval queue rows equivalent to the current JSON item shape", () => {
    const scope = createScope("shape");

    const row = repo.upsertItem({
      scope,
      item: approvalItem({
        mentionId: "mention_1",
        mentionText: "What do you do?",
        mentionAuthor: "founder",
        mentionUrl: "https://x.example/status/1",
        mentionSentiment: "question",
        voiceScore: 0.82,
      }),
      metadata: { migratedFrom: "approval-queue.json" },
    });

    expect(row).toMatchObject({
      tenant_id: scope.tenantId,
      org_id: scope.orgId,
      workspace_id: scope.workspaceId,
      brand_id: scope.brandId,
      agent_id: scope.agentId,
      item_type: "autopost",
      platform: "x",
      content: "Draft post",
      status: "pending",
      risk_flags: JSON.stringify(["needs_review"]),
      created_at: "2026-05-26T10:00:00.000Z",
      expires_at: "2026-05-28T10:00:00.000Z",
    });
    expect(JSON.parse(row.metadata)).toMatchObject({
      mentionId: "mention_1",
      mentionText: "What do you do?",
      mentionAuthor: "founder",
      mentionUrl: "https://x.example/status/1",
      mentionSentiment: "question",
      category: "launch",
      format: "single",
      voiceScore: 0.82,
      migratedFrom: "approval-queue.json",
    });
  });

  it("upserts edits and status transitions without duplicating rows", () => {
    const scope = createScope("upsert");

    repo.upsertItem({ scope, item: approvalItem({ id: "approval_upsert" }) });
    repo.upsertItem({
      scope,
      item: approvalItem({
        id: "approval_upsert",
        content: "Edited draft",
        status: "edited",
        reviewedAt: "2026-05-26T10:30:00.000Z",
        editHistory: ["Draft post"],
      }),
    });
    const marked = repo.markStatus({
      scope,
      id: "approval_upsert",
      status: "posted",
      reviewedAt: "2026-05-26T10:45:00.000Z",
    });

    expect(marked).toMatchObject({
      id: "approval_upsert",
      content: "Edited draft",
      status: "posted",
      reviewed_at: "2026-05-26T10:45:00.000Z",
    });
    expect(repo.listItems(scope)).toHaveLength(1);
    expect(JSON.parse(repo.listItems(scope)[0]!.metadata)).toMatchObject({
      editHistory: ["Draft post"],
    });
  });

  it("isolates approval queue reads by org, workspace, brand, agent, and tenant", () => {
    const scope = createScope("isolation-a");
    const otherScope = createScope("isolation-b");

    repo.upsertItem({ scope, item: approvalItem({ id: "approval_a" }) });
    repo.upsertItem({
      scope: otherScope,
      item: approvalItem({ id: "approval_b", content: "Other draft" }),
    });

    expect(repo.listItems(scope).map((row) => row.id)).toEqual(["approval_a"]);
    expect(repo.listItems(otherScope).map((row) => row.id)).toEqual([
      "approval_b",
    ]);
    expect(repo.listItems({ ...scope, agentId: "wrong_agent" })).toEqual([]);
  });
});

describe("runtime approval queue state bridge", () => {
  it("dual-writes hosted approval queue items and preserves newest-first ordering", async () => {
    const scope = createScope("bridge");

    await withTenantContext(scope.tenantId, async () => {
      const firstId = addToQueue({
        type: "autopost",
        platform: "x",
        content: "First hosted approval draft",
        category: "launch",
        format: "single",
        riskFlags: [],
      });
      const secondId = addToQueue({
        type: "mention_reply",
        platform: "x",
        content: "Second hosted approval draft",
        mentionId: "mention_2",
        mentionText: "Need a response",
        mentionAuthor: "operator",
        riskFlags: ["review"],
      });

      expect(getQueue().map((item) => item.id)).toEqual([secondId, firstId]);
      expect(approveItem(firstId)).toBe(true);
      expect(getQueue({ status: "approved" }).map((item) => item.id)).toEqual([
        firstId,
      ]);
    });

    const rows = repo.listItems({ ...scope, limit: 10 });
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.content)).toEqual([
      "Second hosted approval draft",
      "First hosted approval draft",
    ]);
    expect(repo.getItem(scope, rows[1]!.id)?.status).toBe("approved");
  });

  it("falls back to JSON when hosted SQL has no scoped rows yet", async () => {
    const scope = createScope("fallback");

    await withTenantContext(scope.tenantId, async () => {
      saveState("approval-queue", {
        items: [
          approvalItem({
            id: "approval_json_only",
            content: "JSON-only approval item",
          }),
        ],
        stats: {
          totalApproved: 0,
          totalRejected: 0,
          totalEdited: 0,
          totalExpired: 0,
          approvalTimes: [],
        },
      });

      expect(resolveRuntimeApprovalQueueScope(scope)).toMatchObject({
        brandId: scope.brandId,
        agentId: scope.agentId,
      });
      expect(getQueue().map((item) => item.id)).toEqual(["approval_json_only"]);
    });
  });

  it("falls back to the JSON approval queue after dual-write SQL rows are removed", async () => {
    const scope = createScope("rollback");

    await withTenantContext(scope.tenantId, async () => {
      const approvalId = addToQueue({
        type: "mention_reply",
        platform: "x",
        content: "Rollback-safe approval item",
        mentionId: "mention_rollback",
        mentionText: "Need rollback coverage",
        mentionAuthor: "operator",
        riskFlags: ["review"],
      });

      expect(approveItem(approvalId)).toBe(true);
      expect(repo.getItem(scope, approvalId)?.status).toBe("approved");

      expect(repo.deleteItem(scope, approvalId)).toBe(true);
      expect(getQueue({ status: "approved" })).toMatchObject([
        {
          id: approvalId,
          content: "Rollback-safe approval item",
          status: "approved",
          mentionId: "mention_rollback",
          mentionAuthor: "operator",
          riskFlags: ["review"],
        },
      ]);
    });
  });
});
