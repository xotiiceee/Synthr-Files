/**
 * X (Twitter) platform module — OAuth 1.0a + Serper.dev search.
 * Uses X API v2 for posting, replying, and liking.
 * Search and monitoring go through Serper.dev (Google site:x.com).
 *
 * Env vars: X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET,
 * X_MONTHLY_POST_LIMIT
 */

import crypto from "node:crypto";
import type {
  Platform,
  Conversation,
  PostContent,
  PostResult,
  BrandMention,
  PlatformCapabilities,
} from "./base.js";
import { searchPlatform, type SearchResult } from "../core/search.js";
import { loadState, saveState } from "../core/state.js";

// ─── Context-aware credential access ────────────────────────────────────────
// In hosted mode, secrets live in AsyncLocalStorage (per-tenant isolation).
// Falls back to process.env for self-hosted mode.
let _getContext: (() => { tenantId: string } | undefined) | null = null;
let _getContextSecret: ((key: string) => string | undefined) | null = null;
try {
  const ctx = await import("../../hosted/context.js");
  _getContext = ctx.getContext;
  _getContextSecret = ctx.getContextSecret;
} catch {
  /* self-hosted mode — context module not available */
}
let _runtimeXRateCounters:
  | typeof import("../../hosted/repositories/runtime-x-rate-counters.js").runtimeXRateCounterRepository
  | null = null;
try {
  const counters =
    await import("../../hosted/repositories/runtime-x-rate-counters.js");
  _runtimeXRateCounters = counters.runtimeXRateCounterRepository;
} catch {
  /* self-hosted mode — hosted repository not available */
}

function getSecret(key: string): string {
  return _getContextSecret?.(key) ?? process.env[key] ?? "";
}

// ---------------------------------------------------------------------------
// OAuth 1.0a signing
// ---------------------------------------------------------------------------

function percentEncode(str: string): string {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

function generateOAuthSignature(
  method: string,
  url: string,
  params: Record<string, string>,
  consumerSecret: string,
  tokenSecret: string,
): string {
  const sortedParams = Object.keys(params)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`)
    .join("&");
  const baseString = `${method.toUpperCase()}&${percentEncode(url)}&${percentEncode(sortedParams)}`;
  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;
  return crypto
    .createHmac("sha1", signingKey)
    .update(baseString)
    .digest("base64");
}

export function buildOAuthHeader(
  method: string,
  url: string,
  body?: Record<string, string>,
): string {
  const apiKey = getSecret("X_API_KEY");
  const apiSecret = getSecret("X_API_SECRET");
  const accessToken = getSecret("X_ACCESS_TOKEN");
  const accessTokenSecret = getSecret("X_ACCESS_TOKEN_SECRET");

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: apiKey,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: accessToken,
    oauth_version: "1.0",
  };

  // Merge body params (for form-encoded) and query params for signature base
  const allParams: Record<string, string> = { ...oauthParams, ...(body ?? {}) };

  oauthParams.oauth_signature = generateOAuthSignature(
    method,
    url,
    allParams,
    apiSecret,
    accessTokenSecret,
  );

  const header = Object.keys(oauthParams)
    .sort()
    .map((k) => `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`)
    .join(", ");

  return `OAuth ${header}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let cachedUserId: string | null = null;
let userIdCachedAt = 0;
const USER_ID_TTL = 60 * 60 * 1000; // 1 hour

// ─── Rate limit tracking ────────────────────────────────────────────────────

interface RateLimitState {
  monthKey: string;
  postCount: number;
}

const RATE_LIMIT_STATE_KEY = "x-rate-limit";
const DEFAULT_X_MONTHLY_POST_LIMIT = 1500;

function loadRateLimitState(): RateLimitState {
  return loadState<RateLimitState>(RATE_LIMIT_STATE_KEY, {
    monthKey: "",
    postCount: 0,
  });
}

function saveRateLimitState(state: RateLimitState): void {
  saveState(RATE_LIMIT_STATE_KEY, state);
}

function getMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function getXMonthlyPostLimit(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.X_MONTHLY_POST_LIMIT?.trim();
  if (!raw) return DEFAULT_X_MONTHLY_POST_LIMIT;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_X_MONTHLY_POST_LIMIT;
}

function checkRateLimit(): { ok: boolean; remaining: number; limit: number } {
  const month = getMonthKey();
  const monthlyLimit = getXMonthlyPostLimit();
  const tenantId = _getContext?.()?.tenantId;
  if (tenantId && _runtimeXRateCounters) {
    const postCount = _runtimeXRateCounters.getPostCount({
      tenantId,
      monthKey: month,
    });
    const remaining = monthlyLimit - postCount;
    return { ok: remaining > 0, remaining, limit: monthlyLimit };
  }

  const state = loadRateLimitState();
  if (state.monthKey !== month) {
    const reset = { monthKey: month, postCount: 0 };
    saveRateLimitState(reset);
    return { ok: true, remaining: monthlyLimit, limit: monthlyLimit };
  }
  const remaining = monthlyLimit - state.postCount;
  return { ok: remaining > 0, remaining, limit: monthlyLimit };
}

function recordPost(): void {
  const month = getMonthKey();
  const tenantId = _getContext?.()?.tenantId;
  if (tenantId && _runtimeXRateCounters) {
    _runtimeXRateCounters.incrementPostCount({ tenantId, monthKey: month });
    return;
  }

  const state = loadRateLimitState();
  if (state.monthKey !== month) {
    state.monthKey = month;
    state.postCount = 0;
  }
  state.postCount++;
  saveRateLimitState(state);
}

/**
 * Fetch with retry on 429 (max 2 retries, exponential backoff).
 */
export async function xFetch(
  url: string,
  init: RequestInit,
  retries = 2,
): Promise<Response> {
  const res = await fetch(url, init);
  if (res.status === 429 && retries > 0) {
    const retryAfter = parseInt(res.headers.get("retry-after") ?? "5", 10);
    if (retryAfter > 3600) {
      // Monthly quota exhausted — don't retry, it won't help
      console.error(
        "  [X] Monthly quota exhausted — posts will resume next billing cycle",
      );
      return res;
    }
    const wait = Math.min(retryAfter * 1000, 5 * 60_000); // 5 min cap
    console.log(`  [X] Rate limited — waiting ${Math.ceil(wait / 1000)}s...`);
    await new Promise((r) => setTimeout(r, wait));
    return xFetch(url, init, retries - 1);
  }
  return res;
}

// ─── Media Upload (v2 API) ──────────────────────────────────────────────────

/**
 * Upload an image to X via the v2 media upload endpoint.
 * v1.1 media upload was sunset June 9, 2025 — all uploads must use v2.
 *
 * Simple upload for images <5MB. Returns media_id string for tweet attachment.
 * Supports: PNG, JPEG, GIF, WebP (max 5MB for images, 15MB for animated GIFs).
 */
export async function uploadMedia(
  imageBuffer: Buffer,
  mimeType: string = "image/png",
): Promise<string | null> {
  const url = "https://api.x.com/2/media/upload";

  const boundary = `----PulseBoundary${Date.now()}`;
  const bodyParts: Buffer[] = [];

  // media_data field (base64 encoded)
  const base64Data = imageBuffer.toString("base64");
  bodyParts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="media_data"\r\n\r\n${base64Data}\r\n`,
    ),
  );
  // media_category
  bodyParts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="media_category"\r\n\r\ntweet_image\r\n`,
    ),
  );
  bodyParts.push(Buffer.from(`--${boundary}--\r\n`));

  const bodyBuffer = Buffer.concat(bodyParts);

  try {
    const res = await xFetch(url, {
      method: "POST",
      headers: {
        Authorization: buildOAuthHeader("POST", url),
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body: bodyBuffer,
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error(
        `  [X] Media upload error: ${parseXApiError(res.status, errBody)}`,
      );
      return null;
    }

    // v2 returns { media_id_string } for simple upload (same shape as v1.1)
    // Also check v2 nested format { data: { id } } as fallback
    const data = (await res.json()) as any;
    return data.media_id_string ?? data.data?.id ?? null;
  } catch (err) {
    console.error(
      `  [X] Media upload failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

/**
 * Set alt text on an uploaded media item (v2).
 * Call after upload, before attaching to tweet. Max 1000 chars.
 */
export async function setMediaAltText(
  mediaId: string,
  altText: string,
): Promise<boolean> {
  const url = "https://api.x.com/2/media/metadata/create";
  try {
    const res = await xFetch(url, {
      method: "POST",
      headers: {
        Authorization: buildOAuthHeader("POST", url),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        media_id: mediaId,
        alt_text: { text: altText.slice(0, 1000) },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Extract human-readable error from X API response */
export function parseXApiError(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body);
    if (parsed.errors?.[0]?.message) return parsed.errors[0].message;
    if (parsed.detail) return parsed.detail;
  } catch {
    /* not JSON */
  }
  return `X API ${status}: ${body.slice(0, 200)}`;
}

/** Resolve a username to X user ID via API lookup */
export async function getUserIdFromUsername(
  username: string,
): Promise<string | null> {
  const clean = username.replace(/^@/, "");
  const url = `https://api.twitter.com/2/users/by/username/${clean}`;
  try {
    const res = await xFetch(url, {
      method: "GET",
      headers: { Authorization: buildOAuthHeader("GET", url) },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: { id: string } };
    return data.data?.id ?? null;
  } catch {
    return null;
  }
}

export async function getUserId(): Promise<string | null> {
  if (cachedUserId && Date.now() - userIdCachedAt < USER_ID_TTL)
    return cachedUserId;

  const url = "https://api.twitter.com/2/users/me";
  try {
    const res = await fetch(url, {
      headers: { Authorization: buildOAuthHeader("GET", url) },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      console.error(
        `  [X] /2/users/me error ${res.status}: ${(await res.text()).slice(0, 200)}`,
      );
      return null;
    }

    const data = (await res.json()) as { data?: { id: string } };
    cachedUserId = data.data?.id ?? null;
    userIdCachedAt = Date.now();
    return cachedUserId;
  } catch (err) {
    console.error(
      `  [X] getUserId failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

/**
 * Extract tweet text from a Serper search result.
 * Google titles for x.com follow: "AuthorName on X: \"actual tweet text\""
 */
function extractTweetText(result: SearchResult): string {
  // Try title pattern first: 'Author on X: "tweet text"'
  const titleMatch = result.title.match(
    /on X:\s*[""\u201c](.+?)[""\u201d]\s*$/,
  );
  if (titleMatch) return titleMatch[1].trim();

  // Fall back to snippet
  if (result.snippet) return result.snippet.trim();

  return result.title;
}

/**
 * Extract tweet ID from an x.com URL.
 */
function extractTweetId(url: string): string | null {
  const match = url.match(/\/status\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * Extract author handle from an x.com URL.
 */
function extractAuthor(url: string): string {
  const match = url.match(/x\.com\/([^/]+)\/status/);
  return match ? match[1] : "unknown";
}

// ---------------------------------------------------------------------------
// Platform export
// ---------------------------------------------------------------------------

export const x: Platform = {
  name: "x",

  capabilities: {
    canSearch: true,
    canReply: true,
    canPost: true,
    canLike: true,
    canMonitor: true,
    requiresAuth: true,
    limit: `${getXMonthlyPostLimit()}/month configured write limit`,
  } satisfies PlatformCapabilities,

  async search(query: string, topicId: string): Promise<Conversation[]> {
    const results = await searchPlatform("x.com", query);

    const conversations: Conversation[] = [];

    for (const result of results) {
      const tweetId = extractTweetId(result.url);
      if (!tweetId) continue;

      conversations.push({
        id: tweetId,
        platform: "x",
        url: result.url,
        text: extractTweetText(result),
        author: extractAuthor(result.url),
        topicId,
        createdAt: result.date ?? new Date().toISOString(),
        engagement: {
          likes: 0,
          replies: 0,
          reposts: 0,
        },
      });
    }

    return conversations;
  },

  async reply(conversation: Conversation, text: string): Promise<PostResult> {
    const limit = checkRateLimit();
    if (!limit.ok) {
      return {
        ok: false,
        error: `Configured X monthly post limit reached (${limit.limit}/month). Resets next month. Remaining: ${limit.remaining}`,
      };
    }

    const url = "https://api.twitter.com/2/tweets";

    const body = JSON.stringify({
      text,
      reply: { in_reply_to_tweet_id: conversation.id },
    });

    try {
      const res = await xFetch(url, {
        method: "POST",
        headers: {
          Authorization: buildOAuthHeader("POST", url),
          "Content-Type": "application/json",
        },
        body,
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) {
        const errBody = await res.text();
        const errMsg = parseXApiError(res.status, errBody);

        // ── Quote Tweet Fallback ──
        // Restricted X API tiers may only allow replies when mentioned or when
        // the author follows you.
        // On 403 / "not allowed" / "not permitted", fall back to a quote tweet.
        const isReplyBlocked =
          res.status === 403 ||
          /not (allowed|permitted)/i.test(errMsg) ||
          /reply.*restricted/i.test(errMsg);

        if (isReplyBlocked) {
          console.log(
            `  [X] Reply blocked by X API tier — falling back to quote tweet`,
          );
          const quoteResult = await x.post({
            text,
            type: "post",
            metadata: { quoteTweetId: conversation.id },
          });

          if (quoteResult.ok) {
            return {
              ok: true,
              postId: quoteResult.postId,
              url: quoteResult.url,
              fallback: "quote_tweet",
            } as PostResult & { fallback: string };
          }

          // Quote tweet also failed — return original reply error
          console.error(
            `  [X] Quote tweet fallback also failed: ${quoteResult.error}`,
          );
          return {
            ok: false,
            error: `Reply blocked by X API tier and quote tweet failed: ${quoteResult.error}`,
          };
        }

        console.error(`  [X] Reply error: ${errMsg}`);
        return { ok: false, error: errMsg };
      }

      const data = (await res.json()) as { data?: { id: string } };
      const postId = data.data?.id;
      recordPost();

      return {
        ok: true,
        postId,
        url: postId ? `https://x.com/i/status/${postId}` : undefined,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [X] Reply failed: ${msg}`);
      return { ok: false, error: msg };
    }
  },

  async post(content: PostContent): Promise<PostResult> {
    const limit = checkRateLimit();
    if (!limit.ok) {
      return {
        ok: false,
        error: `Configured X monthly post limit reached (${limit.limit}/month). Remaining: ${limit.remaining}`,
      };
    }

    const url = "https://api.twitter.com/2/tweets";

    const tweetBody: Record<string, unknown> = { text: content.text };
    if (content.replyTo) {
      tweetBody.reply = { in_reply_to_tweet_id: content.replyTo };
    }
    if (content.metadata?.quoteTweetId) {
      tweetBody.quote_tweet_id = content.metadata.quoteTweetId as string;
    }
    if (content.mediaIds && content.mediaIds.length > 0) {
      tweetBody.media = { media_ids: content.mediaIds };
    }

    try {
      const res = await xFetch(url, {
        method: "POST",
        headers: {
          Authorization: buildOAuthHeader("POST", url),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(tweetBody),
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) {
        const errBody = await res.text();
        const errMsg = parseXApiError(res.status, errBody);
        console.error(`  [X] Post error: ${errMsg}`);
        return { ok: false, error: errMsg };
      }

      const data = (await res.json()) as { data?: { id: string } };
      const postId = data.data?.id;
      recordPost();

      return {
        ok: true,
        postId,
        url: postId ? `https://x.com/i/status/${postId}` : undefined,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [X] Post failed: ${msg}`);
      return { ok: false, error: msg };
    }
  },

  async like(postId: string): Promise<boolean> {
    const userId = await getUserId();
    if (!userId) {
      console.error("  [X] Cannot like — failed to resolve user ID");
      return false;
    }

    const url = `https://api.twitter.com/2/users/${userId}/likes`;

    try {
      const res = await xFetch(url, {
        method: "POST",
        headers: {
          Authorization: buildOAuthHeader("POST", url),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tweet_id: postId }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        const errBody = await res.text();
        console.error(
          `  [X] Like error: ${parseXApiError(res.status, errBody)}`,
        );
        return false;
      }

      return true;
    } catch (err) {
      console.error(
        `  [X] Like failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  },

  async monitor(keywords: string[]): Promise<BrandMention[]> {
    const mentions: BrandMention[] = [];

    for (const keyword of keywords) {
      try {
        const results = await searchPlatform("x.com", keyword);

        for (const result of results) {
          const tweetId = extractTweetId(result.url);
          if (!tweetId) continue;

          mentions.push({
            id: tweetId,
            platform: "x",
            url: result.url,
            text: extractTweetText(result),
            author: extractAuthor(result.url),
            sentiment: "unknown",
            createdAt: result.date ?? new Date().toISOString(),
          });
        }
      } catch {
        // Skip failed keyword searches
      }
    }

    return mentions;
  },

  isConfigured(): boolean {
    return !!(
      getSecret("X_API_KEY") &&
      getSecret("X_API_SECRET") &&
      getSecret("X_ACCESS_TOKEN") &&
      getSecret("X_ACCESS_TOKEN_SECRET")
    );
  },
};
