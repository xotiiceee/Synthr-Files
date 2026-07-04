import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getDataDir, setDataDir } from "../../src/core/state.js";
import { buildOAuthHeader, x } from "../../src/platforms/x.js";

const originalDataDir = getDataDir();

function parseOAuthHeader(header: string): Record<string, string> {
  expect(header.startsWith("OAuth ")).toBe(true);
  return Object.fromEntries(
    header
      .slice("OAuth ".length)
      .split(", ")
      .map((part) => {
        const [key, rawValue] = part.split("=");
        return [
          decodeURIComponent(key ?? ""),
          decodeURIComponent((rawValue ?? "").replace(/^"|"$/g, "")),
        ];
      }),
  );
}

describe("X platform write payloads and OAuth headers", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-x-platform-"));
    setDataDir(tempDir);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-26T12:34:56.000Z"));
    vi.stubEnv("X_API_KEY", "consumer-key");
    vi.stubEnv("X_API_SECRET", "consumer-secret");
    vi.stubEnv("X_ACCESS_TOKEN", "access-token");
    vi.stubEnv("X_ACCESS_TOKEN_SECRET", "access-secret");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ data: { id: "tweet_123" } }), {
            status: 201,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    setDataDir(originalDataDir);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("builds OAuth 1.0a Authorization headers from configured X credentials", () => {
    const header = buildOAuthHeader("POST", "https://api.twitter.com/2/tweets");
    const params = parseOAuthHeader(header);

    expect(params).toMatchObject({
      oauth_consumer_key: "consumer-key",
      oauth_signature_method: "HMAC-SHA1",
      oauth_timestamp: "1779798896",
      oauth_token: "access-token",
      oauth_version: "1.0",
    });
    expect(params.oauth_nonce).toMatch(/^[a-f0-9]{32}$/);
    expect(params.oauth_signature).toBeTruthy();
  });

  it("posts original, reply, quote, and media fields in the X API v2 tweet payload", async () => {
    await expect(
      x.post({
        text: "Launch note",
        type: "post",
        replyTo: "root_1",
        mediaIds: ["media_1", "media_2"],
        metadata: { quoteTweetId: "quote_1" },
      }),
    ).resolves.toMatchObject({
      ok: true,
      postId: "tweet_123",
      url: "https://x.com/i/status/tweet_123",
    });

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe("https://api.twitter.com/2/tweets");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      "Content-Type": "application/json",
    });

    const headers = init?.headers as Record<string, string>;
    expect(parseOAuthHeader(headers.Authorization)).toMatchObject({
      oauth_consumer_key: "consumer-key",
      oauth_token: "access-token",
      oauth_signature_method: "HMAC-SHA1",
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      text: "Launch note",
      reply: { in_reply_to_tweet_id: "root_1" },
      quote_tweet_id: "quote_1",
      media: { media_ids: ["media_1", "media_2"] },
    });
  });

  it("replies with the conversation id as in_reply_to_tweet_id", async () => {
    await expect(
      x.reply(
        {
          id: "root_2",
          platform: "x",
          url: "https://x.com/i/status/root_2",
          text: "Root post",
          author: "founder",
          topicId: "topic_1",
          createdAt: "2026-05-26T00:00:00.000Z",
          engagement: { likes: 0, replies: 0, reposts: 0 },
        },
        "Useful reply",
      ),
    ).resolves.toMatchObject({
      ok: true,
      postId: "tweet_123",
    });

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(init?.headers).toMatchObject({
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      text: "Useful reply",
      reply: { in_reply_to_tweet_id: "root_2" },
    });
  });
});
