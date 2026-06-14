/**
 * Preference Engine — learns user preferences from implicit signals.
 *
 * Like Spotify learning taste from skips/replays, not star ratings.
 * The server is the brain, the LLM is the voice.
 *
 * Signal sources:
 * - Draft approvals/rejections/edits (content preferences)
 * - Chat message style (communication preferences)
 * - Suggestion accept/dismiss (autonomy + strategy)
 * - Knowledge note management (what matters to them)
 * - Config changes (direct preference signals)
 *
 * Outputs a structured preference profile injected into LLM context.
 */

import { getRecentSignals, getPreferenceProfile, upsertPreferenceProfile, type PreferenceProfile, type SignalType } from './db.js';

// ─── Chat Style Detection ───────────────────────────────────────────────────

export function detectChatStyle(message: string): { brevity: 'terse' | 'moderate' | 'detailed'; formality: 'casual' | 'neutral' | 'formal'; usesEmoji: boolean } {
  const words = message.split(/\s+/).length;
  const brevity = words < 15 ? 'terse' : words > 80 ? 'detailed' : 'moderate';

  const casualMarkers = /\b(lol|haha|nah|yep|yeah|gonna|wanna|kinda|tbh|imo|idk|btw|rn)\b|[!]{2,}|\.{3,}/i;
  const formalMarkers = /\b(please|kindly|regarding|therefore|furthermore|accordingly|appreciate)\b/i;
  const formality = casualMarkers.test(message) ? 'casual' : formalMarkers.test(message) ? 'formal' : 'neutral';

  const usesEmoji = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u.test(message);

  return { brevity, formality, usesEmoji };
}

// ─── Bulk Content Detection ─────────────────────────────────────────────────

export function isBulkContent(message: string): boolean {
  if (message.length < 500) return false;
  const hasHeaders = /^#{1,3}\s+/m.test(message);
  const hasBullets = (message.match(/^[-*•]\s+/gm) || []).length >= 3;
  const hasNumberedList = (message.match(/^\d+\.\s+/gm) || []).length >= 3;
  const hasBoldSections = (message.match(/\*\*[^*]+\*\*/g) || []).length >= 3;
  const structureScore = (hasHeaders ? 1 : 0) + (hasBullets ? 1 : 0) + (hasNumberedList ? 1 : 0) + (hasBoldSections ? 1 : 0);
  return structureScore >= 1;
}

// ─── Smart Chunking ─────────────────────────────────────────────────────────

export interface ContentChunk {
  title: string;
  content: string;
  priority: number;
}

/** Strip markdown formatting into clean readable text */
function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '')           // headers
    .replace(/\*\*([^*]+)\*\*/g, '$1')      // bold
    .replace(/\*([^*]+)\*/g, '$1')          // italic
    .replace(/__([^_]+)__/g, '$1')          // bold alt
    .replace(/_([^_]+)_/g, '$1')            // italic alt
    .replace(/`([^`]+)`/g, '$1')            // inline code
    .replace(/```[\s\S]*?```/g, '')         // code blocks
    .replace(/^[-*•]\s+/gm, '- ')          // normalize bullets
    .replace(/^\d+\.\s+/gm, (m) => m)      // keep numbered lists
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links → text
    .replace(/^---+$/gm, '')               // horizontal rules
    .replace(/\n{3,}/g, '\n\n')            // collapse blank lines
    .trim();
}

/** Truncate at a sentence/line boundary, never mid-word */
function truncateSmart(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  // Find last sentence-end or newline before limit
  const slice = text.slice(0, maxLen);
  const lastSentence = Math.max(
    slice.lastIndexOf('. '),
    slice.lastIndexOf('.\n'),
    slice.lastIndexOf('\n'),
  );
  if (lastSentence > maxLen * 0.5) return slice.slice(0, lastSentence + 1).trim();
  // Fallback: last space
  const lastSpace = slice.lastIndexOf(' ');
  return lastSpace > maxLen * 0.5 ? slice.slice(0, lastSpace).trim() : slice.trim();
}

/** Condense bullet-heavy sections into concise prose-like summaries */
function condenseBullets(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];
  let bulletBuf: string[] = [];

  const flushBullets = () => {
    if (bulletBuf.length === 0) return;
    // Keep bullets but strip redundant markdown noise
    for (const b of bulletBuf) result.push(b);
    bulletBuf = [];
  };

  for (const line of lines) {
    if (/^[-*•]\s+/.test(line.trim())) {
      bulletBuf.push(line.trim());
    } else {
      flushBullets();
      if (line.trim()) result.push(line.trim());
    }
  }
  flushBullets();
  return result.join('\n');
}

export function chunkStructuredContent(text: string): ContentChunk[] {
  const chunks: ContentChunk[] = [];

  // Try splitting by markdown headers first
  const headerSections = text.split(/^(?=#{1,3}\s+)/m).filter(s => s.trim());

  if (headerSections.length >= 2) {
    for (const section of headerSections) {
      const lines = section.trim().split('\n');
      const headerMatch = lines[0].match(/^#{1,3}\s+(.+)/);
      const rawTitle = headerMatch ? headerMatch[1] : lines[0].slice(0, 60);
      const title = rawTitle.replace(/[*_#]/g, '').replace(/^\d+\.\s*/, '').trim();
      const rawContent = (headerMatch ? lines.slice(1) : lines).join('\n').trim();

      if (rawContent.length > 20) {
        const cleaned = condenseBullets(stripMarkdown(rawContent));
        chunks.push({
          title: title.slice(0, 80),
          content: truncateSmart(cleaned, 2000),
          priority: 2,
        });
      }
    }
    return chunks;
  }

  // Fallback: split by double newlines (paragraphs)
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 30);
  for (let i = 0; i < Math.min(paragraphs.length, 10); i++) {
    const para = paragraphs[i].trim();
    const cleaned = stripMarkdown(para);
    const firstLine = cleaned.split('\n')[0].trim();
    const title = firstLine.length > 10 && firstLine.length < 80 ? firstLine : `Section ${i + 1}`;
    chunks.push({ title, content: truncateSmart(condenseBullets(cleaned), 2000), priority: 1 });
  }
  return chunks;
}

// ─── Fuzzy Note Matching ────────────────────────────────────────────────────

/** Normalize a title for fuzzy matching: lowercase, strip numbers/punctuation/prefixes */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/^\d+\.\s*/, '')           // "1. ClawNet" → "clawnet"
    .replace(/[^a-z0-9\s]/g, '')        // strip punctuation
    .replace(/\s+/g, ' ')
    .trim();
}

/** Find best matching existing note index by fuzzy title similarity */
export function findMatchingNote(notes: Array<{ title: string; tags?: string[] }>, chunkTitle: string): number {
  const norm = normalizeTitle(chunkTitle);
  if (!norm) return -1;

  // Pass 1: exact normalized match
  const exactIdx = notes.findIndex(n => normalizeTitle(n.title) === norm);
  if (exactIdx >= 0) return exactIdx;

  // Pass 2: one contains the other (handles "ClawNet" matching "ClawNet — Sovereign API orchestration")
  const idx2 = notes.findIndex(n => {
    const nn = normalizeTitle(n.title);
    return nn.includes(norm) || norm.includes(nn);
  });
  if (idx2 >= 0) return idx2;

  // Pass 3: significant word overlap (>60% of words shared)
  const chunkWords = new Set(norm.split(' ').filter(w => w.length > 2));
  if (chunkWords.size === 0) return -1;

  let bestIdx = -1;
  let bestOverlap = 0;
  for (let i = 0; i < notes.length; i++) {
    const noteWords = new Set(normalizeTitle(notes[i].title).split(' ').filter(w => w.length > 2));
    if (noteWords.size === 0) continue;
    let shared = 0;
    for (const w of chunkWords) { if (noteWords.has(w)) shared++; }
    const overlap = shared / Math.min(chunkWords.size, noteWords.size);
    if (overlap > 0.6 && overlap > bestOverlap) {
      bestOverlap = overlap;
      bestIdx = i;
    }
  }
  return bestIdx;
}

// ─── Profile Builder ────────────────────────────────────────────────────────

export function rebuildProfile(tenantId: string, agentId: string): PreferenceProfile {
  const signals = getRecentSignals(tenantId, agentId, 200);
  const existing = getPreferenceProfile(tenantId, agentId);

  const profile: PreferenceProfile = existing || {
    strategic_posture: 'unknown',
    competitor_stance: 'unknown',
    content_style: 'unknown',
    risk_tolerance: 'moderate',
    communication: 'unknown',
    autonomy: 'unknown',
    chat_style: 'unknown',
  };

  // Count signal types
  const counts: Record<string, number> = {};
  const chatStyles: { brevity: string; formality: string }[] = [];

  for (const s of signals) {
    counts[s.signal_type] = (counts[s.signal_type] || 0) + 1;
    try {
      const data = JSON.parse(s.signal_data);

      if (s.signal_type === 'chat_message' && data.brevity) {
        chatStyles.push({ brevity: data.brevity, formality: data.formality });
      }

      // Learn from edits: what did they change?
      if (s.signal_type === 'draft_edited' && data.editType) {
        if (data.editType === 'shortened') profile.content_style = 'concise';
        if (data.editType === 'added_humor') profile.risk_tolerance = 'edgy';
        if (data.editType === 'made_formal') profile.content_style = 'formal';
        if (data.editType === 'added_data') profile.content_style = 'data-driven';
      }
    } catch {}
  }

  // Autonomy: high approval rate = trusts the bot
  const approved = counts['draft_approved'] || 0;
  const rejected = counts['draft_rejected'] || 0;
  const total = approved + rejected;
  if (total >= 5) {
    const approvalRate = approved / total;
    profile.autonomy = approvalRate > 0.8 ? 'high' : approvalRate > 0.5 ? 'moderate' : 'low';
  }

  // Chat style: aggregate from recent messages
  if (chatStyles.length >= 3) {
    const brevityMode = mode(chatStyles.map(s => s.brevity));
    const formalityMode = mode(chatStyles.map(s => s.formality));
    profile.chat_style = `${brevityMode}-${formalityMode}`;
    profile.communication = brevityMode;
  }

  upsertPreferenceProfile(tenantId, agentId, profile);
  return profile;
}

function mode(arr: string[]): string {
  const freq: Record<string, number> = {};
  for (const v of arr) freq[v] = (freq[v] || 0) + 1;
  return Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown';
}

// ─── Context Injection ──────────────────────────────────────────────────────

/**
 * Build a concise preference summary for LLM context injection.
 * This tells the LLM who this customer IS, not who we think they should be.
 */
export function buildPreferenceContext(tenantId: string, agentId: string): string {
  const profile = getPreferenceProfile(tenantId, agentId);
  if (!profile) return '';

  const parts: string[] = [];
  const { strategic_posture, competitor_stance, content_style, risk_tolerance, communication, autonomy, chat_style } = profile;

  // Only include learned preferences (not "unknown")
  if (strategic_posture !== 'unknown') parts.push(`Strategy: ${strategic_posture}`);
  if (competitor_stance !== 'unknown') parts.push(`Competitors: ${competitor_stance}`);
  if (content_style !== 'unknown') parts.push(`Content style: ${content_style}`);
  if (risk_tolerance !== 'moderate') parts.push(`Risk tolerance: ${risk_tolerance}`);
  if (communication !== 'unknown') parts.push(`Prefers ${communication} responses`);
  if (autonomy !== 'unknown') parts.push(`Autonomy: ${autonomy} (${autonomy === 'high' ? 'trusts suggestions, less confirmation needed' : 'prefers approval before changes'})`);
  if (chat_style !== 'unknown') parts.push(`Chat style: ${chat_style}`);

  if (parts.length === 0) return '\nUSER PREFERENCES: Still learning — this is a new user. Observe their style and adapt.';

  return `\nUSER PREFERENCES (learned from their behavior — match this):\n${parts.join('\n')}`;
}
