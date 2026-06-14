/**
 * LinkedIn platform module — manual-assist mode.
 * Finds posts via the configured search provider, generates content, and saves
 * drafts for manual posting.
 *
 * LinkedIn's API requires OAuth2 with company page admin approval,
 * so PULSE generates content and saves it as drafts the user can copy-paste.
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
import * as fs from 'node:fs';
import * as path from 'node:path';

const DRAFTS_DIR = path.resolve('data');
const DRAFTS_FILE = path.join(DRAFTS_DIR, 'linkedin-drafts.json');

interface LinkedInDraft {
  type: 'reply' | 'post';
  text: string;
  replyTo?: { id: string; url: string; author: string };
  createdAt: string;
}

function saveDraft(draft: LinkedInDraft): void {
  try {
    if (!fs.existsSync(DRAFTS_DIR)) {
      fs.mkdirSync(DRAFTS_DIR, { recursive: true });
    }

    let drafts: LinkedInDraft[] = [];
    if (fs.existsSync(DRAFTS_FILE)) {
      const raw = fs.readFileSync(DRAFTS_FILE, 'utf-8');
      drafts = JSON.parse(raw) as LinkedInDraft[];
    }

    drafts.push(draft);
    fs.writeFileSync(DRAFTS_FILE, JSON.stringify(drafts, null, 2));
  } catch (err) {
    console.error(`  [LinkedIn] Failed to save draft: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Extract LinkedIn post/article ID from URL if possible.
 */
function extractLinkedInId(url: string): string {
  // Patterns: /posts/slug, /pulse/slug, /feed/update/urn:li:activity:ID
  const activityMatch = url.match(/activity[:/](\d+)/);
  if (activityMatch) return activityMatch[1];

  const postMatch = url.match(/linkedin\.com\/(?:posts|pulse|feed)\/([^/?#]+)/);
  return postMatch?.[1] ?? url;
}

export const linkedin: Platform = {
  name: 'linkedin',

  capabilities: {
    canSearch: true,
    canReply: false,
    canPost: false,
    canLike: false,
    canMonitor: true,
    requiresAuth: false,
    limit: 'Via configured search provider (manual posting)',
  } satisfies PlatformCapabilities,

  async search(query: string, topicId: string): Promise<Conversation[]> {
    const results = await searchPlatform('linkedin.com', query, { num: 10 });

    return results.map((r) => ({
      id: extractLinkedInId(r.url),
      platform: 'linkedin',
      url: r.url,
      text: r.snippet,
      author: '', // Not reliably extractable from Google snippets
      topicId,
      createdAt: r.date ?? new Date().toISOString(),
      engagement: { likes: 0, replies: 0, reposts: 0 },
      metadata: { title: r.title },
    }));
  },

  async reply(conversation: Conversation, text: string): Promise<PostResult> {
    saveDraft({
      type: 'reply',
      text,
      replyTo: { id: conversation.id, url: conversation.url, author: conversation.author },
      createdAt: new Date().toISOString(),
    });

    return {
      ok: true,
      url: conversation.url,
      error: `Draft saved to ${DRAFTS_FILE}. Open the post URL and paste your reply.`,
    };
  },

  async post(content: PostContent): Promise<PostResult> {
    saveDraft({
      type: 'post',
      text: content.text,
      createdAt: new Date().toISOString(),
    });

    return {
      ok: true,
      error: `Draft saved to ${DRAFTS_FILE}. Go to linkedin.com and paste your post.`,
    };
  },

  async like(_postId: string): Promise<boolean> {
    return false;
  },

  async monitor(keywords: string[]): Promise<BrandMention[]> {
    const mentions: BrandMention[] = [];

    for (const keyword of keywords) {
      const results = await searchPlatform('linkedin.com', keyword, { num: 10 });

      for (const r of results) {
        mentions.push({
          id: extractLinkedInId(r.url),
          platform: 'linkedin',
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
    return true; // Uses Serper.dev, no LinkedIn-specific keys needed
  },
};
