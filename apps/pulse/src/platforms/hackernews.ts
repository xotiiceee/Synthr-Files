/**
 * Hacker News platform module — read-only via Algolia HN API.
 * HN is read-only for PULSE — finds conversations for manual engagement.
 * See playbooks/03-hackernews.md
 *
 * No auth required. Search uses Algolia's public API.
 */

import type {
  Platform,
  Conversation,
  PostContent,
  PostResult,
  BrandMention,
  PlatformCapabilities,
} from './base.js';

const ALGOLIA_BASE = 'https://hn.algolia.com/api/v1';

interface AlgoliaHit {
  objectID: string;
  comment_text?: string;
  story_text?: string;
  title?: string;
  author: string;
  story_title?: string;
  story_url?: string;
  created_at_i: number;
  points?: number;
  num_comments?: number;
}

interface AlgoliaResponse {
  hits: AlgoliaHit[];
}

function hitToConversation(hit: AlgoliaHit, topicId: string): Conversation {
  const text = hit.comment_text ?? hit.story_text ?? hit.title ?? '';
  // Strip basic HTML tags from comment_text
  const cleanText = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  return {
    id: hit.objectID,
    platform: 'hackernews',
    url: `https://news.ycombinator.com/item?id=${hit.objectID}`,
    text: cleanText,
    author: hit.author,
    topicId,
    createdAt: new Date(hit.created_at_i * 1000).toISOString(),
    engagement: {
      likes: hit.points ?? 0,
      replies: hit.num_comments ?? 0,
      reposts: 0,
    },
    metadata: {
      storyTitle: hit.story_title,
      storyUrl: hit.story_url,
    },
  };
}

export const hackernews: Platform = {
  name: 'hackernews',

  capabilities: {
    canSearch: true,
    canReply: false,
    canPost: false,
    canLike: false,
    canMonitor: true,
    requiresAuth: false,
    limit: 'Public Algolia reads',
  } satisfies PlatformCapabilities,

  async search(query: string, topicId: string): Promise<Conversation[]> {
    const oneDayAgo = Math.floor(Date.now() / 1000) - 86400;

    try {
      const params = new URLSearchParams({
        query,
        tags: 'comment',
        numericFilters: `created_at_i>${oneDayAgo}`,
        hitsPerPage: '20',
      });

      const res = await fetch(`${ALGOLIA_BASE}/search_by_date?${params}`, {
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        console.error(`  [HN] Search error ${res.status}`);
        return [];
      }

      const data = (await res.json()) as AlgoliaResponse;
      return data.hits.map((hit) => hitToConversation(hit, topicId));
    } catch (err) {
      console.error(`  [HN] Search failed: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  },

  async reply(conversation: Conversation, _text: string): Promise<PostResult> {
    return {
      ok: true,
      url: conversation.url,
      error: 'Draft generated. Visit the HN thread to reply manually.',
    };
  },

  async post(_content: PostContent): Promise<PostResult> {
    return {
      ok: true,
      error: 'Draft generated. Post manually at news.ycombinator.com.',
    };
  },

  async like(_postId: string): Promise<boolean> {
    return false;
  },

  async monitor(keywords: string[]): Promise<BrandMention[]> {
    const oneDayAgo = Math.floor(Date.now() / 1000) - 86400;
    const mentions: BrandMention[] = [];

    for (const keyword of keywords) {
      try {
        const params = new URLSearchParams({
          query: keyword,
          tags: '(story,comment)',
          numericFilters: `created_at_i>${oneDayAgo}`,
          hitsPerPage: '10',
        });

        const res = await fetch(`${ALGOLIA_BASE}/search_by_date?${params}`, {
          signal: AbortSignal.timeout(10_000),
        });

        if (!res.ok) continue;

        const data = (await res.json()) as AlgoliaResponse;

        for (const hit of data.hits) {
          const text = (hit.comment_text ?? hit.story_text ?? hit.title ?? '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

          mentions.push({
            id: hit.objectID,
            platform: 'hackernews',
            url: `https://news.ycombinator.com/item?id=${hit.objectID}`,
            text,
            author: hit.author,
            sentiment: 'unknown',
            createdAt: new Date(hit.created_at_i * 1000).toISOString(),
          });
        }
      } catch {
        // Skip failed keyword searches
      }
    }

    return mentions;
  },

  isConfigured(): boolean {
    return true; // No auth needed
  },
};
