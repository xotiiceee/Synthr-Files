/**
 * Listening provider facade.
 *
 * Keeps X discovery/listening behind an explicit boundary so Pulse can move
 * from ClawNet-backed discovery to official or third-party providers without
 * changing product logic.
 */

import {
  search,
  searchPlatform,
  type SearchOptions,
  type SearchResult,
} from "./search.js";
import {
  getUserProfile,
  isClawNetConfigured,
  searchTweets,
  type UserProfile,
} from "./clawnet-client.js";
export type ListeningPlatform =
  | "x.com"
  | "reddit.com"
  | "news.ycombinator.com"
  | "producthunt.com"
  | "linkedin.com";

export interface ListeningUsageContext {
  operationId: string;
  metadata?: Record<string, unknown>;
}

export interface XRealtimeOptions {
  limit?: number;
  usage?: ListeningUsageContext;
}

export interface XUserProfileOptions {
  usage?: ListeningUsageContext;
}

export interface XRealtimeSearchResult {
  results: SearchResult[];
  creditsUsed: number;
}

export interface XUserProfileResult {
  profile: UserProfile;
  creditsUsed: number;
}

export type ListeningUsageAction = "x.realtime_search" | "x.user_profile";

export interface ListeningUsageEvent {
  action: ListeningUsageAction;
  provider: "clawnet";
  operationId: string;
  creditsUsed: number;
  resultCount: number;
  query?: string;
  username?: string;
  limit?: number;
  metadata?: Record<string, unknown>;
}

export type ListeningUsageHook =
  | ((event: ListeningUsageEvent) => void | Promise<void>)
  | null;

export type ProviderRiskLabel = "official" | "transitional" | "experimental";

export interface ProviderCostProfile {
  unit: "credits" | "request";
  billedBy: "provider" | "pulse";
  notes: string;
}

export interface ProviderRiskProfile {
  provider: string;
  riskLabel: ProviderRiskLabel;
  costProfile: ProviderCostProfile;
}

export interface ListeningProvider {
  name: string;
  getRiskProfile(): ProviderRiskProfile;
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
  searchPlatform(
    platform: ListeningPlatform,
    query: string,
    options?: SearchOptions,
  ): Promise<SearchResult[]>;
  canSearchXRealtime(): boolean;
  searchXRealtime(
    query: string,
    options?: XRealtimeOptions,
  ): Promise<SearchResult[]>;
  searchXRealtimeWithUsage(
    query: string,
    options?: XRealtimeOptions,
  ): Promise<XRealtimeSearchResult>;
  canGetXUserProfile(): boolean;
  getXUserProfile(
    username: string,
    options?: XUserProfileOptions,
  ): Promise<XUserProfileResult | null>;
}

let usageHook: ListeningUsageHook = null;

export function setListeningUsageHook(hook: ListeningUsageHook): void {
  usageHook = hook;
}

async function emitUsage(event: ListeningUsageEvent): Promise<void> {
  if (!usageHook) return;
  try {
    await usageHook(event);
  } catch (err) {
    console.warn(
      `[ListeningProvider] Usage hook failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

class DefaultListeningProvider implements ListeningProvider {
  name = "default";

  getRiskProfile(): ProviderRiskProfile {
    return {
      provider: this.name,
      riskLabel: "transitional",
      costProfile: {
        unit: "credits",
        billedBy: "provider",
        notes:
          "Generic web search uses configured search provider limits; real-time X search/profile reads use ClawNet credits when configured.",
      },
    };
  }

  search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    return search(query, options);
  }

  searchPlatform(
    platform: ListeningPlatform,
    query: string,
    options?: SearchOptions,
  ): Promise<SearchResult[]> {
    return searchPlatform(platform, query, options);
  }

  canSearchXRealtime(): boolean {
    return isClawNetConfigured();
  }

  async searchXRealtime(
    query: string,
    options?: XRealtimeOptions,
  ): Promise<SearchResult[]> {
    const result = await this.searchXRealtimeWithUsage(query, options);
    return result.results;
  }

  async searchXRealtimeWithUsage(
    query: string,
    options?: XRealtimeOptions,
  ): Promise<XRealtimeSearchResult> {
    if (!this.canSearchXRealtime()) return { results: [], creditsUsed: 0 };

    const rtResults = await searchTweets(query, options?.limit ?? 10);
    const tweets = rtResults.data.tweets ?? [];
    const result = {
      creditsUsed: rtResults.creditsUsed,
      results: tweets.map((tweet) => ({
        url: `https://x.com/i/status/${tweet.id}`,
        title: `@${tweet.author}`,
        snippet: tweet.text,
        date: tweet.createdAt,
      })),
    };

    const operationId = options?.usage?.operationId?.trim();
    if (operationId) {
      await emitUsage({
        action: "x.realtime_search",
        provider: "clawnet",
        operationId,
        creditsUsed: result.creditsUsed,
        resultCount: result.results.length,
        query,
        limit: options?.limit,
        metadata: options?.usage?.metadata,
      });
    }

    return result;
  }

  canGetXUserProfile(): boolean {
    return isClawNetConfigured();
  }

  async getXUserProfile(
    username: string,
    options?: XUserProfileOptions,
  ): Promise<XUserProfileResult | null> {
    if (!this.canGetXUserProfile()) return null;

    const result = await getUserProfile(username);
    const usageResult = {
      profile: result.data,
      creditsUsed: result.creditsUsed,
    };
    const operationId = options?.usage?.operationId?.trim();
    if (operationId) {
      await emitUsage({
        action: "x.user_profile",
        provider: "clawnet",
        operationId,
        creditsUsed: usageResult.creditsUsed,
        resultCount: usageResult.profile ? 1 : 0,
        username,
        metadata: options?.usage?.metadata,
      });
    }
    return usageResult;
  }
}

const defaultListeningProvider = new DefaultListeningProvider();

export function getListeningProvider(): ListeningProvider {
  return defaultListeningProvider;
}
