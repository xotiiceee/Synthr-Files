/**
 * JSON-file state management for PULSE.
 * Tracks replied posts, daily counts, action history, adaptation data.
 * All state stored in data/ directory as JSON files.
 */

import fs from "fs";
import path from "path";

let DATA_DIR = path.join(process.cwd(), "data");
let _runtimeOutreachDedup:
  | typeof import("../../hosted/repositories/runtime-outreach-dedup.js").runtimeOutreachDedupRepository
  | null = null;
let _getContext: (() => { tenantId: string } | undefined) | null = null;
let _runtimeActionLog:
  | typeof import("../../hosted/repositories/runtime-action-log.js").runtimeActionLogRepository
  | null = null;
let _resolveRuntimeActionLogScope:
  | typeof import("../../hosted/repositories/runtime-action-log.js").resolveRuntimeActionLogScope
  | null = null;
try {
  const ctx = await import("../../hosted/context.js");
  _getContext = ctx.getContext;
  const outreachDedup =
    await import("../../hosted/repositories/runtime-outreach-dedup.js");
  _runtimeOutreachDedup = outreachDedup.runtimeOutreachDedupRepository;
  const runtimeActionLog =
    await import("../../hosted/repositories/runtime-action-log.js");
  _runtimeActionLog = runtimeActionLog.runtimeActionLogRepository;
  _resolveRuntimeActionLogScope = runtimeActionLog.resolveRuntimeActionLogScope;
} catch {
  /* self-hosted mode — hosted repository not available */
}

function getContextDataDirProvider(): (() => string | undefined) | undefined {
  return (
    globalThis as typeof globalThis & {
      __pulseGetContextDataDir?: () => string | undefined;
    }
  ).__pulseGetContextDataDir;
}

function getContextTenantIdProvider(): (() => string | undefined) | undefined {
  return (
    globalThis as typeof globalThis & {
      __pulseGetContextTenantId?: () => string | undefined;
    }
  ).__pulseGetContextTenantId;
}

function getContextAgentIdProvider(): (() => string | undefined) | undefined {
  return (
    globalThis as typeof globalThis & {
      __pulseGetContextAgentId?: () => string | undefined;
    }
  ).__pulseGetContextAgentId;
}

function getLegacyAgentIdProvider(): (() => string | undefined) | undefined {
  return (
    globalThis as typeof globalThis & {
      __pulseGetLegacyActiveAgentId?: () => string | undefined;
    }
  ).__pulseGetLegacyActiveAgentId;
}

/** Override the data directory (used by hosted multi-tenant layer) */
export function setDataDir(dir: string): void {
  DATA_DIR = dir;
}

/** Get the current data directory */
export function getDataDir(): string {
  return getContextDataDirProvider()?.() ?? DATA_DIR;
}

function ensureDataDir(): void {
  const dir = getDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function stateFile(name: string): string {
  return path.join(getDataDir(), `${name}.json`);
}

/**
 * Load a state file. Returns default value if missing or corrupted.
 */
export function loadState<T>(name: string, defaultValue: T): T {
  ensureDataDir();
  const file = stateFile(name);
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, "utf-8"));
    }
  } catch {
    // Main file corrupted — try backup
    try {
      const bak = file + ".bak";
      if (fs.existsSync(bak)) {
        console.warn(`[State] ${name}.json corrupted, loading from backup`);
        return JSON.parse(fs.readFileSync(bak, "utf-8"));
      }
    } catch {
      /* backup also corrupted */
    }
  }
  return defaultValue;
}

/**
 * Save a state file atomically with lock (write to tmp, rename).
 * Uses a lockfile to prevent concurrent writes to the same state file.
 */
const activeLocks = new Set<string>();

export function saveState<T>(name: string, data: T): void {
  ensureDataDir();
  const file = stateFile(name);
  const lockFile = file + ".lock";

  // Spin-wait for lock (max 2 seconds)
  const deadline = Date.now() + 2000;
  while (activeLocks.has(file) || fs.existsSync(lockFile)) {
    if (Date.now() > deadline) {
      // Stale lock — break it
      try {
        fs.unlinkSync(lockFile);
      } catch {}
      break;
    }
    // Busy wait 5ms (synchronous context, no async available)
    const start = Date.now();
    while (Date.now() - start < 5) {}
  }

  // Acquire lock
  activeLocks.add(file);
  try {
    fs.writeFileSync(lockFile, String(process.pid));
  } catch {}

  try {
    // Backup existing state before overwriting (best-effort)
    try {
      if (fs.existsSync(file)) {
        fs.copyFileSync(file, file + ".bak");
      }
    } catch {
      /* backup is best-effort */
    }
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
  } finally {
    // Release lock
    activeLocks.delete(file);
    try {
      fs.unlinkSync(lockFile);
    } catch {}
  }
}

/**
 * Delete a state file and its backup.
 */
export function deleteState(name: string): void {
  const file = stateFile(name);
  try {
    fs.unlinkSync(file);
  } catch {}
  try {
    fs.unlinkSync(file + ".bak");
  } catch {}
}

// ─── Outreach State ──────────────────────────────────────────────────────────

export interface OutreachState {
  repliedIds: string[]; // Post IDs we've already replied to (dedup)
  dailyCounts: Record<string, number>; // "2026-03-14" => 5
  lastRunAt: string;
  totalReplies: number;
  totalSearches: number;
}

const DEFAULT_OUTREACH: OutreachState = {
  repliedIds: [],
  dailyCounts: {},
  lastRunAt: "",
  totalReplies: 0,
  totalSearches: 0,
};

export function loadOutreachState(): OutreachState {
  const state = loadState("outreach", DEFAULT_OUTREACH);
  const tenantId = getContextTenantIdProvider()?.();
  if (tenantId && _runtimeOutreachDedup) {
    return {
      ...state,
      repliedIds: _runtimeOutreachDedup.listRepliedIds({ tenantId }),
    };
  }
  return state;
}

export function saveOutreachState(state: OutreachState): void {
  // Cap dedup list at 2000 entries
  if (state.repliedIds.length > 2000) {
    state.repliedIds = state.repliedIds.slice(-2000);
  }
  // Clean daily counts older than 7 days
  const cutoff = new Date(Date.now() - 7 * 86400_000)
    .toISOString()
    .slice(0, 10);
  for (const date of Object.keys(state.dailyCounts)) {
    if (date < cutoff) delete state.dailyCounts[date];
  }
  const tenantId = getContextTenantIdProvider()?.();
  if (tenantId && _runtimeOutreachDedup) {
    _runtimeOutreachDedup.upsertRepliedIds({
      tenantId,
      postIds: state.repliedIds,
    });
  }
  saveState("outreach", state);
}

// ─── Action Log (for analytics + adaptation) ────────────────────────────────

export interface ActionRecord {
  id: string;
  timestamp: string;
  platform: string;
  type: "reply" | "thread-reply" | "post" | "like" | "repost" | "comment";
  topicId: string;
  content: string;
  targetText?: string;
  targetUrl?: string;
  theme?: string;
  engagement?: {
    likes: number;
    replies: number;
    reposts: number;
  };
}

export function logAction(action: ActionRecord): void {
  const actions = loadState<ActionRecord[]>("actions", []);
  actions.push(action);
  // Keep last 500 actions
  if (actions.length > 500) actions.splice(0, actions.length - 500);
  saveState("actions", actions);

  try {
    const scope = getHostedRuntimeActionLogScope();
    if (scope && _runtimeActionLog) {
      _runtimeActionLog.appendAction(scope, action);
    }
  } catch (error) {
    console.warn("[State] runtime action log SQL append failed:", error);
  }
}

export function getActions(since?: string): ActionRecord[] {
  const scope = getHostedRuntimeActionLogScope();
  if (scope && _runtimeActionLog) {
    try {
      const actions = _runtimeActionLog.listActions({
        ...scope,
        since,
        limit: 500,
      });
      if (actions.length > 0) return actions;
    } catch (error) {
      console.warn("[State] runtime action log SQL read failed:", error);
    }
  }
  return getJsonActions(since);
}

function getJsonActions(since?: string): ActionRecord[] {
  const actions = loadState<ActionRecord[]>("actions", []);
  if (!since) return actions;
  return actions.filter((a) => a.timestamp >= since);
}

function getHostedRuntimeActionLogScope():
  | import("../../hosted/repositories/runtime-action-log.js").RuntimeActionLogScope
  | null {
  const tenantId = _getContext?.()?.tenantId;
  if (!tenantId || !_resolveRuntimeActionLogScope) return null;
  return (
    _resolveRuntimeActionLogScope({
      tenantId,
      agentId: getCurrentAgentId(),
    }) ?? null
  );
}

function getCurrentAgentId(): string {
  return (
    getContextAgentIdProvider()?.()?.trim() ||
    getLegacyAgentIdProvider()?.()?.trim() ||
    "default"
  );
}

// ─── Adaptation State ────────────────────────────────────────────────────────

export interface AdaptationState {
  lastAdaptedAt: string;
  actionsSinceLastAdaptation: number;
  retiredTopics: string[];
  addedTopics: Array<{ id: string; query: string; reason: string }>;
  toneAdjustments: string[];
  bestTimeSlots: string[];
  insights: string[];
}

export function loadAdaptationState(): AdaptationState {
  return loadState<AdaptationState>("adaptation", {
    lastAdaptedAt: "",
    actionsSinceLastAdaptation: 0,
    retiredTopics: [],
    addedTopics: [],
    toneAdjustments: [],
    bestTimeSlots: [],
    insights: [],
  });
}

export function saveAdaptationState(state: AdaptationState): void {
  // Cap growing arrays
  if (state.retiredTopics.length > 200)
    state.retiredTopics = state.retiredTopics.slice(-200);
  if (state.addedTopics.length > 200)
    state.addedTopics = state.addedTopics.slice(-200);
  saveState("adaptation", state);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function getTodayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
