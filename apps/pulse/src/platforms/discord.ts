/**
 * Discord platform module — full read/write via bot token.
 * Requires DISCORD_BOT_TOKEN and DISCORD_CHANNEL_IDS (comma-separated) env vars.
 * Bot tokens are created at discord.com/developers/applications.
 */

import type {
  Platform,
  Conversation,
  PostContent,
  PostResult,
  BrandMention,
  PlatformCapabilities,
} from './base.js';

const API_BASE = 'https://discord.com/api/v10';

interface DiscordMessage {
  id: string;
  channel_id: string;
  content: string;
  author: { id: string; username: string; discriminator: string };
  timestamp: string;
  reactions?: Array<{ emoji: { name: string }; count: number }>;
  referenced_message?: { id: string } | null;
}

function getToken(): string {
  return process.env.DISCORD_BOT_TOKEN ?? '';
}

function getChannelIds(): string[] {
  const raw = process.env.DISCORD_CHANNEL_IDS ?? '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function headers(): Record<string, string> {
  return {
    Authorization: `Bot ${getToken()}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Fetch with retry on Discord 429 (max 2 retries, respects retry_after).
 */
async function discordFetch(url: string, init: RequestInit, retries = 2): Promise<Response> {
  const res = await fetch(url, init);
  if (res.status === 429 && retries > 0) {
    try {
      const body = (await res.json()) as { retry_after?: number };
      const wait = Math.min((body.retry_after ?? 3) * 1000, 15_000);
      console.log(`  [Discord] Rate limited — waiting ${Math.ceil(wait / 1000)}s...`);
      await new Promise((r) => setTimeout(r, wait));
    } catch {
      await new Promise((r) => setTimeout(r, 3000));
    }
    return discordFetch(url, init, retries - 1);
  }
  return res;
}

function messageToConversation(msg: DiscordMessage, topicId: string): Conversation {
  const likeReaction = msg.reactions?.find((r) => r.emoji.name === '👍');

  return {
    id: msg.id,
    platform: 'discord',
    url: `https://discord.com/channels/-/${msg.channel_id}/${msg.id}`,
    text: msg.content,
    author: msg.author.username,
    topicId,
    createdAt: msg.timestamp,
    engagement: {
      likes: likeReaction?.count ?? 0,
      replies: 0, // Not directly available from message object
      reposts: 0,
    },
    metadata: {
      channelId: msg.channel_id,
      authorId: msg.author.id,
    },
  };
}

export const discord: Platform = {
  name: 'discord',

  capabilities: {
    canSearch: true,
    canReply: true,
    canPost: true,
    canLike: true, // Via reactions
    canMonitor: true,
    requiresAuth: true,
    limit: 'Bot-token rate limits',
  } satisfies PlatformCapabilities,

  async search(query: string, topicId: string): Promise<Conversation[]> {
    if (!getToken()) return [];

    const channelIds = getChannelIds();
    const conversations: Conversation[] = [];
    const queryLower = query.toLowerCase();

    for (const channelId of channelIds) {
      try {
        const res = await discordFetch(`${API_BASE}/channels/${channelId}/messages?limit=50`, {
          headers: headers(),
          signal: AbortSignal.timeout(10_000),
        });

        if (!res.ok) {
          console.error(`  [Discord] Channel ${channelId} fetch error ${res.status}`);
          continue;
        }

        const messages = (await res.json()) as DiscordMessage[];

        // Filter messages matching the query
        for (const msg of messages) {
          if (msg.content.toLowerCase().includes(queryLower)) {
            conversations.push(messageToConversation(msg, topicId));
          }
        }
      } catch (err) {
        console.error(
          `  [Discord] Channel ${channelId} error: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    return conversations;
  },

  async reply(conversation: Conversation, text: string): Promise<PostResult> {
    const channelId = (conversation.metadata?.channelId as string) ?? '';
    if (!channelId) {
      return { ok: false, error: 'Missing channelId in conversation metadata' };
    }

    try {
      const res = await discordFetch(`${API_BASE}/channels/${channelId}/messages`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          content: text,
          message_reference: { message_id: conversation.id },
        }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        const body = await res.text();
        return { ok: false, error: `Discord API error ${res.status}: ${body.slice(0, 200)}` };
      }

      const msg = (await res.json()) as DiscordMessage;
      return {
        ok: true,
        postId: msg.id,
        url: `https://discord.com/channels/-/${channelId}/${msg.id}`,
      };
    } catch (err) {
      return { ok: false, error: `Discord reply failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  },

  async post(content: PostContent): Promise<PostResult> {
    // Post to the first configured channel by default
    const channelIds = getChannelIds();
    const channelId = (content.metadata?.channelId as string) ?? channelIds[0];

    if (!channelId) {
      return { ok: false, error: 'No DISCORD_CHANNEL_IDS configured' };
    }

    try {
      const body: Record<string, unknown> = { content: content.text };

      // If replying to a specific message
      if (content.replyTo) {
        body.message_reference = { message_id: content.replyTo };
      }

      const res = await discordFetch(`${API_BASE}/channels/${channelId}/messages`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        const resBody = await res.text();
        return { ok: false, error: `Discord API error ${res.status}: ${resBody.slice(0, 200)}` };
      }

      const msg = (await res.json()) as DiscordMessage;
      return {
        ok: true,
        postId: msg.id,
        url: `https://discord.com/channels/-/${channelId}/${msg.id}`,
      };
    } catch (err) {
      return { ok: false, error: `Discord post failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  },

  async like(postId: string): Promise<boolean> {
    // postId format from our conversations: "messageId" with channelId in metadata
    // But like() only gets postId, so we check all configured channels
    const channelIds = getChannelIds();
    if (channelIds.length === 0) return false;

    const emoji = encodeURIComponent('👍');

    // Try the first channel first (most common case), then fallback
    for (const channelId of channelIds) {
      try {
        const res = await discordFetch(
          `${API_BASE}/channels/${channelId}/messages/${postId}/reactions/${emoji}/@me`,
          {
            method: 'PUT',
            headers: headers(),
            signal: AbortSignal.timeout(10_000),
          }
        );

        if (res.status === 204 || res.ok) return true;
        // 10003 = Unknown Message — try next channel
        if (res.status === 404) continue;
        // Other errors — stop trying
        return false;
      } catch {
        continue;
      }
    }

    return false;
  },

  async monitor(keywords: string[]): Promise<BrandMention[]> {
    if (!getToken()) return [];

    const channelIds = getChannelIds();
    const mentions: BrandMention[] = [];
    const seen = new Set<string>();

    for (const channelId of channelIds) {
      try {
        const res = await discordFetch(`${API_BASE}/channels/${channelId}/messages?limit=50`, {
          headers: headers(),
          signal: AbortSignal.timeout(10_000),
        });

        if (!res.ok) continue;

        const messages = (await res.json()) as DiscordMessage[];

        for (const msg of messages) {
          const contentLower = msg.content.toLowerCase();
          const matches = keywords.some((kw) => contentLower.includes(kw.toLowerCase()));

          if (matches && !seen.has(msg.id)) {
            seen.add(msg.id);
            mentions.push({
              id: msg.id,
              platform: 'discord',
              url: `https://discord.com/channels/-/${msg.channel_id}/${msg.id}`,
              text: msg.content,
              author: msg.author.username,
              sentiment: 'unknown',
              createdAt: msg.timestamp,
            });
          }
        }
      } catch {
        // Skip failed channels
      }
    }

    return mentions;
  },

  isConfigured(): boolean {
    return !!getToken();
  },
};
