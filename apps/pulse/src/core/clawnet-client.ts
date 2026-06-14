/**
 * ClawNet API client for Pulse.
 *
 * Calls ClawNet's direct endpoint invocation route (POST /v1/endpoints/:id/call)
 * for Twitter/X data. No LLM orchestration overhead — just the endpoint cost.
 *
 * Returns raw data + Soma birth certificate for provenance verification.
 */

import { loadConfig } from './persona.js';

// ─── Auto-Billing (hosted mode) ────────────────────────────────────────────
// Every ClawNet API call costs the platform credits. In hosted mode, we
// recover these costs from the customer with 15% markup (COST_RECOVERY_MARKUP).
// The billing key comes from AsyncLocalStorage context — set by withTenantContext.
const COST_RECOVERY_MARKUP = 1.15; // 15% margin on all ClawNet pass-through costs

let _getContextBillingKey: (() => string | undefined) | null = null;
try {
  const ctx = await import('../../hosted/context.js');
  _getContextBillingKey = ctx.getContextBillingKey;
} catch { /* self-hosted mode — no auto-billing */ }

async function recoverClawNetCost(creditsUsed: number, endpointId: string): Promise<void> {
  if (!_getContextBillingKey || creditsUsed <= 0) return;
  const billingKey = _getContextBillingKey();
  if (!billingKey) return; // self-hosted or no tenant context
  // Don't bill the platform's own key (would drain operator credits)
  const platformKey = getApiKey();
  if (billingKey === platformKey) return;
  const markedUp = Math.max(0.1, Math.round(creditsUsed * COST_RECOVERY_MARKUP * 100) / 100);
  try {
    const url = `${getClawNetUrl()}/v1/auth/deduct`;
    await fetch(url, {
      method: 'POST',
      headers: { 'X-API-Key': billingKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: markedUp, reason: `pulse:clawnet:${endpointId}` }),
      signal: AbortSignal.timeout(5000),
    });
  } catch { /* best-effort — don't crash the caller if billing fails */ }
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface BirthCertificate {
  dataHash: string;
  signature: string;
  timestamp: string;
  publicKey: string;
  heartbeatIndex: number;
}

export interface EndpointCallResult<T = unknown> {
  requestId: string;
  endpointId: string;
  data: T;
  cached: boolean;
  creditsUsed: number;
  durationMs: number;
  provenance: BirthCertificate | null;
}

// ─── Config ─────────────────────────────────────────────────────────────────

function getClawNetUrl(): string {
  return process.env.CLAWNET_API_URL || 'https://api.claw-net.org';
}

function getApiKey(): string {
  // Hosted mode: use the platform API key for server-side calls
  // Self-hosted: user sets CLAWNET_API_KEY in env
  return process.env.CLAWNET_API_KEY || '';
}

// ─── Core Call ──────────────────────────────────────────────────────────────

/**
 * Call a ClawNet registry endpoint directly.
 * No LLM parsing, no orchestration fee — just the endpoint cost.
 */
export async function callEndpoint<T = unknown>(
  endpointId: string,
  params: Record<string, unknown> = {},
  options?: { timeout?: number; cache?: 'smart' | 'fresh' | 'prefer' },
): Promise<EndpointCallResult<T>> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('CLAWNET_API_KEY not set — required for X data via ClawNet');
  }

  const url = `${getClawNetUrl()}/v1/endpoints/${endpointId}/call`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      params,
      cache: options?.cache ?? 'smart',
    }),
    signal: AbortSignal.timeout(options?.timeout ?? 15_000),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` })) as any;
    throw new Error(`ClawNet ${endpointId}: ${body.error || body.code || res.status}`);
  }

  const result = await res.json() as EndpointCallResult<T>;

  // Extract Soma headers if present (backup — also in response body)
  if (!result.provenance) {
    const dataHash = res.headers.get('X-Soma-Data-Hash');
    const signature = res.headers.get('X-Soma-Signature');
    if (dataHash && signature) {
      result.provenance = {
        dataHash,
        signature,
        publicKey: res.headers.get('X-Soma-Public-Key') || '',
        timestamp: new Date().toISOString(),
        heartbeatIndex: parseInt(res.headers.get('X-Soma-Heartbeat-Index') || '0'),
      };
    }
  }

  // Auto-recover ClawNet costs from customer (15% markup, hosted mode only)
  recoverClawNetCost(result.creditsUsed, endpointId).catch(() => {});

  return result;
}

// ─── Twitter/X Convenience Methods ──────────────────────────────────────────

export interface TweetReply {
  id: string;
  text: string;
  author: string;
  authorName?: string;
  likes?: number;
  replies?: number;
  retweets?: number;
  createdAt?: string;
}

export interface TweetRepliesResponse {
  replies: TweetReply[];
  total: number;
  authors?: Record<string, unknown>[];
}

export interface UserProfile {
  displayName: string;
  username: string;
  followers: number;
  following: number;
  verified: boolean;
  bio: string;
  recentTweets?: unknown[];
  engagementRate?: number;
}

export interface TweetSearchResult {
  tweets: Array<{
    id: string;
    text: string;
    author: string;
    likes: number;
    replies: number;
    retweets: number;
    createdAt?: string;
  }>;
  mentionCount?: number;
  engagementTotal?: number;
  sentimentScore?: number;
}

/**
 * Get replies to a specific tweet. Returns threaded reply data with author info.
 * Uses twitsh-tweet-replies endpoint (costPerCall: $0.01).
 */
export async function getTweetReplies(tweetId: string): Promise<EndpointCallResult<TweetRepliesResponse>> {
  return callEndpoint<TweetRepliesResponse>('twitsh-tweet-replies', { tweetId });
}

/**
 * Get a user's profile: followers, verified, bio, engagement rate.
 * Tries twitsh first, falls back to cascade.
 */
export async function getUserProfile(username: string): Promise<EndpointCallResult<UserProfile>> {
  try {
    return await callEndpoint<UserProfile>('twitsh-user-profile', { username: username.replace('@', '') });
  } catch {
    // Fallback to cascade provider
    return callEndpoint<UserProfile>('cascade-twitter-user', { username: username.replace('@', '') });
  }
}

/**
 * Search tweets by keyword. Real-time results with engagement metrics.
 */
export async function searchTweets(query: string, limit: number = 20): Promise<EndpointCallResult<TweetSearchResult>> {
  try {
    return await callEndpoint<TweetSearchResult>('twitsh-search', { query, limit });
  } catch {
    return await callEndpoint<TweetSearchResult>('cascade-twitter-search', { query, count: limit });
  }
}

/**
 * Check if ClawNet integration is configured.
 */
export function isClawNetConfigured(): boolean {
  return !!getApiKey();
}
