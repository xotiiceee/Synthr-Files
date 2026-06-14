/**
 * Hosted Pulse — Master Database
 *
 * Single SQLite database tracking all tenants, subscriptions, and usage.
 * Separate from per-tenant Pulse CRM databases.
 */

import Database from "better-sqlite3";
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";

const DB_PATH =
  process.env.HOSTED_DB_PATH || path.join(process.cwd(), "data", "hosted.db");

let db: Database.Database | null = null;

export function getHostedDb(): Database.Database {
  if (db) return db;

  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  runMigrations(db);
  runGitHubMigrations(db);
  return db;
}

function runMigrations(d: Database.Database): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      api_key TEXT UNIQUE NOT NULL,
      clawnet_user_id TEXT DEFAULT '',
      email TEXT NOT NULL,
      name TEXT DEFAULT '',
      plan TEXT DEFAULT 'credits',
      status TEXT DEFAULT 'active',
      selected_runtime_agent_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS orgs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      billing_email TEXT NOT NULL DEFAULT '',
      legacy_tenant_id TEXT REFERENCES tenants(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL DEFAULT '',
      email_verified INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS email_verification_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      token TEXT UNIQUE NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS memberships (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      role TEXT NOT NULL DEFAULT 'operator',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(org_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS brands (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      workspace_id TEXT REFERENCES workspaces(id),
      name TEXT NOT NULL,
      legacy_tenant_id TEXT REFERENCES tenants(id),
      legacy_agent_id TEXT NOT NULL DEFAULT '',
      runtime_config_json TEXT NOT NULL DEFAULT '{}',
      runtime_enabled INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS brand_connections (
      id TEXT PRIMARY KEY,
      brand_id TEXT NOT NULL REFERENCES brands(id),
      provider TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'disconnected',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(brand_id, provider)
    );

    CREATE TABLE IF NOT EXISTS brand_profiles (
      brand_id TEXT NOT NULL REFERENCES brands(id),
      tenant_id TEXT NOT NULL DEFAULT '',
      org_id TEXT NOT NULL DEFAULT '',
      workspace_id TEXT NOT NULL DEFAULT '',
      agent_id TEXT NOT NULL DEFAULT '',
      profile_json TEXT NOT NULL DEFAULT '{}',
      source TEXT NOT NULL DEFAULT 'unknown',
      source_label TEXT NOT NULL DEFAULT '',
      source_url TEXT NOT NULL DEFAULT '',
      actor_id TEXT NOT NULL DEFAULT '',
      lock_state TEXT NOT NULL DEFAULT 'editable',
      version INTEGER NOT NULL DEFAULT 1,
      confidence REAL NOT NULL DEFAULT 1,
      decay TEXT NOT NULL DEFAULT 'none',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (tenant_id, org_id, workspace_id, brand_id, agent_id)
    );

    CREATE TABLE IF NOT EXISTS brand_knowledge_notes (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT '',
      org_id TEXT NOT NULL DEFAULT '',
      workspace_id TEXT NOT NULL DEFAULT '',
      brand_id TEXT NOT NULL REFERENCES brands(id),
      agent_id TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      priority INTEGER NOT NULL DEFAULT 1,
      locked INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'unknown',
      source_label TEXT NOT NULL DEFAULT '',
      source_url TEXT NOT NULL DEFAULT '',
      actor_id TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 1,
      confidence REAL NOT NULL DEFAULT 1,
      decay TEXT NOT NULL DEFAULT 'none',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(tenant_id, org_id, workspace_id, brand_id, agent_id, title)
    );

    CREATE TABLE IF NOT EXISTS tenant_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      date TEXT NOT NULL,
      llm_calls INTEGER DEFAULT 0,
      search_calls INTEGER DEFAULT 0,
      outreach_runs INTEGER DEFAULT 0,
      content_posts INTEGER DEFAULT 0,
      follows INTEGER DEFAULT 0,
      UNIQUE(tenant_id, date)
    );

    CREATE TABLE IF NOT EXISTS usage_events (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT UNIQUE NOT NULL,
      tenant_id TEXT NOT NULL DEFAULT '',
      org_id TEXT NOT NULL DEFAULT '',
      workspace_id TEXT NOT NULL DEFAULT '',
      brand_id TEXT NOT NULL DEFAULT '',
      agent_id TEXT NOT NULL DEFAULT '',
      actor_id TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL,
      event_type TEXT NOT NULL,
      quantity REAL NOT NULL DEFAULT 1,
      unit TEXT NOT NULL DEFAULT 'event',
      credits REAL NOT NULL DEFAULT 0,
      provider TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tenant_secrets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      key_name TEXT NOT NULL,
      encrypted_value TEXT NOT NULL,
      iv TEXT NOT NULL,
      auth_tag TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(tenant_id, key_name)
    );

    CREATE TABLE IF NOT EXISTS tenant_notes (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      priority INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tenant_pins (
      tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
      pin_hash TEXT NOT NULL,
      recovery_email TEXT NOT NULL DEFAULT '',
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS otp_codes (
      tenant_id TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_tenants_apikey ON tenants(api_key);
    CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);
    CREATE INDEX IF NOT EXISTS idx_orgs_legacy_tenant ON orgs(legacy_tenant_id);
    CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id);
    CREATE INDEX IF NOT EXISTS idx_workspaces_org ON workspaces(org_id);
    CREATE INDEX IF NOT EXISTS idx_brands_org ON brands(org_id);
    CREATE INDEX IF NOT EXISTS idx_brands_workspace ON brands(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_brand_connections_brand ON brand_connections(brand_id);
    CREATE INDEX IF NOT EXISTS idx_brand_profiles_org_brand
      ON brand_profiles(org_id, brand_id, agent_id);
    CREATE INDEX IF NOT EXISTS idx_brand_profiles_tenant_brand
      ON brand_profiles(tenant_id, brand_id, agent_id);
    CREATE INDEX IF NOT EXISTS idx_brand_knowledge_notes_scope_priority
      ON brand_knowledge_notes(tenant_id, org_id, workspace_id, brand_id, agent_id, priority DESC, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_brand_knowledge_notes_source
      ON brand_knowledge_notes(brand_id, source, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_usage_tenant_date ON tenant_usage(tenant_id, date);
    CREATE INDEX IF NOT EXISTS idx_usage_events_tenant_created ON usage_events(tenant_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_usage_events_brand_created ON usage_events(brand_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_usage_events_type ON usage_events(event_type);
    CREATE INDEX IF NOT EXISTS idx_secrets_tenant ON tenant_secrets(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_notes_tenant ON tenant_notes(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_notes_tenant_priority ON tenant_notes(tenant_id, priority DESC);
    CREATE INDEX IF NOT EXISTS idx_otp_expires ON otp_codes(expires_at);

    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      type TEXT NOT NULL DEFAULT 'suggestion',
      message TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_feedback_tenant ON feedback(tenant_id);

    -- Adaptive preference signals: every user action that reveals a preference
    CREATE TABLE IF NOT EXISTS preference_signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      agent_id TEXT NOT NULL DEFAULT 'default',
      signal_type TEXT NOT NULL,
      signal_data TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_signals_tenant_agent ON preference_signals(tenant_id, agent_id);
    CREATE INDEX IF NOT EXISTS idx_signals_type ON preference_signals(signal_type);

    -- Learned preference profile: structured data built from signals
    CREATE TABLE IF NOT EXISTS preference_profiles (
      tenant_id TEXT NOT NULL,
      agent_id TEXT NOT NULL DEFAULT 'default',
      strategic_posture TEXT NOT NULL DEFAULT 'unknown',
      competitor_stance TEXT NOT NULL DEFAULT 'unknown',
      content_style TEXT NOT NULL DEFAULT 'unknown',
      risk_tolerance TEXT NOT NULL DEFAULT 'moderate',
      communication TEXT NOT NULL DEFAULT 'unknown',
      autonomy TEXT NOT NULL DEFAULT 'unknown',
      chat_style TEXT NOT NULL DEFAULT 'unknown',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (tenant_id, agent_id)
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT '',
      org_id TEXT NOT NULL DEFAULT '',
      workspace_id TEXT NOT NULL DEFAULT '',
      brand_id TEXT NOT NULL DEFAULT '',
      agent_id TEXT NOT NULL DEFAULT '',
      actor_id TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL,
      target_type TEXT NOT NULL DEFAULT '',
      target_id TEXT NOT NULL DEFAULT '',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_audit_tenant_created ON audit_events(tenant_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_events(action);

    CREATE TABLE IF NOT EXISTS safety_events (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT '',
      org_id TEXT NOT NULL DEFAULT '',
      workspace_id TEXT NOT NULL DEFAULT '',
      brand_id TEXT NOT NULL DEFAULT '',
      agent_id TEXT NOT NULL DEFAULT '',
      severity TEXT NOT NULL DEFAULT 'info',
      source TEXT NOT NULL,
      event_type TEXT NOT NULL,
      message TEXT NOT NULL DEFAULT '',
      metadata TEXT NOT NULL DEFAULT '{}',
      resolved_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_safety_tenant_created ON safety_events(tenant_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_safety_type ON safety_events(event_type);

    CREATE TABLE IF NOT EXISTS runtime_action_logs (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT '',
      org_id TEXT NOT NULL DEFAULT '',
      workspace_id TEXT NOT NULL DEFAULT '',
      brand_id TEXT NOT NULL DEFAULT '',
      agent_id TEXT NOT NULL DEFAULT '',
      timestamp TEXT NOT NULL,
      platform TEXT NOT NULL,
      action_type TEXT NOT NULL,
      topic_id TEXT NOT NULL,
      content TEXT NOT NULL,
      target_text TEXT NOT NULL DEFAULT '',
      target_url TEXT NOT NULL DEFAULT '',
      theme TEXT NOT NULL DEFAULT '',
      engagement TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_runtime_action_logs_brand_agent_time
      ON runtime_action_logs(brand_id, agent_id, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_runtime_action_logs_workspace_brand_time
      ON runtime_action_logs(workspace_id, brand_id, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_runtime_action_logs_org_brand_time
      ON runtime_action_logs(org_id, brand_id, timestamp DESC);

    CREATE TABLE IF NOT EXISTS runtime_approval_queue (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT '',
      org_id TEXT NOT NULL DEFAULT '',
      workspace_id TEXT NOT NULL DEFAULT '',
      brand_id TEXT NOT NULL DEFAULT '',
      agent_id TEXT NOT NULL DEFAULT '',
      item_type TEXT NOT NULL,
      platform TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL,
      risk_flags TEXT NOT NULL DEFAULT '[]',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      reviewed_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_runtime_approval_queue_brand_status
      ON runtime_approval_queue(brand_id, agent_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_runtime_approval_queue_tenant_status
      ON runtime_approval_queue(tenant_id, status, created_at DESC);

    CREATE TABLE IF NOT EXISTS runtime_content_queue (
      tenant_id TEXT NOT NULL DEFAULT '',
      org_id TEXT NOT NULL DEFAULT '',
      workspace_id TEXT NOT NULL DEFAULT '',
      brand_id TEXT NOT NULL DEFAULT '',
      agent_id TEXT NOT NULL DEFAULT '',
      item_id INTEGER NOT NULL,
      platform TEXT NOT NULL,
      item_type TEXT NOT NULL,
      content TEXT NOT NULL,
      theme TEXT NOT NULL DEFAULT '',
      scheduled_at TEXT NOT NULL,
      published_at TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      post_url TEXT NOT NULL DEFAULT '',
      engagement_score REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (tenant_id, org_id, workspace_id, brand_id, agent_id, item_id)
    );
    CREATE INDEX IF NOT EXISTS idx_runtime_content_queue_brand_status_scheduled
      ON runtime_content_queue(brand_id, agent_id, status, scheduled_at ASC, item_id ASC);
    CREATE INDEX IF NOT EXISTS idx_runtime_content_queue_tenant_status
      ON runtime_content_queue(tenant_id, status, scheduled_at ASC, item_id ASC);

    CREATE TABLE IF NOT EXISTS runtime_x_rate_counters (
      tenant_id TEXT NOT NULL,
      account_id TEXT NOT NULL DEFAULT '',
      month_key TEXT NOT NULL,
      post_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, account_id, month_key),
      CHECK(post_count >= 0)
    );
    CREATE INDEX IF NOT EXISTS idx_runtime_x_rate_counters_tenant_month
      ON runtime_x_rate_counters(tenant_id, month_key);

    CREATE TABLE IF NOT EXISTS runtime_schedule_state (
      tenant_id TEXT NOT NULL,
      agent_id TEXT NOT NULL DEFAULT '',
      task_type TEXT NOT NULL,
      last_run TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, agent_id, task_type)
    );
    CREATE INDEX IF NOT EXISTS idx_runtime_schedule_state_tenant_task
      ON runtime_schedule_state(tenant_id, task_type);

    CREATE TABLE IF NOT EXISTS runtime_outreach_dedup (
      tenant_id TEXT NOT NULL,
      agent_id TEXT NOT NULL DEFAULT '',
      platform TEXT NOT NULL DEFAULT '',
      post_id TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, agent_id, platform, post_id)
    );
    CREATE INDEX IF NOT EXISTS idx_runtime_outreach_dedup_tenant_seen
      ON runtime_outreach_dedup(tenant_id, first_seen_at DESC);

    CREATE TABLE IF NOT EXISTS privacy_requests (
      id TEXT PRIMARY KEY,
      subject_type TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL DEFAULT '',
      org_id TEXT NOT NULL DEFAULT '',
      user_id TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'record_only',
      status TEXT NOT NULL DEFAULT 'pending',
      requested_by TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_privacy_requests_subject
      ON privacy_requests(subject_type, subject_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_privacy_requests_tenant
      ON privacy_requests(tenant_id, created_at DESC);
  `);

  ensureColumn(d, "audit_events", "org_id", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(d, "audit_events", "workspace_id", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(d, "audit_events", "brand_id", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(d, "safety_events", "org_id", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(d, "safety_events", "workspace_id", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(d, "safety_events", "brand_id", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(d, "brand_profiles", "tenant_id", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(d, "brand_profiles", "org_id", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(d, "brand_profiles", "workspace_id", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(d, "brand_profiles", "agent_id", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(
    d,
    "brand_profiles",
    "profile_json",
    "TEXT NOT NULL DEFAULT '{}'",
  );
  ensureColumn(
    d,
    "brand_profiles",
    "source",
    "TEXT NOT NULL DEFAULT 'unknown'",
  );
  ensureColumn(d, "brand_profiles", "source_label", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(d, "brand_profiles", "source_url", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(d, "brand_profiles", "actor_id", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(
    d,
    "brand_profiles",
    "lock_state",
    "TEXT NOT NULL DEFAULT 'editable'",
  );
  ensureColumn(d, "brand_profiles", "version", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(d, "brand_profiles", "confidence", "REAL NOT NULL DEFAULT 1");
  ensureColumn(d, "brand_profiles", "decay", "TEXT NOT NULL DEFAULT 'none'");
  ensureColumn(
    d,
    "brand_knowledge_notes",
    "tenant_id",
    "TEXT NOT NULL DEFAULT ''",
  );
  ensureColumn(
    d,
    "brand_knowledge_notes",
    "org_id",
    "TEXT NOT NULL DEFAULT ''",
  );
  ensureColumn(
    d,
    "brand_knowledge_notes",
    "workspace_id",
    "TEXT NOT NULL DEFAULT ''",
  );
  ensureColumn(
    d,
    "brand_knowledge_notes",
    "agent_id",
    "TEXT NOT NULL DEFAULT ''",
  );
  ensureColumn(d, "brand_knowledge_notes", "title", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(
    d,
    "brand_knowledge_notes",
    "content",
    "TEXT NOT NULL DEFAULT ''",
  );
  ensureColumn(
    d,
    "brand_knowledge_notes",
    "tags",
    "TEXT NOT NULL DEFAULT '[]'",
  );
  ensureColumn(
    d,
    "brand_knowledge_notes",
    "priority",
    "INTEGER NOT NULL DEFAULT 1",
  );
  ensureColumn(
    d,
    "brand_knowledge_notes",
    "locked",
    "INTEGER NOT NULL DEFAULT 0",
  );
  ensureColumn(
    d,
    "brand_knowledge_notes",
    "source",
    "TEXT NOT NULL DEFAULT 'unknown'",
  );
  ensureColumn(
    d,
    "brand_knowledge_notes",
    "source_label",
    "TEXT NOT NULL DEFAULT ''",
  );
  ensureColumn(
    d,
    "brand_knowledge_notes",
    "source_url",
    "TEXT NOT NULL DEFAULT ''",
  );
  ensureColumn(
    d,
    "brand_knowledge_notes",
    "actor_id",
    "TEXT NOT NULL DEFAULT ''",
  );
  ensureColumn(
    d,
    "brand_knowledge_notes",
    "version",
    "INTEGER NOT NULL DEFAULT 1",
  );
  ensureColumn(
    d,
    "brand_knowledge_notes",
    "confidence",
    "REAL NOT NULL DEFAULT 1",
  );
  ensureColumn(
    d,
    "brand_knowledge_notes",
    "decay",
    "TEXT NOT NULL DEFAULT 'none'",
  );
  ensureColumn(d, "brands", "runtime_enabled", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(d, "brands", "deleted_at", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(
    d,
    "brands",
    "runtime_config_json",
    "TEXT NOT NULL DEFAULT '{}'",
  );
  ensureColumn(
    d,
    "tenants",
    "selected_runtime_agent_id",
    "TEXT NOT NULL DEFAULT ''",
  );
  ensureColumn(
    d,
    "users",
    "email_verified",
    "INTEGER NOT NULL DEFAULT 0",
  );

  d.exec(`
    CREATE INDEX IF NOT EXISTS idx_audit_brand_created ON audit_events(brand_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_safety_brand_created ON safety_events(brand_id, created_at DESC);
  `);
}

function ensureColumn(
  d: Database.Database,
  table: string,
  column: string,
  definition: string,
): void {
  const columns = d.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
  if (columns.some((c) => c.name === column)) return;
  d.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
}

// ─── Tenant CRUD ────────────────────────────────────────────────────────────

export interface Tenant {
  id: string;
  api_key: string;
  clawnet_user_id: string;
  email: string;
  name: string;
  plan: "credits";
  status: "active" | "suspended" | "deleted";
  selected_runtime_agent_id: string;
  created_at: string;
  updated_at: string;
}

export interface PrivacyRequest {
  id: string;
  subject_type: "tenant" | "org" | "user";
  subject_id: string;
  tenant_id: string;
  org_id: string;
  user_id: string;
  action: "export" | "delete" | "anonymize";
  mode: "record_only" | "soft_delete";
  status: "pending" | "in_progress" | "completed" | "manual_review_required";
  requested_by: string;
  notes: string;
  metadata: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface CreatePrivacyRequestInput {
  subjectType: PrivacyRequest["subject_type"];
  subjectId: string;
  tenantId?: string;
  orgId?: string;
  userId?: string;
  action: PrivacyRequest["action"];
  mode?: PrivacyRequest["mode"];
  status?: PrivacyRequest["status"];
  requestedBy?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
}

export function createTenant(
  apiKey: string,
  clawnetUserId: string,
  email: string,
  name?: string,
): Tenant {
  const id = "tn_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);

  getHostedDb()
    .prepare(
      `INSERT INTO tenants (id, api_key, clawnet_user_id, email, name, plan)
       VALUES (?, ?, ?, ?, ?, 'credits')`,
    )
    .run(id, apiKey, clawnetUserId, email, name || "");

  return getTenantByApiKey(apiKey)!;
}

export function getTenant(id: string): Tenant | null {
  return getHostedDb()
    .prepare("SELECT * FROM tenants WHERE id = ?")
    .get(id) as Tenant | null;
}

export function getTenantByApiKey(apiKey: string): Tenant | null {
  return getHostedDb()
    .prepare("SELECT * FROM tenants WHERE api_key = ?")
    .get(apiKey) as Tenant | null;
}

export function getTenantByEmail(email: string): Tenant | null {
  return getHostedDb()
    .prepare("SELECT * FROM tenants WHERE email = ? LIMIT 1")
    .get(email) as Tenant | null;
}

export function listTenants(status?: string): Tenant[] {
  if (status) {
    return getHostedDb()
      .prepare(
        "SELECT * FROM tenants WHERE status = ? ORDER BY created_at DESC",
      )
      .all(status) as Tenant[];
  }
  return getHostedDb()
    .prepare("SELECT * FROM tenants ORDER BY created_at DESC")
    .all() as Tenant[];
}

export function updateTenantStatus(
  tenantId: string,
  status: Tenant["status"],
): void {
  getHostedDb()
    .prepare(
      "UPDATE tenants SET status = ?, updated_at = datetime('now') WHERE id = ?",
    )
    .run(status, tenantId);
}

export function createPrivacyRequest(
  input: CreatePrivacyRequestInput,
): PrivacyRequest {
  const id = "prv_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
  getHostedDb()
    .prepare(
      `INSERT INTO privacy_requests
       (id, subject_type, subject_id, tenant_id, org_id, user_id, action, mode, status, requested_by, notes, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.subjectType,
      input.subjectId,
      input.tenantId || "",
      input.orgId || "",
      input.userId || "",
      input.action,
      input.mode || "record_only",
      input.status || "pending",
      input.requestedBy || "",
      input.notes || "",
      JSON.stringify(input.metadata || {}),
    );
  return getPrivacyRequest(id)!;
}

export function getPrivacyRequest(id: string): PrivacyRequest | null {
  return getHostedDb()
    .prepare("SELECT * FROM privacy_requests WHERE id = ?")
    .get(id) as PrivacyRequest | null;
}

export function listPrivacyRequests(input?: {
  tenantId?: string;
  orgId?: string;
  userId?: string;
  subjectType?: PrivacyRequest["subject_type"];
  subjectId?: string;
  limit?: number;
}): PrivacyRequest[] {
  const filters: string[] = [];
  const values: Array<string | number> = [];
  if (input?.tenantId) {
    filters.push("tenant_id = ?");
    values.push(input.tenantId);
  }
  if (input?.orgId) {
    filters.push("org_id = ?");
    values.push(input.orgId);
  }
  if (input?.userId) {
    filters.push("user_id = ?");
    values.push(input.userId);
  }
  if (input?.subjectType) {
    filters.push("subject_type = ?");
    values.push(input.subjectType);
  }
  if (input?.subjectId) {
    filters.push("subject_id = ?");
    values.push(input.subjectId);
  }
  const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
  values.push(input?.limit ?? 50);
  return getHostedDb()
    .prepare(
      `SELECT * FROM privacy_requests ${where} ORDER BY created_at DESC LIMIT ?`,
    )
    .all(...values) as PrivacyRequest[];
}

export function updatePrivacyRequest(
  id: string,
  input: {
    status: PrivacyRequest["status"];
    metadata?: Record<string, unknown>;
    notes?: string;
    completedAt?: string | null;
  },
): void {
  const current = getPrivacyRequest(id);
  if (!current) return;
  const mergedMetadata = {
    ...(current.metadata ? JSON.parse(current.metadata) : {}),
    ...(input.metadata || {}),
  };
  getHostedDb()
    .prepare(
      `UPDATE privacy_requests
       SET status = ?, notes = ?, metadata = ?, updated_at = datetime('now'), completed_at = ?
       WHERE id = ?`,
    )
    .run(
      input.status,
      input.notes ?? current.notes,
      JSON.stringify(mergedMetadata),
      input.completedAt === undefined
        ? input.status === "completed"
          ? new Date().toISOString()
          : current.completed_at
        : input.completedAt,
      id,
    );
}

// ─── Standalone Identity Model ─────────────────────────────────────────────

export interface Org {
  id: string;
  name: string;
  billing_email: string;
  legacy_tenant_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  email_verified: 0 | 1;
  created_at: string;
  updated_at: string;
}

export interface Membership {
  id: string;
  org_id: string;
  user_id: string;
  role: "owner" | "admin" | "approver" | "operator" | "viewer";
  created_at: string;
}

export interface Workspace {
  id: string;
  org_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface Brand {
  id: string;
  org_id: string;
  workspace_id: string | null;
  name: string;
  legacy_tenant_id: string | null;
  legacy_agent_id: string;
  runtime_config_json: string;
  runtime_enabled: 0 | 1;
  deleted_at: string;
  created_at: string;
  updated_at: string;
}

export interface BrandConnection {
  id: string;
  brand_id: string;
  provider: string;
  status: "connected" | "disconnected" | "error";
  metadata: string;
  created_at: string;
  updated_at: string;
}

export interface BrandProfileRow {
  brand_id: string;
  tenant_id: string;
  org_id: string;
  workspace_id: string;
  agent_id: string;
  profile_json: string;
  source: string;
  source_label: string;
  source_url: string;
  actor_id: string;
  lock_state: "editable" | "locked";
  version: number;
  confidence: number;
  decay: string;
  created_at: string;
  updated_at: string;
}

export interface BrandKnowledgeNoteRow {
  id: string;
  tenant_id: string;
  org_id: string;
  workspace_id: string;
  brand_id: string;
  agent_id: string;
  title: string;
  content: string;
  tags: string;
  priority: number;
  locked: 0 | 1;
  source: string;
  source_label: string;
  source_url: string;
  actor_id: string;
  version: number;
  confidence: number;
  decay: string;
  created_at: string;
  updated_at: string;
}

export interface RuntimeActionLogRow {
  id: string;
  tenant_id: string;
  org_id: string;
  workspace_id: string;
  brand_id: string;
  agent_id: string;
  timestamp: string;
  platform: string;
  action_type:
    | "reply"
    | "thread-reply"
    | "post"
    | "like"
    | "repost"
    | "comment";
  topic_id: string;
  content: string;
  target_text: string;
  target_url: string;
  theme: string;
  engagement: string;
  created_at: string;
}

export interface RuntimeContentQueueRow {
  tenant_id: string;
  org_id: string;
  workspace_id: string;
  brand_id: string;
  agent_id: string;
  item_id: number;
  platform: string;
  item_type: string;
  content: string;
  theme: string;
  scheduled_at: string;
  published_at: string;
  status: string;
  post_url: string;
  engagement_score: number;
  created_at: string;
  metadata: string;
  updated_at: string;
}

export function createOrg(input: {
  name: string;
  billingEmail?: string;
  legacyTenantId?: string;
}): Org {
  const id = "org_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  getHostedDb()
    .prepare(
      "INSERT INTO orgs (id, name, billing_email, legacy_tenant_id) VALUES (?, ?, ?, ?)",
    )
    .run(
      id,
      input.name,
      input.billingEmail || "",
      input.legacyTenantId || null,
    );
  return getOrg(id)!;
}

export function getOrg(id: string): Org | null {
  return getHostedDb()
    .prepare("SELECT * FROM orgs WHERE id = ?")
    .get(id) as Org | null;
}

export function createUser(input: {
  email: string;
  name?: string;
  passwordHash?: string;
}): User {
  const id = "usr_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  getHostedDb()
    .prepare(
      "INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)",
    )
    .run(id, input.email, input.name || "", input.passwordHash || "");
  return getUserByEmail(input.email)!;
}

export function getUser(id: string): User | null {
  return getHostedDb()
    .prepare("SELECT * FROM users WHERE id = ?")
    .get(id) as User | null;
}

export function getUserByEmail(email: string): User | null {
  return getHostedDb()
    .prepare("SELECT * FROM users WHERE email = ?")
    .get(email) as User | null;
}

export function createVerificationToken(userId: string): string {
  const id = "vt_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  getHostedDb()
    .prepare(
      "INSERT INTO email_verification_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)",
    )
    .run(id, userId, token, expiresAt);
  return token;
}

export function getVerificationToken(
  token: string,
): { id: string; user_id: string; token: string; expires_at: string } | null {
  return getHostedDb()
    .prepare(
      "SELECT * FROM email_verification_tokens WHERE token = ? AND expires_at > datetime('now')",
    )
    .get(token) as
    | { id: string; user_id: string; token: string; expires_at: string }
    | null;
}

export function markUserEmailVerified(userId: string): void {
  getHostedDb()
    .prepare("UPDATE users SET email_verified = 1 WHERE id = ?")
    .run(userId);
}

export function deleteVerificationToken(token: string): void {
  getHostedDb()
    .prepare("DELETE FROM email_verification_tokens WHERE token = ?")
    .run(token);
}

export function addMembership(
  orgId: string,
  userId: string,
  role: Membership["role"] = "operator",
): Membership {
  const id = "mem_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  getHostedDb()
    .prepare(
      `INSERT INTO memberships (id, org_id, user_id, role)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(org_id, user_id) DO UPDATE SET role = excluded.role`,
    )
    .run(id, orgId, userId, role);
  return getHostedDb()
    .prepare("SELECT * FROM memberships WHERE org_id = ? AND user_id = ?")
    .get(orgId, userId) as Membership;
}

export function listMembershipsForUser(userId: string): Membership[] {
  return getHostedDb()
    .prepare(
      "SELECT * FROM memberships WHERE user_id = ? ORDER BY created_at DESC",
    )
    .all(userId) as Membership[];
}

export function getMembership(
  orgId: string,
  userId: string,
): Membership | null {
  return getHostedDb()
    .prepare("SELECT * FROM memberships WHERE org_id = ? AND user_id = ?")
    .get(orgId, userId) as Membership | null;
}

export function createWorkspace(orgId: string, name: string): Workspace {
  const id = "ws_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  getHostedDb()
    .prepare("INSERT INTO workspaces (id, org_id, name) VALUES (?, ?, ?)")
    .run(id, orgId, name);
  return getWorkspace(id)!;
}

export function getWorkspace(id: string): Workspace | null {
  return getHostedDb()
    .prepare("SELECT * FROM workspaces WHERE id = ?")
    .get(id) as Workspace | null;
}

export function createBrand(input: {
  orgId: string;
  workspaceId?: string | null;
  name: string;
  legacyTenantId?: string | null;
  legacyAgentId?: string;
}): Brand {
  const id = "br_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  getHostedDb()
    .prepare(
      `INSERT INTO brands (id, org_id, workspace_id, name, legacy_tenant_id, legacy_agent_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.orgId,
      input.workspaceId || null,
      input.name,
      input.legacyTenantId || null,
      input.legacyAgentId || "",
    );
  return getBrand(id)!;
}

export function getBrand(id: string): Brand | null {
  return getHostedDb()
    .prepare("SELECT * FROM brands WHERE id = ?")
    .get(id) as Brand | null;
}

export function listBrandsForOrg(orgId: string): Brand[] {
  return getHostedDb()
    .prepare("SELECT * FROM brands WHERE org_id = ? ORDER BY created_at DESC")
    .all(orgId) as Brand[];
}

export function upsertBrandConnection(input: {
  brandId: string;
  provider: string;
  status?: BrandConnection["status"];
  metadata?: Record<string, unknown>;
}): BrandConnection {
  const id = "bc_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  getHostedDb()
    .prepare(
      `INSERT INTO brand_connections (id, brand_id, provider, status, metadata)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(brand_id, provider) DO UPDATE SET
         status = excluded.status,
         metadata = excluded.metadata,
         updated_at = datetime('now')`,
    )
    .run(
      id,
      input.brandId,
      input.provider,
      input.status || "disconnected",
      JSON.stringify(input.metadata || {}),
    );
  return getHostedDb()
    .prepare(
      "SELECT * FROM brand_connections WHERE brand_id = ? AND provider = ?",
    )
    .get(input.brandId, input.provider) as BrandConnection;
}

export function listBrandConnections(brandId: string): BrandConnection[] {
  return getHostedDb()
    .prepare(
      "SELECT * FROM brand_connections WHERE brand_id = ? ORDER BY provider ASC",
    )
    .all(brandId) as BrandConnection[];
}

// ─── Usage Tracking ─────────────────────────────────────────────────────────

export function incrementUsage(
  tenantId: string,
  field:
    | "llm_calls"
    | "search_calls"
    | "outreach_runs"
    | "content_posts"
    | "follows",
  amount: number = 1,
): void {
  const date = new Date().toISOString().slice(0, 10);
  getHostedDb()
    .prepare(
      `INSERT INTO tenant_usage (tenant_id, date, ${field}) VALUES (?, ?, ?)
       ON CONFLICT(tenant_id, date) DO UPDATE SET ${field} = ${field} + ?`,
    )
    .run(tenantId, date, amount, amount);
}

export function getUsage(
  tenantId: string,
  date?: string,
): Record<string, number> {
  const d = date || new Date().toISOString().slice(0, 10);
  const row = getHostedDb()
    .prepare("SELECT * FROM tenant_usage WHERE tenant_id = ? AND date = ?")
    .get(tenantId, d) as any;
  return {
    llm_calls: row?.llm_calls || 0,
    search_calls: row?.search_calls || 0,
    outreach_runs: row?.outreach_runs || 0,
    content_posts: row?.content_posts || 0,
    follows: row?.follows || 0,
  };
}

export function getMonthlyUsage(tenantId: string): Record<string, number> {
  const monthStart = new Date().toISOString().slice(0, 7) + "-01";
  const row = getHostedDb()
    .prepare(
      `SELECT SUM(llm_calls) as llm_calls, SUM(search_calls) as search_calls,
       SUM(outreach_runs) as outreach_runs, SUM(content_posts) as content_posts,
       SUM(follows) as follows
       FROM tenant_usage WHERE tenant_id = ? AND date >= ?`,
    )
    .get(tenantId, monthStart) as any;
  return {
    llm_calls: row?.llm_calls || 0,
    search_calls: row?.search_calls || 0,
    outreach_runs: row?.outreach_runs || 0,
    content_posts: row?.content_posts || 0,
    follows: row?.follows || 0,
  };
}

export interface UsageEvent {
  id: string;
  idempotency_key: string;
  tenant_id: string;
  org_id: string;
  workspace_id: string;
  brand_id: string;
  agent_id: string;
  actor_id: string;
  source: string;
  event_type: string;
  quantity: number;
  unit: string;
  credits: number;
  provider: string;
  model: string;
  metadata: string;
  created_at: string;
}

export interface NewUsageEvent {
  idempotencyKey: string;
  tenantId?: string;
  orgId?: string;
  workspaceId?: string;
  brandId?: string;
  agentId?: string;
  actorId?: string;
  source: string;
  eventType: string;
  quantity?: number;
  unit?: string;
  credits?: number;
  provider?: string;
  model?: string;
  metadata?: Record<string, unknown>;
}

export function recordUsageEvent(event: NewUsageEvent): UsageEvent {
  const id = "use_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
  getHostedDb()
    .prepare(
      `INSERT INTO usage_events
       (id, idempotency_key, tenant_id, org_id, workspace_id, brand_id, agent_id, actor_id,
        source, event_type, quantity, unit, credits, provider, model, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(idempotency_key) DO NOTHING`,
    )
    .run(
      id,
      event.idempotencyKey,
      event.tenantId || "",
      event.orgId || "",
      event.workspaceId || "",
      event.brandId || "",
      event.agentId || "",
      event.actorId || "",
      event.source,
      event.eventType,
      event.quantity ?? 1,
      event.unit || "event",
      event.credits ?? 0,
      event.provider || "",
      event.model || "",
      JSON.stringify(event.metadata || {}),
    );
  return getUsageEventByIdempotencyKey(event.idempotencyKey)!;
}

export function getUsageEventByIdempotencyKey(
  idempotencyKey: string,
): UsageEvent | null {
  return getHostedDb()
    .prepare("SELECT * FROM usage_events WHERE idempotency_key = ?")
    .get(idempotencyKey) as UsageEvent | null;
}

export function listUsageEvents(
  tenantId: string,
  limit: number = 50,
): UsageEvent[] {
  return getHostedDb()
    .prepare(
      "SELECT * FROM usage_events WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?",
    )
    .all(tenantId, limit) as UsageEvent[];
}

// ─── Secret Storage ─────────────────────────────────────────────────────────

export function storeSecret(
  tenantId: string,
  keyName: string,
  encryptedValue: string,
  iv: string,
  authTag: string,
): void {
  getHostedDb()
    .prepare(
      `INSERT INTO tenant_secrets (tenant_id, key_name, encrypted_value, iv, auth_tag)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(tenant_id, key_name) DO UPDATE SET
       encrypted_value = ?, iv = ?, auth_tag = ?, updated_at = datetime('now')`,
    )
    .run(
      tenantId,
      keyName,
      encryptedValue,
      iv,
      authTag,
      encryptedValue,
      iv,
      authTag,
    );
}

export function getSecret(
  tenantId: string,
  keyName: string,
): { encrypted_value: string; iv: string; auth_tag: string } | null {
  return getHostedDb()
    .prepare(
      "SELECT encrypted_value, iv, auth_tag FROM tenant_secrets WHERE tenant_id = ? AND key_name = ?",
    )
    .get(tenantId, keyName) as any;
}

// ─── PIN Management ──────────────────────────────────────────────────────────

export function setPinHash(
  tenantId: string,
  pinHash: string,
  email?: string,
): void {
  if (email) {
    getHostedDb()
      .prepare(
        `INSERT INTO tenant_pins (tenant_id, pin_hash, recovery_email) VALUES (?, ?, ?)
         ON CONFLICT(tenant_id) DO UPDATE SET pin_hash = ?, recovery_email = ?, updated_at = datetime('now')`,
      )
      .run(tenantId, pinHash, email, pinHash, email);
  } else {
    getHostedDb()
      .prepare(
        `INSERT INTO tenant_pins (tenant_id, pin_hash) VALUES (?, ?)
         ON CONFLICT(tenant_id) DO UPDATE SET pin_hash = ?, updated_at = datetime('now')`,
      )
      .run(tenantId, pinHash, pinHash);
  }
}

export function getPinHash(tenantId: string): string | null {
  const row = getHostedDb()
    .prepare("SELECT pin_hash FROM tenant_pins WHERE tenant_id = ?")
    .get(tenantId) as { pin_hash: string } | undefined;
  return row?.pin_hash ?? null;
}

export function getPinRecoveryEmail(tenantId: string): string | null {
  const row = getHostedDb()
    .prepare("SELECT recovery_email FROM tenant_pins WHERE tenant_id = ?")
    .get(tenantId) as { recovery_email: string } | undefined;
  return row?.recovery_email || null;
}

export function hasPin(tenantId: string): boolean {
  return getPinHash(tenantId) !== null;
}

export function recordPinFailure(tenantId: string): {
  locked: boolean;
  retryAfterSec: number;
} {
  // Exponential backoff: 0, 0, 30s, 60s, 120s, 300s, 600s...
  const row = getHostedDb()
    .prepare("SELECT failed_attempts FROM tenant_pins WHERE tenant_id = ?")
    .get(tenantId) as { failed_attempts: number } | undefined;
  const attempts = (row?.failed_attempts ?? 0) + 1;
  const backoffSec =
    attempts <= 2 ? 0 : Math.min(600, 30 * Math.pow(2, attempts - 3));
  const lockedUntil =
    backoffSec > 0
      ? new Date(Date.now() + backoffSec * 1000).toISOString()
      : null;
  getHostedDb()
    .prepare(
      "UPDATE tenant_pins SET failed_attempts = ?, locked_until = ? WHERE tenant_id = ?",
    )
    .run(attempts, lockedUntil, tenantId);
  return { locked: backoffSec > 0, retryAfterSec: backoffSec };
}

export function isPinLocked(tenantId: string): {
  locked: boolean;
  retryAfterSec: number;
} {
  const row = getHostedDb()
    .prepare("SELECT locked_until FROM tenant_pins WHERE tenant_id = ?")
    .get(tenantId) as { locked_until: string | null } | undefined;
  if (!row?.locked_until) return { locked: false, retryAfterSec: 0 };
  const remaining = Math.max(
    0,
    Math.ceil((new Date(row.locked_until).getTime() - Date.now()) / 1000),
  );
  return { locked: remaining > 0, retryAfterSec: remaining };
}

export function resetPinFailures(tenantId: string): void {
  getHostedDb()
    .prepare(
      "UPDATE tenant_pins SET failed_attempts = 0, locked_until = NULL WHERE tenant_id = ?",
    )
    .run(tenantId);
}

// ─── OTP Storage (DB-persisted, survives restarts) ───────────────────────────

export function storeOtp(
  tenantId: string,
  code: string,
  expiresAt: string,
): void {
  getHostedDb()
    .prepare(
      `INSERT INTO otp_codes (tenant_id, code, expires_at, attempts)
       VALUES (?, ?, ?, 0)
       ON CONFLICT(tenant_id) DO UPDATE SET code = ?, expires_at = ?, attempts = 0, created_at = datetime('now')`,
    )
    .run(tenantId, code, expiresAt, code, expiresAt);
}

export function getOtp(
  tenantId: string,
): { code: string; expires_at: string; attempts: number } | null {
  return (
    (getHostedDb()
      .prepare(
        "SELECT code, expires_at, attempts FROM otp_codes WHERE tenant_id = ?",
      )
      .get(tenantId) as any) ?? null
  );
}

export function incrementOtpAttempts(tenantId: string): void {
  getHostedDb()
    .prepare("UPDATE otp_codes SET attempts = attempts + 1 WHERE tenant_id = ?")
    .run(tenantId);
}

export function deleteOtp(tenantId: string): void {
  getHostedDb()
    .prepare("DELETE FROM otp_codes WHERE tenant_id = ?")
    .run(tenantId);
}

export function cleanExpiredOtps(): void {
  getHostedDb()
    .prepare("DELETE FROM otp_codes WHERE expires_at < datetime('now')")
    .run();
}

export function listSecretKeys(tenantId: string): string[] {
  const rows = getHostedDb()
    .prepare("SELECT key_name FROM tenant_secrets WHERE tenant_id = ?")
    .all(tenantId) as any[];
  return rows.map((r) => r.key_name);
}

export function deleteSecret(tenantId: string, keyName: string): void {
  getHostedDb()
    .prepare("DELETE FROM tenant_secrets WHERE tenant_id = ? AND key_name = ?")
    .run(tenantId, keyName);
}

// ─── Knowledge Notes ────────────────────────────────────────────────────────

export interface TenantNote {
  id: string;
  tenant_id: string;
  title: string;
  content: string;
  tags: string; // JSON array string
  priority: number; // 0=normal, 1=always include
  created_at: string;
  updated_at: string;
}

export function createNote(
  tenantId: string,
  title: string,
  content: string,
  tags: string[] = [],
  priority: number = 0,
): TenantNote {
  const id = "note_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  getHostedDb()
    .prepare(
      "INSERT INTO tenant_notes (id, tenant_id, title, content, tags, priority) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(id, tenantId, title, content, JSON.stringify(tags), priority);
  return getNote(tenantId, id)!;
}

export function getNote(tenantId: string, noteId: string): TenantNote | null {
  return getHostedDb()
    .prepare("SELECT * FROM tenant_notes WHERE id = ? AND tenant_id = ?")
    .get(noteId, tenantId) as TenantNote | null;
}

export function listNotes(tenantId: string): TenantNote[] {
  return getHostedDb()
    .prepare(
      "SELECT * FROM tenant_notes WHERE tenant_id = ? ORDER BY priority DESC, updated_at DESC",
    )
    .all(tenantId) as TenantNote[];
}

export function updateNote(
  tenantId: string,
  noteId: string,
  title: string,
  content: string,
  tags: string[] = [],
  priority: number = 0,
): void {
  getHostedDb()
    .prepare(
      `UPDATE tenant_notes SET title = ?, content = ?, tags = ?, priority = ?, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?`,
    )
    .run(title, content, JSON.stringify(tags), priority, noteId, tenantId);
}

export function deleteNote(tenantId: string, noteId: string): void {
  getHostedDb()
    .prepare("DELETE FROM tenant_notes WHERE id = ? AND tenant_id = ?")
    .run(noteId, tenantId);
}

export function searchNotes(tenantId: string, query: string): TenantNote[] {
  return getHostedDb()
    .prepare(
      `SELECT * FROM tenant_notes WHERE tenant_id = ? AND (title LIKE ? OR content LIKE ? OR tags LIKE ?) ORDER BY priority DESC, updated_at DESC`,
    )
    .all(tenantId, `%${query}%`, `%${query}%`, `%${query}%`) as TenantNote[];
}

export function getPriorityNotes(tenantId: string): TenantNote[] {
  return getHostedDb()
    .prepare(
      "SELECT * FROM tenant_notes WHERE tenant_id = ? AND priority > 0 ORDER BY priority DESC",
    )
    .all(tenantId) as TenantNote[];
}

// ─── Feedback ──────────────────────────────────────────────────────────────

export function submitFeedback(
  tenantId: string,
  type: "suggestion" | "bug",
  message: string,
): void {
  getHostedDb()
    .prepare("INSERT INTO feedback (tenant_id, type, message) VALUES (?, ?, ?)")
    .run(tenantId, type, message.slice(0, 2000));
}

export function getFeedbackCount(
  tenantId: string,
  sinceDays: number = 1,
): number {
  const since = new Date(Date.now() - sinceDays * 86400_000).toISOString();
  const row = getHostedDb()
    .prepare(
      "SELECT COUNT(*) as count FROM feedback WHERE tenant_id = ? AND created_at >= ?",
    )
    .get(tenantId, since) as any;
  return row?.count || 0;
}

export function listFeedback(limit: number = 50): Array<{
  id: number;
  tenant_id: string;
  type: string;
  message: string;
  created_at: string;
}> {
  return getHostedDb()
    .prepare("SELECT * FROM feedback ORDER BY created_at DESC LIMIT ?")
    .all(limit) as any[];
}

// ─── Preference Signals & Profiles ──────────────────────────────────────────

export type SignalType =
  | "draft_approved"
  | "draft_rejected"
  | "draft_edited"
  | "suggestion_accepted"
  | "suggestion_dismissed"
  | "note_locked"
  | "note_deleted"
  | "chat_message"
  | "style_toggle"
  | "topic_added"
  | "topic_removed"
  | "autopilot_changed"
  | "model_changed";

export function recordSignal(
  tenantId: string,
  agentId: string,
  signalType: SignalType,
  data: Record<string, unknown> = {},
): void {
  getHostedDb()
    .prepare(
      "INSERT INTO preference_signals (tenant_id, agent_id, signal_type, signal_data) VALUES (?, ?, ?, ?)",
    )
    .run(tenantId, agentId, signalType, JSON.stringify(data));
}

export function getRecentSignals(
  tenantId: string,
  agentId: string,
  limit: number = 100,
): Array<{ signal_type: string; signal_data: string; created_at: string }> {
  return getHostedDb()
    .prepare(
      "SELECT signal_type, signal_data, created_at FROM preference_signals WHERE tenant_id = ? AND agent_id = ? ORDER BY created_at DESC LIMIT ?",
    )
    .all(tenantId, agentId, limit) as any[];
}

export interface PreferenceProfile {
  strategic_posture: string;
  competitor_stance: string;
  content_style: string;
  risk_tolerance: string;
  communication: string;
  autonomy: string;
  chat_style: string;
}

export function getPreferenceProfile(
  tenantId: string,
  agentId: string,
): PreferenceProfile | null {
  return getHostedDb()
    .prepare(
      "SELECT strategic_posture, competitor_stance, content_style, risk_tolerance, communication, autonomy, chat_style FROM preference_profiles WHERE tenant_id = ? AND agent_id = ?",
    )
    .get(tenantId, agentId) as PreferenceProfile | null;
}

export function upsertPreferenceProfile(
  tenantId: string,
  agentId: string,
  profile: Partial<PreferenceProfile>,
): void {
  const existing = getPreferenceProfile(tenantId, agentId);
  if (existing) {
    const sets: string[] = [];
    const vals: any[] = [];
    for (const [k, v] of Object.entries(profile)) {
      if (v !== undefined) {
        sets.push(`${k} = ?`);
        vals.push(v);
      }
    }
    if (sets.length === 0) return;
    sets.push("updated_at = datetime('now')");
    vals.push(tenantId, agentId);
    getHostedDb()
      .prepare(
        `UPDATE preference_profiles SET ${sets.join(", ")} WHERE tenant_id = ? AND agent_id = ?`,
      )
      .run(...vals);
  } else {
    const merged = {
      strategic_posture: "unknown",
      competitor_stance: "unknown",
      content_style: "unknown",
      risk_tolerance: "moderate",
      communication: "unknown",
      autonomy: "unknown",
      chat_style: "unknown",
      ...profile,
    };
    getHostedDb()
      .prepare(
        "INSERT INTO preference_profiles (tenant_id, agent_id, strategic_posture, competitor_stance, content_style, risk_tolerance, communication, autonomy, chat_style) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        tenantId,
        agentId,
        merged.strategic_posture,
        merged.competitor_stance,
        merged.content_style,
        merged.risk_tolerance,
        merged.communication,
        merged.autonomy,
        merged.chat_style,
      );
  }
}

// ─── Audit & Safety Events ─────────────────────────────────────────────────

export interface AuditEvent {
  id: string;
  tenant_id: string;
  org_id: string;
  workspace_id: string;
  brand_id: string;
  agent_id: string;
  actor_id: string;
  action: string;
  target_type: string;
  target_id: string;
  metadata: string;
  created_at: string;
}

export interface NewAuditEvent {
  tenantId?: string;
  orgId?: string;
  workspaceId?: string;
  brandId?: string;
  agentId?: string;
  actorId?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}

export function recordAuditEvent(event: NewAuditEvent): string {
  const id = "aud_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
  getHostedDb()
    .prepare(
      `INSERT INTO audit_events
       (id, tenant_id, org_id, workspace_id, brand_id, agent_id, actor_id, action, target_type, target_id, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      event.tenantId || "",
      event.orgId || "",
      event.workspaceId || "",
      event.brandId || "",
      event.agentId || "",
      event.actorId || "",
      event.action,
      event.targetType || "",
      event.targetId || "",
      JSON.stringify(event.metadata || {}),
    );
  return id;
}

export function listAuditEvents(
  tenantId: string,
  limit: number = 50,
): AuditEvent[] {
  return getHostedDb()
    .prepare(
      "SELECT * FROM audit_events WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?",
    )
    .all(tenantId, limit) as AuditEvent[];
}

export interface SafetyEvent {
  id: string;
  tenant_id: string;
  org_id: string;
  workspace_id: string;
  brand_id: string;
  agent_id: string;
  severity: string;
  source: string;
  event_type: string;
  message: string;
  metadata: string;
  resolved_at: string | null;
  created_at: string;
}

export interface NewSafetyEvent {
  tenantId?: string;
  orgId?: string;
  workspaceId?: string;
  brandId?: string;
  agentId?: string;
  severity?: "info" | "warning" | "critical";
  source: string;
  eventType: string;
  message?: string;
  metadata?: Record<string, unknown>;
}

export function recordSafetyEvent(event: NewSafetyEvent): string {
  const id = "safe_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
  getHostedDb()
    .prepare(
      `INSERT INTO safety_events
       (id, tenant_id, org_id, workspace_id, brand_id, agent_id, severity, source, event_type, message, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      event.tenantId || "",
      event.orgId || "",
      event.workspaceId || "",
      event.brandId || "",
      event.agentId || "",
      event.severity || "info",
      event.source,
      event.eventType,
      event.message || "",
      JSON.stringify(event.metadata || {}),
    );
  return id;
}

export function listOpenSafetyEvents(
  tenantId: string,
  limit: number = 50,
): SafetyEvent[] {
  return getHostedDb()
    .prepare(
      "SELECT * FROM safety_events WHERE tenant_id = ? AND resolved_at IS NULL ORDER BY created_at DESC LIMIT ?",
    )
    .all(tenantId, limit) as SafetyEvent[];
}

export function resolveSafetyEvent(id: string): void {
  getHostedDb()
    .prepare(
      "UPDATE safety_events SET resolved_at = datetime('now') WHERE id = ?",
    )
    .run(id);
}

// ─── GitHub Migrations ──────────────────────────────────────────────────────

function runGitHubMigrations(d: Database.Database): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS github_connections (
      tenant_id TEXT PRIMARY KEY,
      github_user_id TEXT NOT NULL DEFAULT '',
      github_login TEXT NOT NULL DEFAULT '',
      github_name TEXT NOT NULL DEFAULT '',
      github_avatar TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS github_repo_links (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      repo_id TEXT NOT NULL,
      owner TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      full_name TEXT NOT NULL DEFAULT '',
      is_private INTEGER NOT NULL DEFAULT 0,
      default_branch TEXT NOT NULL DEFAULT 'main',
      trust_mode TEXT NOT NULL DEFAULT 'metadata' CHECK(trust_mode IN ('metadata', 'docs', 'full')),
      allowed_paths TEXT NOT NULL DEFAULT '[]',
      sync_enabled INTEGER NOT NULL DEFAULT 1,
      last_synced_at TEXT,
      last_sync_status TEXT NOT NULL DEFAULT 'never',
      summary TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(tenant_id, repo_id)
    );

    CREATE TABLE IF NOT EXISTS github_repo_agent_links (
      repo_link_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      PRIMARY KEY (repo_link_id, agent_id)
    );

    CREATE INDEX IF NOT EXISTS idx_github_repo_links_tenant ON github_repo_links(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_github_repo_agent_links_link ON github_repo_agent_links(repo_link_id);
  `);
}

// ─── GitHub Connections ─────────────────────────────────────────────────────

export interface GitHubConnection {
  tenant_id: string;
  github_user_id: string;
  github_login: string;
  github_name: string;
  github_avatar: string;
  created_at: string;
  updated_at: string;
}

export function upsertGitHubConnection(
  tenantId: string,
  data: {
    githubUserId: string;
    login: string;
    name: string;
    avatarUrl: string;
  },
): void {
  getHostedDb()
    .prepare(
      `INSERT INTO github_connections (tenant_id, github_user_id, github_login, github_name, github_avatar)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(tenant_id) DO UPDATE SET
         github_user_id = excluded.github_user_id,
         github_login   = excluded.github_login,
         github_name    = excluded.github_name,
         github_avatar  = excluded.github_avatar,
         updated_at     = datetime('now')`,
    )
    .run(tenantId, data.githubUserId, data.login, data.name, data.avatarUrl);
}

export function getGitHubConnection(tenantId: string): GitHubConnection | null {
  return getHostedDb()
    .prepare("SELECT * FROM github_connections WHERE tenant_id = ?")
    .get(tenantId) as GitHubConnection | null;
}

export function deleteGitHubConnection(tenantId: string): void {
  getHostedDb()
    .prepare("DELETE FROM github_connections WHERE tenant_id = ?")
    .run(tenantId);
}

// ─── GitHub Repo Links ──────────────────────────────────────────────────────

export interface GitHubRepoLink {
  id: string;
  tenant_id: string;
  repo_id: string;
  owner: string;
  name: string;
  full_name: string;
  is_private: number;
  default_branch: string;
  trust_mode: string;
  allowed_paths: string;
  sync_enabled: number;
  last_synced_at: string | null;
  last_sync_status: string;
  summary: string;
  created_at: string;
  updated_at: string;
}

export function upsertGitHubRepoLink(
  tenantId: string,
  data: {
    repoId: string;
    owner: string;
    name: string;
    fullName: string;
    isPrivate: boolean;
    defaultBranch: string;
    syncEnabled: boolean;
    trustMode: string;
    allowedPaths: string[];
    lastSyncedAt?: string;
    lastSyncStatus?: string;
    summary?: string;
  },
): void {
  const id = "grl_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  getHostedDb()
    .prepare(
      `INSERT INTO github_repo_links
         (id, tenant_id, repo_id, owner, name, full_name, is_private, default_branch,
          trust_mode, allowed_paths, sync_enabled, last_synced_at, last_sync_status, summary)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(tenant_id, repo_id) DO UPDATE SET
         owner             = excluded.owner,
         name              = excluded.name,
         full_name         = excluded.full_name,
         is_private        = excluded.is_private,
         default_branch    = excluded.default_branch,
         trust_mode        = excluded.trust_mode,
         allowed_paths     = excluded.allowed_paths,
         sync_enabled      = excluded.sync_enabled,
         last_synced_at    = COALESCE(excluded.last_synced_at, last_synced_at),
         last_sync_status  = excluded.last_sync_status,
         summary           = COALESCE(NULLIF(excluded.summary, ''), summary),
         updated_at        = datetime('now')`,
    )
    .run(
      id,
      tenantId,
      data.repoId,
      data.owner,
      data.name,
      data.fullName,
      data.isPrivate ? 1 : 0,
      data.defaultBranch,
      data.trustMode,
      JSON.stringify(data.allowedPaths),
      data.syncEnabled ? 1 : 0,
      data.lastSyncedAt ?? null,
      data.lastSyncStatus ?? "never",
      data.summary ?? "",
    );
}

export function listGitHubRepoLinks(tenantId: string): GitHubRepoLink[] {
  return getHostedDb()
    .prepare(
      "SELECT * FROM github_repo_links WHERE tenant_id = ? ORDER BY full_name ASC",
    )
    .all(tenantId) as GitHubRepoLink[];
}

export function deleteGitHubRepoLink(tenantId: string, repoId: string): void {
  const d = getHostedDb();
  const link = d
    .prepare(
      "SELECT id FROM github_repo_links WHERE tenant_id = ? AND repo_id = ?",
    )
    .get(tenantId, repoId) as { id: string } | undefined;
  if (!link) return;
  d.prepare("DELETE FROM github_repo_agent_links WHERE repo_link_id = ?").run(
    link.id,
  );
  d.prepare("DELETE FROM github_repo_links WHERE id = ?").run(link.id);
}

// ─── GitHub Repo Agent Links ────────────────────────────────────────────────

export interface GitHubRepoAgentLink {
  repo_id: string;
  agent_id: string;
}

export function setGitHubRepoAgentLinks(
  tenantId: string,
  repoId: string,
  agentIds: string[],
): void {
  const d = getHostedDb();
  const link = d
    .prepare(
      "SELECT id FROM github_repo_links WHERE tenant_id = ? AND repo_id = ?",
    )
    .get(tenantId, repoId) as { id: string } | undefined;
  if (!link) return;
  d.prepare("DELETE FROM github_repo_agent_links WHERE repo_link_id = ?").run(
    link.id,
  );
  const insert = d.prepare(
    "INSERT OR IGNORE INTO github_repo_agent_links (repo_link_id, agent_id) VALUES (?, ?)",
  );
  for (const agentId of agentIds) {
    insert.run(link.id, agentId);
  }
}

export function getGitHubRepoAgentIds(
  tenantId: string,
  repoId: string,
): string[] {
  const d = getHostedDb();
  const link = d
    .prepare(
      "SELECT id FROM github_repo_links WHERE tenant_id = ? AND repo_id = ?",
    )
    .get(tenantId, repoId) as { id: string } | undefined;
  if (!link) return ["default"];
  const rows = d
    .prepare(
      "SELECT agent_id FROM github_repo_agent_links WHERE repo_link_id = ?",
    )
    .all(link.id) as { agent_id: string }[];
  return rows.length > 0 ? rows.map((r) => r.agent_id) : ["default"];
}

export function listGitHubRepoAgentLinks(
  tenantId: string,
): GitHubRepoAgentLink[] {
  return getHostedDb()
    .prepare(
      `SELECT grl.repo_id, gral.agent_id
       FROM github_repo_agent_links gral
       JOIN github_repo_links grl ON gral.repo_link_id = grl.id
       WHERE grl.tenant_id = ?
       ORDER BY grl.full_name ASC, gral.agent_id ASC`,
    )
    .all(tenantId) as GitHubRepoAgentLink[];
}
