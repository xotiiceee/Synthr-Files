import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const llmMocks = vi.hoisted(() => ({
  askLLMWithSystemAndUsage: vi.fn(),
  askLLMWithSystem: vi.fn(),
}));

vi.mock("../../src/core/llm.js", () => ({
  askLLMWithSystemAndUsage: llmMocks.askLLMWithSystemAndUsage,
  askLLMWithSystem: llmMocks.askLLMWithSystem,
}));

const { getDataDir, setDataDir } = await import("../../src/core/state.js");
const { closeCRM, getCRM } = await import("../../src/crm/database.js");
const { handleChatMessage, resetChat } = await import(
  "../../hosted/pages/chat-setup.js"
);

const originalDataDir = getDataDir();
const tempRoots: string[] = [];
let legacyActiveAgentId = "";

Object.assign(globalThis, {
  __pulseGetLegacyActiveAgentId: () => legacyActiveAgentId,
});

function setLegacyActiveAgent(id: string): void {
  legacyActiveAgentId = id;
}

function createTempDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-chat-state-"));
  tempRoots.push(dir);
  return dir;
}

function activeConversationRows() {
  return getCRM()
    .prepare(
      `SELECT id, status, agent_id FROM chat_conversations ORDER BY created_at ASC`,
    )
    .all() as Array<{ id: string; status: string; agent_id: string }>;
}

function messageRows(conversationId: string) {
  return getCRM()
    .prepare(
      `SELECT role, content FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC, id ASC`,
    )
    .all(conversationId) as Array<{ role: string; content: string }>;
}

beforeEach(() => {
  closeCRM();
  setDataDir(createTempDataDir());
  setLegacyActiveAgent("");
  llmMocks.askLLMWithSystem.mockReset();
  llmMocks.askLLMWithSystemAndUsage.mockReset();
});

afterAll(() => {
  closeCRM();
  setDataDir(originalDataDir);
  for (const dir of tempRoots) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("chat state", () => {
  it("preserves message ordering and stores assistant replies without tool tags", async () => {
    llmMocks.askLLMWithSystemAndUsage
      .mockResolvedValueOnce({
        text: 'First answer.\n[UPDATE_SETTING: {"path":"persona.tone","value":"technical"}]',
        usage: { inputTokens: 10, outputTokens: 5 },
      })
      .mockResolvedValueOnce({
        text: "Second answer.",
        usage: { inputTokens: 12, outputTokens: 6 },
      });

    await handleChatMessage("tn_chat_state", "first user message");
    await handleChatMessage("tn_chat_state", "second user message");

    const [conversation] = activeConversationRows();
    expect(conversation).toMatchObject({
      status: "active",
      agent_id: "default",
    });
    expect(messageRows(conversation.id)).toEqual([
      { role: "user", content: "first user message" },
      { role: "assistant", content: "First answer." },
      { role: "user", content: "second user message" },
      { role: "assistant", content: "Second answer." },
    ]);
  });

  it("returns export actions while persisting a clean assistant reply", async () => {
    llmMocks.askLLMWithSystemAndUsage.mockResolvedValueOnce({
      text: "Your profile is ready.\n[EXPORT_PROFILE]",
      usage: { inputTokens: 9, outputTokens: 4 },
    });

    const result = await handleChatMessage("tn_chat_state", "export my setup");

    expect(result.actions).toEqual([
      { type: "export_profile", payload: null, raw: "[EXPORT_PROFILE]" },
    ]);

    const [conversation] = activeConversationRows();
    expect(messageRows(conversation.id)).toEqual([
      { role: "user", content: "export my setup" },
      { role: "assistant", content: "Your profile is ready." },
    ]);
  });

  it("archives active chat on reset and starts a fresh conversation", async () => {
    llmMocks.askLLMWithSystemAndUsage
      .mockResolvedValueOnce({
        text: "Before reset.",
        usage: { inputTokens: 10, outputTokens: 5 },
      })
      .mockResolvedValueOnce({
        text: "After reset.",
        usage: { inputTokens: 10, outputTokens: 5 },
      });

    await handleChatMessage("tn_chat_state", "before reset");
    const [beforeReset] = activeConversationRows();

    resetChat("tn_chat_state");

    await handleChatMessage("tn_chat_state", "after reset");
    const conversations = activeConversationRows();
    expect(conversations).toHaveLength(2);
    expect(conversations.map((row) => row.status)).toEqual([
      "archived",
      "active",
    ]);
    expect(conversations[1].id).not.toBe(beforeReset.id);
    expect(messageRows(conversations[0].id).map((row) => row.content)).toEqual([
      "before reset",
      "Before reset.",
    ]);
    expect(messageRows(conversations[1].id).map((row) => row.content)).toEqual([
      "after reset",
      "After reset.",
    ]);
  });

  it("keeps self-host data-dir chat reset scoped to the active agent", async () => {
    llmMocks.askLLMWithSystemAndUsage
      .mockResolvedValueOnce({
        text: "Agent A answer.",
        usage: { inputTokens: 10, outputTokens: 5 },
      })
      .mockResolvedValueOnce({
        text: "Agent B answer.",
        usage: { inputTokens: 10, outputTokens: 5 },
      })
      .mockResolvedValueOnce({
        text: "Agent A fresh answer.",
        usage: { inputTokens: 10, outputTokens: 5 },
      });

    setLegacyActiveAgent("agent_a");
    await handleChatMessage("self_host", "agent a message");

    setLegacyActiveAgent("agent_b");
    await handleChatMessage("self_host", "agent b message");

    setLegacyActiveAgent("agent_a");
    resetChat("self_host");
    await handleChatMessage("self_host", "agent a fresh message");

    const conversations = activeConversationRows();
    expect(conversations).toEqual([
      expect.objectContaining({ status: "archived", agent_id: "agent_a" }),
      expect.objectContaining({ status: "active", agent_id: "agent_b" }),
      expect.objectContaining({ status: "active", agent_id: "agent_a" }),
    ]);
    expect(messageRows(conversations[1].id).map((row) => row.content)).toEqual([
      "agent b message",
      "Agent B answer.",
    ]);
    expect(messageRows(conversations[2].id).map((row) => row.content)).toEqual([
      "agent a fresh message",
      "Agent A fresh answer.",
    ]);
  });
});
