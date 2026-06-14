import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { getDataDir } from '../core/state.js';

const CRM_DB_FILENAME = 'pulse-crm.db';
const dbs = new Map<string, Database.Database>();

function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL,
      platform_id TEXT NOT NULL,
      username TEXT NOT NULL,
      profile_url TEXT,
      first_seen_at TEXT NOT NULL,
      last_interaction_at TEXT NOT NULL,
      interaction_count INTEGER DEFAULT 1,
      score INTEGER DEFAULT 0,
      status TEXT DEFAULT 'new',
      tags TEXT DEFAULT '[]',
      notes TEXT DEFAULT '',
      UNIQUE(platform, platform_id)
    );

    CREATE TABLE IF NOT EXISTS interactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL REFERENCES leads(id),
      platform TEXT NOT NULL,
      type TEXT NOT NULL,
      our_content TEXT,
      their_content TEXT,
      url TEXT,
      created_at TEXT NOT NULL,
      metadata TEXT DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS follow_ups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL REFERENCES leads(id),
      platform TEXT NOT NULL,
      action TEXT NOT NULL,
      message TEXT,
      due_at TEXT NOT NULL,
      completed_at TEXT,
      status TEXT DEFAULT 'pending'
    );

    CREATE INDEX IF NOT EXISTS idx_leads_platform ON leads(platform, platform_id);
    CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
    CREATE INDEX IF NOT EXISTS idx_leads_score ON leads(score DESC);
    CREATE INDEX IF NOT EXISTS idx_interactions_lead_id ON interactions(lead_id);
    CREATE INDEX IF NOT EXISTS idx_interactions_created_at ON interactions(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_follow_ups_due_at ON follow_ups(due_at);
    CREATE INDEX IF NOT EXISTS idx_follow_ups_status ON follow_ups(status);

    CREATE TABLE IF NOT EXISTS chat_conversations (
      id TEXT PRIMARY KEY,
      status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL REFERENCES chat_conversations(id),
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_chat_messages_convo ON chat_messages(conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_chat_conversations_status ON chat_conversations(status);
  `);

  // Migration: add agent_id to chat_conversations
  try {
    db.exec(`ALTER TABLE chat_conversations ADD COLUMN agent_id TEXT DEFAULT 'default'`);
  } catch { /* column already exists */ }
}

export function getCRMPath(): string {
  return path.join(getDataDir(), CRM_DB_FILENAME);
}

export function initCRM(dbPath: string = getCRMPath()): Database.Database {
  const resolvedPath = path.resolve(dbPath);
  const existing = dbs.get(resolvedPath);
  if (existing?.open) return existing;

  const dataDir = path.dirname(resolvedPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const db = new Database(resolvedPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  runMigrations(db);
  dbs.set(resolvedPath, db);
  return db;
}

export function getCRM(): Database.Database {
  return initCRM(getCRMPath());
}

export function closeCRM(): void {
  for (const db of dbs.values()) {
    if (db.open) db.close();
  }
  dbs.clear();
}
