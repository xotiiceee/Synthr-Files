/**
 * ROI / UTM link tracking for PULSE.
 * Tracks: social media post -> website visit -> conversion.
 */

import { getCRM } from '../crm/database.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TrackedLink {
  id: number;
  shortCode: string;
  originalUrl: string;
  platform: string;
  campaign: string;
  createdAt: string;
  clickCount: number;
  lastClickedAt: string | null;
  utmUrl: string;
}

export interface ROIStats {
  totalClicks: number;
  totalConversions: number;
  conversionRate: number;
  totalRevenue: number;
  costPerConversion: number;
  topPlatform: string;
  topCampaign: string;
  linkCount: number;
}

// ─── Schema Migration ───────────────────────────────────────────────────────

let migrated = false;

function ensureTables(): void {
  if (migrated) return;
  const db = getCRM();

  db.exec(`
    CREATE TABLE IF NOT EXISTS link_clicks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      short_code TEXT UNIQUE NOT NULL,
      original_url TEXT NOT NULL,
      platform TEXT NOT NULL,
      campaign TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      click_count INTEGER DEFAULT 0,
      last_clicked_at TEXT
    );

    CREATE TABLE IF NOT EXISTS conversions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      link_id INTEGER REFERENCES link_clicks(id),
      lead_id INTEGER REFERENCES leads(id),
      type TEXT NOT NULL,
      value_usd REAL DEFAULT 0,
      created_at TEXT NOT NULL,
      metadata TEXT DEFAULT '{}'
    );

    CREATE INDEX IF NOT EXISTS idx_link_clicks_short_code ON link_clicks(short_code);
    CREATE INDEX IF NOT EXISTS idx_link_clicks_platform ON link_clicks(platform);
    CREATE INDEX IF NOT EXISTS idx_conversions_link_id ON conversions(link_id);
    CREATE INDEX IF NOT EXISTS idx_conversions_type ON conversions(type);
  `);

  migrated = true;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function generateShortCode(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

interface LinkRow {
  id: number;
  short_code: string;
  original_url: string;
  platform: string;
  campaign: string;
  created_at: string;
  click_count: number;
  last_clicked_at: string | null;
}

function rowToLink(row: LinkRow): TrackedLink {
  const base = row.original_url.includes('?') ? row.original_url + '&' : row.original_url + '?';
  const utmUrl = `${base}utm_source=pulse&utm_medium=${encodeURIComponent(row.platform)}&utm_campaign=${encodeURIComponent(row.campaign || 'default')}&utm_content=${row.short_code}`;

  return {
    id: row.id,
    shortCode: row.short_code,
    originalUrl: row.original_url,
    platform: row.platform,
    campaign: row.campaign,
    createdAt: row.created_at,
    clickCount: row.click_count,
    lastClickedAt: row.last_clicked_at,
    utmUrl,
  };
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Create a tracked link with UTM parameters.
 */
export function createTrackedLink(url: string, platform: string, campaign?: string): TrackedLink {
  ensureTables();
  const db = getCRM();
  const now = new Date().toISOString();

  // Generate unique short code
  let shortCode = generateShortCode();
  let attempts = 0;
  while (attempts < 10) {
    const existing = db.prepare('SELECT 1 FROM link_clicks WHERE short_code = ?').get(shortCode);
    if (!existing) break;
    shortCode = generateShortCode();
    attempts++;
  }

  const result = db.prepare(`
    INSERT INTO link_clicks (short_code, original_url, platform, campaign, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(shortCode, url, platform, campaign || '', now);

  const row: LinkRow = {
    id: Number(result.lastInsertRowid),
    short_code: shortCode,
    original_url: url,
    platform,
    campaign: campaign || '',
    created_at: now,
    click_count: 0,
    last_clicked_at: null,
  };

  return rowToLink(row);
}

/**
 * List tracked links, most recent first.
 */
export function getTrackedLinks(limit: number = 50): TrackedLink[] {
  ensureTables();
  const rows = getCRM().prepare(
    'SELECT * FROM link_clicks ORDER BY created_at DESC LIMIT ?'
  ).all(limit) as LinkRow[];
  return rows.map(rowToLink);
}

/**
 * Record a click on a tracked link.
 */
export function recordClick(shortCode: string): void {
  ensureTables();
  const now = new Date().toISOString();
  getCRM().prepare(`
    UPDATE link_clicks
    SET click_count = click_count + 1, last_clicked_at = ?
    WHERE short_code = ?
  `).run(now, shortCode);
}

/**
 * Record a conversion event.
 */
export function recordConversion(data: {
  linkId?: number;
  leadId?: number;
  type: string;
  valueUsd?: number;
}): void {
  ensureTables();
  const now = new Date().toISOString();
  getCRM().prepare(`
    INSERT INTO conversions (link_id, lead_id, type, value_usd, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(data.linkId ?? null, data.leadId ?? null, data.type, data.valueUsd ?? 0, now);
}

/**
 * Get ROI stats for a given period.
 */
export function getROIStats(period: 'day' | 'week' | 'month'): ROIStats {
  ensureTables();
  const db = getCRM();

  const since = new Date();
  if (period === 'day') since.setHours(0, 0, 0, 0);
  else if (period === 'week') since.setDate(since.getDate() - 7);
  else since.setDate(since.getDate() - 30);
  const sinceStr = since.toISOString();

  const clicksRow = db.prepare(
    'SELECT COALESCE(SUM(click_count), 0) as total, COUNT(*) as cnt FROM link_clicks WHERE created_at >= ?'
  ).get(sinceStr) as { total: number; cnt: number };

  const convRow = db.prepare(
    'SELECT COUNT(*) as cnt, COALESCE(SUM(value_usd), 0) as revenue FROM conversions WHERE created_at >= ?'
  ).get(sinceStr) as { cnt: number; revenue: number };

  const topPlatformRow = db.prepare(`
    SELECT platform, SUM(click_count) as total
    FROM link_clicks WHERE created_at >= ?
    GROUP BY platform ORDER BY total DESC LIMIT 1
  `).get(sinceStr) as { platform: string; total: number } | undefined;

  const topCampaignRow = db.prepare(`
    SELECT campaign, SUM(click_count) as total
    FROM link_clicks WHERE created_at >= ? AND campaign != ''
    GROUP BY campaign ORDER BY total DESC LIMIT 1
  `).get(sinceStr) as { campaign: string; total: number } | undefined;

  const totalClicks = clicksRow.total;
  const totalConversions = convRow.cnt;
  const totalRevenue = convRow.revenue;

  return {
    totalClicks,
    totalConversions,
    conversionRate: totalClicks > 0 ? Math.round((totalConversions / totalClicks) * 10000) / 100 : 0,
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    costPerConversion: totalConversions > 0 ? Math.round((totalRevenue / totalConversions) * 100) / 100 : 0,
    topPlatform: topPlatformRow?.platform || 'none',
    topCampaign: topCampaignRow?.campaign || 'none',
    linkCount: clicksRow.cnt,
  };
}

/**
 * Get conversion breakdown by platform.
 */
export function getConversionsByPlatform(): Record<string, { clicks: number; conversions: number; rate: number; revenue: number }> {
  ensureTables();
  const db = getCRM();

  const platforms = db.prepare(
    'SELECT DISTINCT platform FROM link_clicks'
  ).all() as { platform: string }[];

  const result: Record<string, { clicks: number; conversions: number; rate: number; revenue: number }> = {};

  for (const { platform } of platforms) {
    const clickRow = db.prepare(
      'SELECT COALESCE(SUM(click_count), 0) as clicks FROM link_clicks WHERE platform = ?'
    ).get(platform) as { clicks: number };

    const convRow = db.prepare(`
      SELECT COUNT(*) as cnt, COALESCE(SUM(c.value_usd), 0) as revenue
      FROM conversions c
      JOIN link_clicks l ON c.link_id = l.id
      WHERE l.platform = ?
    `).get(platform) as { cnt: number; revenue: number };

    const clicks = clickRow.clicks;
    const conversions = convRow.cnt;

    result[platform] = {
      clicks,
      conversions,
      rate: clicks > 0 ? Math.round((conversions / clicks) * 10000) / 100 : 0,
      revenue: Math.round(convRow.revenue * 100) / 100,
    };
  }

  return result;
}
