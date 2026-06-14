import { Hono } from "hono";
import { createHash } from "node:crypto";
import { withTenantContext } from "./tenant.js";
import {
  billPulseAction,
  canAfford,
  getActionCost,
  CONTENT_MODELS,
  DEFAULT_CONTENT_MODEL,
} from "./billing.js";
import { createX402Response } from "./x402-middleware.js";
import { verifyX402Payment } from "./x402-verify.js";
import { getCRM } from "../src/crm/database.js";
import { getPulseHeart } from "./heart-client.js";
import { loadState } from "../src/core/state.js";

const agentRouter = new Hono();

function stableOperationHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 32);
}

function getRequestOperationId(c: any, fallback: unknown): string {
  const header =
    c.req.header("Idempotency-Key") || c.req.header("X-Idempotency-Key");
  return header?.trim() || stableOperationHash(fallback);
}

// ─── POST /v1/pulse/post ─────────────────────────────────────────────────────
// Generate a post from a topic and publish it immediately.

agentRouter.post("/post", async (c) => {
  const apiKey = c.get("agentApiKey");
  const tenant = c.get("agentTenant");

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body", code: "INVALID_INPUT" }, 400);
  }

  const { topic, model, platform = "x" } = body;
  if (!topic || typeof topic !== "string")
    return c.json({ error: "topic is required", code: "INVALID_INPUT" }, 400);
  if (topic.length > 2000)
    return c.json(
      { error: "topic too long (max 2000 chars)", code: "INVALID_INPUT" },
      400,
    );

  const safeModelId =
    model && CONTENT_MODELS[model] ? model : DEFAULT_CONTENT_MODEL;
  const affordable = await canAfford(apiKey, "generate_post", safeModelId, {
    tenantId: tenant.id,
  });
  if (!affordable) {
    const cost = getActionCost("generate_post", safeModelId);
    const paid = await verifyX402Payment(c, cost);
    if (!paid) return await createX402Response(c, cost);
    return withTenantContext(tenant.id, async () => {
      const { generatePost } =
        await import("../src/intelligence/content-generator.js");
      const { sanitizeForLLM } =
        await import("../src/intelligence/input-sanitizer.js");
      const { clampParams, resolveModel } = await import("./billing.js");
      const sanitized = sanitizeForLLM(topic);
      const params = clampParams("generate_post", {}, safeModelId);
      const resolved = resolveModel(safeModelId);
      const llmOpts = resolved ? { ...resolved, ...params } : params;
      const result = await generatePost(sanitized.text, platform, llmOpts);
      if (!result)
        return c.json(
          { error: "Content generation failed", code: "GENERATION_FAILED" },
          500,
        );
      const platMod = await import(`../src/platforms/${platform}.js`);
      const plat = platMod.default ?? platMod;
      if (!plat.isConfigured?.()) {
        return c.json(
          {
            error: `Platform '${platform}' is not configured for this account`,
            code: "PLATFORM_NOT_CONFIGURED",
          },
          400,
        );
      }
      await plat.post({ text: result.text, type: "post" });
      return c.json({
        ok: true,
        cost: 0,
        creditsRemaining: 0,
        paidVia: "x402",
      });
    });
  }

  return withTenantContext(tenant.id, async () => {
    const { generatePost } =
      await import("../src/intelligence/content-generator.js");
    const { sanitizeForLLM } =
      await import("../src/intelligence/input-sanitizer.js");
    const { clampParams, resolveModel, CONTENT_MODELS, DEFAULT_CONTENT_MODEL } =
      await import("./billing.js");

    const sanitized = sanitizeForLLM(topic);
    const safeModelId =
      model && CONTENT_MODELS[model] ? model : DEFAULT_CONTENT_MODEL;
    const params = clampParams("generate_post", {}, safeModelId);
    const resolved = resolveModel(safeModelId);
    const llmOpts = resolved ? { ...resolved, ...params } : params;

    const result = await generatePost(sanitized.text, platform, llmOpts);
    if (!result)
      return c.json(
        { error: "Content generation failed", code: "GENERATION_FAILED" },
        500,
      );

    const platMod = await import(`../src/platforms/${platform}.js`);
    const plat = platMod.default ?? platMod;
    if (!plat.isConfigured?.()) {
      return c.json(
        {
          error: `Platform '${platform}' is not configured for this account`,
          code: "PLATFORM_NOT_CONFIGURED",
        },
        400,
      );
    }

    const posted = await plat.post({ text: result.text, type: "post" });

    const billing = await billPulseAction(
      apiKey,
      "generate_post",
      safeModelId,
      {
        tenantId: tenant.id,
        operationId: getRequestOperationId(c, {
          route: "/v1/pulse/post",
          tenantId: tenant.id,
          platform,
          postId: posted.postId,
          url: posted.url,
          content: result.text,
          model: safeModelId,
        }),
        metadata: { route: "/v1/pulse/post", platform, postId: posted.postId },
      },
    );
    if (!billing.ok)
      return c.json(
        {
          error: billing.error ?? "Insufficient credits",
          code: "INSUFFICIENT_CREDITS",
        },
        402,
      );

    return c.json({
      ok: posted.ok,
      postId: posted.postId,
      url: posted.url,
      content: result.text,
      cost: billing.cost,
      creditsRemaining: billing.remaining,
      error: posted.ok ? undefined : posted.error,
    });
  });
});

// ─── POST /v1/pulse/reply ────────────────────────────────────────────────────
// Generate a reply to an existing post and publish it.

agentRouter.post("/reply", async (c) => {
  const apiKey = c.get("agentApiKey");
  const tenant = c.get("agentTenant");

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body", code: "INVALID_INPUT" }, 400);
  }

  const { replyToId, text, author = "unknown", platform = "x", model } = body;
  if (!replyToId || typeof replyToId !== "string")
    return c.json(
      { error: "replyToId is required", code: "INVALID_INPUT" },
      400,
    );
  if (!text || typeof text !== "string")
    return c.json(
      {
        error: "text (the post content to reply to) is required",
        code: "INVALID_INPUT",
      },
      400,
    );

  const safeModelId =
    model && CONTENT_MODELS[model] ? model : DEFAULT_CONTENT_MODEL;
  const affordable = await canAfford(apiKey, "generate_reply", safeModelId, {
    tenantId: tenant.id,
  });
  if (!affordable) {
    const cost = getActionCost("generate_reply", safeModelId);
    const paid = await verifyX402Payment(c, cost);
    if (!paid) return await createX402Response(c, cost);
    return withTenantContext(tenant.id, async () => {
      const { generateReply } =
        await import("../src/intelligence/reply-generator.js");
      const conversation = {
        id: replyToId,
        platform,
        url: `https://x.com/i/status/${replyToId}`,
        text,
        author,
        topicId: replyToId,
        createdAt: new Date().toISOString(),
        engagement: { likes: 0, replies: 0, reposts: 0 },
      };
      const replyText = await generateReply(conversation, platform);
      if (!replyText)
        return c.json(
          { error: "Reply generation failed", code: "GENERATION_FAILED" },
          500,
        );
      const platMod = await import(`../src/platforms/${platform}.js`);
      const plat = platMod.default ?? platMod;
      if (!plat.isConfigured?.()) {
        return c.json(
          {
            error: `Platform '${platform}' is not configured for this account`,
            code: "PLATFORM_NOT_CONFIGURED",
          },
          400,
        );
      }
      await plat.post({ text: replyText, type: "post", replyTo: replyToId });
      return c.json({
        ok: true,
        cost: 0,
        creditsRemaining: 0,
        paidVia: "x402",
      });
    });
  }

  return withTenantContext(tenant.id, async () => {
    const { generateReply } =
      await import("../src/intelligence/reply-generator.js");

    const conversation = {
      id: replyToId,
      platform,
      url: `https://x.com/i/status/${replyToId}`,
      text,
      author,
      topicId: replyToId,
      createdAt: new Date().toISOString(),
      engagement: { likes: 0, replies: 0, reposts: 0 },
    };

    const replyText = await generateReply(conversation, platform);
    if (!replyText)
      return c.json(
        { error: "Reply generation failed", code: "GENERATION_FAILED" },
        500,
      );

    const platMod = await import(`../src/platforms/${platform}.js`);
    const plat = platMod.default ?? platMod;
    if (!plat.isConfigured?.()) {
      return c.json(
        {
          error: `Platform '${platform}' is not configured for this account`,
          code: "PLATFORM_NOT_CONFIGURED",
        },
        400,
      );
    }

    const posted = await plat.post({
      text: replyText,
      type: "post",
      replyTo: replyToId,
    });

    const { CONTENT_MODELS, DEFAULT_CONTENT_MODEL } =
      await import("./billing.js");
    const safeModelId =
      model && CONTENT_MODELS[model] ? model : DEFAULT_CONTENT_MODEL;
    const billing = await billPulseAction(
      apiKey,
      "generate_reply",
      safeModelId,
      {
        tenantId: tenant.id,
        operationId: getRequestOperationId(c, {
          route: "/v1/pulse/reply",
          tenantId: tenant.id,
          platform,
          replyToId,
          postId: posted.postId,
          content: replyText,
          model: safeModelId,
        }),
        metadata: {
          route: "/v1/pulse/reply",
          platform,
          replyToId,
          postId: posted.postId,
        },
      },
    );
    if (!billing.ok)
      return c.json(
        {
          error: billing.error ?? "Insufficient credits",
          code: "INSUFFICIENT_CREDITS",
        },
        402,
      );

    return c.json({
      ok: posted.ok,
      postId: posted.postId,
      url: posted.url,
      content: replyText,
      cost: billing.cost,
      creditsRemaining: billing.remaining,
      error: posted.ok ? undefined : posted.error,
    });
  });
});

// ─── POST /v1/pulse/thread ───────────────────────────────────────────────────
// Generate a thread and publish it as a chain of replies.

agentRouter.post("/thread", async (c) => {
  const apiKey = c.get("agentApiKey");
  const tenant = c.get("agentTenant");

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body", code: "INVALID_INPUT" }, 400);
  }

  const { topic, model, platform = "x" } = body;
  if (!topic || typeof topic !== "string")
    return c.json({ error: "topic is required", code: "INVALID_INPUT" }, 400);
  if (topic.length > 2000)
    return c.json(
      { error: "topic too long (max 2000 chars)", code: "INVALID_INPUT" },
      400,
    );

  const safeModelId =
    model && CONTENT_MODELS[model] ? model : DEFAULT_CONTENT_MODEL;
  const affordable = await canAfford(apiKey, "thread_generation", safeModelId, {
    tenantId: tenant.id,
  });
  if (!affordable) {
    const cost = getActionCost("thread_generation", safeModelId);
    const paid = await verifyX402Payment(c, cost);
    if (!paid) return await createX402Response(c, cost);
    return withTenantContext(tenant.id, async () => {
      const { generateThread } =
        await import("../src/intelligence/thread-generator.js");
      const { sanitizeForLLM } =
        await import("../src/intelligence/input-sanitizer.js");
      const { clampParams, resolveModel } = await import("./billing.js");
      const sanitized = sanitizeForLLM(topic);
      const params = clampParams("thread_generation", {}, safeModelId);
      const resolved = resolveModel(safeModelId);
      const llmOpts = resolved ? { ...resolved, ...params } : params;
      const threadResult = await generateThread(sanitized.text, llmOpts);
      if (!threadResult)
        return c.json(
          { error: "Thread generation failed", code: "GENERATION_FAILED" },
          500,
        );
      const tweets = (threadResult.tweets as Array<{ text: string }>).map(
        (t) => t.text,
      );
      const platMod = await import(`../src/platforms/${platform}.js`);
      const plat = platMod.default ?? platMod;
      if (!plat.isConfigured?.()) {
        return c.json(
          {
            error: `Platform '${platform}' is not configured for this account`,
            code: "PLATFORM_NOT_CONFIGURED",
          },
          400,
        );
      }
      let lastPostId: string | undefined;
      for (const tweetText of tweets) {
        const result = await plat.post({
          text: tweetText,
          type: "post",
          ...(lastPostId ? { replyTo: lastPostId } : {}),
        });
        if (!result.ok) {
          return c.json(
            {
              error: `Thread posting failed: ${result.error}`,
              code: "PUBLISH_FAILED",
            },
            500,
          );
        }
        lastPostId = result.postId;
      }
      return c.json({
        ok: true,
        cost: 0,
        creditsRemaining: 0,
        paidVia: "x402",
      });
    });
  }

  return withTenantContext(tenant.id, async () => {
    const { generateThread } =
      await import("../src/intelligence/thread-generator.js");
    const { sanitizeForLLM } =
      await import("../src/intelligence/input-sanitizer.js");
    const { clampParams, resolveModel, CONTENT_MODELS, DEFAULT_CONTENT_MODEL } =
      await import("./billing.js");

    const sanitized = sanitizeForLLM(topic);
    const safeModelId =
      model && CONTENT_MODELS[model] ? model : DEFAULT_CONTENT_MODEL;
    const params = clampParams("thread_generation", {}, safeModelId);
    const resolved = resolveModel(safeModelId);
    const llmOpts = resolved ? { ...resolved, ...params } : params;

    const threadResult = await generateThread(sanitized.text, llmOpts);
    if (!threadResult)
      return c.json(
        { error: "Thread generation failed", code: "GENERATION_FAILED" },
        500,
      );

    const tweets = (threadResult.tweets as Array<{ text: string }>).map(
      (t) => t.text,
    );

    const platMod = await import(`../src/platforms/${platform}.js`);
    const plat = platMod.default ?? platMod;
    if (!plat.isConfigured?.()) {
      return c.json(
        {
          error: `Platform '${platform}' is not configured for this account`,
          code: "PLATFORM_NOT_CONFIGURED",
        },
        400,
      );
    }

    // Post each tweet, threading each onto the previous
    const postedTweets: Array<{ text: string; postId?: string; url?: string }> =
      [];
    let lastPostId: string | undefined;
    for (const text of tweets) {
      const result = await plat.post({
        text,
        type: "post",
        ...(lastPostId ? { replyTo: lastPostId } : {}),
      });
      if (!result.ok) {
        return c.json(
          {
            error: `Thread posting failed at tweet ${postedTweets.length + 1}: ${result.error}`,
            code: "PUBLISH_FAILED",
            postedSoFar: postedTweets,
          },
          500,
        );
      }
      postedTweets.push({ text, postId: result.postId, url: result.url });
      lastPostId = result.postId;
    }

    const billing = await billPulseAction(
      apiKey,
      "thread_generation",
      safeModelId,
      {
        tenantId: tenant.id,
        operationId: getRequestOperationId(c, {
          route: "/v1/pulse/thread",
          tenantId: tenant.id,
          platform,
          firstPostId: postedTweets[0]?.postId,
          postIds: postedTweets.map((post) => post.postId),
          topic,
          model: safeModelId,
        }),
        metadata: {
          route: "/v1/pulse/thread",
          platform,
          firstPostId: postedTweets[0]?.postId,
          postCount: postedTweets.length,
        },
      },
    );
    if (!billing.ok)
      return c.json(
        {
          error: billing.error ?? "Insufficient credits",
          code: "INSUFFICIENT_CREDITS",
        },
        402,
      );

    return c.json({
      ok: true,
      tweets: postedTweets,
      firstUrl: postedTweets[0]?.url,
      cost: billing.cost,
      creditsRemaining: billing.remaining,
    });
  });
});

// ─── POST /v1/pulse/schedule ─────────────────────────────────────────────────
// Queue pre-written content for later publishing.

agentRouter.post("/schedule", async (c) => {
  const apiKey = c.get("agentApiKey");
  const tenant = c.get("agentTenant");

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body", code: "INVALID_INPUT" }, 400);
  }

  const { content, platform = "x", type = "post", scheduledAt, theme } = body;
  if (!content || typeof content !== "string")
    return c.json({ error: "content is required", code: "INVALID_INPUT" }, 400);
  if (content.length > 5000)
    return c.json(
      { error: "content too long (max 5000 chars)", code: "INVALID_INPUT" },
      400,
    );
  if (scheduledAt && isNaN(Date.parse(scheduledAt)))
    return c.json(
      { error: "scheduledAt must be a valid ISO date", code: "INVALID_INPUT" },
      400,
    );

  const affordable = await canAfford(apiKey, "content_calendar", undefined, {
    tenantId: tenant.id,
  });
  if (!affordable) {
    const cost = getActionCost("content_calendar", "");
    const paid = await verifyX402Payment(c, cost);
    if (!paid) return await createX402Response(c, cost);
    return withTenantContext(tenant.id, async () => {
      const db = getCRM();
      const now = new Date().toISOString();
      const scheduled = scheduledAt || now;
      db.prepare(
        `INSERT INTO content_queue (platform, type, content, theme, scheduled_at, status, created_at, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        platform,
        type,
        content,
        theme ?? null,
        scheduled,
        "scheduled",
        now,
        "{}",
      );
      return c.json({
        ok: true,
        cost: 0,
        creditsRemaining: 0,
        paidVia: "x402",
      });
    });
  }

  return withTenantContext(tenant.id, async () => {
    const db = getCRM();
    const now = new Date().toISOString();
    const scheduled = scheduledAt || now;

    const info = db
      .prepare(
        `INSERT INTO content_queue (platform, type, content, theme, scheduled_at, status, created_at, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        platform,
        type,
        content,
        theme ?? null,
        scheduled,
        "scheduled",
        now,
        "{}",
      );

    const billing = await billPulseAction(
      apiKey,
      "content_calendar",
      undefined,
      {
        tenantId: tenant.id,
        operationId: getRequestOperationId(c, {
          route: "/v1/pulse/schedule",
          tenantId: tenant.id,
          queueId: info.lastInsertRowid,
          platform,
          type,
          scheduled,
        }),
        metadata: {
          route: "/v1/pulse/schedule",
          platform,
          type,
          queueId: info.lastInsertRowid,
        },
      },
    );
    if (!billing.ok)
      return c.json(
        {
          error: billing.error ?? "Insufficient credits",
          code: "INSUFFICIENT_CREDITS",
        },
        402,
      );

    return c.json({
      ok: true,
      id: info.lastInsertRowid,
      scheduledAt: scheduled,
      cost: billing.cost,
      creditsRemaining: billing.remaining,
    });
  });
});

// ─── GET /v1/pulse/monitor ───────────────────────────────────────────────────
// Return engagement metrics and recent activity for the caller's account.

agentRouter.get("/monitor", async (c) => {
  const tenant = c.get("agentTenant");
  const period = c.req.query("period") || "7d";
  const agentId: string =
    (c.req.query("agentId") as string | undefined) ?? tenant.id;

  return withTenantContext(tenant.id, async () => {
    const { getActions } = await import("../src/core/state.js");
    const { getThemePerformance } = await import("../src/analytics/tracker.js");

    const periodMs: Record<string, number> = {
      "1d": 86_400_000,
      "7d": 7 * 86_400_000,
      "30d": 30 * 86_400_000,
    };
    const since =
      period === "all"
        ? undefined
        : new Date(
            Date.now() - (periodMs[period] ?? 7 * 86_400_000),
          ).toISOString();
    const actions = getActions(since).filter(
      (a: any) => a.platform !== "system",
    );

    let totalEngagement = 0;
    let engagementCount = 0;
    const byType: Record<string, number> = {};
    let bestPost: any = null;
    let bestEng = -1;

    for (const a of actions as any[]) {
      byType[a.type] = (byType[a.type] ?? 0) + 1;
      if (a.engagement) {
        const eng =
          (a.engagement.likes ?? 0) +
          (a.engagement.replies ?? 0) +
          (a.engagement.reposts ?? 0);
        totalEngagement += eng;
        engagementCount++;
        if (eng > bestEng) {
          bestEng = eng;
          bestPost = a;
        }
      }
    }

    const topThemes = getThemePerformance("month").slice(0, 5);

    const certId = loadState<string | null>(
      `agent-heart-cert-${agentId}`,
      null,
    );
    let soma: { did: string; lineageCertId: string | null } | null = null;
    try {
      soma = { did: getPulseHeart().did, lineageCertId: certId };
    } catch {}

    return c.json({
      period,
      stats: {
        total: actions.length,
        totalEngagement,
        avgEngagement:
          engagementCount > 0
            ? Math.round((totalEngagement / engagementCount) * 10) / 10
            : 0,
        byType,
        bestPost: bestPost
          ? {
              content: bestPost.content?.slice(0, 120),
              platform: bestPost.platform,
              engagement: bestPost.engagement,
            }
          : null,
        topThemes,
      },
      recentActions: (actions as any[]).slice(-20).reverse(),
      soma,
    });
  });
});

export default agentRouter;
