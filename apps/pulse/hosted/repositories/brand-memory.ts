import crypto from "node:crypto";

import type { BrandKnowledgeNoteRow, BrandProfileRow } from "../db.js";
import { getHostedDb } from "../db.js";

export interface BrandMemoryScope {
  orgId: string;
  workspaceId?: string | null;
  brandId: string;
  agentId: string;
  tenantId?: string | null;
}

export interface SaveBrandProfileInput {
  scope: BrandMemoryScope;
  profile: Record<string, unknown>;
  source?: string;
  sourceLabel?: string;
  sourceUrl?: string;
  actorId?: string;
  lockState?: BrandProfileRow["lock_state"];
  version?: number;
  confidence?: number;
  decay?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface SaveBrandKnowledgeNoteInput {
  scope: BrandMemoryScope;
  id?: string;
  title: string;
  content: string;
  tags?: string[];
  priority?: number;
  locked?: boolean;
  source?: string;
  sourceLabel?: string;
  sourceUrl?: string;
  actorId?: string;
  version?: number;
  confidence?: number;
  decay?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface BrandProfileRepository {
  upsertProfile(input: SaveBrandProfileInput): BrandProfileRow;
  getProfile(scope: BrandMemoryScope): BrandProfileRow | null;
  deleteProfile(scope: BrandMemoryScope): boolean;
}

export interface BrandKnowledgeNotesRepository {
  saveNote(input: SaveBrandKnowledgeNoteInput): BrandKnowledgeNoteRow;
  getNoteById(
    scope: BrandMemoryScope,
    id: string,
  ): BrandKnowledgeNoteRow | null;
  getNoteByTitle(
    scope: BrandMemoryScope,
    title: string,
  ): BrandKnowledgeNoteRow | null;
  listNotes(
    scope: BrandMemoryScope,
    input?: { includeLocked?: boolean; limit?: number },
  ): BrandKnowledgeNoteRow[];
  deleteNote(
    scope: BrandMemoryScope,
    input: { id?: string; title?: string },
  ): boolean;
  listMemoryRecords(
    scope: BrandMemoryScope,
    input?: {
      layers?: BrandMemoryLayer[];
      query?: string;
      includeLockedKnowledge?: boolean;
      limit?: number;
    },
  ): BrandMemoryRecord[];
  getDedupContext(
    scope: BrandMemoryScope,
    input?: { query?: string; limit?: number },
  ): BrandMemoryRecord[];
  getVoiceExemplars(
    scope: BrandMemoryScope,
    input?: { query?: string; limit?: number },
  ): BrandMemoryRecord[];
  getRelevanceContext(
    scope: BrandMemoryScope,
    input: { query: string; layers?: BrandMemoryLayer[]; limit?: number },
  ): BrandMemoryRecord[];
  findContradictions(
    scope: BrandMemoryScope,
    input: {
      title?: string;
      content: string;
      layers?: BrandMemoryLayer[];
      includeLockedKnowledge?: boolean;
      limit?: number;
    },
  ): BrandMemoryRecord[];
}

export type BrandMemoryLayer =
  | "identity"
  | "locked_rules"
  | "knowledge"
  | "preferences"
  | "operational";

export interface BrandMemoryRecord {
  id: string;
  layer: BrandMemoryLayer;
  tenantId: string;
  orgId: string;
  workspaceId: string;
  brandId: string;
  agentId: string;
  title: string;
  content: string;
  tags: string[];
  locked: boolean;
  source: string;
  sourceLabel: string;
  sourceUrl: string;
  actorId: string;
  version: number;
  confidence: number;
  decay: string;
  createdAt: string;
  updatedAt: string;
  relevanceScore: number;
}

function normalizeOptional(value?: string | null): string {
  return value ?? "";
}

function clampPriority(priority?: number): number {
  return Math.max(0, Math.min(3, priority ?? 1));
}

function clampConfidence(confidence?: number): number {
  return Math.max(0, Math.min(1, confidence ?? 1));
}

const MEMORY_LAYER_TAG_PREFIXES = ["layer:", "memory:", "memory-layer:"];

function parseTags(tags: string): string[] {
  try {
    const parsed = JSON.parse(tags);
    return Array.isArray(parsed)
      ? parsed.filter((tag) => typeof tag === "string")
      : [];
  } catch {
    return [];
  }
}

function normalizeToken(token: string): string {
  return token.trim().toLowerCase();
}

function tokenize(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter(Boolean);
}

const TOPIC_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "if",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "to",
  "with",
]);

const NEGATION_PATTERNS = [
  /\bdo not\b/i,
  /\bdon't\b/i,
  /\bdoes not\b/i,
  /\bdoesn't\b/i,
  /\bnever\b/i,
  /\bno\b/i,
  /\bnot\b/i,
  /\bwithout\b/i,
  /\bavoid\b/i,
  /\bavoids\b/i,
  /\bavoiding\b/i,
  /\bcannot\b/i,
  /\bcan't\b/i,
  /\bmust not\b/i,
  /\bshould not\b/i,
];

const CONTRADICTION_TERM_GROUPS: Array<
  [RegExp[], RegExp[]]
> = [
  [
    [/\bmanual\b/i],
    [/\bautomatic\b/i, /\bauto\b/i, /\bautomated\b/i],
  ],
  [[/\benable\b/i, /\benabled\b/i, /\bon\b/i], [/\bdisable\b/i, /\bdisabled\b/i, /\boff\b/i]],
  [[/\binclude\b/i, /\bincludes\b/i, /\bwith\b/i], [/\bexclude\b/i, /\bexcludes\b/i, /\bwithout\b/i]],
];

function stableStringify(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (Array.isArray(value))
    return value.map((item) => stableStringify(item)).join("\n");
  if (value && typeof value === "object") {
    const sorted = Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = (value as Record<string, unknown>)[key];
        return acc;
      }, {});
    return JSON.stringify(sorted);
  }
  return "";
}

function getTopicTokens(value: string): Set<string> {
  return new Set(
    tokenize(value).filter(
      (token) => token.length > 2 && !TOPIC_STOPWORDS.has(token),
    ),
  );
}

function countSharedTopicTokens(left: string, right: string): number {
  const leftTokens = getTopicTokens(left);
  const rightTokens = getTopicTokens(right);
  let count = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) count += 1;
  }
  return count;
}

function hasNegationCue(value: string): boolean {
  return NEGATION_PATTERNS.some((pattern) => pattern.test(value));
}

function hasContradictoryTermCue(left: string, right: string): boolean {
  return CONTRADICTION_TERM_GROUPS.some(
    ([leftGroup, rightGroup]) =>
      (leftGroup.some((pattern) => pattern.test(left)) &&
        rightGroup.some((pattern) => pattern.test(right))) ||
      (rightGroup.some((pattern) => pattern.test(left)) &&
        leftGroup.some((pattern) => pattern.test(right))),
  );
}

function isContradictoryRecord(
  candidate: { title?: string; content: string },
  record: BrandMemoryRecord,
): boolean {
  const titleMatches =
    candidate.title !== undefined &&
    normalizeToken(candidate.title) === normalizeToken(record.title);
  const sharedTopicTokens = countSharedTopicTokens(
    `${candidate.title ?? ""} ${candidate.content}`,
    `${record.title} ${record.content}`,
  );
  const sameTopic = titleMatches || sharedTopicTokens >= 2;
  if (!sameTopic) return false;

  const candidateContent = candidate.content.toLowerCase();
  const recordContent = record.content.toLowerCase();
  if (hasContradictoryTermCue(candidateContent, recordContent)) return true;
  if (hasContradictoryTermCue(recordContent, candidateContent)) return true;

  return hasNegationCue(candidateContent) !== hasNegationCue(recordContent);
}

function getExplicitMemoryLayer(tags: string[]): BrandMemoryLayer | null {
  for (const tag of tags) {
    const normalized = normalizeToken(tag);
    for (const prefix of MEMORY_LAYER_TAG_PREFIXES) {
      if (normalized.startsWith(prefix)) {
        const layer = normalized.slice(prefix.length) as BrandMemoryLayer;
        if (
          layer === "identity" ||
          layer === "locked_rules" ||
          layer === "knowledge" ||
          layer === "preferences" ||
          layer === "operational"
        ) {
          return layer;
        }
      }
    }
  }
  return null;
}

function classifyKnowledgeLayer(row: BrandKnowledgeNoteRow): BrandMemoryLayer {
  const tags = parseTags(row.tags);
  const explicitLayer = getExplicitMemoryLayer(tags);
  if (explicitLayer) return explicitLayer;

  const haystack =
    `${row.title} ${row.content} ${tags.join(" ")}`.toLowerCase();
  if (
    row.locked === 1 &&
    /(rule|guardrail|policy|must|never|always)/.test(haystack)
  ) {
    return "locked_rules";
  }
  if (/(preference|voice|tone|style|wording|phrasing)/.test(haystack)) {
    return "preferences";
  }
  if (
    /(operational|operations|schedule|approval|safety|limit|queue)/.test(
      haystack,
    )
  ) {
    return "operational";
  }
  if (/(identity|brand|positioning|about-us)/.test(haystack)) {
    return "identity";
  }
  return "knowledge";
}

function getDecayWeight(decay: string): number {
  switch (decay) {
    case "manual_only":
    case "sticky":
      return 1;
    case "none":
      return 0.95;
    case "slow":
      return 0.8;
    case "medium":
      return 0.6;
    case "fast":
      return 0.35;
    default:
      return 0.7;
  }
}

function getLayerWeight(layer: BrandMemoryLayer): number {
  switch (layer) {
    case "locked_rules":
      return 6;
    case "identity":
      return 5;
    case "preferences":
      return 4;
    case "operational":
      return 3;
    case "knowledge":
    default:
      return 2;
  }
}

function scoreRecord(
  record: Omit<BrandMemoryRecord, "relevanceScore">,
  query?: string,
): number {
  const queryTokens = new Set(tokenize(query ?? ""));
  const searchable = new Set(
    tokenize(`${record.title} ${record.content} ${record.tags.join(" ")}`),
  );
  let overlap = 0;
  for (const token of queryTokens) {
    if (searchable.has(token)) overlap += 1;
  }
  const adjustedConfidence = record.confidence * getDecayWeight(record.decay);
  return (
    overlap * 10 +
    adjustedConfidence * 5 +
    getLayerWeight(record.layer) +
    (record.locked ? 1.5 : 0) +
    Math.max(0, Math.min(3, record.tags.length > 0 ? 1 : 0))
  );
}

function buildMemoryRecord(
  row:
    | BrandKnowledgeNoteRow
    | {
        id: string;
        tenant_id: string;
        org_id: string;
        workspace_id: string;
        brand_id: string;
        agent_id: string;
        source: string;
        source_label: string;
        source_url: string;
        actor_id: string;
        version: number;
        confidence: number;
        decay: string;
        created_at: string;
        updated_at: string;
        locked: 0 | 1;
        title: string;
        content: string;
        tags: string;
      },
  layer: BrandMemoryLayer,
  query?: string,
): BrandMemoryRecord {
  const record = {
    id: row.id,
    layer,
    tenantId: row.tenant_id,
    orgId: row.org_id,
    workspaceId: row.workspace_id,
    brandId: row.brand_id,
    agentId: row.agent_id,
    title: row.title,
    content: row.content,
    tags: parseTags(row.tags),
    locked: row.locked === 1,
    source: row.source,
    sourceLabel: row.source_label,
    sourceUrl: row.source_url,
    actorId: row.actor_id,
    version: row.version,
    confidence: row.confidence,
    decay: row.decay,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  return { ...record, relevanceScore: scoreRecord(record, query) };
}

function getProfileMemoryRecords(
  scope: BrandMemoryScope,
  query?: string,
): BrandMemoryRecord[] {
  const row = getProfile(scope);
  if (!row) return [];

  let profile: Record<string, unknown>;
  try {
    profile = JSON.parse(row.profile_json) as Record<string, unknown>;
  } catch {
    return [];
  }

  const sections: Array<{
    key: string;
    aliases?: string[];
    layer: BrandMemoryLayer;
    title: string;
    locked: boolean;
    tags: string[];
  }> = [
    {
      key: "identity",
      layer: "identity",
      title: "Brand identity",
      locked: row.lock_state === "locked",
      tags: ["layer:identity"],
    },
    {
      key: "locked_rules",
      aliases: ["lockedRules"],
      layer: "locked_rules",
      title: "Locked rules",
      locked: true,
      tags: ["layer:locked_rules"],
    },
    {
      key: "knowledge",
      layer: "knowledge",
      title: "Brand knowledge",
      locked: row.lock_state === "locked",
      tags: ["layer:knowledge"],
    },
    {
      key: "preferences",
      aliases: ["voice"],
      layer: "preferences",
      title: "Brand preferences",
      locked: row.lock_state === "locked",
      tags: ["layer:preferences"],
    },
    {
      key: "operational",
      layer: "operational",
      title: "Operational context",
      locked: row.lock_state === "locked",
      tags: ["layer:operational"],
    },
  ];

  const records: BrandMemoryRecord[] = [];
  for (const section of sections) {
    const value =
      profile[section.key] ??
      section.aliases
        ?.map((alias) => profile[alias])
        .find((item) => item !== undefined);
    if (value === undefined || value === null || stableStringify(value) === "")
      continue;

    records.push(
      buildMemoryRecord(
        {
          id: `profile_${row.brand_id}_${section.layer}`,
          tenant_id: row.tenant_id,
          org_id: row.org_id,
          workspace_id: row.workspace_id,
          brand_id: row.brand_id,
          agent_id: row.agent_id,
          source: row.source,
          source_label: row.source_label,
          source_url: row.source_url,
          actor_id: row.actor_id,
          version: row.version,
          confidence: row.confidence,
          decay: row.decay,
          created_at: row.created_at,
          updated_at: row.updated_at,
          locked: section.locked ? 1 : 0,
          title: section.title,
          content: stableStringify(value),
          tags: JSON.stringify(section.tags),
        },
        section.layer,
        query,
      ),
    );
  }
  return records;
}

function dedupeMemoryRecords(
  records: BrandMemoryRecord[],
): BrandMemoryRecord[] {
  const deduped = new Map<string, BrandMemoryRecord>();
  for (const record of records) {
    const key = `${record.layer}:${normalizeToken(record.title)}:${normalizeToken(record.content)}`;
    const existing = deduped.get(key);
    if (!existing || record.relevanceScore > existing.relevanceScore) {
      deduped.set(key, record);
    }
  }
  return [...deduped.values()];
}

function sortMemoryRecords(records: BrandMemoryRecord[]): BrandMemoryRecord[] {
  return [...records].sort((left, right) => {
    if (right.relevanceScore !== left.relevanceScore) {
      return right.relevanceScore - left.relevanceScore;
    }
    if (Number(right.locked) !== Number(left.locked)) {
      return Number(right.locked) - Number(left.locked);
    }
    const rightAdjusted = right.confidence * getDecayWeight(right.decay);
    const leftAdjusted = left.confidence * getDecayWeight(left.decay);
    if (rightAdjusted !== leftAdjusted) {
      return rightAdjusted - leftAdjusted;
    }
    if (right.updatedAt !== left.updatedAt) {
      return right.updatedAt.localeCompare(left.updatedAt);
    }
    return right.id.localeCompare(left.id);
  });
}

function isLockedRulesRecord(row: BrandKnowledgeNoteRow): boolean {
  return row.locked === 1 && classifyKnowledgeLayer(row) === "locked_rules";
}

function getProfile(scope: BrandMemoryScope): BrandProfileRow | null {
  return (
    (getHostedDb()
      .prepare(
        `SELECT brand_id, tenant_id, org_id, workspace_id, agent_id, profile_json,
                source, source_label, source_url, actor_id, lock_state, version,
                confidence, decay, created_at, updated_at
           FROM brand_profiles
          WHERE tenant_id = ?
            AND org_id = ?
            AND workspace_id = ?
            AND brand_id = ?
            AND agent_id = ?`,
      )
      .get(
        normalizeOptional(scope.tenantId),
        scope.orgId,
        normalizeOptional(scope.workspaceId),
        scope.brandId,
        scope.agentId,
      ) as BrandProfileRow | undefined) ?? null
  );
}

function getNoteById(
  scope: BrandMemoryScope,
  id: string,
): BrandKnowledgeNoteRow | null {
  return (
    (getHostedDb()
      .prepare(
        `SELECT id, tenant_id, org_id, workspace_id, brand_id, agent_id, title,
                content, tags, priority, locked, source, source_label, source_url,
                actor_id, version, confidence, decay, created_at, updated_at
           FROM brand_knowledge_notes
          WHERE id = ?
            AND tenant_id = ?
            AND org_id = ?
            AND workspace_id = ?
            AND brand_id = ?
            AND agent_id = ?`,
      )
      .get(
        id,
        normalizeOptional(scope.tenantId),
        scope.orgId,
        normalizeOptional(scope.workspaceId),
        scope.brandId,
        scope.agentId,
      ) as BrandKnowledgeNoteRow | undefined) ?? null
  );
}

function getNoteByIdUnscoped(id: string): BrandKnowledgeNoteRow | null {
  return (
    (getHostedDb()
      .prepare(
        `SELECT id, tenant_id, org_id, workspace_id, brand_id, agent_id, title,
                content, tags, priority, locked, source, source_label, source_url,
                actor_id, version, confidence, decay, created_at, updated_at
           FROM brand_knowledge_notes
          WHERE id = ?`,
      )
      .get(id) as BrandKnowledgeNoteRow | undefined) ?? null
  );
}

function getNoteByTitle(
  scope: BrandMemoryScope,
  title: string,
): BrandKnowledgeNoteRow | null {
  return (
    (getHostedDb()
      .prepare(
        `SELECT id, tenant_id, org_id, workspace_id, brand_id, agent_id, title,
                content, tags, priority, locked, source, source_label, source_url,
                actor_id, version, confidence, decay, created_at, updated_at
           FROM brand_knowledge_notes
          WHERE tenant_id = ?
            AND org_id = ?
            AND workspace_id = ?
            AND brand_id = ?
            AND agent_id = ?
            AND title = ?`,
      )
      .get(
        normalizeOptional(scope.tenantId),
        scope.orgId,
        normalizeOptional(scope.workspaceId),
        scope.brandId,
        scope.agentId,
        title,
      ) as BrandKnowledgeNoteRow | undefined) ?? null
  );
}

export function createBrandProfileRepository(): BrandProfileRepository {
  return {
    upsertProfile(input) {
      const existing = getProfile(input.scope);
      const createdAt =
        existing?.created_at ?? input.createdAt ?? new Date().toISOString();
      const updatedAt = input.updatedAt ?? new Date().toISOString();

      getHostedDb()
        .prepare(
          `INSERT INTO brand_profiles (
             brand_id, tenant_id, org_id, workspace_id, agent_id, profile_json,
             source, source_label, source_url, actor_id, lock_state, version,
             confidence, decay, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(tenant_id, org_id, workspace_id, brand_id, agent_id)
           DO UPDATE SET
             profile_json = excluded.profile_json,
             source = excluded.source,
             source_label = excluded.source_label,
             source_url = excluded.source_url,
             actor_id = excluded.actor_id,
             lock_state = excluded.lock_state,
             version = excluded.version,
             confidence = excluded.confidence,
             decay = excluded.decay,
             updated_at = excluded.updated_at`,
        )
        .run(
          input.scope.brandId,
          normalizeOptional(input.scope.tenantId),
          input.scope.orgId,
          normalizeOptional(input.scope.workspaceId),
          input.scope.agentId,
          JSON.stringify(input.profile),
          input.source ?? existing?.source ?? "unknown",
          input.sourceLabel ?? existing?.source_label ?? "",
          input.sourceUrl ?? existing?.source_url ?? "",
          input.actorId ?? existing?.actor_id ?? "",
          input.lockState ?? existing?.lock_state ?? "editable",
          input.version ?? (existing ? existing.version + 1 : 1),
          clampConfidence(input.confidence ?? existing?.confidence),
          input.decay ?? existing?.decay ?? "none",
          createdAt,
          updatedAt,
        );

      return getProfile(input.scope)!;
    },

    getProfile(scope) {
      return getProfile(scope);
    },

    deleteProfile(scope) {
      const result = getHostedDb()
        .prepare(
          `DELETE FROM brand_profiles
            WHERE tenant_id = ?
              AND org_id = ?
              AND workspace_id = ?
              AND brand_id = ?
              AND agent_id = ?`,
        )
        .run(
          normalizeOptional(scope.tenantId),
          scope.orgId,
          normalizeOptional(scope.workspaceId),
          scope.brandId,
          scope.agentId,
        );
      return result.changes > 0;
    },
  };
}

export function createBrandKnowledgeNotesRepository(): BrandKnowledgeNotesRepository {
  const listScopedNoteRows = (
    scope: BrandMemoryScope,
    input?: { includeLocked?: boolean; limit?: number },
  ): BrandKnowledgeNoteRow[] => {
    const includeLockedClause = input?.includeLocked ? "" : " AND locked = 0";
    const limit = Math.max(1, Math.min(input?.limit ?? 100, 500));
    return getHostedDb()
      .prepare(
        `SELECT id, tenant_id, org_id, workspace_id, brand_id, agent_id, title,
                content, tags, priority, locked, source, source_label, source_url,
                actor_id, version, confidence, decay, created_at, updated_at
           FROM brand_knowledge_notes
          WHERE tenant_id = ?
            AND org_id = ?
            AND workspace_id = ?
            AND brand_id = ?
            AND agent_id = ?
            ${includeLockedClause}
          ORDER BY priority DESC, updated_at DESC, id DESC
          LIMIT ?`,
      )
      .all(
        normalizeOptional(scope.tenantId),
        scope.orgId,
        normalizeOptional(scope.workspaceId),
        scope.brandId,
        scope.agentId,
        limit,
      ) as BrandKnowledgeNoteRow[];
  };

  const listMemoryRecords = (
    scope: BrandMemoryScope,
    input?: {
      layers?: BrandMemoryLayer[];
      query?: string;
      includeLockedKnowledge?: boolean;
      limit?: number;
    },
  ): BrandMemoryRecord[] => {
    const allowedLayers = input?.layers ? new Set(input.layers) : null;
    const query = input?.query;
    const profileRecords = getProfileMemoryRecords(scope, query);
    const noteRows = listScopedNoteRows(scope, {
      includeLocked: true,
      limit: Math.max(50, Math.min(input?.limit ?? 50, 500)),
    });
    const noteRecords = noteRows
      .map((row) => buildMemoryRecord(row, classifyKnowledgeLayer(row), query))
      .filter((record) => {
        if (
          !input?.includeLockedKnowledge &&
          record.layer === "knowledge" &&
          record.locked
        ) {
          return false;
        }
        return true;
      });

    const records = [...profileRecords, ...noteRecords].filter((record) =>
      allowedLayers ? allowedLayers.has(record.layer) : true,
    );

    return sortMemoryRecords(dedupeMemoryRecords(records)).slice(
      0,
      Math.max(1, Math.min(input?.limit ?? 20, 200)),
    );
  };

  return {
    saveNote(input) {
      const existingByScopedId = input.id
        ? getNoteById(input.scope, input.id)
        : null;
      const existingByTitle = getNoteByTitle(input.scope, input.title);
      const existing = existingByScopedId ?? existingByTitle;
      if (existing && isLockedRulesRecord(existing)) return existing;
      const conflictingIdRow =
        input.id && !existingByScopedId ? getNoteByIdUnscoped(input.id) : null;
      const id =
        existing?.id ??
        (conflictingIdRow ? null : input.id) ??
        `bkn_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
      const createdAt =
        existing?.created_at ?? input.createdAt ?? new Date().toISOString();
      const updatedAt = input.updatedAt ?? new Date().toISOString();

      getHostedDb()
        .prepare(
          `INSERT INTO brand_knowledge_notes (
             id, tenant_id, org_id, workspace_id, brand_id, agent_id, title,
             content, tags, priority, locked, source, source_label, source_url,
             actor_id, version, confidence, decay, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             title = excluded.title,
             content = excluded.content,
             tags = excluded.tags,
             priority = excluded.priority,
             locked = excluded.locked,
             source = excluded.source,
             source_label = excluded.source_label,
             source_url = excluded.source_url,
             actor_id = excluded.actor_id,
             version = excluded.version,
             confidence = excluded.confidence,
             decay = excluded.decay,
             updated_at = excluded.updated_at`,
        )
        .run(
          id,
          normalizeOptional(input.scope.tenantId),
          input.scope.orgId,
          normalizeOptional(input.scope.workspaceId),
          input.scope.brandId,
          input.scope.agentId,
          input.title,
          input.content,
          JSON.stringify(
            input.tags ?? (existing ? JSON.parse(existing.tags) : []),
          ),
          clampPriority(input.priority ?? existing?.priority),
          input.locked === undefined
            ? (existing?.locked ?? 0)
            : input.locked
              ? 1
              : 0,
          input.source ?? existing?.source ?? "unknown",
          input.sourceLabel ?? existing?.source_label ?? "",
          input.sourceUrl ?? existing?.source_url ?? "",
          input.actorId ?? existing?.actor_id ?? "",
          input.version ?? (existing ? existing.version + 1 : 1),
          clampConfidence(input.confidence ?? existing?.confidence),
          input.decay ?? existing?.decay ?? "none",
          createdAt,
          updatedAt,
        );

      return getNoteById(input.scope, id)!;
    },

    getNoteById(scope, id) {
      return getNoteById(scope, id);
    },

    getNoteByTitle(scope, title) {
      return getNoteByTitle(scope, title);
    },

    listNotes(scope, input) {
      return listScopedNoteRows(scope, input);
    },

    deleteNote(scope, input) {
      if (!input.id && !input.title) return false;

      const result = input.id
        ? getHostedDb()
            .prepare(
              `DELETE FROM brand_knowledge_notes
                WHERE id = ?
                  AND tenant_id = ?
                  AND org_id = ?
                  AND workspace_id = ?
                  AND brand_id = ?
                  AND agent_id = ?`,
            )
            .run(
              input.id,
              normalizeOptional(scope.tenantId),
              scope.orgId,
              normalizeOptional(scope.workspaceId),
              scope.brandId,
              scope.agentId,
            )
        : getHostedDb()
            .prepare(
              `DELETE FROM brand_knowledge_notes
                WHERE tenant_id = ?
                  AND org_id = ?
                  AND workspace_id = ?
                  AND brand_id = ?
                  AND agent_id = ?
                  AND title = ?`,
            )
            .run(
              normalizeOptional(scope.tenantId),
              scope.orgId,
              normalizeOptional(scope.workspaceId),
              scope.brandId,
              scope.agentId,
              input.title!,
            );
      return result.changes > 0;
    },

    listMemoryRecords(scope, input) {
      return listMemoryRecords(scope, input);
    },

    getDedupContext(scope, input) {
      return listMemoryRecords(scope, {
        query: input?.query,
        limit: input?.limit ?? 12,
        includeLockedKnowledge: false,
        layers: ["identity", "locked_rules", "knowledge", "operational"],
      });
    },

    getVoiceExemplars(scope, input) {
      return listMemoryRecords(scope, {
        query: input?.query,
        limit: input?.limit ?? 8,
        includeLockedKnowledge: true,
        layers: ["locked_rules", "preferences", "identity"],
      });
    },

    getRelevanceContext(scope, input) {
      return listMemoryRecords(scope, {
        query: input.query,
        limit: input.limit ?? 12,
        includeLockedKnowledge: true,
        layers: input.layers ?? [
          "identity",
          "locked_rules",
          "knowledge",
          "preferences",
          "operational",
        ],
      });
    },

    findContradictions(scope, input) {
      const records = listMemoryRecords(scope, {
        query: `${input.title ?? ""} ${input.content}`.trim(),
        limit: input.limit ?? 20,
        includeLockedKnowledge: input.includeLockedKnowledge ?? true,
        layers: input.layers,
      });

      return records.filter((record) => isContradictoryRecord(input, record));
    },
  };
}

export const brandProfileRepository = createBrandProfileRepository();
export const brandKnowledgeNotesRepository =
  createBrandKnowledgeNotesRepository();
