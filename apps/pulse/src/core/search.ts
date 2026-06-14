/**
 * Multi-provider search wrapper -- shared by all PULSE modules.
 * Supports: Serper (default), SerpAPI, Brave Search.
 * Provider selected via SEARCH_PROVIDER env var.
 */

export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
  date?: string;
}

export interface SearchOptions {
  /** Number of results (default 10) */
  num?: number;
  /** Time filter: qdr:h (hour), qdr:d (day), qdr:w (week), qdr:m (month) */
  timeFilter?: string;
  /** Country code for localization */
  gl?: string;
}

import { loadState, saveState } from './state.js';

interface SearchQuota { count: number; monthKey: string }

function getMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Persistent quota tracking (survives restarts, resets monthly)
function getPersistedSearchCount(): number {
  const quota = loadState<SearchQuota>('search-quota', { count: 0, monthKey: getMonthKey() });
  if (quota.monthKey !== getMonthKey()) return 0;
  return quota.count;
}

function incrementSearchCount(): number {
  const monthKey = getMonthKey();
  const quota = loadState<SearchQuota>('search-quota', { count: 0, monthKey });
  if (quota.monthKey !== monthKey) { quota.count = 0; quota.monthKey = monthKey; }
  quota.count++;
  saveState('search-quota', quota);
  return quota.count;
}

let searchCount = 0; // In-memory counter for usage warnings (resets on restart)

function getSearchProvider(): 'serper' | 'serpapi' | 'brave' {
  return (process.env.SEARCH_PROVIDER ?? 'serper') as 'serper' | 'serpapi' | 'brave';
}

const providerLimits: Record<string, number> = {
  serper: 2500,
  serpapi: 100,
  brave: 2000,
};

function logUsageWarning(provider: string): void {
  const totalCount = getPersistedSearchCount();
  if (totalCount % 100 === 0 && totalCount > 0) {
    const limit = providerLimits[provider] ?? 2500;
    const pctUsed = Math.round((totalCount / limit) * 100);
    if (pctUsed >= 80) {
      console.warn(
        `  [Search] Monthly usage: ${totalCount}/${limit} (${pctUsed}%) — approaching configured ${provider} search limit`,
      );
    }
  }
}

// --- Serper -----------------------------------------------------------

async function searchSerper(query: string, options?: SearchOptions): Promise<SearchResult[]> {
  const apiKey = process.env.SERPER_API_KEY ?? '';
  if (!apiKey) {
    console.warn('  [Search] No SERPER_API_KEY configured for SEARCH_PROVIDER=serper');
    return [];
  }

  const opts = { num: 10, timeFilter: 'qdr:d', ...options };

  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        q: query,
        num: opts.num,
        ...(opts.timeFilter ? { tbs: opts.timeFilter } : {}),
        ...(opts.gl ? { gl: opts.gl } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`  [Search] Error ${res.status}: ${body.slice(0, 200)}`);
      return [];
    }

    searchCount++;
    incrementSearchCount();
    logUsageWarning('serper');

    const data = (await res.json()) as {
      organic?: Array<{ link: string; title: string; snippet: string; date?: string }>;
    };

    return (data.organic ?? []).map((item) => ({
      url: item.link,
      title: item.title,
      snippet: item.snippet,
      date: item.date,
    }));
  } catch (err) {
    console.error(`  [Search] Error: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

// --- SerpAPI ----------------------------------------------------------

async function searchSerpAPI(query: string, options?: SearchOptions): Promise<SearchResult[]> {
  const apiKey = process.env.SERPAPI_API_KEY ?? '';
  if (!apiKey) {
    console.warn('  [Search] No SERPAPI_API_KEY -- get one at serpapi.com');
    return [];
  }

  const opts = { num: 10, ...options };

  const params = new URLSearchParams({
    q: query,
    api_key: apiKey,
    engine: 'google',
    num: String(opts.num),
  });

  try {
    const res = await fetch(`https://serpapi.com/search?${params}`, {
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`  [Search] Error ${res.status}: ${body.slice(0, 200)}`);
      return [];
    }

    searchCount++;
    incrementSearchCount();
    logUsageWarning('serpapi');

    const data = await res.json() as {
      organic_results?: Array<{ link: string; title: string; snippet: string }>;
    };

    return (data.organic_results ?? []).map((item) => ({
      url: item.link,
      title: item.title,
      snippet: item.snippet,
    }));
  } catch (err) {
    console.error(`  [Search] Error: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

// --- Brave Search -----------------------------------------------------

async function searchBrave(query: string, options?: SearchOptions): Promise<SearchResult[]> {
  const apiKey = process.env.BRAVE_API_KEY ?? '';
  if (!apiKey) {
    console.warn('  [Search] No BRAVE_API_KEY -- get one at brave.com/search/api');
    return [];
  }

  const opts = { num: 10, ...options };

  const params = new URLSearchParams({
    q: query,
    count: String(opts.num),
  });

  try {
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
      headers: {
        'X-Subscription-Token': apiKey,
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`  [Search] Error ${res.status}: ${body.slice(0, 200)}`);
      return [];
    }

    searchCount++;
    incrementSearchCount();
    logUsageWarning('brave');

    const data = await res.json() as {
      web?: { results?: Array<{ url: string; title: string; description: string }> };
    };

    return (data.web?.results ?? []).map((item) => ({
      url: item.url,
      title: item.title,
      snippet: item.description,
    }));
  } catch (err) {
    console.error(`  [Search] Error: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

// --- Public API -------------------------------------------------------

/**
 * Search the web using the configured provider.
 * Automatically prepends site: filters for platform-specific searches.
 */
export async function search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
  const provider = getSearchProvider();

  switch (provider) {
    case 'serper':
      return searchSerper(query, options);
    case 'serpapi':
      return searchSerpAPI(query, options);
    case 'brave':
      return searchBrave(query, options);
    default:
      return searchSerper(query, options);
  }
}

/**
 * Search for posts on a specific platform via Google site: operator.
 */
export async function searchPlatform(
  platform: 'x.com' | 'reddit.com' | 'news.ycombinator.com' | 'producthunt.com' | 'linkedin.com',
  query: string,
  options?: SearchOptions
): Promise<SearchResult[]> {
  return search(`site:${platform} ${query}`, options);
}

/**
 * Get total searches used this session.
 */
export function getSearchCount(): number {
  return searchCount;
}
