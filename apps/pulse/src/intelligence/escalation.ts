/**
 * Escalation System for PULSE.
 *
 * Flags mentions/posts that need human attention — negative sentiment,
 * high-profile accounts, legal keywords, viral potential, etc.
 *
 * Flow:
 *   1. checkEscalation() runs against each incoming mention
 *   2. If triggers fire, an EscalationEvent is created and persisted
 *   3. sendEscalationAlert() pushes to Slack/Discord webhooks
 *   4. Humans acknowledge/resolve via management functions
 *
 * State key: 'escalations' (JSON file in data/)
 */

import { loadState, saveState, generateId } from '../core/state.js';
import { getConfig } from '../core/persona.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export type EscalationPriority = 'low' | 'medium' | 'high' | 'critical';

export type EscalationReason =
  | 'negative_sentiment'
  | 'high_profile_account'
  | 'legal_keywords'
  | 'viral_potential'
  | 'competitor_comparison'
  | 'sarcasm_detected'
  | 'low_confidence'
  | 'ratio_detected'
  | 'repeated_complaints'
  | 'security_mention';

export interface EscalationEvent {
  id: string;
  mentionId?: string;
  postId?: string;
  platform: string;
  author: string;
  authorFollowers?: number;
  content: string;
  url?: string;
  reasons: EscalationReason[];
  priority: EscalationPriority;
  suggestedResponse?: string;
  status: 'open' | 'acknowledged' | 'resolved';
  createdAt: string;
  resolvedAt?: string;
}

export interface EscalationConfig {
  slackWebhook?: string;
  discordWebhook?: string;
  highProfileThreshold: number;
  legalKeywords: string[];
  viralThreshold: number;
  neverReplyKeywords: string[];
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Hardcoded — not configurable. These always trigger escalation. */
const LEGAL_KEYWORDS: string[] = [
  'lawsuit',
  'lawyer',
  'sue',
  'legal',
  'SEC',
  'scam',
  'fraud',
  'hack',
  'leaked',
  'vulnerability',
  'security breach',
  'class action',
];

/** Pre-compiled patterns — word boundaries prevent false positives like "issue"/"hackathon" */
const LEGAL_PATTERNS: RegExp[] = LEGAL_KEYWORDS.map(kw => {
  // Multi-word phrases use includes, single words use word boundaries
  if (kw.includes(' ')) return new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  // "SEC" should be case-sensitive (uppercase only) to avoid matching "second"
  if (kw === 'SEC') return new RegExp(`\\b${kw}\\b`);
  return new RegExp(`\\b${kw}\\b`, 'i');
});

const STATE_KEY = 'escalations';
const MAX_EVENTS = 500;

// ─── Priority Weights ───────────────────────────────────────────────────────

const REASON_WEIGHTS: Record<EscalationReason, number> = {
  legal_keywords: 10,
  security_mention: 9,
  high_profile_account: 8,
  viral_potential: 7,
  ratio_detected: 6,
  repeated_complaints: 6,
  negative_sentiment: 5,
  competitor_comparison: 3,
  sarcasm_detected: 3,
  low_confidence: 2,
};

function priorityFromScore(score: number): EscalationPriority {
  if (score >= 15) return 'critical';
  if (score >= 10) return 'high';
  if (score >= 5) return 'medium';
  return 'low';
}

// ─── State Helpers ──────────────────────────────────────────────────────────

function loadEscalations(): EscalationEvent[] {
  return loadState<EscalationEvent[]>(STATE_KEY, []);
}

function persistEscalations(events: EscalationEvent[]): void {
  // Keep last MAX_EVENTS to avoid unbounded growth
  if (events.length > MAX_EVENTS) {
    events.splice(0, events.length - MAX_EVENTS);
  }
  saveState(STATE_KEY, events);
}

// ─── Default Config ─────────────────────────────────────────────────────────

export function getDefaultEscalationConfig(): EscalationConfig {
  return {
    slackWebhook: undefined,
    discordWebhook: undefined,
    highProfileThreshold: 50_000,
    legalKeywords: [...LEGAL_KEYWORDS],
    viralThreshold: 50,
    neverReplyKeywords: [],
  };
}

// ─── Trigger Detection ──────────────────────────────────────────────────────

/**
 * Check if a mention needs escalation.
 * Returns an EscalationEvent if any triggers fire, null otherwise.
 */
export function checkEscalation(mention: {
  text: string;
  author: string;
  authorFollowers?: number;
  sentiment?: string;
  platform: string;
  url?: string;
  confidence?: number;
  engagement?: number;
}): EscalationEvent | null {
  const config = getConfig();
  const escalationConfig = getDefaultEscalationConfig();
  const competitors = config.competitors ?? [];
  const reasons: EscalationReason[] = [];
  const textLower = mention.text.toLowerCase();

  // 1. Negative sentiment
  if (mention.sentiment === 'negative') {
    reasons.push('negative_sentiment');
  }

  // 2. High-profile account (large follower count)
  if (mention.authorFollowers && mention.authorFollowers >= escalationConfig.highProfileThreshold) {
    reasons.push('high_profile_account');
  }

  // 3. Legal keywords (word-boundary matching to avoid false positives)
  const hasLegalKeyword = LEGAL_PATTERNS.some(p => p.test(mention.text));
  if (hasLegalKeyword) {
    reasons.push('legal_keywords');
  }

  // 4. Viral potential (high engagement)
  if (mention.engagement && mention.engagement >= escalationConfig.viralThreshold) {
    reasons.push('viral_potential');
  }

  // 5. Competitor comparison
  if (competitors.length > 0) {
    const hasCompetitor = competitors.some((comp) =>
      textLower.includes(comp.toLowerCase()),
    );
    if (hasCompetitor) {
      reasons.push('competitor_comparison');
    }
  }

  // 6. Sarcasm indicators
  const sarcasmPatterns = [
    /(?:sure|right|yeah|oh)\s*,?\s*(?:because|like)/i,
    /(?:totally|definitely|absolutely)\s+(?:not|never)/i,
    /(?:what a|how)\s+(?:great|wonderful|amazing|fantastic)\s+(?:idea|product|service)/i,
    /\bslow clap\b/i,
    /\b(?:air quotes|scare quotes)\b/i,
    /\/s\s*$/,
  ];
  if (sarcasmPatterns.some((p) => p.test(mention.text))) {
    reasons.push('sarcasm_detected');
  }

  // 7. Low confidence from the LLM classifier
  if (mention.confidence !== undefined && mention.confidence < 0.4) {
    reasons.push('low_confidence');
  }

  // 8. Ratio detected — lots of engagement on a negative mention
  if (
    mention.engagement &&
    mention.engagement >= 20 &&
    mention.sentiment === 'negative'
  ) {
    reasons.push('ratio_detected');
  }

  // 9. Repeated complaints — check if the same author has open escalations
  const existing = loadEscalations();
  const authorOpen = existing.filter(
    (e) =>
      e.author === mention.author &&
      e.status === 'open' &&
      e.reasons.includes('negative_sentiment'),
  );
  if (authorOpen.length >= 2) {
    reasons.push('repeated_complaints');
  }

  // 10. Security-related mentions
  const securityPatterns = [
    /\b(?:data\s*breach|data\s*leak|exposed\s*data|credentials?\s*leaked?)\b/i,
    /\b(?:zero[\s-]?day|exploit|backdoor|ransomware|malware)\b/i,
    /\b(?:CVE-\d{4}-\d+)\b/i,
    /\b(?:SQL\s*injection|XSS|CSRF|RCE)\b/i,
    /\b(?:unauthorized\s*access|privilege\s*escalation)\b/i,
  ];
  if (securityPatterns.some((p) => p.test(mention.text))) {
    reasons.push('security_mention');
  }

  // No triggers fired
  if (reasons.length === 0) return null;

  // Calculate priority from combined reason weights
  const score = reasons.reduce((sum, r) => sum + REASON_WEIGHTS[r], 0);
  const priority = priorityFromScore(score);

  const event: EscalationEvent = {
    id: generateId(),
    platform: mention.platform,
    author: mention.author,
    authorFollowers: mention.authorFollowers,
    content: mention.text.slice(0, 1000),
    url: mention.url,
    reasons,
    priority,
    status: 'open',
    createdAt: new Date().toISOString(),
  };

  // Persist immediately
  const events = loadEscalations();
  events.push(event);
  persistEscalations(events);

  return event;
}

// ─── Webhook Alerts ─────────────────────────────────────────────────────────

const PRIORITY_COLORS: Record<EscalationPriority, string> = {
  low: '#36a64f',       // green
  medium: '#daa038',    // amber
  high: '#e84d3d',      // red
  critical: '#8b0000',  // dark red
};

const PRIORITY_EMOJI: Record<EscalationPriority, string> = {
  low: ':information_source:',
  medium: ':warning:',
  high: ':rotating_light:',
  critical: ':fire:',
};

/**
 * Build a Slack Block Kit payload for the escalation alert.
 */
function buildSlackPayload(event: EscalationEvent): object {
  const color = PRIORITY_COLORS[event.priority];
  const emoji = PRIORITY_EMOJI[event.priority];
  const reasonList = event.reasons.map((r) => r.replace(/_/g, ' ')).join(', ');

  const fields = [
    { type: 'mrkdwn', text: `*Priority:*\n${emoji} ${event.priority.toUpperCase()}` },
    { type: 'mrkdwn', text: `*Platform:*\n${event.platform}` },
    { type: 'mrkdwn', text: `*Author:*\n${event.author}` },
    { type: 'mrkdwn', text: `*Followers:*\n${event.authorFollowers?.toLocaleString() ?? 'unknown'}` },
  ];

  const blocks: object[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${emoji} *Escalation — ${event.priority.toUpperCase()}*`,
      },
    },
    {
      type: 'section',
      fields,
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Reasons:*\n${reasonList}`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Content:*\n>${event.content.slice(0, 500).replace(/\n/g, '\n>')}`,
      },
    },
  ];

  if (event.url) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Link:* <${event.url}|View on ${event.platform}>`,
      },
    });
  }

  if (event.suggestedResponse) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Suggested Response:*\n_${event.suggestedResponse.slice(0, 300)}_`,
      },
    });
  }

  blocks.push({
    type: 'context',
    elements: [
      { type: 'mrkdwn', text: `ID: \`${event.id}\` | ${event.createdAt}` },
    ],
  });

  return {
    text: `[${event.priority.toUpperCase()}] Escalation from ${event.author} on ${event.platform}`,
    attachments: [
      {
        color,
        blocks,
      },
    ],
  };
}

/**
 * Build a Discord embed payload for the escalation alert.
 */
function buildDiscordPayload(event: EscalationEvent): object {
  const colorInt = parseInt(PRIORITY_COLORS[event.priority].replace('#', ''), 16);
  const reasonList = event.reasons.map((r) => r.replace(/_/g, ' ')).join(', ');

  const fields = [
    { name: 'Priority', value: event.priority.toUpperCase(), inline: true },
    { name: 'Platform', value: event.platform, inline: true },
    { name: 'Author', value: event.author, inline: true },
    { name: 'Followers', value: event.authorFollowers?.toLocaleString() ?? 'unknown', inline: true },
    { name: 'Reasons', value: reasonList, inline: false },
  ];

  if (event.url) {
    fields.push({ name: 'Link', value: event.url, inline: false });
  }

  if (event.suggestedResponse) {
    fields.push({
      name: 'Suggested Response',
      value: event.suggestedResponse.slice(0, 300),
      inline: false,
    });
  }

  return {
    embeds: [
      {
        title: `Escalation — ${event.priority.toUpperCase()}`,
        description: event.content.slice(0, 500),
        color: colorInt,
        fields,
        footer: { text: `ID: ${event.id}` },
        timestamp: event.createdAt,
      },
    ],
  };
}

/**
 * Send an escalation alert via configured webhooks (Slack and/or Discord).
 * Fails silently — never crashes the caller.
 */
export async function sendEscalationAlert(event: EscalationEvent): Promise<boolean> {
  const escalationConfig = getDefaultEscalationConfig();

  // Override with env vars if present
  const slackUrl = process.env.PULSE_SLACK_WEBHOOK ?? escalationConfig.slackWebhook;
  const discordUrl = process.env.PULSE_DISCORD_WEBHOOK ?? escalationConfig.discordWebhook;

  if (!slackUrl && !discordUrl) return false;

  let sent = false;

  // Slack
  if (slackUrl) {
    try {
      const payload = buildSlackPayload(event);
      const res = await fetch(slackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) sent = true;
      else console.warn(`[Escalation] Slack webhook returned ${res.status}`);
    } catch (err) {
      console.warn(`[Escalation] Slack webhook failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Discord
  if (discordUrl) {
    try {
      const payload = buildDiscordPayload(event);
      const res = await fetch(discordUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) sent = true;
      else console.warn(`[Escalation] Discord webhook returned ${res.status}`);
    } catch (err) {
      console.warn(`[Escalation] Discord webhook failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return sent;
}

// ─── Escalation Management ──────────────────────────────────────────────────

/**
 * Get all open (unresolved) escalations.
 */
export function getOpenEscalations(): EscalationEvent[] {
  return loadEscalations().filter((e) => e.status === 'open');
}

/**
 * Acknowledge an escalation — marks it as seen but not yet resolved.
 */
export function acknowledgeEscalation(id: string): boolean {
  const events = loadEscalations();
  const event = events.find((e) => e.id === id);
  if (!event || event.status !== 'open') return false;

  event.status = 'acknowledged';
  persistEscalations(events);
  return true;
}

/**
 * Resolve an escalation — marks it as fully handled.
 */
export function resolveEscalation(id: string): boolean {
  const events = loadEscalations();
  const event = events.find((e) => e.id === id);
  if (!event || event.status === 'resolved') return false;

  event.status = 'resolved';
  event.resolvedAt = new Date().toISOString();
  persistEscalations(events);
  return true;
}

/**
 * Get escalation history, optionally filtered by date.
 * @param since — ISO date string; returns only events created on or after this date
 */
export function getEscalationHistory(since?: string): EscalationEvent[] {
  const events = loadEscalations();
  if (!since) return events;
  return events.filter((e) => e.createdAt >= since);
}

/**
 * Get aggregate escalation statistics.
 */
export function getEscalationStats(): {
  total: number;
  open: number;
  avgResolutionHours: number;
  byReason: Record<string, number>;
} {
  const events = loadEscalations();

  const open = events.filter((e) => e.status === 'open').length;

  // Calculate average resolution time for resolved events
  const resolved = events.filter((e) => e.status === 'resolved' && e.resolvedAt);
  let avgResolutionHours = 0;

  if (resolved.length > 0) {
    const totalMs = resolved.reduce((sum, e) => {
      const created = new Date(e.createdAt).getTime();
      const resolvedAt = new Date(e.resolvedAt!).getTime();
      return sum + (resolvedAt - created);
    }, 0);
    avgResolutionHours = Math.round((totalMs / resolved.length / 3_600_000) * 100) / 100;
  }

  // Count by reason
  const byReason: Record<string, number> = {};
  for (const event of events) {
    for (const reason of event.reasons) {
      byReason[reason] = (byReason[reason] ?? 0) + 1;
    }
  }

  return {
    total: events.length,
    open,
    avgResolutionHours,
    byReason,
  };
}
