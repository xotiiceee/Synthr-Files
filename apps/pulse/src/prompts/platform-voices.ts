/**
 * Platform-Specific Voice Configurations
 *
 * Each platform has different culture, expectations, and formatting rules.
 * These configurations are injected into LLM prompts so generated content
 * matches platform norms.
 */

export interface PlatformVoice {
  systemPromptAddition: string;
  formatRules: string[];
  maxLength: number;
  toneAdjustment: string;
  doNot: string[];
}

export const PLATFORM_VOICES: Record<string, PlatformVoice> = {
  x: {
    systemPromptAddition: 'You are posting on X (Twitter). Be concise, punchy, and direct. Use short sentences. Hooks matter — the first line determines if people read the rest.',
    formatRules: [
      'Max 280 characters for single tweets',
      'Use line breaks for readability',
      'Hashtags: 0-2 max, only if genuinely relevant',
      'No walls of text — every sentence should earn its place',
    ],
    maxLength: 280,
    toneAdjustment: 'More casual, conversational. Hot takes welcome. Write like you talk.',
    doNot: ['Write essays', 'Use more than 2 hashtags', 'Start with "I think"', 'Be generic or corporate'],
  },

  reddit: {
    systemPromptAddition: 'You are posting on Reddit. Be genuine, detailed, and helpful. Redditors hate marketing speak — they can smell it instantly. Share real experience and be specific.',
    formatRules: [
      'Longer responses are fine (100-500 words)',
      'Use paragraphs for readability',
      'Cite sources when possible',
      'Share personal experience, not just opinions',
    ],
    maxLength: 10000,
    toneAdjustment: 'Conversational but substantive. Like explaining to a smart friend. No buzzwords.',
    doNot: ['Sound like an ad', 'Use marketing buzzwords', 'Say "check out my product"', 'Be vague or generic', 'Use emojis excessively'],
  },

  discord: {
    systemPromptAddition: 'You are posting in a Discord server. Be casual, friendly, and community-oriented. Emoji usage is natural here. Short messages work best.',
    formatRules: [
      'Keep messages short (1-3 sentences usually)',
      'Emoji are natural and expected',
      'Markdown formatting works (bold, italic, code blocks)',
      'Casual tone, like chatting with friends',
    ],
    maxLength: 2000,
    toneAdjustment: 'Very casual. Emoji welcome. Community vibe.',
    doNot: ['Write formal paragraphs', 'Sound corporate', 'Ignore the channel context'],
  },

  linkedin: {
    systemPromptAddition: 'You are posting on LinkedIn. Be professional but not boring. First-person narratives work best. Share insights from experience, not generic advice.',
    formatRules: [
      'First line is the hook (shows in preview)',
      'Short paragraphs (1-2 sentences each)',
      'Use line breaks generously',
      'End with a question or call-to-action for engagement',
    ],
    maxLength: 3000,
    toneAdjustment: 'Professional but human. First-person storytelling. Thought leadership without the cringe.',
    doNot: ['Use LinkedIn cliches ("I\'m humbled to announce")', 'Be overly formal', 'Write a press release', 'Use excessive hashtags'],
  },

  hackernews: {
    systemPromptAddition: 'You are posting on Hacker News. Be technical, factual, and concise. The audience is engineers and founders. No marketing, no fluff. If you mention a product, explain the technical decision behind it.',
    formatRules: [
      'Plain text only (no markdown formatting)',
      'Technical depth valued over marketing polish',
      'Cite data and sources',
      'Brevity respected — say it in fewer words',
    ],
    maxLength: 10000,
    toneAdjustment: 'Technical, direct, no-nonsense. Like talking to a senior engineer.',
    doNot: ['Sound like marketing', 'Use buzzwords', 'Be vague about technical details', 'Self-promote without adding value'],
  },

  producthunt: {
    systemPromptAddition: 'You are engaging on Product Hunt. Be enthusiastic but genuine about products. Share specific use cases and honest feedback.',
    formatRules: [
      'Be specific about what you like/dislike',
      'Share how you would use the product',
      'Ask thoughtful questions to makers',
    ],
    maxLength: 1000,
    toneAdjustment: 'Enthusiastic, supportive, specific. Maker community vibe.',
    doNot: ['Leave generic "looks great!" comments', 'Only promote your own products'],
  },
};

export function getPlatformVoice(platform: string): PlatformVoice {
  return PLATFORM_VOICES[platform] || PLATFORM_VOICES.x;
}

export function enforcePlatformLimits(content: string, platform: string): string {
  const voice = getPlatformVoice(platform);
  if (content.length <= voice.maxLength) return content;

  // Truncate at last sentence boundary before limit
  const truncated = content.slice(0, voice.maxLength);
  const lastPeriod = truncated.lastIndexOf('.');
  const lastNewline = truncated.lastIndexOf('\n');
  const cutPoint = Math.max(lastPeriod, lastNewline);

  return cutPoint > voice.maxLength * 0.5 ? truncated.slice(0, cutPoint + 1) : truncated;
}
