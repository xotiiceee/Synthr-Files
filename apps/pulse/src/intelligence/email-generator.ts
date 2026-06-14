/**
 * Email sequence generator.
 * Creates welcome, nurture, and conversion email sequences
 * tailored to the brand's niche and audience.
 */

import { askLLM } from '../core/llm.js';
import { getConfig, getPersonaPrompt } from '../core/persona.js';

export interface Email {
  subject: string;
  previewText: string; // The preview line in inbox
  body: string; // Full email body (plain text or light HTML)
  cta: string; // Primary call-to-action
  sendDelay: string; // When to send relative to trigger (e.g. "Day 0", "Day 3")
}

export interface EmailSequence {
  name: string;
  type: 'welcome' | 'nurture' | 'convert' | 'reactivation' | 'onboarding';
  description: string;
  emails: Email[];
}

/**
 * Generate a complete email sequence.
 */
export async function generateEmailSequence(
  type: EmailSequence['type']
): Promise<EmailSequence | null> {
  const config = getConfig();
  const persona = getPersonaPrompt();

  const sequenceGuide: Record<string, { name: string; description: string; count: number; guide: string }> = {
    welcome: {
      name: 'Welcome Sequence',
      description: 'Sent when someone joins your email list',
      count: 5,
      guide: `5-email welcome sequence:
        Email 1 (Day 0): Welcome + deliver the lead magnet/promise. Warm, personal, set expectations.
        Email 2 (Day 1): Your story — why you started, what drives you. Build connection.
        Email 3 (Day 3): Best content/resource — give massive value, no selling.
        Email 4 (Day 5): Social proof — testimonials, results, case studies.
        Email 5 (Day 7): Soft pitch — introduce your product/service naturally.`,
    },
    nurture: {
      name: 'Nurture Sequence',
      description: 'Ongoing value emails to build trust',
      count: 7,
      guide: `7-email nurture sequence (sent weekly):
        Email 1: Quick win — one tip they can implement today.
        Email 2: Common mistake — "most people do X, but Y works better."
        Email 3: Deep dive — comprehensive guide on one topic.
        Email 4: Behind the scenes — how you do things, what you've learned.
        Email 5: Myth-busting — challenge a common belief in your industry.
        Email 6: Case study — real result from a real person/client.
        Email 7: Ask — what are they struggling with? Reply to this email.`,
    },
    convert: {
      name: 'Conversion Sequence',
      description: 'Turn engaged subscribers into customers',
      count: 5,
      guide: `5-email conversion sequence:
        Email 1 (Day 0): The problem — paint the pain, show you understand.
        Email 2 (Day 1): The solution — introduce your offer, focus on transformation.
        Email 3 (Day 2): Social proof — testimonials, before/after, results.
        Email 4 (Day 3): Objection handling — address the top 3 reasons people don't buy.
        Email 5 (Day 4): Urgency — final chance, bonus, or deadline.`,
    },
    reactivation: {
      name: 'Re-engagement Sequence',
      description: 'Win back inactive subscribers',
      count: 3,
      guide: `3-email re-engagement sequence:
        Email 1 (Day 0): "We miss you" — casual check-in, ask if they're still interested.
        Email 2 (Day 3): Value bomb — your absolute best content/tip, no ask.
        Email 3 (Day 7): Final — "Should I remove you?" with easy unsubscribe. Surprisingly effective.`,
    },
    onboarding: {
      name: 'Onboarding Sequence',
      description: 'Guide new customers to success',
      count: 5,
      guide: `5-email onboarding sequence:
        Email 1 (Day 0): Welcome + quickstart — get them to first win in under 5 minutes.
        Email 2 (Day 1): Feature spotlight — show ONE key feature they probably missed.
        Email 3 (Day 3): Pro tips — 3 power-user tips that save time.
        Email 4 (Day 5): Community — invite to Discord/community, show them they're not alone.
        Email 5 (Day 7): Check-in — "How's it going?" + link to help/support.`,
    },
  };

  const guide = sequenceGuide[type];
  if (!guide) return null;

  const prompt = `${persona}

Generate a ${guide.name} email sequence for this brand. ${guide.description}.

${guide.guide}

Return ONLY valid JSON (no markdown fences):
{
  "emails": [
    {
      "subject": "email subject line (compelling, under 50 chars)",
      "previewText": "inbox preview text (under 80 chars, complements subject)",
      "body": "full email body. Use short paragraphs (2-3 sentences max). Include the person's first name as {{firstName}}. Be conversational, not corporate. Use line breaks between paragraphs.",
      "cta": "the call-to-action text and what it links to",
      "sendDelay": "when to send (e.g. 'Day 0', 'Day 3')"
    }
  ]
}

Rules:
- Subject lines must be curiosity-driven or benefit-driven, NEVER clickbait
- Every email should be readable in under 2 minutes
- Use {{firstName}} for personalization
- Use ${config.persona.website || config.persona.brandName} naturally (not every email)
- Match the ${config.persona.tone} tone
- Each email stands alone but flows as a sequence
- Include specific examples relevant to "${config.persona.niche}"
- NO corporate buzzwords: ${config.persona.neverSay.slice(0, 5).join(', ')}`;

  try {
    const raw = await askLLM(prompt, { maxTokens: 3000, temperature: 0.7 });
    if (!raw) return null;
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned) as { emails: Email[] };
    return {
      name: guide.name,
      type,
      description: guide.description,
      emails: parsed.emails,
    };
  } catch (err) {
    console.log(`  [Email] Generation failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Generate all standard email sequences.
 */
export async function generateAllSequences(): Promise<EmailSequence[]> {
  const types: EmailSequence['type'][] = ['welcome', 'nurture', 'convert', 'reactivation', 'onboarding'];
  const sequences: EmailSequence[] = [];

  for (const type of types) {
    console.log(`  Generating ${type} sequence...`);
    const seq = await generateEmailSequence(type);
    if (seq) sequences.push(seq);
    // Rate limit between sequences
    await new Promise(r => setTimeout(r, 3000));
  }

  return sequences;
}

/**
 * Format an email sequence for terminal display.
 */
export function formatEmailSequence(seq: EmailSequence): string {
  const lines = [
    `\n${'═'.repeat(50)}`,
    `  ${seq.name.toUpperCase()}`,
    `  ${seq.description}`,
    `${'═'.repeat(50)}`,
  ];

  for (const email of seq.emails) {
    lines.push('');
    lines.push(`  ┌─ ${email.sendDelay}`);
    lines.push(`  │  Subject: ${email.subject}`);
    lines.push(`  │  Preview: ${email.previewText}`);
    lines.push(`  │`);
    for (const bodyLine of email.body.split('\n')) {
      lines.push(`  │  ${bodyLine}`);
    }
    lines.push(`  │`);
    lines.push(`  │  CTA: ${email.cta}`);
    lines.push(`  └${'─'.repeat(48)}`);
  }

  return lines.join('\n');
}
