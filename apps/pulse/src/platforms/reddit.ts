/**
 * Reddit platform module — uses Reddit OAuth2 API (script-type app).
 * Rate limit: 100 requests/minute.
 * Requires: REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD
 */

import type {
  Platform,
  Conversation,
  PostContent,
  PostResult,
  BrandMention,
  PlatformCapabilities,
} from './base.js';

// ---------- OAuth2 token cache ----------

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

const USER_AGENT = `pulse/1.0 by ${process.env.REDDIT_USERNAME ?? 'unknown'}`;

async function getAccessToken(): Promise<string> {
  // Return cached token if still valid (refresh at 50 min mark)
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

  const clientId = process.env.REDDIT_CLIENT_ID ?? '';
  const clientSecret = process.env.REDDIT_CLIENT_SECRET ?? '';
  const username = process.env.REDDIT_USERNAME ?? '';
  const password = process.env.REDDIT_PASSWORD ?? '';

  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body: `grant_type=password&username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`,
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Reddit OAuth failed ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = data.access_token;
  // Refresh 10 minutes early (50 min of 60 min lifetime)
  tokenExpiresAt = Date.now() + (data.expires_in - 600) * 1000;
  return cachedToken;
}

// ---------- Helpers ----------

async function redditGet(path: string, retries = 2): Promise<unknown> {
  const token = await getAccessToken();
  const res = await fetch(`https://oauth.reddit.com${path}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'User-Agent': USER_AGENT,
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (res.status === 429 && retries > 0) {
    const wait = Math.min(parseInt(res.headers.get('retry-after') ?? '3', 10) * 1000, 15_000);
    console.log(`  [Reddit] Rate limited — waiting ${Math.ceil(wait / 1000)}s...`);
    await new Promise((r) => setTimeout(r, wait));
    return redditGet(path, retries - 1);
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Reddit GET ${path} failed ${res.status}: ${body.slice(0, 200)}`);
  }

  return res.json();
}

async function redditPost(path: string, body: Record<string, string>, retries = 2): Promise<unknown> {
  const token = await getAccessToken();
  const res = await fetch(`https://oauth.reddit.com${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: Object.entries(body)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&'),
    signal: AbortSignal.timeout(15_000),
  });

  if (res.status === 429 && retries > 0) {
    const wait = Math.min(parseInt(res.headers.get('retry-after') ?? '3', 10) * 1000, 15_000);
    console.log(`  [Reddit] Rate limited — waiting ${Math.ceil(wait / 1000)}s...`);
    await new Promise((r) => setTimeout(r, wait));
    return redditPost(path, body, retries - 1);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Reddit POST ${path} failed ${res.status}: ${text.slice(0, 200)}`);
  }

  return res.json();
}

// ---------- Response types ----------

interface RedditPost {
  id: string;
  title: string;
  selftext: string;
  author: string;
  score: number;
  num_comments: number;
  permalink: string;
  created_utc: number;
  subreddit: string;
}

interface RedditSearchResponse {
  data: {
    children: Array<{ data: RedditPost }>;
  };
}

// ---------- Platform implementation ----------

function toConversation(post: RedditPost, topicId: string): Conversation {
  return {
    id: post.id,
    platform: 'reddit',
    url: `https://reddit.com${post.permalink}`,
    text: post.title + (post.selftext ? `\n\n${post.selftext}` : ''),
    author: post.author,
    topicId,
    createdAt: new Date(post.created_utc * 1000).toISOString(),
    engagement: {
      likes: post.score,
      replies: post.num_comments,
      reposts: 0,
    },
    metadata: {
      subreddit: post.subreddit,
    },
  };
}

export const reddit: Platform = {
  name: 'reddit',

  capabilities: {
    canSearch: true,
    canReply: true,
    canPost: true,
    canLike: true,
    canMonitor: true,
    requiresAuth: true,
    limit: '100 requests/minute',
  } satisfies PlatformCapabilities,

  async search(query: string, topicId: string): Promise<Conversation[]> {
    try {
      const encoded = encodeURIComponent(query);
      const data = (await redditGet(`/search?q=${encoded}&sort=new&t=day&limit=25`)) as RedditSearchResponse;
      return data.data.children.map((child) => toConversation(child.data, topicId));
    } catch (err) {
      console.error(`  [Reddit] Search error: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  },

  async reply(conversation: Conversation, text: string): Promise<PostResult> {
    try {
      const thingId = `t3_${conversation.id}`;
      const data = (await redditPost('/api/comment', {
        thing_id: thingId,
        text,
        api_type: 'json',
      })) as { json?: { data?: { things?: Array<{ data?: { id?: string; permalink?: string } }> }; errors?: string[][] } };

      const errors = data.json?.errors;
      if (errors && errors.length > 0) {
        return { ok: false, error: errors.map((e) => e.join(': ')).join('; ') };
      }

      const comment = data.json?.data?.things?.[0]?.data;
      return {
        ok: true,
        postId: comment?.id,
        url: comment?.permalink ? `https://reddit.com${comment.permalink}` : undefined,
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  async post(content: PostContent): Promise<PostResult> {
    try {
      const subreddit = (content.metadata?.subreddit as string) ?? 'test';
      // Extract a clean title: first sentence, or truncate at word boundary (max 300 chars)
      const titleRaw = (content.metadata?.title as string) ?? content.text;
      const firstSentence = titleRaw.match(/^[^.!?\n]+[.!?]?/)?.[0] ?? titleRaw;
      const title = firstSentence.length <= 300
        ? firstSentence
        : firstSentence.slice(0, 297).replace(/\s+\S*$/, '') + '...';

      const data = (await redditPost('/api/submit', {
        sr: subreddit,
        kind: 'self',
        title,
        text: content.text,
        api_type: 'json',
      })) as { json?: { data?: { id?: string; url?: string }; errors?: string[][] } };

      const errors = data.json?.errors;
      if (errors && errors.length > 0) {
        return { ok: false, error: errors.map((e) => e.join(': ')).join('; ') };
      }

      return {
        ok: true,
        postId: data.json?.data?.id,
        url: data.json?.data?.url,
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  async like(postId: string): Promise<boolean> {
    try {
      const thingId = postId.startsWith('t') ? postId : `t3_${postId}`;
      await redditPost('/api/vote', { id: thingId, dir: '1' });
      return true;
    } catch (err) {
      console.error(`  [Reddit] Like error: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  },

  async monitor(keywords: string[]): Promise<BrandMention[]> {
    try {
      const query = keywords.join(' OR ');
      const encoded = encodeURIComponent(query);
      const data = (await redditGet(`/search?q=${encoded}&sort=new&t=day&limit=50`)) as RedditSearchResponse;

      return data.data.children.map((child): BrandMention => {
        const post = child.data;
        return {
          id: post.id,
          platform: 'reddit',
          url: `https://reddit.com${post.permalink}`,
          text: post.title + (post.selftext ? `\n\n${post.selftext}` : ''),
          author: post.author,
          sentiment: 'unknown',
          createdAt: new Date(post.created_utc * 1000).toISOString(),
        };
      });
    } catch (err) {
      console.error(`  [Reddit] Monitor error: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  },

  isConfigured(): boolean {
    return !!(
      process.env.REDDIT_CLIENT_ID &&
      process.env.REDDIT_CLIENT_SECRET &&
      process.env.REDDIT_USERNAME &&
      process.env.REDDIT_PASSWORD
    );
  },
};
