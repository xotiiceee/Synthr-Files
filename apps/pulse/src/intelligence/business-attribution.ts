/**
 * Business Attribution — tracks which posts actually drive business outcomes.
 *
 * Auto-appends UTM parameters to links, tracks click-through,
 * and attributes signups/conversions back to specific posts and categories.
 * Closes the loop: content → clicks → signups → revenue.
 */

import { loadState, saveState } from '../core/state.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AttributedPost {
  post_id: string;
  platform: string;
  category: string;
  posted_at: string;
  content_preview: string;
  link_url?: string;
  utm_params?: {
    source: string;
    medium: string;
    campaign: string;
    content: string;     // post_id for attribution
  };
  metrics: {
    impressions?: number;
    engagements?: number;
    link_clicks?: number;
    profile_visits?: number;
    follows?: number;
    signups?: number;     // tracked via UTM → conversion
    revenue?: number;     // if tracked
  };
  funnel_stage: 'posted' | 'clicked' | 'converted' | 'revenue';
  last_updated: string;
}

export interface AttributionInsights {
  total_posts_tracked: number;
  total_clicks: number;
  total_conversions: number;
  click_rate: number;         // clicks / posts with links
  conversion_rate: number;    // conversions / clicks
  top_converting_categories: Array<{ category: string; conversions: number; rate: number }>;
  top_converting_posts: AttributedPost[];
  category_roi: Record<string, { posts: number; clicks: number; conversions: number; revenue: number }>;
  recommendation: string;
}

interface AttributionState {
  posts: AttributedPost[];
  conversions: Array<{
    date: string;
    source_post_id?: string;
    utm_content?: string;
    type: 'signup' | 'demo' | 'purchase' | 'newsletter' | 'other';
    value?: number;
  }>;
  last_analysis: string;
}

const DEFAULT_STATE: AttributionState = {
  posts: [],
  conversions: [],
  last_analysis: '',
};

// ─── UTM Generation ─────────────────────────────────────────────────────────

/**
 * Generate UTM parameters for a post's link.
 * Call this before publishing to append tracking to any URLs.
 */
export function generateUTM(postId: string, platform: string, category: string, brandName: string): {
  params: Record<string, string>;
  appendToUrl: (url: string) => string;
} {
  const params = {
    utm_source: platform,
    utm_medium: 'social',
    utm_campaign: `${brandName.toLowerCase().replace(/\s+/g, '-')}-${category}`,
    utm_content: postId,
  };

  const appendToUrl = (url: string): string => {
    const separator = url.includes('?') ? '&' : '?';
    const paramStr = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    return `${url}${separator}${paramStr}`;
  };

  return { params, appendToUrl };
}

/**
 * Auto-append UTM to any URLs in post content.
 * Finds URLs and adds tracking parameters.
 */
export function appendUTMToContent(content: string, postId: string, platform: string, category: string, brandName: string): string {
  const { appendToUrl } = generateUTM(postId, platform, category, brandName);

  // Find URLs in the content (simple regex — handles most cases)
  return content.replace(
    /(https?:\/\/[^\s)>\]]+)/g,
    (url) => {
      // Don't add UTM to image URLs or social media links
      if (url.match(/\.(jpg|jpeg|png|gif|webp|svg|mp4)$/i)) return url;
      if (url.includes('twitter.com') || url.includes('x.com') || url.includes('reddit.com')) return url;
      return appendToUrl(url);
    }
  );
}

// ─── Post Tracking ──────────────────────────────────────────────────────────

/**
 * Record a published post for attribution tracking.
 */
export function trackPost(
  postId: string,
  platform: string,
  category: string,
  content: string,
  linkUrl?: string,
): void {
  const state = loadState<AttributionState>('business-attribution', DEFAULT_STATE);

  const post: AttributedPost = {
    post_id: postId,
    platform,
    category,
    posted_at: new Date().toISOString(),
    content_preview: content.slice(0, 200),
    link_url: linkUrl,
    utm_params: linkUrl ? generateUTM(postId, platform, category, 'brand').params as { source: string; medium: string; campaign: string; content: string } : undefined,
    metrics: {},
    funnel_stage: 'posted',
    last_updated: new Date().toISOString(),
  };

  state.posts.push(post);
  if (state.posts.length > 1000) state.posts = state.posts.slice(-1000);
  saveState('business-attribution', state);
}

/**
 * Update metrics for a tracked post (called when engagement data comes in).
 */
export function updatePostMetrics(
  postId: string,
  metrics: Partial<AttributedPost['metrics']>,
): void {
  const state = loadState<AttributionState>('business-attribution', DEFAULT_STATE);
  const post = state.posts.find(p => p.post_id === postId);
  if (!post) return;

  Object.assign(post.metrics, metrics);

  // Update funnel stage
  if (metrics.signups && metrics.signups > 0) post.funnel_stage = 'converted';
  else if (metrics.link_clicks && metrics.link_clicks > 0) post.funnel_stage = 'clicked';

  post.last_updated = new Date().toISOString();
  saveState('business-attribution', state);
}

/**
 * Record a conversion (from webhook, analytics, or manual entry).
 */
export function recordConversion(
  type: 'signup' | 'demo' | 'purchase' | 'newsletter' | 'other',
  sourcePostId?: string,
  utmContent?: string,
  value?: number,
): void {
  const state = loadState<AttributionState>('business-attribution', DEFAULT_STATE);

  state.conversions.push({
    date: new Date().toISOString(),
    source_post_id: sourcePostId || utmContent, // utm_content = post_id
    utm_content: utmContent,
    type,
    value,
  });

  // Update the source post's metrics
  const postId = sourcePostId || utmContent;
  if (postId) {
    const post = state.posts.find(p => p.post_id === postId);
    if (post) {
      post.metrics.signups = (post.metrics.signups || 0) + 1;
      if (value) post.metrics.revenue = (post.metrics.revenue || 0) + value;
      post.funnel_stage = value ? 'revenue' : 'converted';
    }
  }

  if (state.conversions.length > 5000) state.conversions = state.conversions.slice(-5000);
  saveState('business-attribution', state);
}

// ─── Analysis ───────────────────────────────────────────────────────────────

/**
 * Get full attribution insights — which content categories actually drive business.
 */
export function getAttributionInsights(): AttributionInsights {
  const state = loadState<AttributionState>('business-attribution', DEFAULT_STATE);

  const postsWithLinks = state.posts.filter(p => p.link_url);
  const totalClicks = state.posts.reduce((sum, p) => sum + (p.metrics.link_clicks || 0), 0);
  const totalConversions = state.conversions.length;

  // Category-level ROI
  const categoryRoi: Record<string, { posts: number; clicks: number; conversions: number; revenue: number }> = {};

  for (const post of state.posts) {
    if (!categoryRoi[post.category]) {
      categoryRoi[post.category] = { posts: 0, clicks: 0, conversions: 0, revenue: 0 };
    }
    categoryRoi[post.category].posts++;
    categoryRoi[post.category].clicks += post.metrics.link_clicks || 0;
    categoryRoi[post.category].conversions += post.metrics.signups || 0;
    categoryRoi[post.category].revenue += post.metrics.revenue || 0;
  }

  // Top converting categories
  const topConverting = Object.entries(categoryRoi)
    .map(([category, data]) => ({
      category,
      conversions: data.conversions,
      rate: data.clicks > 0 ? Math.round((data.conversions / data.clicks) * 100) : 0,
    }))
    .filter(c => c.conversions > 0)
    .sort((a, b) => b.conversions - a.conversions);

  // Top converting individual posts
  const topPosts = state.posts
    .filter(p => (p.metrics.signups || 0) > 0)
    .sort((a, b) => (b.metrics.signups || 0) - (a.metrics.signups || 0))
    .slice(0, 5);

  // Generate recommendation
  let recommendation = '';
  if (topConverting.length > 0) {
    const best = topConverting[0];
    const worst = Object.entries(categoryRoi)
      .filter(([, d]) => d.posts >= 3 && d.conversions === 0)
      .map(([cat]) => cat);

    recommendation = `Your "${best.category}" posts drive the most conversions (${best.conversions} total, ${best.rate}% click-to-conversion rate). Post more of these.`;
    if (worst.length > 0) {
      recommendation += ` Consider reducing "${worst[0]}" posts — ${categoryRoi[worst[0]].posts} posts with 0 conversions.`;
    }
  } else if (state.posts.length < 20) {
    recommendation = 'Not enough data yet. Keep posting and tracking for 2+ weeks.';
  } else {
    recommendation = 'No conversions tracked yet. Make sure your links have UTM parameters and your conversion tracking is set up.';
  }

  return {
    total_posts_tracked: state.posts.length,
    total_clicks: totalClicks,
    total_conversions: totalConversions,
    click_rate: postsWithLinks.length > 0 ? Math.round((totalClicks / postsWithLinks.length) * 100) / 100 : 0,
    conversion_rate: totalClicks > 0 ? Math.round((totalConversions / totalClicks) * 100) / 100 : 0,
    top_converting_categories: topConverting,
    top_converting_posts: topPosts,
    category_roi: categoryRoi,
    recommendation,
  };
}

/**
 * Get a simple summary for the weekly digest.
 */
export function getWeeklyAttributionSummary(): string {
  const insights = getAttributionInsights();

  if (insights.total_posts_tracked === 0) return 'No posts tracked this week.';

  let summary = `📊 Attribution: ${insights.total_posts_tracked} posts tracked`;
  if (insights.total_clicks > 0) summary += `, ${insights.total_clicks} clicks`;
  if (insights.total_conversions > 0) summary += `, ${insights.total_conversions} conversions`;
  summary += `\n${insights.recommendation}`;

  return summary;
}

export function getAttributionState(): AttributionState {
  return loadState<AttributionState>('business-attribution', DEFAULT_STATE);
}

export function resetAttribution(): void {
  saveState('business-attribution', DEFAULT_STATE);
}
