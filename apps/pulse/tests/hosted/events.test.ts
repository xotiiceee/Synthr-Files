import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";

import { cleanupSqliteFiles, createTempHostedDbPath } from "./temp-db.js";

const dbPath = createTempHostedDbPath("pulse-events");
process.env.HOSTED_DB_PATH = dbPath;

const oldDb = new Database(dbPath);
oldDb.exec(`
  CREATE TABLE audit_events (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT '',
    agent_id TEXT NOT NULL DEFAULT '',
    actor_id TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL,
    target_type TEXT NOT NULL DEFAULT '',
    target_id TEXT NOT NULL DEFAULT '',
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE safety_events (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT '',
    agent_id TEXT NOT NULL DEFAULT '',
    severity TEXT NOT NULL DEFAULT 'info',
    source TEXT NOT NULL,
    event_type TEXT NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    metadata TEXT NOT NULL DEFAULT '{}',
    resolved_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);
oldDb.close();

const {
  listAuditEvents,
  listOpenSafetyEvents,
  recordAuditEvent,
  recordSafetyEvent,
  resolveSafetyEvent,
} = await import("../../hosted/db.js");

describe("audit and safety events", () => {
  it("records audit events scoped by tenant", () => {
    const id = recordAuditEvent({
      tenantId: "tn_a",
      orgId: "org_a",
      workspaceId: "ws_a",
      brandId: "br_a",
      agentId: "agent_a",
      actorId: "user_a",
      action: "x.post",
      targetType: "post",
      targetId: "post_1",
      metadata: { source: "test" },
    });
    recordAuditEvent({
      tenantId: "tn_b",
      action: "x.post",
      metadata: { source: "other" },
    });

    const events = listAuditEvents("tn_a");

    expect(events).toHaveLength(1);
    expect(events[0].id).toBe(id);
    expect(events[0].tenant_id).toBe("tn_a");
    expect(events[0].org_id).toBe("org_a");
    expect(events[0].workspace_id).toBe("ws_a");
    expect(events[0].brand_id).toBe("br_a");
    expect(events[0].agent_id).toBe("agent_a");
    expect(events[0].actor_id).toBe("user_a");
    expect(events[0].action).toBe("x.post");
    expect(events[0].target_type).toBe("post");
    expect(events[0].target_id).toBe("post_1");
    expect(JSON.parse(events[0].metadata)).toEqual({ source: "test" });
  });

  it("records, lists, and resolves open safety events", () => {
    const id = recordSafetyEvent({
      tenantId: "tn_safe",
      orgId: "org_safe",
      workspaceId: "ws_safe",
      brandId: "br_safe",
      agentId: "agent_safe",
      severity: "critical",
      source: "x-write-client",
      eventType: "x_rate_limited",
      message: "X returned 429",
      metadata: { status: 429 },
    });

    const open = listOpenSafetyEvents("tn_safe");
    expect(open).toHaveLength(1);
    expect(open[0].id).toBe(id);
    expect(open[0].org_id).toBe("org_safe");
    expect(open[0].workspace_id).toBe("ws_safe");
    expect(open[0].brand_id).toBe("br_safe");
    expect(open[0].severity).toBe("critical");
    expect(open[0].source).toBe("x-write-client");
    expect(open[0].event_type).toBe("x_rate_limited");
    expect(open[0].message).toBe("X returned 429");
    expect(JSON.parse(open[0].metadata)).toEqual({ status: 429 });

    resolveSafetyEvent(id);
    expect(listOpenSafetyEvents("tn_safe")).toEqual([]);
  });
});

process.on("exit", () => {
  cleanupSqliteFiles(dbPath);
});
