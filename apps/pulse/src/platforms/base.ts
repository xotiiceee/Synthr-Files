/**
 * Platform interface — every platform module implements this.
 * Provides a unified API for searching, replying, posting, and monitoring
 * across X, Reddit, HN, Product Hunt, LinkedIn, and Discord.
 */

export interface Conversation {
  id: string;
  platform: string;
  url: string;
  text: string;
  author: string;
  topicId: string;
  createdAt: string;
  engagement: {
    likes: number;
    replies: number;
    reposts: number;
  };
  metadata?: Record<string, unknown>;
}

export interface PostContent {
  text: string;
  type: 'post' | 'thread' | 'comment';
  replyTo?: string; // Post ID to reply to
  /** Media IDs to attach (from platform-specific upload). */
  mediaIds?: string[];
  metadata?: Record<string, unknown>;
}

export interface PostResult {
  ok: boolean;
  postId?: string;
  url?: string;
  error?: string;
}

export interface BrandMention {
  id: string;
  platform: string;
  url: string;
  text: string;
  author: string;
  sentiment: 'positive' | 'neutral' | 'negative' | 'unknown';
  createdAt: string;
}

export interface PlatformCapabilities {
  canSearch: boolean;
  canReply: boolean;
  canPost: boolean;
  canLike: boolean;
  canMonitor: boolean;
  requiresAuth: boolean;
  limit: string;
}

export interface Platform {
  name: string;
  capabilities: PlatformCapabilities;

  /**
   * Search for relevant conversations on this platform.
   * Uses the configured search provider for platforms without native search APIs.
   */
  search(query: string, topicId: string): Promise<Conversation[]>;

  /**
   * Post a reply to a conversation.
   */
  reply(conversation: Conversation, text: string): Promise<PostResult>;

  /**
   * Create an original post on this platform.
   */
  post(content: PostContent): Promise<PostResult>;

  /**
   * Like/upvote a post (if supported).
   */
  like(postId: string): Promise<boolean>;

  /**
   * Search for brand mentions across this platform.
   */
  monitor(keywords: string[]): Promise<BrandMention[]>;

  /**
   * Check if the platform is configured and ready (API keys set, etc).
   */
  isConfigured(): boolean;
}
