import { describe, expect, it } from "vitest";

import { cleanupSqliteFiles, createTempHostedDbPath } from "./temp-db.js";

const dbPath = createTempHostedDbPath("pulse-privacy-export");
process.env.HOSTED_DB_PATH = dbPath;

const {
  addMembership,
  createBrand,
  createNote,
  createOrg,
  createTenant,
  createUser,
  createWorkspace,
  recordAuditEvent,
  recordSignal,
  recordUsageEvent,
  storeSecret,
  submitFeedback,
  upsertBrandConnection,
  upsertGitHubConnection,
  upsertGitHubRepoLink,
  upsertPreferenceProfile,
  setGitHubRepoAgentLinks,
} = await import("../../hosted/db.js");
const { exportPrivacyData } = await import("../../hosted/privacy-export.js");
const { createBrandKnowledgeNotesRepository, createBrandProfileRepository } =
  await import("../../hosted/repositories/brand-memory.js");
const { createRuntimeActionLogRepository } =
  await import("../../hosted/repositories/runtime-action-log.js");
const { createRuntimeApprovalQueueRepository } =
  await import("../../hosted/repositories/runtime-approval-queue.js");
const { createRuntimeContentQueueRepository } =
  await import("../../hosted/repositories/runtime-content-queue.js");
const { createRuntimeOutreachDedupRepository } =
  await import("../../hosted/repositories/runtime-outreach-dedup.js");
const { createRuntimeScheduleStateRepository } =
  await import("../../hosted/repositories/runtime-schedule-state.js");
const { createRuntimeXRateCounterRepository } =
  await import("../../hosted/repositories/runtime-x-rate-counters.js");
const { createXWriteOperationRepository } =
  await import("../../hosted/x-write-operations.js");

describe("privacy export foundation", () => {
  it("exports a tenant-scoped snapshot without raw secrets or api keys", async () => {
    const tenantA = createTenant(
      "cn-privacy-a",
      "claw_user_a",
      "tenant-a@example.test",
      "Tenant A",
    );
    const tenantB = createTenant(
      "cn-privacy-b",
      "claw_user_b",
      "tenant-b@example.test",
      "Tenant B",
    );
    const orgA = createOrg({ name: "Org A", legacyTenantId: tenantA.id });
    createOrg({ name: "Org B", legacyTenantId: tenantB.id });
    const userA = createUser({
      email: "owner-a@example.test",
      name: "Owner A",
    });
    addMembership(orgA.id, userA.id, "owner");
    const workspaceA = createWorkspace(orgA.id, "Workspace A");
    const brandA = createBrand({
      orgId: orgA.id,
      workspaceId: workspaceA.id,
      name: "Brand A",
      legacyTenantId: tenantA.id,
    });
    const brandB = createBrand({
      orgId: orgA.id,
      workspaceId: workspaceA.id,
      name: "Brand B",
      legacyTenantId: tenantB.id,
    });
    const memoryScopeA = {
      tenantId: tenantA.id,
      orgId: orgA.id,
      workspaceId: workspaceA.id,
      brandId: brandA.id,
      agentId: "agent_a",
    };
    const memoryScopeB = {
      tenantId: tenantB.id,
      orgId: orgA.id,
      workspaceId: workspaceA.id,
      brandId: brandB.id,
      agentId: "agent_b",
    };
    const profiles = createBrandProfileRepository();
    const knowledgeNotes = createBrandKnowledgeNotesRepository();
    const runtimeActions = createRuntimeActionLogRepository();
    const runtimeApprovals = createRuntimeApprovalQueueRepository();
    const runtimeContent = createRuntimeContentQueueRepository();
    const runtimeSchedule = createRuntimeScheduleStateRepository();
    const runtimeOutreachDedup = createRuntimeOutreachDedupRepository();
    const runtimeXRateCounters = createRuntimeXRateCounterRepository();
    const xWriteOperations = createXWriteOperationRepository();
    profiles.upsertProfile({
      scope: memoryScopeA,
      profile: { identity: { keyFacts: ["tenant A memory"] } },
      source: "chat",
      sourceLabel: "Founder brief",
      sourceUrl: "https://example.test/brief",
      actorId: userA.id,
      lockState: "locked",
      version: 7,
      confidence: 0.92,
      decay: "manual_only",
      createdAt: "2026-05-26T10:00:00.000Z",
      updatedAt: "2026-05-26T11:00:00.000Z",
    });
    profiles.upsertProfile({
      scope: memoryScopeB,
      profile: { identity: { keyFacts: ["tenant B memory"] } },
      source: "chat",
      actorId: userA.id,
    });
    knowledgeNotes.saveNote({
      scope: memoryScopeA,
      title: "Locked rule",
      content: "Always preserve source metadata.",
      tags: ["layer:locked_rules"],
      locked: true,
      source: "import",
      sourceLabel: "Setup import",
      sourceUrl: "https://example.test/import",
      actorId: userA.id,
      version: 3,
      confidence: 0.88,
      decay: "sticky",
      createdAt: "2026-05-26T12:00:00.000Z",
      updatedAt: "2026-05-26T13:00:00.000Z",
    });
    knowledgeNotes.saveNote({
      scope: memoryScopeB,
      title: "Other memory",
      content: "Do not leak this row.",
      source: "import",
    });
    runtimeApprovals.upsertItem({
      scope: memoryScopeA,
      item: {
        id: "approval_a",
        type: "autopost",
        platform: "x",
        content: "Approve tenant A",
        riskFlags: ["needs_review"],
        createdAt: "2026-05-26T14:00:00.000Z",
        expiresAt: "2026-05-28T14:00:00.000Z",
        status: "pending",
        category: "launch",
      },
      metadata: { queue: "approval-a" },
    });
    runtimeApprovals.upsertItem({
      scope: memoryScopeB,
      item: {
        id: "approval_b",
        type: "autopost",
        platform: "x",
        content: "Do not export approval B",
        riskFlags: [],
        createdAt: "2026-05-26T14:00:00.000Z",
        expiresAt: "2026-05-28T14:00:00.000Z",
        status: "pending",
      },
    });
    runtimeContent.upsertItem({
      scope: memoryScopeA,
      item: {
        id: 101,
        platform: "x",
        type: "post",
        content: "Scheduled tenant A",
        theme: "launch",
        scheduledAt: "2026-05-27T10:00:00.000Z",
        publishedAt: null,
        status: "draft",
        postUrl: null,
        engagementScore: 0,
        createdAt: "2026-05-26T14:05:00.000Z",
      },
      metadata: { queue: "content-a" },
    });
    runtimeActions.appendAction(memoryScopeA, {
      id: "action_a",
      timestamp: "2026-05-26T14:10:00.000Z",
      platform: "x",
      type: "post",
      topicId: "topic_a",
      content: "Action tenant A",
      engagement: { likes: 2, replies: 1, reposts: 0 },
    });
    runtimeSchedule.markTaskComplete({
      tenantId: tenantA.id,
      agentId: "agent_a",
      taskType: "content",
      completedAt: "2026-05-26T14:15:00.000Z",
    });
    runtimeOutreachDedup.upsertRepliedIds({
      tenantId: tenantA.id,
      agentId: "agent_a",
      platform: "x",
      postIds: ["post_a"],
      now: "2026-05-26T14:20:00.000Z",
    });
    runtimeXRateCounters.incrementPostCount({
      tenantId: tenantA.id,
      accountId: "acct_a",
      monthKey: "2026-05",
    });
    xWriteOperations.begin({
      tenantId: tenantA.id,
      orgId: orgA.id,
      workspaceId: workspaceA.id,
      brandId: brandA.id,
      agentId: "agent_a",
      idempotencyKey: "x-write-client:privacy-a:post",
      action: "post",
      operationId: "privacy-a:post",
      contentHash: "hash_a",
      postType: "post",
      metadata: { source: "autopost" },
      now: "2026-05-26T14:25:00.000Z",
    });
    xWriteOperations.complete({
      idempotencyKey: "x-write-client:privacy-a:post",
      externalPostId: "x_post_a",
      metadata: { completed: true },
      now: "2026-05-26T14:26:00.000Z",
    });

    upsertBrandConnection({
      brandId: brandA.id,
      provider: "x",
      status: "connected",
      metadata: { handle: "@brandA" },
    });
    storeSecret(
      tenantA.id,
      "X_ACCESS_TOKEN",
      "raw-super-secret-token",
      "raw-secret-iv",
      "raw-secret-auth-tag",
    );
    createNote(tenantA.id, "Only tenant A", "private note", ["alpha"], 1);
    createNote(tenantB.id, "Only tenant B", "other note", ["beta"], 0);
    submitFeedback(tenantA.id, "bug", "tenant A feedback");
    submitFeedback(tenantB.id, "bug", "tenant B feedback");
    upsertPreferenceProfile(tenantA.id, "default", {
      communication: "direct",
      chat_style: "brief",
    });
    recordSignal(tenantA.id, "default", "chat_message", { text: "hello" });
    recordUsageEvent({
      idempotencyKey: "privacy-export-tenant-a",
      tenantId: tenantA.id,
      orgId: orgA.id,
      source: "test",
      eventType: "privacy_export",
      metadata: { tenant: "a" },
    });
    recordAuditEvent({
      tenantId: tenantA.id,
      orgId: orgA.id,
      actorId: userA.id,
      action: "privacy.export",
      metadata: { tenant: "a" },
    });
    upsertGitHubConnection(tenantA.id, {
      githubUserId: "gh_1",
      login: "octo-a",
      name: "Octo A",
      avatarUrl: "https://example.test/a.png",
    });
    upsertGitHubRepoLink(tenantA.id, {
      repoId: "repo_a",
      owner: "acme",
      name: "tenant-a",
      fullName: "acme/tenant-a",
      isPrivate: true,
      defaultBranch: "main",
      syncEnabled: true,
      trustMode: "metadata",
      allowedPaths: ["docs"],
      summary: "tenant A repo",
    });
    setGitHubRepoAgentLinks(tenantA.id, "repo_a", ["default"]);

    const payload = await exportPrivacyData({
      subjectType: "tenant",
      subjectId: tenantA.id,
      includeProfileExport: false,
    });

    expect(payload.scope.tenantIds).toEqual([tenantA.id]);
    expect(payload.scope.orgIds).toEqual([orgA.id]);
    expect(payload.tenants).toHaveLength(1);
    expect(payload.tenants[0]?.id).toBe(tenantA.id);
    expect(payload.tenants[0]).not.toHaveProperty("api_key");
    expect(payload.notes).toHaveLength(1);
    expect(payload.notes[0]?.tenant_id).toBe(tenantA.id);
    expect(payload.feedback).toHaveLength(1);
    expect(payload.users).toHaveLength(1);
    expect(payload.users[0]).not.toHaveProperty("password_hash");
    expect(payload.githubConnections).toHaveLength(1);
    expect(payload.githubRepoLinks).toHaveLength(1);
    expect(payload.githubRepoAgentLinks).toEqual([
      { tenant_id: tenantA.id, repo_id: "repo_a", agent_id: "default" },
    ]);
    expect(payload.brandProfiles).toEqual([
      expect.objectContaining({
        tenant_id: tenantA.id,
        org_id: orgA.id,
        workspace_id: workspaceA.id,
        brand_id: brandA.id,
        agent_id: "agent_a",
        profile_json: { identity: { keyFacts: ["tenant A memory"] } },
        source: "chat",
        source_label: "Founder brief",
        source_url: "https://example.test/brief",
        actor_id: userA.id,
        lock_state: "locked",
        version: 7,
        confidence: 0.92,
        decay: "manual_only",
      }),
    ]);
    expect(payload.brandKnowledgeNotes).toEqual([
      expect.objectContaining({
        tenant_id: tenantA.id,
        org_id: orgA.id,
        workspace_id: workspaceA.id,
        brand_id: brandA.id,
        agent_id: "agent_a",
        title: "Locked rule",
        content: "Always preserve source metadata.",
        tags: ["layer:locked_rules"],
        locked: 1,
        source: "import",
        source_label: "Setup import",
        source_url: "https://example.test/import",
        actor_id: userA.id,
        version: 3,
        confidence: 0.88,
        decay: "sticky",
      }),
    ]);
    expect(payload.runtimeApprovalQueue).toEqual([
      expect.objectContaining({
        id: "approval_a",
        tenant_id: tenantA.id,
        brand_id: brandA.id,
        risk_flags: ["needs_review"],
        metadata: expect.objectContaining({ queue: "approval-a" }),
      }),
    ]);
    expect(payload.runtimeContentQueue).toEqual([
      expect.objectContaining({
        tenant_id: tenantA.id,
        brand_id: brandA.id,
        item_id: 101,
        metadata: { queue: "content-a" },
      }),
    ]);
    expect(payload.runtimeActionLogs).toEqual([
      expect.objectContaining({
        id: "action_a",
        tenant_id: tenantA.id,
        brand_id: brandA.id,
        engagement: { likes: 2, replies: 1, reposts: 0 },
      }),
    ]);
    expect(payload.runtimeScheduleState).toEqual([
      expect.objectContaining({
        tenant_id: tenantA.id,
        agent_id: "agent_a",
        task_type: "content",
        last_run: "2026-05-26T14:15:00.000Z",
      }),
    ]);
    expect(payload.runtimeOutreachDedup).toEqual([
      expect.objectContaining({
        tenant_id: tenantA.id,
        agent_id: "agent_a",
        platform: "x",
        post_id: "post_a",
      }),
    ]);
    expect(payload.runtimeXRateCounters).toEqual([
      expect.objectContaining({
        tenant_id: tenantA.id,
        account_id: "acct_a",
        month_key: "2026-05",
        post_count: 1,
      }),
    ]);
    expect(payload.xWriteOperations).toEqual([
      expect.objectContaining({
        tenant_id: tenantA.id,
        brand_id: brandA.id,
        status: "succeeded",
        external_post_id: "x_post_a",
        metadata: { source: "autopost", completed: true },
      }),
    ]);

    const legacyApprovalQueue = payload.runtimeApprovalQueue.map((row) => {
      const metadata =
        row.metadata && typeof row.metadata === "object"
          ? (row.metadata as Record<string, unknown>)
          : {};
      return {
        id: row.id,
        type: row.item_type,
        platform: row.platform,
        content: row.content,
        mentionId:
          typeof metadata.mentionId === "string"
            ? metadata.mentionId
            : undefined,
        category:
          typeof metadata.category === "string"
            ? metadata.category
            : undefined,
        riskFlags: row.risk_flags,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        status: row.status,
      };
    });
    const legacyContentQueue = payload.runtimeContentQueue.map((row) => ({
      id: row.item_id,
      platform: row.platform,
      type: row.item_type,
      content: row.content,
      theme: row.theme || null,
      scheduledAt: row.scheduled_at,
      publishedAt: row.published_at || null,
      status: row.status,
      postUrl: row.post_url || null,
      engagementScore: row.engagement_score,
      createdAt: row.created_at,
    }));
    const legacyActionLog = payload.runtimeActionLogs.map((row) => ({
      id: row.id,
      timestamp: row.timestamp,
      platform: row.platform,
      type: row.action_type,
      topicId: row.topic_id,
      content: row.content,
      engagement: row.engagement,
    }));

    expect(legacyApprovalQueue).toEqual([
      {
        id: "approval_a",
        type: "autopost",
        platform: "x",
        content: "Approve tenant A",
        mentionId: undefined,
        category: "launch",
        riskFlags: ["needs_review"],
        createdAt: "2026-05-26T14:00:00.000Z",
        expiresAt: "2026-05-28T14:00:00.000Z",
        status: "pending",
      },
    ]);
    expect(legacyContentQueue).toEqual([
      {
        id: 101,
        platform: "x",
        type: "post",
        content: "Scheduled tenant A",
        theme: "launch",
        scheduledAt: "2026-05-27T10:00:00.000Z",
        publishedAt: null,
        status: "draft",
        postUrl: null,
        engagementScore: 0,
        createdAt: "2026-05-26T14:05:00.000Z",
      },
    ]);
    expect(legacyActionLog).toEqual([
      {
        id: "action_a",
        timestamp: "2026-05-26T14:10:00.000Z",
        platform: "x",
        type: "post",
        topicId: "topic_a",
        content: "Action tenant A",
        engagement: { likes: 2, replies: 1, reposts: 0 },
      },
    ]);
    expect(payload.excluded.tenantSecretKeys[tenantA.id]).toEqual([
      "X_ACCESS_TOKEN",
    ]);
    expect(payload.profileExports).toEqual([]);

    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("cn-privacy-a");
    expect(serialized).not.toContain("raw-super-secret-token");
    expect(serialized).not.toContain("raw-secret-iv");
    expect(serialized).not.toContain("raw-secret-auth-tag");
    expect(serialized).not.toContain("Only tenant B");
    expect(serialized).not.toContain("tenant B memory");
    expect(serialized).not.toContain("Do not leak this row");
    expect(serialized).not.toContain("Do not export approval B");
  });

  it("keeps org export scoped to the requested org and its memberships", async () => {
    const tenantA = createTenant(
      "cn-org-scope-a",
      "claw_user_org_a",
      "scope-a@example.test",
      "Scope A",
    );
    const tenantB = createTenant(
      "cn-org-scope-b",
      "claw_user_org_b",
      "scope-b@example.test",
      "Scope B",
    );
    const orgA = createOrg({
      name: "Scoped Org A",
      legacyTenantId: tenantA.id,
    });
    const orgB = createOrg({
      name: "Scoped Org B",
      legacyTenantId: tenantB.id,
    });
    const userA = createUser({
      email: "scoped-a@example.test",
      name: "Scoped A",
    });
    const userB = createUser({
      email: "scoped-b@example.test",
      name: "Scoped B",
    });
    addMembership(orgA.id, userA.id, "admin");
    addMembership(orgB.id, userB.id, "viewer");
    const workspaceA = createWorkspace(orgA.id, "Scoped Workspace A");
    createWorkspace(orgB.id, "Scoped Workspace B");
    createBrand({
      orgId: orgA.id,
      workspaceId: workspaceA.id,
      name: "Scoped Brand A",
      legacyTenantId: tenantA.id,
    });
    createBrand({
      orgId: orgB.id,
      name: "Scoped Brand B",
      legacyTenantId: tenantB.id,
    });

    const payload = await exportPrivacyData({
      subjectType: "org",
      subjectId: orgA.id,
      includeProfileExport: false,
    });

    expect(payload.scope.orgIds).toEqual([orgA.id]);
    expect(payload.scope.tenantIds).toEqual([tenantA.id]);
    expect(payload.users.map((user) => user.email)).toEqual([
      "scoped-a@example.test",
    ]);
    expect(payload.workspaces).toHaveLength(1);
    expect(payload.workspaces[0]?.org_id).toBe(orgA.id);
    expect(payload.brands).toHaveLength(1);
    expect(payload.brands[0]?.org_id).toBe(orgA.id);
    expect(JSON.stringify(payload)).not.toContain("Scoped Org B");
    expect(JSON.stringify(payload)).not.toContain("scoped-b@example.test");
  });
});

process.on("exit", () => {
  cleanupSqliteFiles(dbPath);
});
