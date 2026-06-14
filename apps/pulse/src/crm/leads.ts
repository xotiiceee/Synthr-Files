import { getCRM } from './database.js';

export interface Lead {
  id: number;
  platform: string;
  platformId: string;
  username: string;
  profileUrl: string | null;
  firstSeenAt: string;
  lastInteractionAt: string;
  interactionCount: number;
  score: number;
  status: string;
  tags: string[];
  notes: string;
}

interface LeadRow {
  id: number;
  platform: string;
  platform_id: string;
  username: string;
  profile_url: string | null;
  first_seen_at: string;
  last_interaction_at: string;
  interaction_count: number;
  score: number;
  status: string;
  tags: string;
  notes: string;
}

function rowToLead(row: LeadRow): Lead {
  return {
    id: row.id,
    platform: row.platform,
    platformId: row.platform_id,
    username: row.username,
    profileUrl: row.profile_url,
    firstSeenAt: row.first_seen_at,
    lastInteractionAt: row.last_interaction_at,
    interactionCount: row.interaction_count,
    score: row.score,
    status: row.status,
    tags: JSON.parse(row.tags || '[]'),
    notes: row.notes,
  };
}

export function upsertLead(data: {
  platform: string;
  platformId: string;
  username: string;
  profileUrl?: string;
}): Lead {
  const db = getCRM();
  const now = new Date().toISOString();

  const existing = db.prepare(
    'SELECT * FROM leads WHERE platform = ? AND platform_id = ?'
  ).get(data.platform, data.platformId) as LeadRow | undefined;

  if (existing) {
    db.prepare(`
      UPDATE leads
      SET username = ?, last_interaction_at = ?, interaction_count = interaction_count + 1
      WHERE id = ?
    `).run(data.username, now, existing.id);

    return rowToLead({
      ...existing,
      username: data.username,
      last_interaction_at: now,
      interaction_count: existing.interaction_count + 1,
    });
  }

  const result = db.prepare(`
    INSERT INTO leads (platform, platform_id, username, profile_url, first_seen_at, last_interaction_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(data.platform, data.platformId, data.username, data.profileUrl ?? null, now, now);

  return {
    id: Number(result.lastInsertRowid),
    platform: data.platform,
    platformId: data.platformId,
    username: data.username,
    profileUrl: data.profileUrl ?? null,
    firstSeenAt: now,
    lastInteractionAt: now,
    interactionCount: 1,
    score: 0,
    status: 'new',
    tags: [],
    notes: '',
  };
}

export function updateLeadScore(leadId: number): void {
  const db = getCRM();

  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId) as LeadRow | undefined;
  if (!lead) return;

  // Interaction count score: ×10, max 30
  const interactionScore = Math.min(lead.interaction_count * 10, 30);

  // Recency score
  const daysSinceInteraction = (Date.now() - new Date(lead.last_interaction_at).getTime()) / (1000 * 60 * 60 * 24);
  let recencyScore = 0;
  if (daysSinceInteraction < 7) recencyScore = 30;
  else if (daysSinceInteraction < 30) recencyScore = 20;
  else if (daysSinceInteraction < 90) recencyScore = 10;

  // Reply received bonus (+20)
  const hasReply = db.prepare(
    "SELECT 1 FROM interactions WHERE lead_id = ? AND type = 'reply_received' LIMIT 1"
  ).get(leadId);
  const replyScore = hasReply ? 20 : 0;

  // Follow bonus (+20)
  const hasFollow = db.prepare(
    "SELECT 1 FROM interactions WHERE lead_id = ? AND type = 'follow' LIMIT 1"
  ).get(leadId);
  const followScore = hasFollow ? 20 : 0;

  const totalScore = Math.min(interactionScore + recencyScore + replyScore + followScore, 100);

  db.prepare('UPDATE leads SET score = ? WHERE id = ?').run(totalScore, leadId);
}

export function updateLeadStatus(leadId: number, status: string): void {
  getCRM().prepare('UPDATE leads SET status = ? WHERE id = ?').run(status, leadId);
}

export function addTag(leadId: number, tag: string): void {
  const db = getCRM();
  const row = db.prepare('SELECT tags FROM leads WHERE id = ?').get(leadId) as { tags: string } | undefined;
  if (!row) return;

  const tags: string[] = JSON.parse(row.tags || '[]');
  if (!tags.includes(tag)) {
    tags.push(tag);
    db.prepare('UPDATE leads SET tags = ? WHERE id = ?').run(JSON.stringify(tags), leadId);
  }
}

export function removeTag(leadId: number, tag: string): void {
  const db = getCRM();
  const row = db.prepare('SELECT tags FROM leads WHERE id = ?').get(leadId) as { tags: string } | undefined;
  if (!row) return;

  const tags: string[] = JSON.parse(row.tags || '[]');
  const filtered = tags.filter(t => t !== tag);
  if (filtered.length !== tags.length) {
    db.prepare('UPDATE leads SET tags = ? WHERE id = ?').run(JSON.stringify(filtered), leadId);
  }
}

export function getLeadById(id: number): Lead | null {
  const row = getCRM().prepare('SELECT * FROM leads WHERE id = ?').get(id) as LeadRow | undefined;
  return row ? rowToLead(row) : null;
}

export function getLeadByPlatform(platform: string, platformId: string): Lead | null {
  const row = getCRM().prepare(
    'SELECT * FROM leads WHERE platform = ? AND platform_id = ?'
  ).get(platform, platformId) as LeadRow | undefined;
  return row ? rowToLead(row) : null;
}

export function listLeads(options: {
  status?: string;
  minScore?: number;
  platform?: string;
  limit?: number;
  offset?: number;
  sortBy?: string;
} = {}): Lead[] {
  const conditions: string[] = [];
  const params: any[] = [];

  if (options.status) {
    conditions.push('status = ?');
    params.push(options.status);
  }
  if (options.minScore !== undefined) {
    conditions.push('score >= ?');
    params.push(options.minScore);
  }
  if (options.platform) {
    conditions.push('platform = ?');
    params.push(options.platform);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const validSortColumns: Record<string, string> = {
    score: 'score DESC',
    recent: 'last_interaction_at DESC',
    interactions: 'interaction_count DESC',
    oldest: 'first_seen_at ASC',
  };
  const orderBy = validSortColumns[options.sortBy ?? 'score'] ?? 'score DESC';

  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;

  const rows = getCRM().prepare(
    `SELECT * FROM leads ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as LeadRow[];

  return rows.map(rowToLead);
}

export function getHotLeads(limit: number = 20): Lead[] {
  const rows = getCRM().prepare(
    'SELECT * FROM leads WHERE score >= 60 ORDER BY score DESC LIMIT ?'
  ).all(limit) as LeadRow[];
  return rows.map(rowToLead);
}

export function getLeadStats(): {
  total: number;
  new: number;
  warm: number;
  hot: number;
  customer: number;
  lost: number;
  avgScore: number;
} {
  const db = getCRM();

  const total = (db.prepare('SELECT COUNT(*) as c FROM leads').get() as any).c;
  const byStatus = db.prepare(
    "SELECT status, COUNT(*) as c FROM leads GROUP BY status"
  ).all() as { status: string; c: number }[];

  const statusMap: Record<string, number> = {};
  for (const row of byStatus) {
    statusMap[row.status] = row.c;
  }

  const avgRow = db.prepare('SELECT AVG(score) as avg FROM leads').get() as { avg: number | null };

  return {
    total,
    new: statusMap['new'] ?? 0,
    warm: statusMap['warm'] ?? 0,
    hot: statusMap['hot'] ?? 0,
    customer: statusMap['customer'] ?? 0,
    lost: statusMap['lost'] ?? 0,
    avgScore: Math.round(avgRow.avg ?? 0),
  };
}
