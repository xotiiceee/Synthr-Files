/**
 * Content Style DNA — learned content style from actual outcomes.
 *
 * Replaces ALL hardcoded type guidance (educational/personal/engagement/promotional).
 * The system starts with zero assumptions and learns everything from:
 * - Approvals: user published this → the system got it right
 * - Rejections: user discarded this → wrong direction
 * - Edits: user changed X to Y → the diff IS the feedback
 * - Engagement: post got N likes/replies → audience signal
 *
 * The DNA builds up over time and gets injected into every content prompt.
 * New users get minimal guidance (just "write about this topic").
 * Experienced users get rich, specific, learned guidance.
 */

import {
  loadRuntimeAgentState as loadAgentState,
  saveRuntimeAgentState as saveAgentState,
} from '../core/runtime-agent-state.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ContentDNA {
  /** How many posts have been tracked total */
  totalTracked: number;

  /** Approved post patterns — what the system got RIGHT */
  approved: {
    count: number;
    avgLength: number;
    usesQuestions: number;      // ratio 0-1
    usesNumbers: number;        // ratio 0-1
    usesFirstPerson: number;    // ratio 0-1
    usesEmoji: number;          // ratio 0-1
    /** Phrases/patterns that appear in approved posts */
    commonPatterns: string[];
  };

  /** Rejected post patterns — what the system got WRONG */
  rejected: {
    count: number;
    /** Patterns seen in rejected posts — avoid these */
    avoidPatterns: string[];
  };

  /** Edit patterns — THE EDIT IS THE FEEDBACK */
  edits: {
    count: number;
    /** User tends to shorten posts */
    shortened: number;
    /** User tends to lengthen posts */
    lengthened: number;
    /** User removes questions */
    removedQuestions: number;
    /** User adds specific data/numbers */
    addedData: number;
    /** User makes tone more casual */
    madeCasual: number;
    /** User makes tone more formal */
    madeFormal: number;
  };

  /** Engagement patterns — what the AUDIENCE likes */
  engagement: {
    postsTracked: number;
    /** Average engagement score across all tracked posts */
    avgScore: number;
    /** Length range of top performers */
    bestLengthMin: number;
    bestLengthMax: number;
    /** Topics/themes that performed well */
    topThemes: string[];
    /** Topics/themes that flopped */
    bottomThemes: string[];
    /** Best posting hours (learned from engagement data) */
    bestHours: number[];
  };

  /** Discovered angles — what types of posts exist for this niche */
  angles: string[];

  /** Last updated */
  updatedAt: string;
}

// ─── Storage ────────────────────────────────────────────────────────────────

const STATE_KEY = 'content-dna';

function defaultDNA(): ContentDNA {
  return {
    totalTracked: 0,
    approved: {
      count: 0, avgLength: 0,
      usesQuestions: 0, usesNumbers: 0, usesFirstPerson: 0, usesEmoji: 0,
      commonPatterns: [],
    },
    rejected: { count: 0, avoidPatterns: [] },
    edits: {
      count: 0, shortened: 0, lengthened: 0,
      removedQuestions: 0, addedData: 0, madeCasual: 0, madeFormal: 0,
    },
    engagement: {
      postsTracked: 0, avgScore: 0,
      bestLengthMin: 0, bestLengthMax: 280,
      topThemes: [], bottomThemes: [],
      bestHours: [],
    },
    angles: [],
    updatedAt: new Date().toISOString(),
  };
}

export function loadDNA(agentId?: string): ContentDNA {
  return loadAgentState<ContentDNA>(STATE_KEY, defaultDNA(), agentId);
}

function saveDNA(dna: ContentDNA, agentId?: string): void {
  dna.updatedAt = new Date().toISOString();
  saveAgentState(STATE_KEY, dna, agentId);
}

// ─── Signal Recording ───────────────────────────────────────────────────────

/** Record that a post was approved/published by the user */
export function recordApproval(text: string, agentId?: string): void {
  const dna = loadDNA(agentId);
  dna.totalTracked++;
  const a = dna.approved;
  a.count++;

  // Update running averages
  const len = text.length;
  a.avgLength = a.avgLength === 0 ? len : Math.round((a.avgLength * (a.count - 1) + len) / a.count);

  // Pattern detection
  const hasQuestion = /\?/.test(text);
  const hasNumbers = /\d{2,}/.test(text);
  const hasFirstPerson = /\b(I|we|I'm|we're|I've|we've|my|our)\b/i.test(text);
  const hasEmoji = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u.test(text);

  // Running ratios
  a.usesQuestions = ((a.usesQuestions * (a.count - 1)) + (hasQuestion ? 1 : 0)) / a.count;
  a.usesNumbers = ((a.usesNumbers * (a.count - 1)) + (hasNumbers ? 1 : 0)) / a.count;
  a.usesFirstPerson = ((a.usesFirstPerson * (a.count - 1)) + (hasFirstPerson ? 1 : 0)) / a.count;
  a.usesEmoji = ((a.usesEmoji * (a.count - 1)) + (hasEmoji ? 1 : 0)) / a.count;

  saveDNA(dna, agentId);
}

/** Record that a post was rejected/discarded by the user */
export function recordRejection(text: string, agentId?: string): void {
  const dna = loadDNA(agentId);
  dna.totalTracked++;
  dna.rejected.count++;

  // Detect patterns in rejected content to avoid
  const patterns: string[] = [];
  if (/^(ever notice|have you ever|what if)\b/i.test(text)) patterns.push('rhetorical opener');
  if (/\?$/.test(text.trim())) patterns.push('ends with question');
  if (/^(here'?s|this is|let me)\b/i.test(text)) patterns.push('lecture opener');
  if (/\b(game[- ]?changer|revolutionary|unlock)\b/i.test(text)) patterns.push('hype words');
  if (text.length > 250) patterns.push('too long');
  if (text.length < 50) patterns.push('too short');

  // Add new patterns, keep max 20
  for (const p of patterns) {
    if (!dna.rejected.avoidPatterns.includes(p)) {
      dna.rejected.avoidPatterns.push(p);
    }
  }
  dna.rejected.avoidPatterns = dna.rejected.avoidPatterns.slice(-20);

  saveDNA(dna, agentId);
}

/** Record a user edit — the diff between original and edited version */
export function recordEdit(original: string, edited: string, agentId?: string): void {
  const dna = loadDNA(agentId);
  dna.totalTracked++;
  dna.edits.count++;

  // Analyze the diff
  if (edited.length < original.length * 0.8) dna.edits.shortened++;
  if (edited.length > original.length * 1.2) dna.edits.lengthened++;

  // Question handling
  const origQuestions = (original.match(/\?/g) || []).length;
  const editQuestions = (edited.match(/\?/g) || []).length;
  if (editQuestions < origQuestions) dna.edits.removedQuestions++;

  // Data/numbers added
  const origNumbers = (original.match(/\d{2,}/g) || []).length;
  const editNumbers = (edited.match(/\d{2,}/g) || []).length;
  if (editNumbers > origNumbers) dna.edits.addedData++;

  // Tone shifts
  const casualMarkers = /\b(lol|ngl|tbh|imo|nah|yep|gonna|kinda)\b/gi;
  const origCasual = (original.match(casualMarkers) || []).length;
  const editCasual = (edited.match(casualMarkers) || []).length;
  if (editCasual > origCasual) dna.edits.madeCasual++;
  if (editCasual < origCasual) dna.edits.madeFormal++;

  saveDNA(dna, agentId);
}

/** Record engagement data for a post */
export function recordPostEngagement(
  text: string,
  theme: string,
  score: number,
  hour: number,
  agentId?: string,
): void {
  const dna = loadDNA(agentId);
  const e = dna.engagement;
  e.postsTracked++;

  // Running average score
  e.avgScore = e.avgScore === 0 ? score : ((e.avgScore * (e.postsTracked - 1)) + score) / e.postsTracked;

  // Track best length range from top performers (score > 1.5x average)
  if (score > e.avgScore * 1.5 && e.postsTracked > 5) {
    const len = text.length;
    if (e.bestLengthMin === 0 || len < e.bestLengthMin) e.bestLengthMin = len;
    if (len > e.bestLengthMax) e.bestLengthMax = len;

    // Track best themes
    if (theme && !e.topThemes.includes(theme)) {
      e.topThemes.push(theme);
      e.topThemes = e.topThemes.slice(-10);
    }

    // Track best hours
    if (!e.bestHours.includes(hour)) {
      e.bestHours.push(hour);
      e.bestHours = e.bestHours.slice(-6);
    }
  }

  // Track bottom themes (score < 0.5x average)
  if (score < e.avgScore * 0.5 && e.postsTracked > 5 && theme) {
    if (!e.bottomThemes.includes(theme)) {
      e.bottomThemes.push(theme);
      e.bottomThemes = e.bottomThemes.slice(-10);
    }
  }

  saveDNA(dna, agentId);
}

/** Set discovered angles for this brand's niche */
export function setAngles(angles: string[], agentId?: string): void {
  const dna = loadDNA(agentId);
  dna.angles = angles.slice(0, 20);
  saveDNA(dna, agentId);
}

// ─── DNA → Prompt Guidance ──────────────────────────────────────────────────

/**
 * Build the guidance string from learned DNA.
 * This replaces ALL hardcoded type guidance.
 * Returns empty string for new users (no assumptions).
 */
export function buildDNAGuidance(agentId?: string): string {
  const dna = loadDNA(agentId);
  const parts: string[] = [];

  // Not enough data — no guidance, let the LLM figure it out from context
  if (dna.totalTracked < 3) {
    return '';
  }

  // From approvals — what works
  if (dna.approved.count >= 3) {
    const a = dna.approved;
    const traits: string[] = [];

    if (a.avgLength > 0) {
      traits.push(`aim for ~${a.avgLength} characters`);
    }
    if (a.usesQuestions < 0.2) traits.push('avoid ending with questions');
    else if (a.usesQuestions > 0.6) traits.push('questions work well for this brand');

    if (a.usesNumbers > 0.5) traits.push('include specific numbers and data');
    else if (a.usesNumbers < 0.15) traits.push('this brand prefers narrative over data');

    if (a.usesFirstPerson > 0.7) traits.push('write in first person (I/we)');
    if (a.usesEmoji > 0.5) traits.push('emoji are welcome');
    else if (a.usesEmoji < 0.1) traits.push('skip emoji');

    if (traits.length > 0) {
      parts.push(`LEARNED STYLE (from ${a.count} approved posts): ${traits.join('. ')}.`);
    }
  }

  // From rejections — what to avoid
  if (dna.rejected.count >= 2 && dna.rejected.avoidPatterns.length > 0) {
    parts.push(`AVOID (rejected ${dna.rejected.count} times for): ${dna.rejected.avoidPatterns.join(', ')}.`);
  }

  // From edits — how the user refines
  if (dna.edits.count >= 3) {
    const e = dna.edits;
    const editHints: string[] = [];
    if (e.shortened > e.lengthened * 2) editHints.push('be more concise — user frequently shortens drafts');
    if (e.lengthened > e.shortened * 2) editHints.push('add more detail — user frequently expands drafts');
    if (e.removedQuestions >= 3) editHints.push('don\'t ask questions — user consistently removes them');
    if (e.addedData >= 3) editHints.push('include more specific data/numbers — user adds them when missing');
    if (e.madeCasual >= 3) editHints.push('be more casual — user loosens the tone');
    if (e.madeFormal >= 3) editHints.push('be more formal — user tightens the tone');

    if (editHints.length > 0) {
      parts.push(`EDIT PATTERNS (from ${e.count} edits): ${editHints.join('. ')}.`);
    }
  }

  // From engagement — what the audience likes
  if (dna.engagement.postsTracked >= 10) {
    const eng = dna.engagement;
    const engHints: string[] = [];

    if (eng.bestLengthMin > 0 && eng.bestLengthMax > 0) {
      engHints.push(`best-performing posts are ${eng.bestLengthMin}-${eng.bestLengthMax} chars`);
    }
    if (eng.topThemes.length > 0) {
      engHints.push(`high-engagement topics: ${eng.topThemes.slice(0, 5).join(', ')}`);
    }
    if (eng.bottomThemes.length > 0) {
      engHints.push(`low-engagement topics: ${eng.bottomThemes.slice(0, 3).join(', ')}`);
    }

    if (engHints.length > 0) {
      parts.push(`AUDIENCE DATA (from ${eng.postsTracked} posts): ${engHints.join('. ')}.`);
    }
  }

  return parts.length > 0 ? `\n${parts.join('\n')}\n` : '';
}

/**
 * Pick a content angle for this post.
 * Uses discovered angles if available, falls back to niche-derived angles.
 * Avoids recently used angles for variety.
 */
export function pickAngle(agentId?: string): string | null {
  const dna = loadDNA(agentId);
  if (dna.angles.length === 0) return null;

  // Weighted random — prefer angles not in bottomThemes
  const viable = dna.angles.filter(a => !dna.engagement.bottomThemes.includes(a));
  const pool = viable.length > 0 ? viable : dna.angles;
  return pool[Math.floor(Math.random() * pool.length)];
}
