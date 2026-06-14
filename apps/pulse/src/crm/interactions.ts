import { getCRM } from './database.js';
import { Lead, getLeadById, updateLeadScore } from './leads.js';

export interface Interaction {
  id: number;
  leadId: number;
  platform: string;
  type: string;
  ourContent: string | null;
  theirContent: string | null;
  url: string | null;
  createdAt: string;
}

export interface FollowUp {
  id: number;
  leadId: number;
  platform: string;
  action: string;
  message: string | null;
  dueAt: string;
  completedAt: string | null;
  status: string;
  lead?: Lead;
}

interface InteractionRow {
  id: number;
  lead_id: number;
  platform: string;
  type: string;
  our_content: string | null;
  their_content: string | null;
  url: string | null;
  created_at: string;
  metadata: string;
}

interface FollowUpRow {
  id: number;
  lead_id: number;
  platform: string;
  action: string;
  message: string | null;
  due_at: string;
  completed_at: string | null;
  status: string;
}

function rowToInteraction(row: InteractionRow): Interaction {
  return {
    id: row.id,
    leadId: row.lead_id,
    platform: row.platform,
    type: row.type,
    ourContent: row.our_content,
    theirContent: row.their_content,
    url: row.url,
    createdAt: row.created_at,
  };
}

function rowToFollowUp(row: FollowUpRow, lead?: Lead): FollowUp {
  return {
    id: row.id,
    leadId: row.lead_id,
    platform: row.platform,
    action: row.action,
    message: row.message,
    dueAt: row.due_at,
    completedAt: row.completed_at,
    status: row.status,
    ...(lead ? { lead } : {}),
  };
}

export function logInteraction(data: {
  leadId: number;
  platform: string;
  type: string;
  ourContent?: string;
  theirContent?: string;
  url?: string;
}): void {
  const db = getCRM();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO interactions (lead_id, platform, type, our_content, their_content, url, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.leadId,
    data.platform,
    data.type,
    data.ourContent ?? null,
    data.theirContent ?? null,
    data.url ?? null,
    now
  );

  db.prepare('UPDATE leads SET last_interaction_at = ? WHERE id = ?').run(now, data.leadId);

  updateLeadScore(data.leadId);
}

export function getInteractionsForLead(leadId: number, limit: number = 50): Interaction[] {
  const rows = getCRM().prepare(
    'SELECT * FROM interactions WHERE lead_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(leadId, limit) as InteractionRow[];
  return rows.map(rowToInteraction);
}

export function getRecentInteractions(limit: number = 50): Interaction[] {
  const rows = getCRM().prepare(
    'SELECT * FROM interactions ORDER BY created_at DESC LIMIT ?'
  ).all(limit) as InteractionRow[];
  return rows.map(rowToInteraction);
}

export function createFollowUp(data: {
  leadId: number;
  platform: string;
  action: string;
  message?: string;
  dueAt: string;
}): void {
  getCRM().prepare(`
    INSERT INTO follow_ups (lead_id, platform, action, message, due_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(data.leadId, data.platform, data.action, data.message ?? null, data.dueAt);
}

export function getPendingFollowUps(limit: number = 20): FollowUp[] {
  const db = getCRM();
  const now = new Date().toISOString();

  const rows = db.prepare(`
    SELECT f.*, l.id as l_id, l.platform as l_platform, l.platform_id, l.username,
           l.profile_url, l.first_seen_at, l.last_interaction_at, l.interaction_count,
           l.score, l.status as l_status, l.tags, l.notes
    FROM follow_ups f
    JOIN leads l ON f.lead_id = l.id
    WHERE f.due_at <= ? AND f.status = 'pending'
    ORDER BY f.due_at ASC
    LIMIT ?
  `).all(now, limit) as any[];

  return rows.map(row => {
    const lead: Lead = {
      id: row.l_id,
      platform: row.l_platform,
      platformId: row.platform_id,
      username: row.username,
      profileUrl: row.profile_url,
      firstSeenAt: row.first_seen_at,
      lastInteractionAt: row.last_interaction_at,
      interactionCount: row.interaction_count,
      score: row.score,
      status: row.l_status,
      tags: JSON.parse(row.tags || '[]'),
      notes: row.notes,
    };

    return rowToFollowUp({
      id: row.id,
      lead_id: row.lead_id,
      platform: row.platform,
      action: row.action,
      message: row.message,
      due_at: row.due_at,
      completed_at: row.completed_at,
      status: row.status,
    }, lead);
  });
}

export function completeFollowUp(id: number): void {
  const now = new Date().toISOString();
  getCRM().prepare(
    "UPDATE follow_ups SET status = 'completed', completed_at = ? WHERE id = ?"
  ).run(now, id);
}

export function skipFollowUp(id: number): void {
  getCRM().prepare(
    "UPDATE follow_ups SET status = 'skipped' WHERE id = ?"
  ).run(id);
}

export function autoScheduleFollowUp(leadId: number): void {
  const db = getCRM();

  // Check if the lead has received a reply from us
  const hasReply = db.prepare(
    "SELECT 1 FROM interactions WHERE lead_id = ? AND type = 'reply_received' LIMIT 1"
  ).get(leadId);
  if (!hasReply) return;

  // Check if there's already a pending follow-up
  const pendingExists = db.prepare(
    "SELECT 1 FROM follow_ups WHERE lead_id = ? AND status = 'pending' LIMIT 1"
  ).get(leadId);
  if (pendingExists) return;

  // Schedule a check_in for 3 days later
  const lead = getLeadById(leadId);
  if (!lead) return;

  const dueAt = new Date();
  dueAt.setDate(dueAt.getDate() + 3);

  createFollowUp({
    leadId,
    platform: lead.platform,
    action: 'check_in',
    message: `Follow up with @${lead.username} — they replied to our content.`,
    dueAt: dueAt.toISOString(),
  });
}
