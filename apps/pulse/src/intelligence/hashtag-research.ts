/**
 * Trending Topic & Hashtag Research.
 * Finds trending conversations, hashtags, and viral content in the user's niche.
 * Uses Serper search across X, Reddit, and HN, then LLM analysis to extract themes.
 */

import { search, searchPlatform } from '../core/search.js';
import { askLLM } from '../core/llm.js';
import { getConfig } from '../core/persona.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TrendingReport {
  generatedAt: string;
  niche: string;
  trendingTopics: Array<{
    topic: string;
    platform: string;
    mentions: number;
    sentiment: string;
  }>;
  suggestedContent: string[];
  hashtags: {
    highVolume: string[];
    niche: string[];
    emerging: string[];
  };
  viralPosts: ViralPost[];
}

export interface ViralPost {
  platform: string;
  text: string;
  url: string;
  engagement: string;
  whyItWorked: string;
}

// ─── Search Helpers ──────────────────────────────────────────────────────────

async function searchPlatformTrends(
  niche: string,
  keywords: string[]
): Promise<Array<{ platform: string; title: string; snippet: string; url: string }>> {
  const results: Array<{ platform: string; title: string; snippet: string; url: string }> = [];

  // Search across X, Reddit, and HN in parallel
  const platforms = [
    { site: 'x.com' as const, name: 'x' },
    { site: 'reddit.com' as const, name: 'reddit' },
    { site: 'news.ycombinator.com' as const, name: 'hackernews' },
  ];

  const queries = keywords.slice(0, 3); // Limit to conserve search quota
  const searchTasks: Promise<void>[] = [];

  for (const platform of platforms) {
    for (const query of queries) {
      searchTasks.push(
        searchPlatform(platform.site, `${niche} ${query}`, {
          num: 5,
          timeFilter: 'qdr:w', // Past week
        }).then((hits) => {
          for (const hit of hits) {
            results.push({
              platform: platform.name,
              title: hit.title,
              snippet: hit.snippet,
              url: hit.url,
            });
          }
        })
      );
    }
  }

  await Promise.all(searchTasks);
  return results;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Research trending topics in the user's niche across X, Reddit, and HN.
 * Searches recent popular posts via Serper, then asks LLM to extract themes.
 */
export async function researchTrending(): Promise<TrendingReport> {
  const config = getConfig();
  const niche = config.persona.niche;
  const themes = config.contentThemes.length > 0
    ? config.contentThemes
    : [niche];

  // Gather search results across platforms
  const trendKeywords = ['trending', 'viral', 'hot take', 'debate', 'launch'];
  const searchResults = await searchPlatformTrends(niche, trendKeywords);

  // Also do a general trending search
  const generalTrends = await search(`${niche} trending this week`, {
    num: 10,
    timeFilter: 'qdr:w',
  });

  // Combine all search data for LLM analysis
  const searchSummary = searchResults
    .slice(0, 30)
    .map(
      (r) =>
        `[${r.platform}] ${r.title}\n  ${r.snippet.slice(0, 150)}\n  ${r.url}`
    )
    .join('\n\n');

  const generalSummary = generalTrends
    .slice(0, 10)
    .map((r) => `${r.title}: ${r.snippet.slice(0, 150)}`)
    .join('\n');

  const prompt = `You are a social media trend analyst for the "${niche}" niche.

CONTENT THEMES: ${themes.join(', ')}
COMPETITORS: ${config.competitors.join(', ') || 'none listed'}

RECENT POSTS FROM PLATFORMS:
${searchSummary || 'No search results available.'}

GENERAL TRENDING:
${generalSummary || 'No general results available.'}

Analyze the data and respond in EXACTLY this JSON format (no markdown, no code blocks):
{
  "trendingTopics": [
    { "topic": "topic name", "platform": "x/reddit/hackernews", "mentions": 5, "sentiment": "positive/negative/neutral/mixed" }
  ],
  "suggestedContent": [
    "specific content idea based on trending topic 1",
    "specific content idea based on trending topic 2"
  ],
  "hashtags": {
    "highVolume": ["#hashtag1", "#hashtag2"],
    "niche": ["#niche1", "#niche2"],
    "emerging": ["#emerging1", "#emerging2"]
  },
  "viralPosts": [
    { "platform": "x", "text": "summary of the post", "url": "url", "engagement": "high/estimated likes", "whyItWorked": "reason" }
  ]
}

Include 5-8 trending topics, 5-7 content ideas, 5+ hashtags per category, and 3-5 viral posts. Be specific to the niche — no generic social media advice.`;

  const raw = await askLLM(prompt, { maxTokens: 1500, temperature: 0.5 });

  const defaults: TrendingReport = {
    generatedAt: new Date().toISOString(),
    niche,
    trendingTopics: [],
    suggestedContent: [],
    hashtags: { highVolume: [], niche: [], emerging: [] },
    viralPosts: [],
  };

  if (!raw) return defaults;

  try {
    const parsed = JSON.parse(raw);
    return {
      generatedAt: new Date().toISOString(),
      niche,
      trendingTopics: parsed.trendingTopics ?? [],
      suggestedContent: parsed.suggestedContent ?? [],
      hashtags: {
        highVolume: parsed.hashtags?.highVolume ?? [],
        niche: parsed.hashtags?.niche ?? [],
        emerging: parsed.hashtags?.emerging ?? [],
      },
      viralPosts: (parsed.viralPosts ?? []).map((v: any) => ({
        platform: v.platform ?? 'unknown',
        text: v.text ?? '',
        url: v.url ?? '',
        engagement: v.engagement ?? 'unknown',
        whyItWorked: v.whyItWorked ?? '',
      })),
    };
  } catch {
    console.log('  [Hashtag] Failed to parse LLM response, using defaults');
    return defaults;
  }
}

/**
 * Given a topic, suggest 10-15 relevant hashtags (mix of high-volume and niche).
 */
export async function suggestHashtags(topic: string): Promise<string[]> {
  const config = getConfig();

  // Search for popular posts on the topic to find real hashtags
  const results = await search(`${topic} ${config.persona.niche} hashtags`, {
    num: 10,
    timeFilter: 'qdr:m',
  });

  const context = results
    .slice(0, 5)
    .map((r) => `${r.title}: ${r.snippet.slice(0, 100)}`)
    .join('\n');

  const prompt = `Suggest 10-15 hashtags for the topic "${topic}" in the "${config.persona.niche}" niche.

Context from recent posts:
${context || 'No context available.'}

Mix of:
- 3-4 high-volume hashtags (>100K posts, broad reach)
- 4-5 niche-specific hashtags (targeted, less competition)
- 3-4 emerging/trending hashtags (growing momentum)

Respond with ONLY a JSON array of hashtag strings, like: ["#tag1", "#tag2", "#tag3"]
No explanation, no markdown.`;

  const raw = await askLLM(prompt, { maxTokens: 300, temperature: 0.6 });
  if (!raw) return [`#${topic.replace(/\s+/g, '')}`];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((t) => typeof t === 'string');
  } catch {
    // Try to extract hashtags from raw text
    const matches = raw.match(/#[\w]+/g);
    if (matches && matches.length > 0) return matches;
  }

  return [`#${topic.replace(/\s+/g, '')}`];
}

/**
 * Find recent viral posts in the niche that could be modeled or riffed on.
 */
export async function findViralContent(niche: string): Promise<ViralPost[]> {
  // Search for high-engagement content across platforms
  const searchQueries = [
    `site:x.com "${niche}" viral OR popular`,
    `site:reddit.com "${niche}" top upvoted`,
    `"${niche}" went viral this week`,
  ];

  const allResults: Array<{ title: string; snippet: string; url: string }> = [];

  for (const q of searchQueries) {
    const results = await search(q, { num: 5, timeFilter: 'qdr:w' });
    allResults.push(...results);
  }

  if (allResults.length === 0) return [];

  const resultsSummary = allResults
    .slice(0, 15)
    .map((r) => `${r.title}\n${r.snippet.slice(0, 150)}\n${r.url}`)
    .join('\n\n');

  const prompt = `Analyze these recent posts from the "${niche}" niche and identify the ones that went viral or got high engagement.

POSTS:
${resultsSummary}

Respond in EXACTLY this JSON format (no markdown):
[
  {
    "platform": "x/reddit/other",
    "text": "summary of the viral post content",
    "url": "the post url",
    "engagement": "estimated engagement level or metrics",
    "whyItWorked": "1-2 sentence analysis of why this post resonated"
  }
]

Return 3-5 posts max. Focus on posts that have clear patterns we can learn from. If a post URL doesn't seem to be viral content, skip it.`;

  const raw = await askLLM(prompt, { maxTokens: 800, temperature: 0.4 });
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((v: any) => ({
      platform: v.platform ?? 'unknown',
      text: v.text ?? '',
      url: v.url ?? '',
      engagement: v.engagement ?? 'unknown',
      whyItWorked: v.whyItWorked ?? '',
    }));
  } catch {
    console.log('  [Hashtag] Failed to parse viral content response');
    return [];
  }
}
