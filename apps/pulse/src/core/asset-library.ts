/**
 * Asset Library — curated media + post URLs for reuse.
 *
 * Stores images (generated or uploaded), threads to amplify, and
 * tracks usage so auto-mode doesn't spam the same asset.
 *
 * Assets are stored as JSON metadata in data/assets.json.
 * Actual image files live in data/assets/ directory.
 * Remote images (from ClawNet gen) stored as URLs — downloaded on first use.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadState, saveState, getDataDir } from './state.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface Asset {
  id: string;
  type: 'image' | 'thread' | 'screenshot';
  /** Display label */
  name: string;
  /** Searchable tags — the universal matching language. Topics, vibes, use cases. */
  tags: string[];
  /** URL (remote) or relative path (local) to the media file */
  source: string;
  /** Local file path if downloaded — set after first download */
  localPath?: string;
  /** MIME type for images */
  mimeType?: string;
  /** For thread amplification — the tweet URL to amplify */
  threadUrl?: string;
  /** Original generation prompt (if AI-generated) */
  prompt?: string;
  /** Which image gen model was used */
  model?: string;
  /** Content categories this asset is good for */
  categories: string[];
  /** Soma provenance — birth certificate hash from generation */
  somaDataHash?: string;
  createdAt: string;
  /** Track usage to prevent over-reuse */
  usageCount: number;
  lastUsedAt?: string;
  /** Is this a favorite? Favorites get priority in auto-selection. */
  starred: boolean;
}

export interface AssetLibrary {
  assets: Asset[];
  /** Amplification queue — tweet URLs marked for boosting */
  amplifyQueue: AmplifyItem[];
}

export interface AmplifyItem {
  id: string;
  tweetUrl: string;
  tweetText: string;
  /** When to stop amplifying (ISO timestamp) */
  expiresAt: string;
  /** How many times has it been used */
  usageCount: number;
  maxUses: number;
  createdAt: string;
}

// ─── Storage ────────────────────────────────────────────────────────────────

function assetsDir(): string {
  const dir = path.join(getDataDir(), 'assets');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function loadLibrary(): AssetLibrary {
  return loadState<AssetLibrary>('assets', { assets: [], amplifyQueue: [] });
}

function saveLibrary(lib: AssetLibrary): void {
  saveState('assets', lib);
}

// ─── Asset CRUD ─────────────────────────────────────────────────────────────

function generateId(): string {
  return crypto.randomBytes(6).toString('hex');
}

/**
 * Add an image asset to the library.
 * For remote URLs (from ClawNet image gen), the image is stored as a URL reference.
 * For local files, provide the path.
 */
export function addImageAsset(opts: {
  name: string;
  tags: string[];
  source: string;
  mimeType?: string;
  prompt?: string;
  model?: string;
  categories?: string[];
  somaDataHash?: string;
}): Asset {
  const lib = loadLibrary();
  const asset: Asset = {
    id: generateId(),
    type: 'image',
    name: opts.name,
    tags: opts.tags,
    source: opts.source,
    mimeType: opts.mimeType || 'image/png',
    prompt: opts.prompt,
    model: opts.model,
    categories: opts.categories || [],
    somaDataHash: opts.somaDataHash,
    createdAt: new Date().toISOString(),
    usageCount: 0,
    starred: false,
  };
  lib.assets.push(asset);
  // Cap at 500 assets — remove oldest unstarred if over
  if (lib.assets.length > 500) {
    const unstarred = lib.assets.filter(a => !a.starred);
    unstarred.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (unstarred.length > 0) {
      const toRemove = unstarred[0];
      lib.assets = lib.assets.filter(a => a.id !== toRemove.id);
      // Clean up local file if exists
      if (toRemove.localPath) {
        try { fs.unlinkSync(path.join(assetsDir(), toRemove.localPath)); } catch {}
      }
    }
  }
  saveLibrary(lib);
  return asset;
}

/**
 * Add a thread URL to the amplification queue.
 */
export function addAmplifyItem(opts: {
  tweetUrl: string;
  tweetText: string;
  maxUses?: number;
  expiresInHours?: number;
}): AmplifyItem {
  const lib = loadLibrary();
  const item: AmplifyItem = {
    id: generateId(),
    tweetUrl: opts.tweetUrl,
    tweetText: opts.tweetText,
    expiresAt: new Date(Date.now() + (opts.expiresInHours ?? 24) * 3600_000).toISOString(),
    usageCount: 0,
    maxUses: opts.maxUses ?? 5,
    createdAt: new Date().toISOString(),
  };
  lib.amplifyQueue.push(item);
  saveLibrary(lib);
  return item;
}

/**
 * Get all assets, optionally filtered by tags/categories.
 */
export function getAssets(filter?: {
  tags?: string[];
  categories?: string[];
  type?: Asset['type'];
  starred?: boolean;
}): Asset[] {
  const lib = loadLibrary();
  let assets = lib.assets;

  if (filter?.type) {
    assets = assets.filter(a => a.type === filter.type);
  }
  if (filter?.starred !== undefined) {
    assets = assets.filter(a => a.starred === filter.starred);
  }
  if (filter?.tags && filter.tags.length > 0) {
    const searchTags = filter.tags.map(t => t.toLowerCase());
    assets = assets.filter(a =>
      a.tags.some(t => searchTags.includes(t.toLowerCase()))
    );
  }
  if (filter?.categories && filter.categories.length > 0) {
    const searchCats = filter.categories.map(c => c.toLowerCase());
    assets = assets.filter(a =>
      a.categories.some(c => searchCats.includes(c.toLowerCase()))
    );
  }

  return assets;
}

/** Update an asset's metadata (tags, name, starred) */
export function updateAsset(assetId: string, updates: Partial<Pick<Asset, 'name' | 'tags' | 'starred' | 'categories'>>): Asset | null {
  const lib = loadLibrary();
  const asset = lib.assets.find(a => a.id === assetId);
  if (!asset) return null;
  if (updates.name !== undefined) asset.name = updates.name;
  if (updates.tags !== undefined) asset.tags = updates.tags;
  if (updates.starred !== undefined) asset.starred = updates.starred;
  if (updates.categories !== undefined) asset.categories = updates.categories;
  saveLibrary(lib);
  return asset;
}

/**
 * Find the best image for a given set of tags.
 * Pure tag matching — no hardcoded categories.
 * Scoring: tag overlap > starred > less-used.
 * Per-image cooldown: starred/brand images = 6h, normal = 24h, heavily-used = 72h.
 * Returns null if no candidate has any tag overlap (won't attach random images).
 */
export function findBestImage(opts: {
  tags?: string[];
  categories?: string[];
}): Asset | null {
  const now = Date.now();

  let candidates = getAssets({
    type: 'image',
    tags: opts.tags,
    categories: opts.categories,
  });

  // Per-image adaptive cooldown
  candidates = candidates.filter(a => {
    if (!a.lastUsedAt) return true;
    const sinceUsed = now - new Date(a.lastUsedAt).getTime();
    // Starred images (brand logos etc.) reusable after 6h
    if (a.starred) return sinceUsed > 6 * 3600_000;
    // Heavily used images need longer cooldown
    if (a.usageCount >= 5) return sinceUsed > 72 * 3600_000;
    // Normal images: 24h cooldown
    return sinceUsed > 24 * 3600_000;
  });

  if (candidates.length === 0) return null;

  const searchTags = (opts.tags ?? []).map(t => t.toLowerCase());
  if (searchTags.length === 0) return null;

  // Score purely on tag overlap + starred + usage
  const scored = candidates.map(a => {
    const assetTags = a.tags.map(t => t.toLowerCase());
    const overlap = searchTags.filter(t => assetTags.some(at => at.includes(t) || t.includes(at))).length;
    const overlapRatio = searchTags.length > 0 ? overlap / searchTags.length : 0;

    return {
      asset: a,
      score: (overlap * 40)                       // tag overlap is king
        + (overlapRatio > 0.5 ? 50 : 0)           // bonus for >50% match
        + (a.starred ? 100 : 0)                    // starred = priority
        + (30 / (a.usageCount + 1)),               // prefer less-used
      overlap,
    };
  });

  // Must have at least 1 tag overlap — don't attach random images
  const withOverlap = scored.filter(s => s.overlap > 0);
  if (withOverlap.length === 0) return null;

  withOverlap.sort((a, b) => b.score - a.score);
  return withOverlap[0].asset;
}

/**
 * Record that an asset was used (increments usage, updates timestamp).
 */
export function markAssetUsed(assetId: string): void {
  const lib = loadLibrary();
  const asset = lib.assets.find(a => a.id === assetId);
  if (asset) {
    asset.usageCount++;
    asset.lastUsedAt = new Date().toISOString();
    saveLibrary(lib);
  }
}

/**
 * Toggle star on an asset.
 */
export function toggleStar(assetId: string): boolean {
  const lib = loadLibrary();
  const asset = lib.assets.find(a => a.id === assetId);
  if (!asset) return false;
  asset.starred = !asset.starred;
  saveLibrary(lib);
  return asset.starred;
}

/**
 * Delete an asset by ID.
 */
export function deleteAsset(assetId: string): boolean {
  const lib = loadLibrary();
  const idx = lib.assets.findIndex(a => a.id === assetId);
  if (idx === -1) return false;
  const asset = lib.assets[idx];
  if (asset.localPath) {
    try { fs.unlinkSync(path.join(assetsDir(), asset.localPath)); } catch {}
  }
  lib.assets.splice(idx, 1);
  saveLibrary(lib);
  return true;
}

// ─── Amplification Queue ────────────────────────────────────────────────────

/**
 * Get the next amplification item that hasn't expired or maxed out.
 */
export function getNextAmplifyItem(): AmplifyItem | null {
  const lib = loadLibrary();
  const now = new Date().toISOString();

  // Clean expired
  lib.amplifyQueue = lib.amplifyQueue.filter(item =>
    item.expiresAt > now && item.usageCount < item.maxUses
  );
  saveLibrary(lib);

  if (lib.amplifyQueue.length === 0) return null;

  // Prefer least-used
  lib.amplifyQueue.sort((a, b) => a.usageCount - b.usageCount);
  return lib.amplifyQueue[0];
}

/**
 * Record that an amplification item was used.
 */
export function markAmplifyUsed(itemId: string): void {
  const lib = loadLibrary();
  const item = lib.amplifyQueue.find(i => i.id === itemId);
  if (item) {
    item.usageCount++;
    saveLibrary(lib);
  }
}

/**
 * Remove an amplify item.
 */
export function removeAmplifyItem(itemId: string): boolean {
  const lib = loadLibrary();
  const before = lib.amplifyQueue.length;
  lib.amplifyQueue = lib.amplifyQueue.filter(i => i.id !== itemId);
  if (lib.amplifyQueue.length < before) {
    saveLibrary(lib);
    return true;
  }
  return false;
}

/**
 * Get all active amplification items.
 */
export function getAmplifyQueue(): AmplifyItem[] {
  const lib = loadLibrary();
  const now = new Date().toISOString();
  return lib.amplifyQueue.filter(item =>
    item.expiresAt > now && item.usageCount < item.maxUses
  );
}

// ─── Image Download Helper ──────────────────────────────────────────────────

/**
 * Download a remote image to local storage.
 * Returns the local file path (relative to assets dir).
 */
export async function downloadAssetImage(asset: Asset): Promise<string | null> {
  if (asset.localPath) {
    const fullPath = path.join(assetsDir(), asset.localPath);
    if (fs.existsSync(fullPath)) return asset.localPath;
  }

  if (!asset.source.startsWith('http')) return null;

  try {
    const res = await fetch(asset.source, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return null;

    const buffer = Buffer.from(await res.arrayBuffer());
    const ext = asset.mimeType?.includes('png') ? '.png'
      : asset.mimeType?.includes('jpeg') || asset.mimeType?.includes('jpg') ? '.jpg'
      : asset.mimeType?.includes('gif') ? '.gif'
      : '.png';

    const filename = `${asset.id}${ext}`;
    fs.writeFileSync(path.join(assetsDir(), filename), buffer);

    // Update asset with local path
    const lib = loadLibrary();
    const stored = lib.assets.find(a => a.id === asset.id);
    if (stored) {
      stored.localPath = filename;
      saveLibrary(lib);
    }

    return filename;
  } catch {
    return null;
  }
}
