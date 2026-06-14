/**
 * Scheduled Content Queue for PULSE.
 * Generate a week's content, let user approve/edit, then auto-publish on schedule.
 * Backed by the CRM SQLite database.
 */

import fs from "fs";
import path from "path";
import { getCRM, getCRMPath } from "../crm/database.js";
import { currentRuntimeAgentId as currentAgentId } from "../core/runtime-agent-state.js";
import { getConfig } from "../core/persona.js";
import { generatePost } from "./content-generator.js";
import type { RuntimeContentQueueRow } from "../../hosted/db.js";

let _getContext: (() => { tenantId: string } | undefined) | null = null;
let _runtimeContentQueue:
  | typeof import("../../hosted/repositories/runtime-content-queue.js").runtimeContentQueueRepository
  | null = null;
let _resolveRuntimeContentQueueScope:
  | typeof import("../../hosted/repositories/runtime-content-queue.js").resolveRuntimeContentQueueScope
  | null = null;
try {
  const ctx = await import("../../hosted/context.js");
  _getContext = ctx.getContext;
  const runtimeContentQueue =
    await import("../../hosted/repositories/runtime-content-queue.js");
  _runtimeContentQueue = runtimeContentQueue.runtimeContentQueueRepository;
  _resolveRuntimeContentQueueScope =
    runtimeContentQueue.resolveRuntimeContentQueueScope;
} catch {
  /* self-hosted mode — hosted repository not available */
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface QueueItem {
  id: number;
  platform: string;
  type: string;
  content: string;
  theme: string | null;
  scheduledAt: string;
  publishedAt: string | null;
  status: string;
  postUrl: string | null;
  engagementScore: number;
  createdAt: string;
}

export interface CreateQueueItemInput {
  platform: string;
  type: string;
  content: string;
  theme?: string | null;
  scheduledAt: string;
  publishedAt?: string | null;
  status?: string;
  postUrl?: string | null;
  engagementScore?: number;
  metadata?: Record<string, unknown>;
}

export interface PublishResult {
  itemId: number;
  platform: string;
  ok: boolean;
  postUrl?: string;
  error?: string;
}

// ─── Schema Migration ────────────────────────────────────────────────────────

const migratedPaths = new Set<string>();

function ensureTable(): void {
  const crmPath = getCRMPath();
  if (migratedPaths.has(crmPath)) return;
  const db = getCRM();

  db.exec(`
    CREATE TABLE IF NOT EXISTS content_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      theme TEXT,
      scheduled_at TEXT NOT NULL,
      published_at TEXT,
      status TEXT DEFAULT 'draft',
      post_url TEXT,
      engagement_score REAL DEFAULT 0,
      created_at TEXT NOT NULL,
      metadata TEXT DEFAULT '{}'
    );

    CREATE INDEX IF NOT EXISTS idx_content_queue_status ON content_queue(status);
    CREATE INDEX IF NOT EXISTS idx_content_queue_scheduled ON content_queue(scheduled_at);
    CREATE INDEX IF NOT EXISTS idx_content_queue_platform ON content_queue(platform);
  `);

  migratedPaths.add(crmPath);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function rowToItem(row: Record<string, unknown>): QueueItem {
  return {
    id: row.id as number,
    platform: row.platform as string,
    type: row.type as string,
    content: row.content as string,
    theme: (row.theme as string) || null,
    scheduledAt: row.scheduled_at as string,
    publishedAt: (row.published_at as string) || null,
    status: row.status as string,
    postUrl: (row.post_url as string) || null,
    engagementScore: row.engagement_score as number,
    createdAt: row.created_at as string,
  };
}

function mapHostedRowToItem(row: RuntimeContentQueueRow): QueueItem {
  return {
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
  };
}

function getHostedRuntimeContentQueueScope():
  | import("../../hosted/repositories/runtime-content-queue.js").RuntimeContentQueueScope
  | null {
  const tenantId = _getContext?.()?.tenantId;
  if (!tenantId || !_resolveRuntimeContentQueueScope) return null;
  return (
    _resolveRuntimeContentQueueScope({
      tenantId,
      agentId: currentAgentId(),
    }) ?? null
  );
}

function getQueueItemRow(id: number): Record<string, unknown> | null {
  ensureTable();
  return (
    (getCRM().prepare(`SELECT * FROM content_queue WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined) ?? null
  );
}

function syncHostedQueueItemById(id: number): void {
  const scope = getHostedRuntimeContentQueueScope();
  if (!scope || !_runtimeContentQueue) return;
  const row = getQueueItemRow(id);
  if (!row) {
    _runtimeContentQueue.deleteItem(scope, id);
    return;
  }
  _runtimeContentQueue.upsertItem({
    scope,
    item: rowToItem(row),
    metadata: JSON.parse(String(row.metadata || "{}")) as Record<
      string,
      unknown
    >,
  });
}

function hasHostedQueueItems(): boolean {
  const scope = getHostedRuntimeContentQueueScope();
  if (!scope || !_runtimeContentQueue) return false;
  return _runtimeContentQueue.listItems({ ...scope, limit: 1 }).length > 0;
}

/** Platforms that require manual posting (no API available). */
const MANUAL_PLATFORMS = new Set(["linkedin", "hackernews", "producthunt"]);

/** Map platform name to content type. */
function platformToType(platform: string): string {
  const typeMap: Record<string, string> = {
    x: "tweet",
    reddit: "reddit_post",
    linkedin: "linkedin_post",
    discord: "discord_message",
    hackernews: "hackernews_post",
    producthunt: "producthunt_post",
  };
  return typeMap[platform] || "post";
}

/** Optimal posting hours (local time). */
const OPTIMAL_HOURS = [9, 12, 15, 18];

// ─── Exports ─────────────────────────────────────────────────────────────────

export function createQueueItem(input: CreateQueueItemInput): QueueItem {
  ensureTable();
  const db = getCRM();
  const createdAt = new Date().toISOString();
  const info = db
    .prepare(
      `
    INSERT INTO content_queue (
      platform, type, content, theme, scheduled_at, published_at, status,
      post_url, engagement_score, created_at, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    )
    .run(
      input.platform,
      input.type,
      input.content,
      input.theme ?? null,
      input.scheduledAt,
      input.publishedAt ?? null,
      input.status ?? "draft",
      input.postUrl ?? null,
      input.engagementScore ?? 0,
      createdAt,
      JSON.stringify(input.metadata ?? {}),
    );

  const item = rowToItem(getQueueItemRow(info.lastInsertRowid as number)!);
  syncHostedQueueItemById(item.id);
  return item;
}

export function markPublished(
  id: number,
  publishedAt: string,
  postUrl?: string | null,
): void {
  ensureTable();
  const db = getCRM();
  db.prepare(
    `
    UPDATE content_queue
       SET status = 'published',
           published_at = ?,
           post_url = ?
     WHERE id = ?
  `,
  ).run(publishedAt, postUrl ?? null, id);
  syncHostedQueueItemById(id);
}

export function markFailed(id: number): void {
  ensureTable();
  const db = getCRM();
  db.prepare(`UPDATE content_queue SET status = 'failed' WHERE id = ?`).run(id);
  syncHostedQueueItemById(id);
}

export function deleteItem(id: number): void {
  ensureTable();
  const db = getCRM();
  db.prepare(`DELETE FROM content_queue WHERE id = ?`).run(id);
  syncHostedQueueItemById(id);
}

/**
 * Generate a full week of content, insert as drafts, and return them.
 * Distributes across enabled platforms with optimal time slots.
 */
export async function generateWeekContent(): Promise<QueueItem[]> {
  ensureTable();
  const config = getConfig();
  const postsPerDay = config.schedule.contentPostsPerDay || 2;
  const themes = config.contentThemes;
  const totalDays = 7;

  // Get enabled platforms
  const enabledPlatforms = Object.entries(config.platforms)
    .filter(([, s]) => s.enabled)
    .map(([name]) => name);

  if (enabledPlatforms.length === 0) {
    console.log("  [Queue] No platforms enabled — cannot generate content.");
    return [];
  }

  const items: QueueItem[] = [];
  const now = new Date();

  for (let day = 0; day < totalDays; day++) {
    for (let slot = 0; slot < postsPerDay; slot++) {
      // Round-robin across platforms
      const platform =
        enabledPlatforms[(day * postsPerDay + slot) % enabledPlatforms.length];
      const isManual = MANUAL_PLATFORMS.has(platform);

      // Pick theme
      const theme =
        themes.length > 0
          ? themes[(day * postsPerDay + slot) % themes.length]
          : config.persona.niche;

      // Calculate scheduled time
      const scheduledDate = new Date(now);
      scheduledDate.setDate(scheduledDate.getDate() + day + 1); // Start tomorrow
      const hour = OPTIMAL_HOURS[slot % OPTIMAL_HOURS.length];
      scheduledDate.setHours(hour, 0, 0, 0);
      const scheduledAt = scheduledDate.toISOString();

      // Generate content via LLM
      console.log(
        `  [Queue] Generating ${platform} post for day ${day + 1}, slot ${slot + 1}...`,
      );
      const result = await generatePost(theme, platform);
      const content = result?.text ?? `[Draft pending: ${theme}]`;
      const type = isManual ? "manual" : platformToType(platform);

      items.push(
        createQueueItem({
          platform,
          type,
          content,
          theme,
          scheduledAt,
          status: "draft",
          metadata: {
            contentType: result?.type ?? "educational",
            manual: isManual,
          },
        }),
      );
    }
  }

  console.log(
    `  [Queue] Generated ${items.length} content items for the next 7 days.`,
  );
  return items;
}

/**
 * Get queue items with optional filters.
 */
export function getQueue(
  options: { status?: string; platform?: string; limit?: number } = {},
): QueueItem[] {
  ensureTable();
  const scope = getHostedRuntimeContentQueueScope();
  if (scope && _runtimeContentQueue) {
    const items = _runtimeContentQueue
      .listItems({
        ...scope,
        status: options.status,
        platform: options.platform,
        limit: options.limit,
      })
      .map(mapHostedRowToItem);
    if (items.length > 0 || hasHostedQueueItems()) return items;
  }

  const db = getCRM();

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.status) {
    conditions.push("status = ?");
    params.push(options.status);
  }
  if (options.platform) {
    conditions.push("platform = ?");
    params.push(options.platform);
  }

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = options.limit ? `LIMIT ${options.limit}` : "";

  const rows = db
    .prepare(
      `SELECT * FROM content_queue ${where} ORDER BY scheduled_at ASC ${limit}`,
    )
    .all(...params) as Record<string, unknown>[];
  return rows.map(rowToItem);
}

/**
 * Approve a single item (draft -> scheduled).
 */
export function approveItem(id: number): void {
  ensureTable();
  const db = getCRM();
  db.prepare(
    `UPDATE content_queue SET status = 'scheduled' WHERE id = ? AND status = 'draft'`,
  ).run(id);
  syncHostedQueueItemById(id);
}

/**
 * Approve all draft items. Returns the count approved.
 */
export function approveAll(): number {
  ensureTable();
  const db = getCRM();
  const ids = db
    .prepare(`SELECT id FROM content_queue WHERE status = 'draft'`)
    .all()
    .map((row) => (row as { id: number }).id);
  const info = db
    .prepare(
      `UPDATE content_queue SET status = 'scheduled' WHERE status = 'draft'`,
    )
    .run();
  for (const id of ids) {
    syncHostedQueueItemById(id);
  }
  return info.changes;
}

/**
 * Edit the content text of a queue item.
 */
export function editItem(id: number, newContent: string): void {
  ensureTable();
  const db = getCRM();
  db.prepare(`UPDATE content_queue SET content = ? WHERE id = ?`).run(
    newContent,
    id,
  );
  syncHostedQueueItemById(id);
}

/**
 * Skip a queue item.
 */
export function skipItem(id: number): void {
  ensureTable();
  const db = getCRM();
  db.prepare(`UPDATE content_queue SET status = 'skipped' WHERE id = ?`).run(
    id,
  );
  syncHostedQueueItemById(id);
}

/**
 * Attempt to publish all items that are scheduled and due.
 * Tries to load the platform module dynamically to post.
 */
export async function publishDueItems(): Promise<PublishResult[]> {
  const now = new Date().toISOString();
  const dueItems = getQueue({ status: "scheduled" }).filter(
    (item) => item.scheduledAt <= now,
  );

  const results: PublishResult[] = [];

  for (const item of dueItems) {
    const row = getQueueItemRow(item.id);
    const meta = JSON.parse(String(row?.metadata || "{}")) as Record<
      string,
      unknown
    >;

    // Skip manual platforms — they need human action
    if (meta.manual || MANUAL_PLATFORMS.has(item.platform)) {
      console.log(
        `  [Queue] #${item.id} (${item.platform}) requires manual posting — skipping auto-publish.`,
      );
      results.push({
        itemId: item.id,
        platform: item.platform,
        ok: false,
        error: "Manual platform — post manually",
      });
      continue;
    }

    try {
      // Dynamic import of platform module
      const platformModule = await import(`../platforms/${item.platform}.js`);
      const platform = platformModule.default ?? platformModule;

      if (
        !platform.post ||
        !platform.isConfigured ||
        !platform.isConfigured()
      ) {
        results.push({
          itemId: item.id,
          platform: item.platform,
          ok: false,
          error: "Platform not configured",
        });
        markFailed(item.id);
        continue;
      }

      const postResult = await platform.post({
        text: item.content,
        type: "post",
      });

      if (postResult.ok) {
        const publishedAt = new Date().toISOString();
        markPublished(item.id, publishedAt, postResult.url || null);

        results.push({
          itemId: item.id,
          platform: item.platform,
          ok: true,
          postUrl: postResult.url,
        });
        console.log(
          `  [Queue] Published #${item.id} on ${item.platform}${postResult.url ? ` -> ${postResult.url}` : ""}`,
        );
      } else {
        markFailed(item.id);
        results.push({
          itemId: item.id,
          platform: item.platform,
          ok: false,
          error: postResult.error,
        });
        console.log(
          `  [Queue] Failed #${item.id} on ${item.platform}: ${postResult.error}`,
        );
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      markFailed(item.id);
      results.push({
        itemId: item.id,
        platform: item.platform,
        ok: false,
        error: errMsg,
      });
      console.log(`  [Queue] Error publishing #${item.id}: ${errMsg}`);
    }
  }

  return results;
}

/**
 * Reschedule a queue item to a new time.
 */
export function rescheduleItem(id: number, newTime: string): void {
  ensureTable();
  const db = getCRM();
  db.prepare(`UPDATE content_queue SET scheduled_at = ? WHERE id = ?`).run(
    newTime,
    id,
  );
  syncHostedQueueItemById(id);
}

/**
 * Get aggregate stats for the content queue.
 */
export function getQueueStats(): {
  total: number;
  drafts: number;
  scheduled: number;
  published: number;
  failed: number;
} {
  const items = getQueue({ limit: 500 });
  const counts: Record<string, number> = {};
  for (const item of items) {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
  }

  return {
    total: items.length,
    drafts: counts["draft"] ?? 0,
    scheduled: counts["scheduled"] ?? 0,
    published: counts["published"] ?? 0,
    failed: counts["failed"] ?? 0,
  };
}
