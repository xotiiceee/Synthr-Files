/**
 * Context-aware reply generation with system/user message split.
 * Uses persona voice, platform-specific styles, and natural tone.
 * 6 high-contrast reply styles from prompts/reply.ts.
 * Falls back to template replies when LLM is offline.
 *
 * Production lessons:
 * - Soft guidance beats rigid rules (real humans don't follow rules strictly)
 * - Context-aware URL inclusion (not random dice roll)
 * - Re-generate instead of truncate when over char limit
 * - Voice block gets priority over anti-patterns in prompt ordering
 */

import fs from 'node:fs';
import path from 'node:path';
import { askLLM, askLLMWithSystem } from '../core/llm.js';
import { getConfig, getPersonaPrompt } from '../core/persona.js';
import { pickReplyStyle, buildSystemPrompt, type ReplyContext } from '../prompts/reply.js';
import type { Conversation } from '../platforms/base.js';
import { buildVoiceBlock, buildPersonContext, humanizeText } from './human-behavior.js';
import { getKnowledgeContext } from './knowledge-context.js';
import { getPlatformVoice } from '../prompts/platform-voices.js';
import type { ScoredReply, ThreadAnalysis } from './thread-analyzer.js';
import { buildReplySystemPrompt } from './prompt-builder.js';

// CRM imports for conversation memory (optional — graceful fallback if CRM not available)
let crmAvailable = false;
let getLeadByPlatform: ((platform: string, platformId: string) => any) | undefined;
let getInteractionsForLead: ((leadId: number, limit?: number) => any[]) | undefined;
let logInteraction: ((data: any) => void) | undefined;
try {
  const crm = await import('../crm/leads.js');
  const interactions = await import('../crm/interactions.js');
  getLeadByPlatform = crm.getLeadByPlatform;
  getInteractionsForLead = interactions.getInteractionsForLead;
  logInteraction = interactions.logInteraction;
  crmAvailable = true;
} catch { /* CRM not available — no conversation memory */ }

/** Load knowledge base (cached, refreshed every 5 minutes) */
let knowledgeCache: string | null = null;
let knowledgeCachedAt = 0;
const KNOWLEDGE_TTL = 5 * 60 * 1000;

function loadKnowledge(): string {
  if (knowledgeCache && Date.now() - knowledgeCachedAt < KNOWLEDGE_TTL) return knowledgeCache;
  const kbPath = path.join(process.cwd(), 'data', 'knowledge.md');
  try {
    if (fs.existsSync(kbPath)) {
      // Cap at 4500 chars to avoid blowing up the prompt
      knowledgeCache = fs.readFileSync(kbPath, 'utf-8').slice(0, 4500);
      knowledgeCachedAt = Date.now();
      return knowledgeCache;
    }
  } catch { /* knowledge base is optional */ }
  knowledgeCache = '';
  knowledgeCachedAt = Date.now();
  return '';
}

const PLATFORM_CHAR_LIMITS: Record<string, number> = {
  x: 280,
  reddit: 500,
  hackernews: 500,
  linkedin: 500,
  discord: 400,
  producthunt: 500,
};

/** Check if the post content suggests a URL would be genuinely helpful */
function shouldIncludeUrl(text: string): boolean {
  const toolPatterns = /\b(tool|platform|service|alternative|vs\.?|compar|recommend|what do you use|best way to|looking for|suggestions?|any good)\b/i;
  if (toolPatterns.test(text)) return Math.random() < 0.7; // 70% when they're asking for tools
  return Math.random() < 0.15; // 15% baseline for organic mentions
}

/**
 * Generate a context-aware reply to a conversation.
 * Randomly selects from 6 reply styles appropriate for the platform.
 * Uses system/user message split for better persona control.
 * Returns null if the LLM declines to reply or the call fails.
 */
export async function generateReply(
  conversation: Conversation,
  platform: string,
  feedback?: string,
): Promise<string | null> {
  const config = getConfig();
  const personaPrompt = getPersonaPrompt();
  const charLimit = PLATFORM_CHAR_LIMITS[platform] ?? 500;
  const includeUrl = shouldIncludeUrl(conversation.text) && !!config.persona.website;

  // Pick a random reply style appropriate for this platform
  const styleFn = pickReplyStyle(platform) as (ctx: ReplyContext) => string;

  const ctx: ReplyContext = {
    personaPrompt,
    text: conversation.text.slice(0, 500),
    platform,
    website: config.persona.website || '',
    charLimit,
    includeUrl,
  };

  // Build system prompt via unified prompt builder (single identity source)
  const platformVoice = getPlatformVoice(platform);
  const systemPrompt = buildReplySystemPrompt({
    conversationText: conversation.text,
    platform,
    platformVoice,
  });

  // Build user prompt (style-specific task — varies per reply)
  let userPrompt = styleFn(ctx);

  // Voice block gets priority (placed before anti-patterns)
  const voiceBlock = buildVoiceBlock();
  userPrompt += `\n\n${voiceBlock}`;

  // Person context if we have history with this user
  const personCtx = buildPersonContext(conversation.author, platform);
  if (personCtx) {
    userPrompt += `\n\n${personCtx}`;
  }

  // CRM conversation memory — inject prior interactions if available
  if (crmAvailable && getLeadByPlatform) {
    try {
      const lead = getLeadByPlatform(platform, conversation.author);
      if (lead && getInteractionsForLead) {
        const priorInteractions = getInteractionsForLead(lead.id, 5);
        if (priorInteractions.length > 0) {
          let memoryBlock = '\n\nCONVERSATION HISTORY (you have talked to this person before):';
          for (const i of priorInteractions) {
            memoryBlock += `\n- [${i.created_at || 'recent'}] ${i.type || 'reply'}: ${(i.content || i.notes || '').slice(0, 150)}`;
          }
          memoryBlock += `\nLead status: ${lead.status || 'unknown'} | Score: ${lead.score || 0}/100`;
          memoryBlock += '\nDo NOT re-introduce your product. Be more familiar. Reference past conversations naturally.';
          userPrompt += memoryBlock;
        }
      }
    } catch { /* CRM lookup failed — continue without memory */ }
  }

  // Soft guidance (not rigid rules — lets the LLM be natural)
  userPrompt += `

GUIDANCE:
- Try to stay on their topic — if they talk about pricing, respond about pricing
- Reference specific words or ideas from their post
- If their post is pure self-promotion with no discussion value: SKIP
- Maximum ${charLimit} characters`;

  // Append user feedback for regeneration
  if (feedback) {
    userPrompt += `\n\nUser feedback on the previous reply: "${feedback}". Incorporate this guidance into the new reply.`;
  }

  const response = await askLLMWithSystem(systemPrompt, userPrompt, {
    maxTokens: Math.ceil(charLimit / 2),
    temperature: 0.8,
  });

  if (!response) return null;

  let reply = response.trim();

  // LLM declined
  if (/^(skip|decline)/i.test(reply)) {
    return null;
  }

  // Strip surrounding quotes
  if ((reply.startsWith('"') && reply.endsWith('"')) ||
      (reply.startsWith("'") && reply.endsWith("'"))) {
    reply = reply.slice(1, -1);
  }

  // Strip "Reply:" or similar prefixes
  reply = reply.replace(/^(Reply|Response|Here'?s? (?:my |a )?reply):\s*/i, '');

  // Reject if too short
  if (reply.length < 20) return null;

  // Enforce character limit — re-ask LLM to shorten instead of dumb truncation
  if (reply.length > charLimit) {
    const shortened = await askLLM(
      `Rewrite this reply to fit under ${charLimit} characters. Keep the core idea, cut the filler:\n\n"${reply}"`,
      { maxTokens: Math.ceil(charLimit / 2), temperature: 0.7 },
    );
    if (shortened && shortened.length <= charLimit && shortened.length >= 20) {
      reply = shortened.trim().replace(/^["']|["']$/g, '');
    } else {
      // Fallback: smart truncation at sentence boundary
      const truncated = reply.slice(0, charLimit - 3);
      const lastPeriod = truncated.lastIndexOf('.');
      const lastQuestion = truncated.lastIndexOf('?');
      const cutPoint = Math.max(lastPeriod, lastQuestion);
      reply = cutPoint > charLimit * 0.4
        ? reply.slice(0, cutPoint + 1)
        : truncated + '...';
    }
  }

  // Apply anti-detection humanization
  reply = humanizeText(reply, platform);

  return reply;
}

/**
 * Generate a thread-aware reply — responds to a SPECIFIC COMMENT in a thread,
 * not the original post. Sounds like you were already in the conversation.
 *
 * Key differences from generateReply():
 * - References the specific comment being replied to, not the thread OP
 * - Almost never includes URLs (you're contributing, not marketing)
 * - Matches the thread's energy and tone
 * - Never replies to multiple comments in the same thread
 */
export async function generateThreadReply(
  thread: ThreadAnalysis,
  target: ScoredReply,
  platform: string = 'x',
  feedback?: string,
): Promise<string | null> {
  const config = getConfig();
  const charLimit = PLATFORM_CHAR_LIMITS[platform] ?? 280;
  const platformVoice = getPlatformVoice(platform);

  // System prompt: unified identity + domain knowledge + style rules + platform voice
  const systemPrompt = buildReplySystemPrompt({
    conversationText: `${thread.rootText} ${target.text}`,
    platform,
    platformVoice,
  });

  // User prompt: thread context + target comment + reply task
  const replyTypeGuidance: Record<string, string> = {
    question: 'They asked a question. Answer it directly and helpfully. If your product is genuinely the answer, mention it briefly — otherwise just be helpful.',
    pain_point: 'They\'re frustrated about something. Empathize first, then offer practical help. Don\'t pitch unless it genuinely solves their specific problem.',
    opinion: 'They shared a take. Agree and expand with your own perspective, or respectfully add nuance. Don\'t just say "great point" — add something new.',
    insight: 'They made a substantive point. Build on it with a related observation or experience. Show you actually read and thought about what they said.',
    debate: 'There\'s a discussion happening. Add a nuanced perspective. Don\'t take sides aggressively — be the thoughtful voice in the room.',
  };

  const guidance = replyTypeGuidance[target.replyType] || 'Add genuine value to this conversation. Reference their specific words.';

  let userPrompt = `THREAD CONTEXT:
Original post by @${thread.rootAuthor}: "${thread.rootText.slice(0, 300)}"

YOU ARE REPLYING TO THIS COMMENT (by @${target.author}):
"${target.text.slice(0, 400)}"

${target.accountScore.isKol ? `Note: @${target.author} is an influential account. A thoughtful reply here has high visibility.` : ''}

TASK: Write a reply to @${target.author}'s comment above. ${guidance}

CRITICAL RULES:
- You are replying to @${target.author}'s COMMENT, not to the original post
- Sound like you were already reading this thread, not like you searched for it
- Reference their specific words or ideas
- Do NOT introduce yourself or your product unless it directly answers their question
- Do NOT include any URLs (you're contributing to a conversation, not marketing)
- Maximum ${charLimit} characters
- Be natural, be brief, add value`;

  // Voice fingerprint
  const voiceBlock = buildVoiceBlock();
  userPrompt += `\n\n${voiceBlock}`;

  // CRM memory if we've talked to this person before
  if (crmAvailable && getLeadByPlatform) {
    try {
      const lead = getLeadByPlatform(platform, target.author);
      if (lead && getInteractionsForLead) {
        const prior = getInteractionsForLead(lead.id, 3);
        if (prior.length > 0) {
          userPrompt += `\n\nYou've talked to @${target.author} before:`;
          for (const i of prior) {
            userPrompt += `\n- ${(i.content || i.notes || '').slice(0, 100)}`;
          }
          userPrompt += '\nBe familiar, not re-introductory.';
        }
      }
    } catch {}
  }

  if (feedback) {
    userPrompt += `\n\nFeedback on previous version: "${feedback}"`;
  }

  const response = await askLLMWithSystem(systemPrompt, userPrompt, {
    maxTokens: Math.ceil(charLimit / 2),
    temperature: 0.8,
  });

  if (!response) return null;

  let reply = response.trim();

  // LLM declined
  if (/^(skip|decline)/i.test(reply)) return null;

  // Clean up
  reply = reply.replace(/^["']|["']$/g, '');
  reply = reply.replace(/^(Reply|Response|Here'?s? (?:my |a )?reply):\s*/i, '');

  if (reply.length < 15) return null;

  // Enforce char limit
  if (reply.length > charLimit) {
    const shortened = await askLLM(
      `Rewrite to fit under ${charLimit} characters. Keep the core idea:\n\n"${reply}"`,
      { maxTokens: Math.ceil(charLimit / 2), temperature: 0.7 },
    );
    if (shortened && shortened.length <= charLimit && shortened.length >= 15) {
      reply = shortened.trim().replace(/^["']|["']$/g, '');
    } else {
      const truncated = reply.slice(0, charLimit - 3);
      const cut = Math.max(truncated.lastIndexOf('.'), truncated.lastIndexOf('?'));
      reply = cut > charLimit * 0.4 ? reply.slice(0, cut + 1) : truncated + '...';
    }
  }

  reply = humanizeText(reply, platform);
  return reply;
}

/**
 * Get a template-based reply for a given topic ID.
 * Used as fallback when the LLM is offline.
 */
export function getTemplateReply(topicId: string): string {
  const config = getConfig();
  const topic = config.topics.find((t) => t.id === topicId);

  if (!topic || topic.replies.length === 0) {
    const allReplies = config.topics.flatMap((t) => t.replies);
    if (allReplies.length === 0) return '';
    return allReplies[Math.floor(Math.random() * allReplies.length)]
      .replace(/\{\{url\}\}/g, config.persona.website ? ` ${config.persona.website}` : '')
      .replace(/\{brand\}/g, config.persona.brandName);
  }

  const template = topic.replies[Math.floor(Math.random() * topic.replies.length)];
  return template
    .replace(/\{\{url\}\}/g, Math.random() < 0.4 && config.persona.website ? ` ${config.persona.website}` : '')
    .replace(/\{brand\}/g, config.persona.brandName);
}
