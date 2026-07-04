import { describe, expect, it } from "vitest";

import { cleanupSqliteFiles, createTempHostedDbPath } from "./temp-db.js";

const dbPath = createTempHostedDbPath("pulse-usage-events");
process.env.HOSTED_DB_PATH = dbPath;

const { getUsageEventByIdempotencyKey, listUsageEvents, recordUsageEvent } =
  await import("../../hosted/db.js");

describe("usage events", () => {
  it("records durable scoped usage events", () => {
    const event = recordUsageEvent({
      idempotencyKey: "llm:tn_a:msg_1",
      tenantId: "tn_a",
      orgId: "org_a",
      workspaceId: "ws_a",
      brandId: "br_a",
      agentId: "agent_a",
      actorId: "user_a",
      source: "llm-provider",
      eventType: "llm.tokens",
      quantity: 42,
      unit: "tokens",
      credits: 0.5,
      provider: "groq",
      model: "llama",
      metadata: { inputTokens: 20, outputTokens: 22 },
    });

    expect(event).toMatchObject({
      idempotency_key: "llm:tn_a:msg_1",
      tenant_id: "tn_a",
      org_id: "org_a",
      workspace_id: "ws_a",
      brand_id: "br_a",
      agent_id: "agent_a",
      actor_id: "user_a",
      source: "llm-provider",
      event_type: "llm.tokens",
      quantity: 42,
      unit: "tokens",
      credits: 0.5,
      provider: "groq",
      model: "llama",
    });
    expect(JSON.parse(event.metadata)).toEqual({
      inputTokens: 20,
      outputTokens: 22,
    });
    expect(listUsageEvents("tn_a").map((row) => row.id)).toEqual([event.id]);
  });

  it("uses idempotency keys to make retries no-op", () => {
    const first = recordUsageEvent({
      idempotencyKey: "image:tn_a:req_1",
      tenantId: "tn_a",
      source: "image-provider",
      eventType: "image.generated",
      quantity: 1,
      unit: "image",
      credits: 3,
      provider: "clawnet",
      model: "fast",
    });
    const second = recordUsageEvent({
      idempotencyKey: "image:tn_a:req_1",
      tenantId: "tn_a",
      source: "image-provider",
      eventType: "image.generated",
      quantity: 1,
      unit: "image",
      credits: 999,
      provider: "clawnet",
      model: "quality",
    });

    expect(second).toEqual(first);
    expect(getUsageEventByIdempotencyKey("image:tn_a:req_1")).toEqual(first);
  });
});

process.on("exit", () => {
  cleanupSqliteFiles(dbPath);
});
