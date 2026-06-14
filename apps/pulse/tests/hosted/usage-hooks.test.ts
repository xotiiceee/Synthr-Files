import { describe, expect, it, vi } from "vitest";

import { cleanupSqliteFiles, createTempHostedDbPath } from "./temp-db.js";

const mocks = vi.hoisted(() => ({
  askLLMWithUsage: vi.fn(),
  generateImage: vi.fn(),
}));

vi.mock("../../src/core/llm.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/core/llm.js")>(
    "../../src/core/llm.js",
  );
  return {
    ...actual,
    askLLMWithUsage: mocks.askLLMWithUsage,
  };
});

vi.mock("../../src/intelligence/image-gen.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/intelligence/image-gen.js")
  >("../../src/intelligence/image-gen.js");
  return {
    ...actual,
    generateImage: mocks.generateImage,
  };
});

const dbPath = createTempHostedDbPath("pulse-usage-hooks");
process.env.HOSTED_DB_PATH = dbPath;

const {
  buildImageIdempotencyKey,
  buildImageMetadata,
  buildListeningIdempotencyKey,
  buildListeningMetadata,
  buildLLMIdempotencyKey,
  buildLLMMetadata,
  buildXWriteIdempotencyKey,
  buildXWriteMetadata,
  createImageUsageEventHook,
  createListeningUsageEventHook,
  createLLMUsageEventHook,
  createXWriteUsageEventHook,
  installImageUsageEventHook,
  installLLMUsageEventHook,
  recordImageUsageEvent,
  recordListeningUsageEvent,
  recordLLMUsageEvent,
  recordXWriteUsageEvent,
} = await import("../../hosted/usage-events.js");
const { listUsageEvents } = await import("../../hosted/db.js");
const { getLLMProvider } = await import("../../src/core/llm-provider.js");
const { getImageProvider } =
  await import("../../src/intelligence/image-provider.js");

describe("hosted usage hook emission", () => {
  it("records LLM usage events with explicit scope and idempotency", () => {
    const first = recordLLMUsageEvent({
      scope: {
        tenantId: "tn_hooks",
        orgId: "org_hooks",
        workspaceId: "ws_hooks",
        brandId: "br_hooks",
        agentId: "agent_hooks",
        actorId: "user_hooks",
      },
      idempotencyKey: "llm:tn_hooks:req_1",
      event: {
        callType: "system_prompt",
        usage: {
          inputTokens: 15,
          outputTokens: 9,
          provider: "openai",
          model: "gpt-4o-mini",
        },
      },
      metadata: { route: "chat" },
    });
    const second = recordLLMUsageEvent({
      scope: { tenantId: "tn_hooks" },
      idempotencyKey: "llm:tn_hooks:req_1",
      event: {
        callType: "prompt",
        usage: {
          inputTokens: 999,
          outputTokens: 999,
          provider: "anthropic",
          model: "claude",
        },
      },
    });

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      tenant_id: "tn_hooks",
      org_id: "org_hooks",
      workspace_id: "ws_hooks",
      brand_id: "br_hooks",
      agent_id: "agent_hooks",
      actor_id: "user_hooks",
      source: "llm-provider",
      event_type: "llm.tokens",
      quantity: 24,
      unit: "tokens",
      credits: 0,
      provider: "openai",
      model: "gpt-4o-mini",
    });
    expect(JSON.parse(first.metadata)).toEqual({
      callType: "system_prompt",
      inputTokens: 15,
      outputTokens: 9,
      route: "chat",
    });
  });

  it("records image usage events with explicit scope and idempotency", () => {
    const event = recordImageUsageEvent({
      scope: { tenantId: "tn_hooks", brandId: "br_hooks" },
      idempotencyKey: "image:tn_hooks:req_1",
      event: {
        provider: "clawnet",
        model: "FLUX Schnell",
        creditsUsed: 3,
      },
      metadata: { assetId: "asset_1" },
    });

    expect(event).toMatchObject({
      tenant_id: "tn_hooks",
      brand_id: "br_hooks",
      source: "image-provider",
      event_type: "image.generated",
      quantity: 1,
      unit: "image",
      credits: 3,
      provider: "clawnet",
      model: "FLUX Schnell",
    });
    expect(JSON.parse(event.metadata)).toEqual({
      creditsUsed: 3,
      assetId: "asset_1",
    });
  });

  it("records listening usage events with explicit scope and idempotency", () => {
    const first = recordListeningUsageEvent({
      scope: {
        tenantId: "tn_listen",
        workspaceId: "ws_listen",
        agentId: "agent_listen",
      },
      idempotencyKey: "listen:tn_listen:req_1",
      event: {
        action: "x.realtime_search",
        provider: "clawnet",
        operationId: "req_1",
        creditsUsed: 4,
        resultCount: 2,
        query: "founder pain",
        limit: 5,
        metadata: { route: "research" },
      },
      metadata: { sourceRoute: "autopilot" },
    });
    const second = recordListeningUsageEvent({
      scope: { tenantId: "tn_listen" },
      idempotencyKey: "listen:tn_listen:req_1",
      event: {
        action: "x.realtime_search",
        provider: "clawnet",
        operationId: "req_1",
        creditsUsed: 999,
        resultCount: 999,
      },
    });

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      tenant_id: "tn_listen",
      workspace_id: "ws_listen",
      agent_id: "agent_listen",
      source: "listening-provider",
      event_type: "x.realtime_search",
      quantity: 1,
      unit: "request",
      credits: 4,
      provider: "clawnet",
    });
    expect(JSON.parse(first.metadata)).toEqual({
      action: "x.realtime_search",
      operationId: "req_1",
      creditsUsed: 4,
      resultCount: 2,
      query: "founder pain",
      limit: 5,
      route: "research",
      sourceRoute: "autopilot",
    });
  });

  it("records X write usage events with explicit scope and idempotency", () => {
    const first = recordXWriteUsageEvent({
      scope: {
        tenantId: "tn_xwrite",
        brandId: "br_xwrite",
        actorId: "user_xwrite",
      },
      idempotencyKey: "xwrite:tn_xwrite:req_1",
      event: {
        action: "reply",
        provider: "x",
        operationId: "req_1",
        postType: "comment",
        postId: "post_2",
        replyToPostId: "post_1",
        metadata: { route: "mentions" },
      },
      metadata: { attempt: 1 },
    });
    const second = recordXWriteUsageEvent({
      scope: { tenantId: "tn_xwrite" },
      idempotencyKey: "xwrite:tn_xwrite:req_1",
      event: {
        action: "reply",
        provider: "x",
        operationId: "req_1",
        postType: "comment",
        postId: "post_duplicate",
      },
    });

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      tenant_id: "tn_xwrite",
      brand_id: "br_xwrite",
      actor_id: "user_xwrite",
      source: "x-write-client",
      event_type: "x.reply",
      quantity: 1,
      unit: "post",
      provider: "x",
    });
    expect(JSON.parse(first.metadata)).toEqual({
      action: "reply",
      operationId: "req_1",
      postType: "comment",
      postId: "post_2",
      replyToPostId: "post_1",
      route: "mentions",
      attempt: 1,
    });
  });

  it("builds durable hooks from explicit scope and idempotency resolvers", async () => {
    const hook = createLLMUsageEventHook({
      scope: () => ({ tenantId: "tn_hook_resolver", actorId: "user_1" }),
      idempotencyKey: (event) =>
        `llm:tn_hook_resolver:${event.callType}:${event.usage.model}:req_2`,
      metadata: (event) => ({
        totalTokens: event.usage.inputTokens + event.usage.outputTokens,
      }),
    });

    await hook({
      callType: "prompt",
      usage: {
        inputTokens: 4,
        outputTokens: 6,
        provider: "groq",
        model: "llama",
      },
    });

    const events = listUsageEvents("tn_hook_resolver");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      idempotency_key: "llm:tn_hook_resolver:prompt:llama:req_2",
      actor_id: "user_1",
      quantity: 10,
    });
    expect(JSON.parse(events[0].metadata)).toMatchObject({
      callType: "prompt",
      totalTokens: 10,
    });
  });

  it("installs a durable LLM usage hook into the provider path", async () => {
    mocks.askLLMWithUsage
      .mockResolvedValueOnce({
        text: "first draft",
        usage: {
          inputTokens: 9,
          outputTokens: 6,
          provider: "openai",
          model: "gpt-4o-mini",
        },
      })
      .mockResolvedValueOnce({
        text: "retry draft",
        usage: {
          inputTokens: 99,
          outputTokens: 66,
          provider: "openai",
          model: "gpt-4o-mini",
        },
      })
      .mockResolvedValueOnce({
        text: "after uninstall",
        usage: {
          inputTokens: 3,
          outputTokens: 2,
          provider: "groq",
          model: "llama",
        },
      });

    const uninstall = installLLMUsageEventHook({
      scope: {
        tenantId: "tn_llm_provider_hook",
        workspaceId: "ws_llm_provider",
      },
      idempotencyKey: (event) =>
        buildLLMIdempotencyKey({
          scope: { tenantId: "tn_llm_provider_hook" },
          operationId: "chat_req_1",
          provider: event.usage.provider,
          model: event.usage.model,
          callType: event.callType,
        }),
      metadata: { route: "chat-composer", requestId: "chat_req_1" },
    });

    try {
      await getLLMProvider().askWithUsage("draft a reply");
      await getLLMProvider().askWithUsage("retry the same reply");

      const events = listUsageEvents("tn_llm_provider_hook");
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        workspace_id: "ws_llm_provider",
        idempotency_key:
          "llm-provider:tn_llm_provider_hook:chat_req_1:openai:gpt-4o-mini:prompt",
        quantity: 15,
        provider: "openai",
        model: "gpt-4o-mini",
      });
      expect(JSON.parse(events[0].metadata)).toMatchObject({
        callType: "prompt",
        inputTokens: 9,
        outputTokens: 6,
        route: "chat-composer",
        requestId: "chat_req_1",
      });
    } finally {
      uninstall();
    }

    await getLLMProvider().askWithUsage("do not persist after uninstall");
    expect(listUsageEvents("tn_llm_provider_hook")).toHaveLength(1);
  });

  it("installs a durable image usage hook into the provider path", async () => {
    mocks.generateImage
      .mockResolvedValueOnce({
        imageUrl: "https://example.test/launch.png",
        asset: { id: "asset_launch_1" },
        creditsUsed: 4,
        provenance: null,
        model: "FLUX Schnell",
      })
      .mockResolvedValueOnce({
        imageUrl: "https://example.test/retry.png",
        asset: { id: "asset_launch_2" },
        creditsUsed: 99,
        provenance: null,
        model: "FLUX Schnell",
      })
      .mockResolvedValueOnce({
        imageUrl: "https://example.test/after-uninstall.png",
        asset: { id: "asset_launch_3" },
        creditsUsed: 7,
        provenance: null,
        model: "Freepik Mystic",
      });

    const uninstall = installImageUsageEventHook({
      scope: {
        tenantId: "tn_image_provider_hook",
        brandId: "br_image_provider",
      },
      idempotencyKey: (event) =>
        buildImageIdempotencyKey({
          scope: { tenantId: "tn_image_provider_hook" },
          operationId: "image_req_1",
          provider: event.provider,
          model: event.model,
        }),
      metadata: { route: "image-studio", assetIntent: "launch" },
    });

    try {
      await getImageProvider().generate("launch visual");
      await getImageProvider().generate("retry launch visual");

      const events = listUsageEvents("tn_image_provider_hook");
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        brand_id: "br_image_provider",
        idempotency_key:
          "image-provider:tn_image_provider_hook:image_req_1:clawnet:FLUX Schnell",
        credits: 4,
        quantity: 1,
        provider: "clawnet",
        model: "FLUX Schnell",
      });
      expect(JSON.parse(events[0].metadata)).toMatchObject({
        creditsUsed: 4,
        route: "image-studio",
        assetIntent: "launch",
      });
    } finally {
      uninstall();
    }

    await getImageProvider().generate("do not persist after uninstall");
    expect(listUsageEvents("tn_image_provider_hook")).toHaveLength(1);
  });

  it("isolates persistence failures inside installed hook functions", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const hook = createImageUsageEventHook({
      scope: { tenantId: "tn_hook_failure" },
      idempotencyKey: "image:tn_hook_failure:req_1",
      metadata: circular,
    });

    await expect(
      hook({
        provider: "clawnet",
        model: "Freepik Mystic",
        creditsUsed: 12,
      }),
    ).resolves.toBeUndefined();

    expect(listUsageEvents("tn_hook_failure")).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("[UsageEvents] Image usage hook failed:"),
    );
    warn.mockRestore();
  });

  it("builds durable listening hooks with stable idempotency and retained metadata", async () => {
    const hook = createListeningUsageEventHook({
      scope: () => ({
        tenantId: "tn_listen_hook",
        agentId: "agent_listen_hook",
      }),
      idempotencyKey: (event) =>
        buildListeningIdempotencyKey({
          scope: { tenantId: "tn_listen_hook" },
          operationId: event.operationId,
          provider: event.provider,
          action: event.action,
        }),
      metadata: (event) => ({ sink: event.metadata?.sink }),
    });

    await hook({
      action: "x.user_profile",
      provider: "clawnet",
      operationId: "profile_req_1",
      creditsUsed: 3,
      resultCount: 1,
      username: "@pulse",
      metadata: { sink: "profile-panel" },
    });
    await hook({
      action: "x.user_profile",
      provider: "clawnet",
      operationId: "profile_req_1",
      creditsUsed: 30,
      resultCount: 9,
      username: "@ignored",
    });

    const events = listUsageEvents("tn_listen_hook");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      idempotency_key:
        "listening-provider:tn_listen_hook:profile_req_1:clawnet:x.user_profile",
      agent_id: "agent_listen_hook",
      credits: 3,
    });
    expect(JSON.parse(events[0].metadata)).toMatchObject({
      action: "x.user_profile",
      operationId: "profile_req_1",
      username: "@pulse",
      sink: "profile-panel",
    });
  });

  it("builds durable X write hooks with stable idempotency and retained metadata", async () => {
    const hook = createXWriteUsageEventHook({
      scope: { tenantId: "tn_xwrite_hook", actorId: "user_7" },
      idempotencyKey: (event) =>
        buildXWriteIdempotencyKey({
          scope: { tenantId: "tn_xwrite_hook" },
          operationId: event.operationId,
          provider: event.provider,
          action: event.action,
        }),
      metadata: (event) => ({ channel: event.metadata?.channel }),
    });

    await hook({
      action: "post",
      provider: "x",
      operationId: "post_req_1",
      postType: "post",
      postId: "tweet_1",
      metadata: { channel: "content-queue" },
    });
    await hook({
      action: "post",
      provider: "x",
      operationId: "post_req_1",
      postType: "post",
      postId: "tweet_2",
    });

    const events = listUsageEvents("tn_xwrite_hook");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      idempotency_key: "x-write-client:tn_xwrite_hook:post_req_1:x:post",
      actor_id: "user_7",
      event_type: "x.post",
    });
    expect(JSON.parse(events[0].metadata)).toMatchObject({
      action: "post",
      operationId: "post_req_1",
      postType: "post",
      postId: "tweet_1",
      channel: "content-queue",
    });
  });
});

describe("idempotency key helpers", () => {
  it("buildLLMIdempotencyKey produces a stable key from all params", () => {
    expect(
      buildLLMIdempotencyKey({
        scope: { tenantId: "tn_1" },
        operationId: "req_abc",
        provider: "openai",
        model: "gpt-4o",
        callType: "prompt",
      }),
    ).toBe("llm-provider:tn_1:req_abc:openai:gpt-4o:prompt");
  });

  it("buildLLMIdempotencyKey uses _ when tenantId is absent", () => {
    expect(
      buildLLMIdempotencyKey({
        scope: {},
        operationId: "req_xyz",
        provider: "anthropic",
        model: "claude-3",
        callType: "system_prompt",
      }),
    ).toBe("llm-provider:_:req_xyz:anthropic:claude-3:system_prompt");
  });

  it("buildLLMIdempotencyKey is stable across identical calls", () => {
    const params = {
      scope: { tenantId: "tn_2", orgId: "org_2" },
      operationId: "op_1",
      provider: "groq",
      model: "llama",
      callType: "prompt" as const,
    };
    expect(buildLLMIdempotencyKey(params)).toBe(buildLLMIdempotencyKey(params));
  });

  it("buildImageIdempotencyKey produces a stable key from all params", () => {
    expect(
      buildImageIdempotencyKey({
        scope: { tenantId: "tn_3" },
        operationId: "img_abc",
        provider: "clawnet",
        model: "FLUX Schnell",
      }),
    ).toBe("image-provider:tn_3:img_abc:clawnet:FLUX Schnell");
  });

  it("buildImageIdempotencyKey uses _ when tenantId is absent", () => {
    expect(
      buildImageIdempotencyKey({
        scope: {},
        operationId: "img_xyz",
        provider: "clawnet",
        model: "Freepik Mystic",
      }),
    ).toBe("image-provider:_:img_xyz:clawnet:Freepik Mystic");
  });

  it("buildListeningIdempotencyKey produces a stable key from all params", () => {
    expect(
      buildListeningIdempotencyKey({
        scope: { tenantId: "tn_4" },
        operationId: "listen_1",
        provider: "clawnet",
        action: "x.realtime_search",
      }),
    ).toBe("listening-provider:tn_4:listen_1:clawnet:x.realtime_search");
  });

  it("buildXWriteIdempotencyKey produces a stable key from all params", () => {
    expect(
      buildXWriteIdempotencyKey({
        scope: { tenantId: "tn_5" },
        operationId: "post_1",
        provider: "x",
        action: "reply",
      }),
    ).toBe("x-write-client:tn_5:post_1:x:reply");
  });
});

describe("metadata helpers", () => {
  it("buildLLMMetadata includes standard token fields", () => {
    expect(
      buildLLMMetadata({
        callType: "prompt",
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          provider: "openai",
          model: "gpt-4o",
        },
      }),
    ).toEqual({ callType: "prompt", inputTokens: 10, outputTokens: 5 });
  });

  it("buildLLMMetadata merges caller-supplied extra fields", () => {
    expect(
      buildLLMMetadata(
        {
          callType: "system_prompt",
          usage: {
            inputTokens: 20,
            outputTokens: 8,
            provider: "anthropic",
            model: "claude-3",
          },
        },
        { route: "chat", requestId: "req_1" },
      ),
    ).toEqual({
      callType: "system_prompt",
      inputTokens: 20,
      outputTokens: 8,
      route: "chat",
      requestId: "req_1",
    });
  });

  it("buildLLMMetadata extra fields override standard fields", () => {
    const meta = buildLLMMetadata(
      {
        callType: "prompt",
        usage: {
          inputTokens: 3,
          outputTokens: 7,
          provider: "groq",
          model: "llama",
        },
      },
      { inputTokens: 999 },
    );
    expect(meta.inputTokens).toBe(999);
  });

  it("buildImageMetadata includes creditsUsed", () => {
    expect(
      buildImageMetadata({
        provider: "clawnet",
        model: "FLUX Schnell",
        creditsUsed: 5,
      }),
    ).toEqual({ creditsUsed: 5 });
  });

  it("buildImageMetadata merges caller-supplied extra fields", () => {
    expect(
      buildImageMetadata(
        { provider: "clawnet", model: "FLUX Schnell", creditsUsed: 3 },
        { assetId: "asset_42", workflow: "hero" },
      ),
    ).toEqual({ creditsUsed: 3, assetId: "asset_42", workflow: "hero" });
  });

  it("buildListeningMetadata merges event and caller metadata", () => {
    expect(
      buildListeningMetadata(
        {
          action: "x.realtime_search",
          provider: "clawnet",
          operationId: "listen_meta_1",
          creditsUsed: 2,
          resultCount: 5,
          query: "pain points",
          metadata: { route: "research" },
        },
        { feature: "auto-research" },
      ),
    ).toEqual({
      action: "x.realtime_search",
      operationId: "listen_meta_1",
      creditsUsed: 2,
      resultCount: 5,
      query: "pain points",
      route: "research",
      feature: "auto-research",
    });
  });

  it("buildXWriteMetadata merges event and caller metadata", () => {
    expect(
      buildXWriteMetadata(
        {
          action: "reply",
          provider: "x",
          operationId: "xwrite_meta_1",
          postType: "comment",
          postId: "tweet_7",
          replyToPostId: "tweet_6",
          metadata: { route: "mentions" },
        },
        { attempt: 1 },
      ),
    ).toEqual({
      action: "reply",
      operationId: "xwrite_meta_1",
      postType: "comment",
      postId: "tweet_7",
      replyToPostId: "tweet_6",
      route: "mentions",
      attempt: 1,
    });
  });

  it("buildLLMMetadata result matches metadata persisted by recordLLMUsageEvent", () => {
    const event = {
      callType: "prompt" as const,
      usage: {
        inputTokens: 6,
        outputTokens: 4,
        provider: "openai",
        model: "gpt-4o-mini",
      },
    };
    const extra = { route: "summarize" };
    const persisted = recordLLMUsageEvent({
      scope: { tenantId: "tn_meta_check" },
      idempotencyKey: "llm:tn_meta_check:meta_check",
      event,
      metadata: extra,
    });
    expect(JSON.parse(persisted.metadata)).toEqual(
      buildLLMMetadata(event, extra),
    );
  });

  it("buildImageMetadata result matches metadata persisted by recordImageUsageEvent", () => {
    const event = {
      provider: "clawnet" as const,
      model: "FLUX Schnell",
      creditsUsed: 7,
    };
    const extra = { assetId: "asset_meta" };
    const persisted = recordImageUsageEvent({
      scope: { tenantId: "tn_img_meta_check" },
      idempotencyKey: "image:tn_img_meta_check:meta_check",
      event,
      metadata: extra,
    });
    expect(JSON.parse(persisted.metadata)).toEqual(
      buildImageMetadata(event, extra),
    );
  });

  it("buildListeningMetadata result matches metadata persisted by recordListeningUsageEvent", () => {
    const event = {
      action: "x.user_profile" as const,
      provider: "clawnet" as const,
      operationId: "listen_meta_check",
      creditsUsed: 8,
      resultCount: 1,
      username: "@pulse",
    };
    const extra = { sourceRoute: "profiles" };
    const persisted = recordListeningUsageEvent({
      scope: { tenantId: "tn_listen_meta_check" },
      idempotencyKey: "listen:tn_listen_meta_check:meta_check",
      event,
      metadata: extra,
    });
    expect(JSON.parse(persisted.metadata)).toEqual(
      buildListeningMetadata(event, extra),
    );
  });

  it("buildXWriteMetadata result matches metadata persisted by recordXWriteUsageEvent", () => {
    const event = {
      action: "post" as const,
      provider: "x" as const,
      operationId: "xwrite_meta_check",
      postType: "post" as const,
      postId: "tweet_99",
    };
    const extra = { route: "composer" };
    const persisted = recordXWriteUsageEvent({
      scope: { tenantId: "tn_xwrite_meta_check" },
      idempotencyKey: "xwrite:tn_xwrite_meta_check:meta_check",
      event,
      metadata: extra,
    });
    expect(JSON.parse(persisted.metadata)).toEqual(
      buildXWriteMetadata(event, extra),
    );
  });
});

process.on("exit", () => {
  cleanupSqliteFiles(dbPath);
});
