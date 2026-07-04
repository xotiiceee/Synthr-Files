/**
 * Product Hunt platform module — discovery-only via Serper.dev.
 * PH is discovery-only — finds relevant launches for manual engagement.
 *
 * No PH-specific API keys needed; uses the configured search provider.
 */

import type {
  Platform,
  Conversation,
  PostContent,
  PostResult,
  BrandMention,
  PlatformCapabilities,
} from './base.js';
import { searchPlatform } from '../core/search.js';

/**
 * Extract a Product Hunt post ID from a URL.
 * Patterns: /posts/slug, /products/slug, /discussions/slug
 */
function extractPostId(url: string): string {
  const match = url.match(/producthunt\.com\/(?:posts|products|discussions)\/([^/?#]+)/);
  return match?.[1] ?? url;
}

export const producthunt: Platform = {
  name: 'producthunt',

  capabilities: {
    canSearch: true,
    canReply: false,
    canPost: false,
    canLike: false,
    canMonitor: true,
    requiresAuth: false,
    limit: 'Via configured search provider',
  } satisfies PlatformCapabilities,

  async search(query: string, topicId: string): Promise<Conversation[]> {
    const results = await searchPlatform('producthunt.com', query, { num: 10 });

    return results.map((r) => ({
      id: extractPostId(r.url),
      platform: 'producthunt',
      url: r.url,
      text: r.snippet,
      author: '', // Not available from Google snippets
      topicId,
      createdAt: r.date ?? new Date().toISOString(),
      engagement: { likes: 0, replies: 0, reposts: 0 },
      metadata: { title: r.title },
    }));
  },

  async reply(conversation: Conversation, _text: string): Promise<PostResult> {
    return {
      ok: true,
      url: conversation.url,
      error: 'Draft generated. Visit the post URL to reply manually.',
    };
  },

  async post(_content: PostContent): Promise<PostResult> {
    return {
      ok: true,
      error: 'Draft generated. Post manually at producthunt.com.',
    };
  },

  async like(_postId: string): Promise<boolean> {
    return false;
  },

  async monitor(keywords: string[]): Promise<BrandMention[]> {
    const mentions: BrandMention[] = [];

    for (const keyword of keywords) {
      const results = await searchPlatform('producthunt.com', keyword, { num: 10 });

      for (const r of results) {
        mentions.push({
          id: extractPostId(r.url),
          platform: 'producthunt',
          url: r.url,
          text: r.snippet,
          author: '',
          sentiment: 'unknown',
          createdAt: r.date ?? new Date().toISOString(),
        });
      }
    }

    return mentions;
  },

  isConfigured(): boolean {
    return true; // Uses Serper.dev, no PH-specific keys needed
  },
};
