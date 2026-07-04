/**
 * Niche-Aware Content Categories
 *
 * Instead of hardcoded 4-pillar system, derives content categories from the
 * client's niche preset. Each niche gets categories that make sense for THEIR
 * business, not generic pillars.
 */

export interface ContentCategory {
  id: string;
  name: string;
  description: string;
  examples: string[];
  suggestedFrequency: 'daily' | 'weekly' | 'biweekly';
  mediaRecommended: boolean;
}

// ─── Niche-specific category maps ───────────────────────────────────────────

const NICHE_CATEGORIES: Record<string, ContentCategory[]> = {
  saas: [
    { id: 'case_study', name: 'Case Study', description: 'Customer results with specific numbers', examples: ['"This onboarding change increased demos by 18%"'], suggestedFrequency: 'weekly', mediaRecommended: true },
    { id: 'product_tip', name: 'Product Tip', description: 'Quick how-to showing a feature', examples: ['"3 settings most users miss in our dashboard"'], suggestedFrequency: 'daily', mediaRecommended: true },
    { id: 'behind_scenes', name: 'Behind the Scenes', description: 'Building in public — what broke, what shipped', examples: ['"What broke in our deploy this week"'], suggestedFrequency: 'weekly', mediaRecommended: false },
    { id: 'industry_take', name: 'Industry Take', description: 'Opinion on a trend in your space', examples: ['"Why most company accounts sound dead on arrival"'], suggestedFrequency: 'biweekly', mediaRecommended: false },
    { id: 'customer_win', name: 'Customer Win', description: 'Celebrating a customer milestone', examples: ['"@customer just hit 10K users using our tool"'], suggestedFrequency: 'weekly', mediaRecommended: true },
    { id: 'lesson_learned', name: 'Lesson Learned', description: 'Honest reflection on a mistake or insight', examples: ['"We lost 30% of trials by doing X. Here\'s what we changed"'], suggestedFrequency: 'weekly', mediaRecommended: false },
  ],
  ecommerce: [
    { id: 'product_showcase', name: 'Product Showcase', description: 'Highlight a product with lifestyle context', examples: ['"New drop. Limited to 200 units."'], suggestedFrequency: 'daily', mediaRecommended: true },
    { id: 'customer_photo', name: 'Customer Photo', description: 'UGC — customers using your product', examples: ['"@customer wearing our [product] — love this"'], suggestedFrequency: 'daily', mediaRecommended: true },
    { id: 'lifestyle', name: 'Lifestyle', description: 'Aspirational content tied to your brand', examples: ['"Sunday mornings in our favorite mug"'], suggestedFrequency: 'biweekly', mediaRecommended: true },
    { id: 'offer', name: 'Offer/Promotion', description: 'Sales, discounts, limited drops', examples: ['"24 hours. 20% off everything."'], suggestedFrequency: 'weekly', mediaRecommended: true },
    { id: 'behind_scenes', name: 'Behind the Scenes', description: 'How products are made, packed, designed', examples: ['"Packing today\'s orders at 5am. 247 going out."'], suggestedFrequency: 'weekly', mediaRecommended: true },
    { id: 'trending', name: 'Trending Hook', description: 'Tie into a current trend or meme', examples: ['"POV: you finally found the perfect [product category]"'], suggestedFrequency: 'biweekly', mediaRecommended: false },
  ],
  agency: [
    { id: 'case_study', name: 'Case Study', description: 'Client result with specific metrics', examples: ['"Helped @client 3x their pipeline in 6 weeks"'], suggestedFrequency: 'weekly', mediaRecommended: true },
    { id: 'methodology', name: 'Methodology', description: 'Your process or framework', examples: ['"Our exact 5-step audit process for new clients"'], suggestedFrequency: 'weekly', mediaRecommended: false },
    { id: 'industry_insight', name: 'Industry Insight', description: 'Data or opinion about the industry', examples: ['"80% of agencies undercharge. Here\'s the math"'], suggestedFrequency: 'biweekly', mediaRecommended: false },
    { id: 'client_win', name: 'Client Win', description: 'Celebrate client milestones', examples: ['"@client just crossed $1M ARR. Proud to be part of the journey"'], suggestedFrequency: 'weekly', mediaRecommended: true },
    { id: 'team_spotlight', name: 'Team Spotlight', description: 'Show the humans behind the agency', examples: ['"Meet @teammate — the brain behind our analytics"'], suggestedFrequency: 'biweekly', mediaRecommended: true },
    { id: 'hot_take', name: 'Hot Take', description: 'Contrarian opinion that positions you', examples: ['"Most marketing agencies sell hours. We sell outcomes."'], suggestedFrequency: 'weekly', mediaRecommended: false },
  ],
  creator: [
    { id: 'teaching', name: 'Teaching', description: 'Educate your audience on your expertise', examples: ['"5 mistakes beginners make with [topic]"'], suggestedFrequency: 'daily', mediaRecommended: false },
    { id: 'personal_story', name: 'Personal Story', description: 'Relatable experience or journey', examples: ['"I quit my job 2 years ago. Here\'s what nobody tells you"'], suggestedFrequency: 'weekly', mediaRecommended: false },
    { id: 'engagement', name: 'Engagement Prompt', description: 'Questions or polls that invite responses', examples: ['"What\'s the one tool you couldn\'t live without?"'], suggestedFrequency: 'biweekly', mediaRecommended: false },
    { id: 'resource', name: 'Resource Share', description: 'Curated tools, links, recommendations', examples: ['"10 free tools I use every day (not the obvious ones)"'], suggestedFrequency: 'weekly', mediaRecommended: true },
    { id: 'milestone', name: 'Milestone', description: 'Celebrate growth or achievements', examples: ['"Just hit 10K followers. Here\'s what I learned"'], suggestedFrequency: 'biweekly', mediaRecommended: true },
    { id: 'collaboration', name: 'Collaboration', description: 'Tag and collaborate with others', examples: ['"Working with @person on something exciting"'], suggestedFrequency: 'biweekly', mediaRecommended: false },
  ],
  crypto: [
    { id: 'education', name: 'Education', description: 'Explain concepts clearly', examples: ['"What is x402 and why it matters — in 30 seconds"'], suggestedFrequency: 'daily', mediaRecommended: false },
    { id: 'community', name: 'Community', description: 'Engage the community, ask questions', examples: ['"What feature would make you use [product] daily?"'], suggestedFrequency: 'daily', mediaRecommended: false },
    { id: 'roadmap', name: 'Roadmap Update', description: 'What you shipped, what\'s next', examples: ['"Shipped this week: Manifest + Attestation. Next: Context Engine"'], suggestedFrequency: 'weekly', mediaRecommended: true },
    { id: 'alpha', name: 'Alpha / Insight', description: 'Market insight or data analysis', examples: ['"On-chain data shows whale accumulation at $140"'], suggestedFrequency: 'daily', mediaRecommended: true },
    { id: 'meme', name: 'Meme / Culture', description: 'Crypto-native humor that resonates', examples: ['"POV: you checked the chart at 3am again"'], suggestedFrequency: 'biweekly', mediaRecommended: true },
    { id: 'partnership', name: 'Partnership', description: 'Integration or collaboration announcements', examples: ['"Now integrated with @partner — here\'s what this means"'], suggestedFrequency: 'biweekly', mediaRecommended: true },
  ],
  fitness: [
    { id: 'transformation', name: 'Transformation', description: 'Before/after results', examples: ['"12 weeks. 15 lbs lost. No crash diet."'], suggestedFrequency: 'weekly', mediaRecommended: true },
    { id: 'workout', name: 'Workout Tip', description: 'Quick exercise advice', examples: ['"Most people do deadlifts wrong. Here\'s the fix"'], suggestedFrequency: 'daily', mediaRecommended: true },
    { id: 'nutrition', name: 'Nutrition', description: 'Meal plans, recipes, supplements', examples: ['"My exact pre-workout meal for max energy"'], suggestedFrequency: 'weekly', mediaRecommended: true },
    { id: 'motivation', name: 'Motivation', description: 'Mindset and consistency', examples: ['"You don\'t need motivation. You need a system."'], suggestedFrequency: 'biweekly', mediaRecommended: false },
    { id: 'myth_bust', name: 'Myth Busting', description: 'Correct common misconceptions', examples: ['"No, carbs are not the enemy. Here\'s why"'], suggestedFrequency: 'weekly', mediaRecommended: false },
    { id: 'client_win', name: 'Client Win', description: 'Celebrate client achievements', examples: ['"@client just ran their first 5K after 8 weeks of training"'], suggestedFrequency: 'weekly', mediaRecommended: true },
  ],
};

// Default categories for niches not explicitly mapped
const DEFAULT_CATEGORIES: ContentCategory[] = [
  { id: 'value_post', name: 'Value Post', description: 'Teach something useful in your niche', examples: [], suggestedFrequency: 'daily', mediaRecommended: false },
  { id: 'story', name: 'Story', description: 'Personal experience or customer story', examples: [], suggestedFrequency: 'weekly', mediaRecommended: false },
  { id: 'behind_scenes', name: 'Behind the Scenes', description: 'Show the work behind the product', examples: [], suggestedFrequency: 'weekly', mediaRecommended: true },
  { id: 'engagement', name: 'Engagement', description: 'Questions, polls, or prompts', examples: [], suggestedFrequency: 'biweekly', mediaRecommended: false },
  { id: 'customer_proof', name: 'Customer Proof', description: 'Results, testimonials, case studies', examples: [], suggestedFrequency: 'weekly', mediaRecommended: true },
  { id: 'opinion', name: 'Opinion', description: 'Take a stance on something in your industry', examples: [], suggestedFrequency: 'biweekly', mediaRecommended: false },
];

// ─── Public API ─────────────────────────────────────────────────────────────

export function getCategoriesForNiche(niche: string): ContentCategory[] {
  const lower = niche.toLowerCase();
  // Try exact match first
  if (NICHE_CATEGORIES[lower]) return NICHE_CATEGORIES[lower];
  // Try partial match
  for (const [key, cats] of Object.entries(NICHE_CATEGORIES)) {
    if (lower.includes(key) || key.includes(lower)) return cats;
  }
  return DEFAULT_CATEGORIES;
}

export function getAllNichePresets(): string[] {
  return Object.keys(NICHE_CATEGORIES);
}
