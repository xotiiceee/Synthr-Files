import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

const { getDataDir, setDataDir } = await import("../../src/core/state.js");
const { closeCRM, getCRM, getCRMPath } = await import(
  "../../src/crm/database.js"
);

const originalDataDir = getDataDir();
const tempRoots: string[] = [];

function createTempDataDir(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  tempRoots.push(dir);
  return dir;
}

function insertConversation(message: string): void {
  const db = getCRM();
  const now = new Date("2026-05-26T12:00:00.000Z").toISOString();
  db.prepare(
    `INSERT INTO chat_conversations (id, status, agent_id, created_at, updated_at)
     VALUES (?, 'active', 'agent_a', ?, ?)`,
  ).run(`chat_${message}`, now, now);
  db.prepare(
    `INSERT INTO chat_messages (conversation_id, role, content, created_at)
     VALUES (?, 'user', ?, ?)`,
  ).run(`chat_${message}`, message, now);
}

function listMessages(): string[] {
  return getCRM()
    .prepare("SELECT content FROM chat_messages ORDER BY id ASC")
    .all()
    .map((row) => (row as { content: string }).content);
}

beforeEach(() => {
  closeCRM();
});

afterAll(() => {
  closeCRM();
  setDataDir(originalDataDir);
  for (const dir of tempRoots) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("CRM tenant isolation", () => {
  it("stores chat and CRM data under the active data directory", () => {
    const tenantAData = createTempDataDir("pulse-crm-tenant-a");
    const tenantBData = createTempDataDir("pulse-crm-tenant-b");

    setDataDir(tenantAData);
    expect(getCRMPath()).toBe(path.join(tenantAData, "pulse-crm.db"));
    insertConversation("tenant-a-message");

    setDataDir(tenantBData);
    expect(getCRMPath()).toBe(path.join(tenantBData, "pulse-crm.db"));
    expect(listMessages()).toEqual([]);
    insertConversation("tenant-b-message");

    expect(listMessages()).toEqual(["tenant-b-message"]);

    setDataDir(tenantAData);
    expect(listMessages()).toEqual(["tenant-a-message"]);
    expect(fs.existsSync(path.join(tenantAData, "pulse-crm.db"))).toBe(true);
    expect(fs.existsSync(path.join(tenantBData, "pulse-crm.db"))).toBe(true);
  });
});
