import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { cleanupSqliteFiles, createTempHostedDbPath } from "./temp-db.js";

const dbPath = createTempHostedDbPath("pulse-chat-tool-execution-context");
process.env.HOSTED_DB_PATH = dbPath;

const {
  addMembership,
  createBrand,
  createOrg,
  createTenant,
  createUser,
  createWorkspace,
} = await import("../../hosted/db.js");
const { createSession, SESSION_COOKIE } =
  await import("../../hosted/sessions.js");
const { resolveChatToolExecutionOptions } =
  await import("../../hosted/chat-tool-execution-context.js");
const { executeToolActions, parseToolActions } = await import(
  "../../hosted/pages/chat-setup.js"
);
const { getDataDir, setDataDir } = await import("../../src/core/state.js");

function createScope(tenantId: string) {
  const org = createOrg({ name: "Chat Tools Org", legacyTenantId: tenantId });
  const workspace = createWorkspace(org.id, "Default");
  const brand = createBrand({
    orgId: org.id,
    workspaceId: workspace.id,
    name: "Pulse Brand",
    legacyTenantId: tenantId,
  });
  return { org, workspace, brand };
}

function createTempWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pulse-chat-tool-context-"));
}

function writeTenantConfig(
  rootDir: string,
  tenantId: string,
  personaTone: string = "friendly",
): void {
  const tenantDir = path.join(rootDir, "data", "tenants", tenantId);
  fs.mkdirSync(tenantDir, { recursive: true });
  fs.writeFileSync(
    path.join(tenantDir, "pulse.yaml"),
    `persona:\n  tone: ${personaTone}\n`,
    "utf-8",
  );
}

function readTenantConfig(rootDir: string, tenantId: string): string {
  return fs.readFileSync(
    path.join(rootDir, "data", "tenants", tenantId, "pulse.yaml"),
    "utf-8",
  );
}

const originalCwd = process.cwd();
const originalDataDir = getDataDir();

afterAll(() => {
  process.chdir(originalCwd);
  setDataDir(originalDataDir);
  cleanupSqliteFiles(dbPath);
});

describe("chat tool execution context", () => {
  it("keeps ClawNet-authenticated tenants owner-equivalent while adding audit scope", () => {
    const tenant = createTenant(
      "cn_chat_tools_legacy",
      "claw_user_1",
      "legacy@example.com",
    );
    const { org, workspace, brand } = createScope(tenant.id);

    const options = resolveChatToolExecutionOptions({
      tenant,
      agentId: "agent_legacy",
      authProvider: "clawnet",
    });

    expect(options.policy).toEqual({ role: "owner" });
    expect(options.audit).toMatchObject({
      orgId: org.id,
      workspaceId: workspace.id,
      brandId: brand.id,
      agentId: "agent_legacy",
      actorId: "claw_user_1",
    });
  });

  it("maps first-party sessions to org membership for policy checks", () => {
    const tenant = createTenant(
      "cn_chat_tools_firstparty",
      "",
      "firstparty@example.com",
    );
    const { org, workspace, brand } = createScope(tenant.id);
    const user = createUser({ email: "operator@example.com" });
    addMembership(org.id, user.id, "operator");
    const { token } = createSession({ userId: user.id, orgId: org.id });

    const options = resolveChatToolExecutionOptions({
      tenant,
      agentId: "agent_firstparty",
      authProvider: "firstparty",
      cookieHeader: `${SESSION_COOKIE.name}=${encodeURIComponent(token)}`,
    });

    expect(options.policy).toEqual({
      membership: expect.objectContaining({
        org_id: org.id,
        user_id: user.id,
        role: "operator",
      }),
    });
    expect(options.audit).toMatchObject({
      orgId: org.id,
      workspaceId: workspace.id,
      brandId: brand.id,
      agentId: "agent_firstparty",
      actorId: user.id,
    });
  });

  it("denies standalone chat mutations by default when no first-party session is present", () => {
    const tenant = createTenant(
      "cn_chat_tools_missing_session",
      "",
      "missing-session@example.com",
    );
    const { org, workspace, brand } = createScope(tenant.id);

    const options = resolveChatToolExecutionOptions({
      tenant,
      authProvider: "firstparty",
    });

    expect(options.policy).toEqual({ role: "viewer" });
    expect(options.audit).toMatchObject({
      orgId: org.id,
      workspaceId: workspace.id,
      brandId: brand.id,
    });
  });

  it("does not apply a first-party membership from another org to the tenant scope", () => {
    const tenant = createTenant(
      "cn_chat_tools_cross_org",
      "",
      "cross-org@example.com",
    );
    const { org, workspace, brand } = createScope(tenant.id);
    const otherOrg = createOrg({ name: "Other Org" });
    const user = createUser({ email: "cross-org-user@example.com" });
    addMembership(otherOrg.id, user.id, "admin");
    const { token } = createSession({ userId: user.id, orgId: otherOrg.id });

    const options = resolveChatToolExecutionOptions({
      tenant,
      agentId: "agent_cross_org",
      authProvider: "firstparty",
      cookieHeader: `${SESSION_COOKIE.name}=${encodeURIComponent(token)}`,
    });

    expect(options.policy).toEqual({ role: "viewer" });
    expect(options.audit).toMatchObject({
      orgId: org.id,
      workspaceId: workspace.id,
      brandId: brand.id,
      agentId: "agent_cross_org",
      actorId: user.id,
    });
  });

  it("keeps cross-org first-party sessions from mutating the tenant config", () => {
    const tempRoot = createTempWorkspace();
    process.chdir(tempRoot);
    setDataDir(path.join(tempRoot, "data"));

    const tenant = createTenant(
      "cn_chat_tools_cross_org_execute",
      "",
      "cross-org-execute@example.com",
    );
    createScope(tenant.id);
    writeTenantConfig(tempRoot, tenant.id, "friendly");

    const otherOrg = createOrg({ name: "Other Execute Org" });
    const user = createUser({ email: "cross-org-execute-user@example.com" });
    addMembership(otherOrg.id, user.id, "admin");
    const { token } = createSession({ userId: user.id, orgId: otherOrg.id });
    const options = resolveChatToolExecutionOptions({
      tenant,
      agentId: "agent_cross_org_execute",
      authProvider: "firstparty",
      cookieHeader: `${SESSION_COOKIE.name}=${encodeURIComponent(token)}`,
    });
    const actions = parseToolActions(
      '[UPDATE_SETTING: {"path":"persona.tone","value":"technical"}]',
    );

    expect(executeToolActions(tenant.id, actions, options)).toEqual([
      "Denied update_setting: requires brand:manage",
    ]);
    expect(readTenantConfig(tempRoot, tenant.id)).toContain("tone: friendly");
  });
});
