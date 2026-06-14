import { afterAll, describe, expect, it } from "vitest";

import { cleanupSqliteFiles, createTempHostedDbPath } from "./temp-db.js";

const dbPath = createTempHostedDbPath("pulse-brand-memory");
process.env.HOSTED_DB_PATH = dbPath;

const { createOrg, createTenant, createWorkspace } =
  await import("../../hosted/db.js");
const { createBrandRepository } =
  await import("../../hosted/repositories/brands.js");
const { createBrandKnowledgeNotesRepository, createBrandProfileRepository } =
  await import("../../hosted/repositories/brand-memory.js");

const brands = createBrandRepository();
const profiles = createBrandProfileRepository();
const notes = createBrandKnowledgeNotesRepository();

afterAll(() => {
  cleanupSqliteFiles(dbPath);
});

function createScope(label: string) {
  const tenant = createTenant(
    `brand-memory-${label}`,
    `claw-brand-memory-${label}`,
    `${label}@example.test`,
    `Brand Memory ${label}`,
  );
  const org = createOrg({
    name: `Brand Memory Org ${label}`,
    legacyTenantId: tenant.id,
  });
  const workspace = createWorkspace(org.id, `Workspace ${label}`);
  const brand = brands.createBrand({
    orgId: org.id,
    workspaceId: workspace.id,
    name: `Brand ${label}`,
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

describe("brand memory repositories", () => {
  it("stores and updates scoped brand profiles with source, lock, version, and decay metadata", () => {
    const scope = createScope("profile");
    const otherScope = createScope("profile-other");

    const created = profiles.upsertProfile({
      scope,
      profile: {
        identity: { name: "Pulse Brand", keyFacts: ["SOC 2"] },
        voice: { toneNotes: "Direct" },
      },
      source: "import",
      sourceLabel: "Founder brief",
      sourceUrl: "https://example.test/brief",
      actorId: "usr_founder",
      lockState: "locked",
      version: 7,
      confidence: 0.9,
      decay: "manual_only",
      createdAt: "2026-05-26T10:00:00.000Z",
      updatedAt: "2026-05-26T10:00:00.000Z",
    });

    expect(created).toMatchObject({
      tenant_id: scope.tenantId,
      org_id: scope.orgId,
      workspace_id: scope.workspaceId,
      brand_id: scope.brandId,
      agent_id: scope.agentId,
      source: "import",
      source_label: "Founder brief",
      source_url: "https://example.test/brief",
      actor_id: "usr_founder",
      lock_state: "locked",
      version: 7,
      confidence: 0.9,
      decay: "manual_only",
      created_at: "2026-05-26T10:00:00.000Z",
      updated_at: "2026-05-26T10:00:00.000Z",
    });
    expect(JSON.parse(created.profile_json)).toMatchObject({
      identity: { name: "Pulse Brand", keyFacts: ["SOC 2"] },
    });

    const updated = profiles.upsertProfile({
      scope,
      profile: {
        identity: { name: "Pulse Brand", keyFacts: ["SOC 2", "500 users"] },
        voice: { toneNotes: "Sharper" },
      },
      source: "chat",
      actorId: "usr_operator",
      updatedAt: "2026-05-26T11:00:00.000Z",
    });

    expect(updated).toMatchObject({
      brand_id: scope.brandId,
      source: "chat",
      actor_id: "usr_operator",
      lock_state: "locked",
      version: 8,
      confidence: 0.9,
      decay: "manual_only",
      created_at: "2026-05-26T10:00:00.000Z",
      updated_at: "2026-05-26T11:00:00.000Z",
    });
    expect(JSON.parse(updated.profile_json)).toMatchObject({
      identity: { keyFacts: ["SOC 2", "500 users"] },
      voice: { toneNotes: "Sharper" },
    });
    expect(profiles.getProfile(scope)).toMatchObject({
      brand_id: scope.brandId,
      source: "chat",
      source_label: "Founder brief",
      source_url: "https://example.test/brief",
      actor_id: "usr_operator",
      lock_state: "locked",
      version: 8,
      confidence: 0.9,
      decay: "manual_only",
      created_at: "2026-05-26T10:00:00.000Z",
      updated_at: "2026-05-26T11:00:00.000Z",
    });
    expect(
      notes.listMemoryRecords(scope, { layers: ["identity", "preferences"] }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          layer: "identity",
          locked: true,
          source: "chat",
          sourceLabel: "Founder brief",
          sourceUrl: "https://example.test/brief",
          actorId: "usr_operator",
          version: 8,
          decay: "manual_only",
        }),
        expect.objectContaining({
          layer: "preferences",
          locked: true,
          source: "chat",
          sourceLabel: "Founder brief",
          sourceUrl: "https://example.test/brief",
          actorId: "usr_operator",
          version: 8,
          decay: "manual_only",
        }),
      ]),
    );
    expect(profiles.getProfile(otherScope)).toBeNull();

    expect(profiles.deleteProfile(otherScope)).toBe(false);
    expect(profiles.deleteProfile(scope)).toBe(true);
    expect(profiles.getProfile(scope)).toBeNull();
  });

  it("keeps the structured brand profile ahead of overlapping identity notes in retrieval context", () => {
    const scope = createScope("source-of-truth");

    profiles.upsertProfile({
      scope,
      profile: {
        identity: {
          summary: "Pulse Premium is the canonical identity record.",
        },
        preferences: {
          tone: "operationally precise",
        },
      },
      source: "import",
      sourceLabel: "Founder brief",
      actorId: "usr_founder",
      lockState: "locked",
      version: 4,
      confidence: 0.98,
      decay: "manual_only",
      createdAt: "2026-05-26T09:00:00.000Z",
      updatedAt: "2026-05-26T09:30:00.000Z",
    });
    notes.saveNote({
      scope,
      title: "Brand identity",
      content: "Supplemental note about the same identity topic.",
      tags: ["layer:identity", "imported"],
      priority: 1,
      locked: false,
      source: "import",
      sourceLabel: "Migration note",
      actorId: "usr_ops",
      version: 8,
      confidence: 0.35,
      decay: "fast",
      createdAt: "2026-05-26T09:35:00.000Z",
      updatedAt: "2026-05-26T09:45:00.000Z",
    });

    const records = notes.listMemoryRecords(scope, {
      layers: ["identity", "preferences"],
      includeLockedKnowledge: true,
      query: "brand identity tone",
      limit: 10,
    });

    expect(records[0]).toMatchObject({
      layer: "identity",
      title: "Brand identity",
      content: expect.stringContaining(
        "Pulse Premium is the canonical identity record.",
      ),
      locked: true,
      source: "import",
      sourceLabel: "Founder brief",
      actorId: "usr_founder",
      version: 4,
      confidence: 0.98,
      decay: "manual_only",
    });
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          layer: "preferences",
          title: "Brand preferences",
          content: expect.stringContaining("operationally precise"),
        }),
        expect.objectContaining({
          layer: "identity",
          title: "Brand identity",
          content: "Supplemental note about the same identity topic.",
          locked: false,
          sourceLabel: "Migration note",
          actorId: "usr_ops",
        }),
      ]),
    );
  });

  it("supports note CRUD with scoped title dedupe, source fields, lock state, versioning, and no cross-brand leakage", () => {
    const tenant = createTenant(
      "brand-memory-notes-key",
      "claw-brand-memory-notes",
      "notes@example.test",
      "Brand Memory Notes",
    );
    const org = createOrg({
      name: "Brand Memory Notes Org",
      legacyTenantId: tenant.id,
    });
    const workspace = createWorkspace(org.id, "Shared Workspace");
    const firstBrand = brands.createBrand({
      orgId: org.id,
      workspaceId: workspace.id,
      name: "Notes Brand A",
      legacyTenantId: tenant.id,
      legacyAgentId: "agent_notes",
    });
    const secondBrand = brands.createBrand({
      orgId: org.id,
      workspaceId: workspace.id,
      name: "Notes Brand B",
      legacyTenantId: tenant.id,
      legacyAgentId: "agent_notes",
    });

    const firstScope = {
      tenantId: tenant.id,
      orgId: org.id,
      workspaceId: workspace.id,
      brandId: firstBrand.id,
      agentId: "agent_notes",
    };
    const secondScope = {
      ...firstScope,
      brandId: secondBrand.id,
    };

    const created = notes.saveNote({
      scope: firstScope,
      title: "Product overview",
      content: "Brand A ships managed workflows.",
      tags: ["layer:knowledge", "product", "from-chat"],
      priority: 2,
      locked: true,
      source: "chat",
      sourceLabel: "Operator setup",
      sourceUrl: "https://example.test/chat/1",
      actorId: "usr_setup",
      version: 3,
      confidence: 0.85,
      decay: "sticky",
      createdAt: "2026-05-26T12:00:00.000Z",
      updatedAt: "2026-05-26T12:00:00.000Z",
    });
    const updated = notes.saveNote({
      scope: firstScope,
      title: "Product overview",
      content: "Brand A ships managed workflows for premium X operators.",
      updatedAt: "2026-05-26T13:00:00.000Z",
    });
    const otherBrandRow = notes.saveNote({
      scope: secondScope,
      title: "Product overview",
      content: "Brand B has different positioning.",
      source: "import",
      actorId: "usr_import",
    });

    expect(updated.id).toBe(created.id);
    expect(updated).toMatchObject({
      tenant_id: firstScope.tenantId,
      org_id: firstScope.orgId,
      workspace_id: firstScope.workspaceId,
      brand_id: firstScope.brandId,
      agent_id: firstScope.agentId,
      title: "Product overview",
      locked: 1,
      priority: 2,
      source: "chat",
      source_label: "Operator setup",
      source_url: "https://example.test/chat/1",
      actor_id: "usr_setup",
      version: 4,
      confidence: 0.85,
      decay: "sticky",
      created_at: "2026-05-26T12:00:00.000Z",
      updated_at: "2026-05-26T13:00:00.000Z",
    });
    expect(JSON.parse(updated.tags)).toEqual([
      "layer:knowledge",
      "product",
      "from-chat",
    ]);
    expect(notes.getNoteById(firstScope, created.id)).toMatchObject({
      id: created.id,
      content: "Brand A ships managed workflows for premium X operators.",
      locked: 1,
      source: "chat",
      source_label: "Operator setup",
      source_url: "https://example.test/chat/1",
      actor_id: "usr_setup",
      version: 4,
      confidence: 0.85,
      decay: "sticky",
      created_at: "2026-05-26T12:00:00.000Z",
      updated_at: "2026-05-26T13:00:00.000Z",
    });
    expect(notes.getNoteByTitle(secondScope, "Product overview")?.id).toBe(
      otherBrandRow.id,
    );
    expect(notes.getNoteById(firstScope, otherBrandRow.id)).toBeNull();
    expect(notes.listNotes(firstScope)).toEqual([]);
    expect(
      notes.listNotes(firstScope, { includeLocked: true }).map((row) => row.id),
    ).toEqual([created.id]);
    expect(notes.listNotes(firstScope, { includeLocked: true })[0]).toMatchObject({
      id: created.id,
      locked: 1,
      source: "chat",
      source_label: "Operator setup",
      source_url: "https://example.test/chat/1",
      actor_id: "usr_setup",
      version: 4,
      confidence: 0.85,
      decay: "sticky",
    });
    expect(
      notes.listMemoryRecords(firstScope, {
        layers: ["knowledge"],
        includeLockedKnowledge: true,
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: created.id,
          layer: "knowledge",
          locked: true,
          source: "chat",
          sourceLabel: "Operator setup",
          sourceUrl: "https://example.test/chat/1",
          actorId: "usr_setup",
          version: 4,
          confidence: 0.85,
          decay: "sticky",
        }),
      ]),
    );
    expect(
      notes
        .listNotes(secondScope, { includeLocked: true })
        .map((row) => row.id),
    ).toEqual([otherBrandRow.id]);

    expect(notes.deleteNote(secondScope, { title: "Product overview" })).toBe(
      true,
    );
    expect(notes.getNoteByTitle(secondScope, "Product overview")).toBeNull();
    expect(notes.getNoteByTitle(firstScope, "Product overview")?.id).toBe(
      created.id,
    );
  });

  it("does not let an explicit note id mutate a different brand scope", () => {
    const firstScope = createScope("note-id-isolation-a");
    const secondScope = createScope("note-id-isolation-b");

    const protectedRow = notes.saveNote({
      scope: firstScope,
      title: "Protected note",
      content: "Original scoped content.",
      tags: ["layer:knowledge"],
      source: "import",
      actorId: "usr_a",
      updatedAt: "2026-05-26T13:30:00.000Z",
    });

    const attemptedCollision = notes.saveNote({
      scope: secondScope,
      id: protectedRow.id,
      title: "Second scope note",
      content: "This must stay in the second scope only.",
      tags: ["layer:knowledge"],
      source: "chat",
      actorId: "usr_b",
      updatedAt: "2026-05-26T13:31:00.000Z",
    });

    expect(attemptedCollision.id).not.toBe(protectedRow.id);
    expect(notes.getNoteById(firstScope, protectedRow.id)).toMatchObject({
      id: protectedRow.id,
      title: "Protected note",
      content: "Original scoped content.",
      source: "import",
      actor_id: "usr_a",
      updated_at: "2026-05-26T13:30:00.000Z",
    });
    expect(notes.getNoteById(secondScope, attemptedCollision.id)).toMatchObject({
      id: attemptedCollision.id,
      title: "Second scope note",
      content: "This must stay in the second scope only.",
      source: "chat",
      actor_id: "usr_b",
      updated_at: "2026-05-26T13:31:00.000Z",
    });
  });

  it("retrieves layered memory records with source retention and scope filtering", () => {
    const scope = createScope("retrieval-layers");
    const otherScope = createScope("retrieval-layers-other");

    profiles.upsertProfile({
      scope,
      profile: {
        identity: { name: "Pulse", tagline: "Ship calm automation" },
        preferences: { tone: "direct", avoid: ["hype"] },
        operational: { approvalMode: "manual" },
      },
      source: "import",
      sourceLabel: "Founder doc",
      sourceUrl: "https://example.test/founder-doc",
      actorId: "usr_founder",
      confidence: 0.95,
      decay: "manual_only",
      updatedAt: "2026-05-26T14:00:00.000Z",
    });
    notes.saveNote({
      scope,
      title: "Reply rule",
      content: "Never claim guaranteed outcomes.",
      tags: ["layer:locked_rules", "voice"],
      locked: true,
      source: "policy",
      sourceLabel: "Legal",
      sourceUrl: "https://example.test/legal",
      actorId: "usr_legal",
      confidence: 1,
      decay: "manual_only",
      updatedAt: "2026-05-26T14:05:00.000Z",
    });
    notes.saveNote({
      scope,
      title: "Customer proof",
      content: "Used by 500 premium operators.",
      tags: ["layer:knowledge", "proof"],
      source: "research",
      actorId: "usr_research",
      confidence: 0.8,
      decay: "none",
      updatedAt: "2026-05-26T14:10:00.000Z",
    });
    notes.saveNote({
      scope: otherScope,
      title: "Other scope note",
      content: "Should not leak.",
      tags: ["layer:knowledge"],
      source: "chat",
      actorId: "usr_other",
    });

    const preferenceRecords = notes.listMemoryRecords(scope, {
      layers: ["preferences"],
      query: "direct tone",
    });
    expect(preferenceRecords).toHaveLength(1);
    expect(preferenceRecords[0]).toMatchObject({
      layer: "preferences",
      source: "import",
      sourceLabel: "Founder doc",
      sourceUrl: "https://example.test/founder-doc",
      actorId: "usr_founder",
    });

    const relevance = notes.getRelevanceContext(scope, {
      query: "guaranteed outcomes for operators",
      limit: 4,
    });
    expect(relevance.map((record) => record.layer)).toContain("locked_rules");
    expect(relevance.map((record) => record.brandId)).toEqual(
      Array(relevance.length).fill(scope.brandId),
    );
    expect(
      relevance.some((record) => record.title === "Other scope note"),
    ).toBe(false);
  });

  it("orders retrieval using confidence and decay and isolates purpose-specific scopes", () => {
    const scope = createScope("retrieval-ordering");

    notes.saveNote({
      scope,
      title: "Fast-decay note",
      content: "Operators want concise launch copy.",
      tags: ["layer:knowledge", "voice"],
      source: "chat",
      actorId: "usr_chat",
      confidence: 1,
      decay: "fast",
      updatedAt: "2026-05-26T15:00:00.000Z",
    });
    notes.saveNote({
      scope,
      title: "Sticky note",
      content: "Operators want concise launch copy.",
      tags: ["layer:knowledge", "voice"],
      source: "import",
      actorId: "usr_import",
      confidence: 0.8,
      decay: "sticky",
      updatedAt: "2026-05-26T15:01:00.000Z",
    });
    notes.saveNote({
      scope,
      title: "Voice guide",
      content: "Use direct sentences and skip hype.",
      tags: ["layer:preferences", "voice"],
      source: "chat",
      actorId: "usr_voice",
      confidence: 0.9,
      decay: "sticky",
      updatedAt: "2026-05-26T15:02:00.000Z",
    });
    notes.saveNote({
      scope,
      title: "Ops limit",
      content: "Approval queue stays manual for outbound claims.",
      tags: ["layer:operational"],
      source: "settings",
      actorId: "usr_ops",
      confidence: 0.7,
      decay: "slow",
      updatedAt: "2026-05-26T15:03:00.000Z",
    });

    const relevance = notes.getRelevanceContext(scope, {
      query: "concise launch copy",
      layers: ["knowledge"],
      limit: 2,
    });
    expect(relevance.map((record) => record.title)).toEqual([
      "Sticky note",
      "Fast-decay note",
    ]);

    const voice = notes.getVoiceExemplars(scope, {
      query: "direct voice",
      limit: 4,
    });
    expect(
      voice.every((record) =>
        ["identity", "locked_rules", "preferences"].includes(record.layer),
      ),
    ).toBe(true);

    const dedup = notes.getDedupContext(scope, {
      query: "approval claims concise copy",
      limit: 6,
    });
    expect(dedup.some((record) => record.layer === "preferences")).toBe(false);
    expect(dedup.some((record) => record.layer === "operational")).toBe(true);
  });

  it("finds bounded contradictions against existing memory without cross-brand leakage", () => {
    const scope = createScope("contradictions");
    const otherScope = createScope("contradictions-other");

    profiles.upsertProfile({
      scope,
      profile: {
        operational: {
          approvalMode: "manual",
          outboundClaims: "require approval",
        },
      },
      source: "settings",
      actorId: "usr_ops",
      confidence: 0.9,
      decay: "sticky",
      updatedAt: "2026-05-26T15:30:00.000Z",
    });
    profiles.upsertProfile({
      scope: otherScope,
      profile: {
        operational: {
          approvalMode: "automatic",
        },
      },
      source: "settings",
      actorId: "usr_other_ops",
    });
    notes.saveNote({
      scope,
      title: "Guarantee rule",
      content: "Never promise revenue guarantees.",
      tags: ["layer:locked_rules", "policy"],
      locked: true,
      source: "policy",
      actorId: "usr_legal",
      confidence: 1,
      decay: "manual_only",
      updatedAt: "2026-05-26T15:31:00.000Z",
    });

    const operationalConflicts = notes.findContradictions(scope, {
      title: "Approval mode",
      content: "Switch approval mode to automatic for outbound claims.",
      layers: ["operational"],
      limit: 5,
    });
    expect(operationalConflicts).toHaveLength(1);
    expect(operationalConflicts[0]).toMatchObject({
      brandId: scope.brandId,
      layer: "operational",
      source: "settings",
    });

    const ruleConflicts = notes.findContradictions(scope, {
      title: "Guarantee rule",
      content: "Promise revenue guarantees if qualified.",
      layers: ["locked_rules"],
      limit: 5,
    });
    expect(ruleConflicts).toHaveLength(1);
    expect(ruleConflicts[0]).toMatchObject({
      brandId: scope.brandId,
      layer: "locked_rules",
      source: "policy",
      actorId: "usr_legal",
    });
    expect(
      ruleConflicts.some((record) => record.brandId === otherScope.brandId),
    ).toBe(false);
  });

  it("does not overwrite locked-rule memories and preserves source and actor metadata", () => {
    const scope = createScope("locked-rules");

    const created = notes.saveNote({
      scope,
      title: "Hard rule",
      content: "Never promise revenue guarantees.",
      tags: ["layer:locked_rules", "policy"],
      locked: true,
      source: "policy",
      sourceLabel: "Counsel review",
      sourceUrl: "https://example.test/counsel",
      actorId: "usr_counsel",
      confidence: 1,
      decay: "manual_only",
      updatedAt: "2026-05-26T16:00:00.000Z",
    });

    const attemptedOverwrite = notes.saveNote({
      scope,
      title: "Hard rule",
      content: "Promise revenue guarantees if qualified.",
      tags: ["layer:locked_rules", "policy"],
      locked: true,
      source: "chat",
      sourceLabel: "Assistant draft",
      sourceUrl: "https://example.test/chat",
      actorId: "usr_assistant",
      confidence: 0.2,
      decay: "fast",
      updatedAt: "2026-05-26T16:05:00.000Z",
    });

    expect(attemptedOverwrite).toMatchObject({
      id: created.id,
      content: "Never promise revenue guarantees.",
      source: "policy",
      source_label: "Counsel review",
      source_url: "https://example.test/counsel",
      actor_id: "usr_counsel",
      confidence: 1,
      decay: "manual_only",
      updated_at: "2026-05-26T16:00:00.000Z",
    });
    expect(
      notes.getVoiceExemplars(scope, { query: "revenue guarantees" })[0],
    ).toMatchObject({
      layer: "locked_rules",
      source: "policy",
      actorId: "usr_counsel",
    });
  });
});
