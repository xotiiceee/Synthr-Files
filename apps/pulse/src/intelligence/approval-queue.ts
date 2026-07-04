/**
 * Shared Approval Queue for PULSE.
 *
 * Central queue where drafts wait for human approval before being posted.
 * Used by both the auto-posting engine (generated brand content) and the
 * mention-reply pipeline (responses to brand mentions).
 *
 * Workflow:  pending -> approved/rejected/edited -> posted
 *            pending -> expired (after configurable TTL, default 48h)
 *
 * Backed by JSON state file in data/approval-queue.json.
 * Max queue size: 200 items (FIFO cleanup when exceeded).
 */

import { loadState, saveState, generateId } from "../core/state.js";
import { currentRuntimeAgentId as currentAgentId } from "../core/runtime-agent-state.js";
import { recordEdit, recordRejection } from "./learning-engine.js";
import type { RuntimeApprovalQueueRow } from "../../hosted/repositories/runtime-approval-queue.js";

let _getContext: (() => { tenantId: string } | undefined) | null = null;
let _runtimeApprovalQueue:
  | typeof import("../../hosted/repositories/runtime-approval-queue.js").runtimeApprovalQueueRepository
  | null = null;
let _resolveRuntimeApprovalQueueScope:
  | typeof import("../../hosted/repositories/runtime-approval-queue.js").resolveRuntimeApprovalQueueScope
  | null = null;
try {
  const ctx = await import("../../hosted/context.js");
  _getContext = ctx.getContext;
  const runtimeApprovalQueue =
    await import("../../hosted/repositories/runtime-approval-queue.js");
  _runtimeApprovalQueue = runtimeApprovalQueue.runtimeApprovalQueueRepository;
  _resolveRuntimeApprovalQueueScope =
    runtimeApprovalQueue.resolveRuntimeApprovalQueueScope;
} catch {
  /* self-hosted mode — hosted repository not available */
}

// ─── Constants ──────────────────────────────────────────────────────────────

const STATE_KEY = "approval-queue";
const MAX_QUEUE_SIZE = 200;
const DEFAULT_EXPIRY_HOURS = 48;
const DEFAULT_CLEANUP_DAYS = 7;

// ─── Types ──────────────────────────────────────────────────────────────────

export type QueueItemType = "autopost" | "mention_reply";

export type QueueItemStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "edited"
  | "expired"
  | "posted";

export interface ApprovalQueueItem {
  id: string;
  type: QueueItemType;
  platform: string;
  content: string;

  // For mention_reply items
  mentionId?: string;
  mentionText?: string;
  mentionAuthor?: string;
  mentionUrl?: string;
  mentionSentiment?: string;

  // For autopost items
  category?: string;
  format?: string;
  sourceUrl?: string;

  // Metadata
  riskFlags: string[];
  voiceScore?: number;
  createdAt: string;
  expiresAt: string;
  status: QueueItemStatus;
  reviewedAt?: string;
  editHistory?: string[]; // previous versions if edited
  rejectReason?: string;
}

export interface QueueStats {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  expired: number;
  posted: number;
  avgApprovalTimeMinutes: number;
  editRate: number; // percentage of items that were edited before posting
}

// ─── Internal State Shape ───────────────────────────────────────────────────

interface ApprovalQueueState {
  items: ApprovalQueueItem[];
  stats: {
    totalApproved: number;
    totalRejected: number;
    totalEdited: number;
    totalExpired: number;
    /** Approval durations in minutes (kept for rolling average) */
    approvalTimes: number[];
  };
}

const DEFAULT_STATE: ApprovalQueueState = {
  items: [],
  stats: {
    totalApproved: 0,
    totalRejected: 0,
    totalEdited: 0,
    totalExpired: 0,
    approvalTimes: [],
  },
};

// ─── State Helpers ──────────────────────────────────────────────────────────

function load(): ApprovalQueueState {
  return loadState<ApprovalQueueState>(STATE_KEY, DEFAULT_STATE);
}

function persist(state: ApprovalQueueState): void {
  // Cap approval-time samples at 500 to bound memory
  if (state.stats.approvalTimes.length > 500) {
    state.stats.approvalTimes = state.stats.approvalTimes.slice(-500);
  }
  saveState(STATE_KEY, state);
}

function getHostedRuntimeApprovalQueueScope():
  | import("../../hosted/repositories/runtime-approval-queue.js").RuntimeApprovalQueueScope
  | null {
  const tenantId = _getContext?.()?.tenantId;
  if (!tenantId || !_resolveRuntimeApprovalQueueScope) return null;
  return (
    _resolveRuntimeApprovalQueueScope({
      tenantId,
      agentId: currentAgentId(),
    }) ?? null
  );
}

function mapRowToApprovalQueueItem(
  row: RuntimeApprovalQueueRow,
): ApprovalQueueItem {
  const metadata = row.metadata
    ? (JSON.parse(row.metadata) as Record<string, unknown>)
    : {};
  return {
    id: row.id,
    type: row.item_type as QueueItemType,
    platform: row.platform,
    content: row.content,
    mentionId:
      typeof metadata.mentionId === "string" ? metadata.mentionId : undefined,
    mentionText:
      typeof metadata.mentionText === "string"
        ? metadata.mentionText
        : undefined,
    mentionAuthor:
      typeof metadata.mentionAuthor === "string"
        ? metadata.mentionAuthor
        : undefined,
    mentionUrl:
      typeof metadata.mentionUrl === "string" ? metadata.mentionUrl : undefined,
    mentionSentiment:
      typeof metadata.mentionSentiment === "string"
        ? metadata.mentionSentiment
        : undefined,
    category:
      typeof metadata.category === "string" ? metadata.category : undefined,
    format: typeof metadata.format === "string" ? metadata.format : undefined,
    sourceUrl:
      typeof metadata.sourceUrl === "string" ? metadata.sourceUrl : undefined,
    riskFlags: row.risk_flags ? (JSON.parse(row.risk_flags) as string[]) : [],
    voiceScore:
      typeof metadata.voiceScore === "number" ? metadata.voiceScore : undefined,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    status: row.status,
    reviewedAt: row.reviewed_at || undefined,
    editHistory: Array.isArray(metadata.editHistory)
      ? metadata.editHistory.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : undefined,
    rejectReason:
      typeof metadata.rejectReason === "string"
        ? metadata.rejectReason
        : undefined,
  };
}

function getHostedQueueItem(id: string): ApprovalQueueItem | null {
  const scope = getHostedRuntimeApprovalQueueScope();
  if (!scope || !_runtimeApprovalQueue) return null;
  const row = _runtimeApprovalQueue.getItem(scope, id);
  return row ? mapRowToApprovalQueueItem(row) : null;
}

function upsertHostedQueueItem(item: ApprovalQueueItem): void {
  const scope = getHostedRuntimeApprovalQueueScope();
  if (!scope || !_runtimeApprovalQueue) return;
  _runtimeApprovalQueue.upsertItem({ scope, item });
}

function deleteHostedQueueItem(id: string): void {
  const scope = getHostedRuntimeApprovalQueueScope();
  if (!scope || !_runtimeApprovalQueue) return;
  _runtimeApprovalQueue.deleteItem(scope, id);
}

function listHostedQueue(filter?: {
  type?: QueueItemType;
  status?: QueueItemStatus;
}): ApprovalQueueItem[] | null {
  const scope = getHostedRuntimeApprovalQueueScope();
  if (!scope || !_runtimeApprovalQueue) return null;
  const rows = _runtimeApprovalQueue.listItems({
    ...scope,
    status: filter?.status,
    limit: MAX_QUEUE_SIZE,
  });
  if (rows.length === 0) return [];
  let items = rows.map(mapRowToApprovalQueueItem);
  if (filter?.type) {
    items = items.filter((item) => item.type === filter.type);
  }
  return items;
}

function hasHostedQueueItems(): boolean {
  const items = listHostedQueue();
  return items !== null && items.length > 0;
}

function findMutableQueueItem(
  state: ApprovalQueueState,
  id: string,
): ApprovalQueueItem | null {
  const existing = state.items.find((item) => item.id === id);
  if (existing) return existing;
  const hosted = getHostedQueueItem(id);
  if (!hosted) return null;
  state.items.push(hosted);
  return hosted;
}

/**
 * Enforce FIFO when queue exceeds MAX_QUEUE_SIZE.
 * Removes the oldest non-pending items first, then oldest pending items.
 */
function enforceMaxSize(state: ApprovalQueueState): void {
  if (state.items.length <= MAX_QUEUE_SIZE) return;

  const excess = state.items.length - MAX_QUEUE_SIZE;

  // Prefer to remove terminal items (posted, rejected, expired) before pending
  const terminalStatuses: Set<QueueItemStatus> = new Set([
    "posted",
    "rejected",
    "expired",
  ]);

  let removed = 0;
  // First pass: remove oldest terminal items
  state.items = state.items.filter((item) => {
    if (removed >= excess) return true;
    if (terminalStatuses.has(item.status)) {
      removed++;
      return false;
    }
    return true;
  });

  // Second pass: if still over limit, remove oldest items regardless of status
  if (state.items.length > MAX_QUEUE_SIZE) {
    state.items = state.items.slice(-MAX_QUEUE_SIZE);
  }
}

// ─── Queue Management ───────────────────────────────────────────────────────

/**
 * Add a new item to the approval queue.
 * Returns the generated item ID.
 *
 * @param item - Item data (id, createdAt, expiresAt, and status are auto-set)
 * @param expiryHours - Hours until the item expires (default 48)
 */
export function addToQueue(
  item: Omit<ApprovalQueueItem, "id" | "createdAt" | "expiresAt" | "status">,
  expiryHours: number = DEFAULT_EXPIRY_HOURS,
): string {
  const state = load();
  const previousIds = new Set(state.items.map((entry) => entry.id));

  const newestExistingCreatedAt = state.items.reduce((max, entry) => {
    const timestamp = Date.parse(entry.createdAt);
    return Number.isFinite(timestamp) ? Math.max(max, timestamp) : max;
  }, 0);
  const currentTimestamp = Date.now();
  const now = new Date(
    newestExistingCreatedAt >= currentTimestamp
      ? newestExistingCreatedAt + 1
      : currentTimestamp,
  );
  const expiresAt = new Date(now.getTime() + expiryHours * 60 * 60 * 1000);

  const queueItem: ApprovalQueueItem = {
    ...item,
    id: generateId(),
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    status: "pending",
  };

  state.items.push(queueItem);
  enforceMaxSize(state);
  persist(state);
  upsertHostedQueueItem(queueItem);

  const currentIds = new Set(state.items.map((entry) => entry.id));
  for (const id of previousIds) {
    if (!currentIds.has(id)) {
      deleteHostedQueueItem(id);
    }
  }

  return queueItem.id;
}

/**
 * Retrieve queue items with optional filters.
 * Returns items sorted newest-first.
 */
export function getQueue(filter?: {
  type?: QueueItemType;
  status?: QueueItemStatus;
}): ApprovalQueueItem[] {
  const hostedItems = listHostedQueue(filter);
  if (
    hostedItems !== null &&
    (hostedItems.length > 0 || hasHostedQueueItems())
  ) {
    return hostedItems;
  }

  const state = load();
  let items = state.items;
  if (filter?.type) {
    items = items.filter((i) => i.type === filter.type);
  }
  if (filter?.status) {
    items = items.filter((i) => i.status === filter.status);
  }

  // Newest first
  return [...items].reverse();
}

/**
 * Get all items that are currently pending review.
 * Also expires any items past their expiry window before returning.
 */
export function getPendingItems(): ApprovalQueueItem[] {
  // Expire stale items first so callers always see accurate state
  expireOldItems();
  return getQueue({ status: "pending" });
}

/**
 * Look up a single queue item by ID.
 */
export function getItemById(id: string): ApprovalQueueItem | null {
  const scope = getHostedRuntimeApprovalQueueScope();
  if (scope && _runtimeApprovalQueue) {
    const row = _runtimeApprovalQueue.getItem(scope, id);
    if (row) return mapRowToApprovalQueueItem(row);
  }
  const state = load();
  return state.items.find((i) => i.id === id) ?? null;
}

// ─── Actions ────────────────────────────────────────────────────────────────

/**
 * Approve a pending item. Records review timestamp and approval time.
 * Returns false if the item doesn't exist or isn't pending.
 */
export function approveItem(id: string): boolean {
  const state = load();
  const item = findMutableQueueItem(state, id);
  if (!item || item.status !== "pending") return false;

  const now = new Date();
  item.status = "approved";
  item.reviewedAt = now.toISOString();

  // Track approval time
  const createdMs = new Date(item.createdAt).getTime();
  const approvalMinutes = (now.getTime() - createdMs) / 60_000;
  state.stats.approvalTimes.push(Math.round(approvalMinutes * 100) / 100);
  state.stats.totalApproved++;

  persist(state);
  upsertHostedQueueItem(item);
  return true;
}

/**
 * Reject a pending item with an optional reason.
 * Returns false if the item doesn't exist or isn't pending.
 */
export function rejectItem(id: string, reason?: string): boolean {
  const state = load();
  const item = findMutableQueueItem(state, id);
  if (!item || item.status !== "pending") return false;

  item.status = "rejected";
  item.reviewedAt = new Date().toISOString();
  if (reason) item.rejectReason = reason;

  state.stats.totalRejected++;

  persist(state);
  upsertHostedQueueItem(item);
  recordRejection(item.content, item.category || item.type, reason);
  return true;
}

/**
 * Edit a pending item's content. Saves the previous version to editHistory,
 * then transitions the item to 'edited' status (still requires final approval
 * via approveItem if desired, or can be posted directly via markPosted).
 *
 * Returns false if the item doesn't exist or is in a terminal state.
 */
export function editItem(id: string, newContent: string): boolean {
  const state = load();
  const item = findMutableQueueItem(state, id);

  // Allow editing pending or already-edited items only
  if (!item || (item.status !== "pending" && item.status !== "edited"))
    return false;

  // Preserve the old content in edit history
  if (!item.editHistory) item.editHistory = [];
  const oldContent = item.content;
  item.editHistory.push(oldContent);

  item.content = newContent;

  // Only record stats on first transition out of pending
  if (item.status === "pending") {
    state.stats.totalEdited++;
    const createdMs = new Date(item.createdAt).getTime();
    const approvalMinutes = (Date.now() - createdMs) / 60_000;
    state.stats.approvalTimes.push(Math.round(approvalMinutes * 100) / 100);
  }

  item.status = "edited";
  item.reviewedAt = new Date().toISOString();

  persist(state);
  upsertHostedQueueItem(item);
  recordEdit(oldContent, newContent, item.category || item.type);
  return true;
}

/**
 * Mark an approved/edited item as posted (content was successfully published).
 * Returns false if the item doesn't exist or isn't in an approvable state.
 */
export function markPosted(id: string): boolean {
  const state = load();
  const item = findMutableQueueItem(state, id);

  // Can only post items that have been approved or edited
  if (!item || (item.status !== "approved" && item.status !== "edited"))
    return false;

  item.status = "posted";

  persist(state);
  upsertHostedQueueItem(item);
  return true;
}

/**
 * Expire all pending items that are past their expiresAt timestamp.
 * Returns the number of items expired.
 */
export function expireOldItems(): number {
  const state = load();
  const now = new Date().toISOString();
  let jsonCount = 0;

  for (const item of state.items) {
    if (item.status === "pending" && item.expiresAt <= now) {
      item.status = "expired";
      state.stats.totalExpired++;
      jsonCount++;
    }
  }

  if (jsonCount > 0) persist(state);

  let sqlCount = 0;
  const scope = getHostedRuntimeApprovalQueueScope();
  if (scope && _runtimeApprovalQueue) {
    const pending = _runtimeApprovalQueue.listItems({
      ...scope,
      status: "pending",
      limit: MAX_QUEUE_SIZE,
    });
    for (const row of pending) {
      if (row.expires_at <= now) {
        _runtimeApprovalQueue.markStatus({
          scope,
          id: row.id,
          status: "expired",
        });
        sqlCount++;
      }
    }
  }

  return Math.max(jsonCount, sqlCount);
}

// ─── Stats ──────────────────────────────────────────────────────────────────

/**
 * Compute aggregate statistics for the approval queue.
 */
export function getQueueStats(): QueueStats {
  const state = load();

  const counts: Record<QueueItemStatus, number> = {
    pending: 0,
    approved: 0,
    rejected: 0,
    edited: 0,
    expired: 0,
    posted: 0,
  };

  for (const item of state.items) {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
  }

  // Average approval time from the rolling sample
  const times = state.stats.approvalTimes;
  const avgApprovalTimeMinutes =
    times.length > 0
      ? Math.round((times.reduce((a, b) => a + b, 0) / times.length) * 100) /
        100
      : 0;

  // Edit rate = edited / (approved + edited + posted) — items that went through review
  const reviewed = state.stats.totalApproved + state.stats.totalEdited;
  const editRate =
    reviewed > 0
      ? Math.round((state.stats.totalEdited / reviewed) * 10000) / 100
      : 0;

  return {
    total: state.items.length,
    pending: counts.pending,
    approved: counts.approved + counts.edited, // edited items are effectively approved
    rejected: counts.rejected,
    expired: counts.expired,
    posted: counts.posted,
    avgApprovalTimeMinutes,
    editRate,
  };
}

// ─── Cleanup ────────────────────────────────────────────────────────────────

/**
 * Remove items older than maxAge days from the queue.
 * Only removes terminal items (posted, rejected, expired).
 * Returns the number of items removed.
 *
 * @param maxAge - Maximum age in days (default 7)
 */
export function cleanupQueue(maxAge: number = DEFAULT_CLEANUP_DAYS): number {
  const state = load();
  const cutoff = new Date(Date.now() - maxAge * 86400_000).toISOString();

  const terminalStatuses: Set<QueueItemStatus> = new Set([
    "posted",
    "rejected",
    "expired",
  ]);

  const before = state.items.length;
  const removedIds = new Set<string>();
  state.items = state.items.filter((item) => {
    // Only clean up terminal items older than cutoff
    if (terminalStatuses.has(item.status) && item.createdAt < cutoff) {
      removedIds.add(item.id);
      return false;
    }
    return true;
  });

  const removed = before - state.items.length;
  if (removed > 0) persist(state);
  if (removedIds.size > 0) {
    for (const id of removedIds) {
      deleteHostedQueueItem(id);
    }
  }
  return removed;
}
