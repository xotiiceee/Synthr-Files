/**
 * Voice Drift Detection — tracks how brand voice evolves and catches unintentional drift.
 *
 * Takes weekly snapshots of approved content, compares against baseline,
 * detects drift, tracks user edits, and suggests persona refinements.
 */

import { loadState, saveState } from '../core/state.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface VoiceMetrics {
  avg_sentence_length: number;
  emoji_frequency: number;       // per 100 words
  question_frequency: number;    // % of posts ending with ?
  exclamation_frequency: number; // per 100 words
  hashtag_frequency: number;     // per post
  avg_word_length: number;
  formality_score: number;       // 0-100 (casual to formal)
  unique_vocab_ratio: number;    // unique words / total words
  top_phrases: string[];         // most common 2-3 word phrases
}

export interface VoiceSnapshot {
  date: string;
  metrics: VoiceMetrics;
  sample_size: number;
}

export interface DriftReport {
  drift_detected: boolean;
  drift_score: number;          // 0-100
  drift_direction: string;
  recommendations: string[];
  current: VoiceSnapshot;
  baseline: VoiceSnapshot | null;
}

export interface EditPatterns {
  shortened: number;
  lengthened: number;
  added_emoji: number;
  removed_emoji: number;
  made_casual: number;
  made_formal: number;
  added_question: number;
  removed_question: number;
  total_edits: number;
}

interface VoiceDriftState {
  baseline: VoiceSnapshot | null;
  snapshots: VoiceSnapshot[];
  drift_history: Array<{ date: string; drift_score: number; direction: string }>;
  edit_patterns: EditPatterns;
  last_analysis: string;
}

const DEFAULT_STATE: VoiceDriftState = {
  baseline: null,
  snapshots: [],
  drift_history: [],
  edit_patterns: { shortened: 0, lengthened: 0, added_emoji: 0, removed_emoji: 0, made_casual: 0, made_formal: 0, added_question: 0, removed_question: 0, total_edits: 0 },
  last_analysis: '',
};

const EMOJI_REGEX = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2702}-\u{27B0}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}]/gu;
const FORMAL_WORDS = ['therefore', 'furthermore', 'consequently', 'nevertheless', 'regarding', 'accordingly', 'hereby', 'pursuant', 'aforementioned', 'henceforth'];
const CASUAL_WORDS = ['gonna', 'wanna', 'gotta', 'btw', 'tbh', 'imo', 'lol', 'lmao', 'ngl', 'fr', 'lowkey', 'highkey', 'vibe', 'literally'];

// ─── Snapshot Creation ──────────────────────────────────────────────────────

export function createSnapshot(posts: string[]): VoiceSnapshot {
  if (posts.length === 0) {
    return { date: new Date().toISOString(), metrics: emptyMetrics(), sample_size: 0 };
  }

  const allText = posts.join(' ');
  const words = allText.split(/\s+/).filter(w => w.length > 0);
  const sentences = allText.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const totalWords = words.length;
  const uniqueWords = new Set(words.map(w => w.toLowerCase()));

  // Emoji count
  const emojiCount = (allText.match(EMOJI_REGEX) || []).length;
  const emojiFreq = totalWords > 0 ? (emojiCount / totalWords) * 100 : 0;

  // Question frequency (% of posts ending with ?)
  const questionPosts = posts.filter(p => p.trim().endsWith('?')).length;
  const questionFreq = posts.length > 0 ? (questionPosts / posts.length) * 100 : 0;

  // Exclamation frequency
  const exclamationCount = (allText.match(/!/g) || []).length;
  const exclamationFreq = totalWords > 0 ? (exclamationCount / totalWords) * 100 : 0;

  // Hashtag frequency
  const hashtagCount = (allText.match(/#\w+/g) || []).length;
  const hashtagFreq = posts.length > 0 ? hashtagCount / posts.length : 0;

  // Formality score
  const formalCount = words.filter(w => FORMAL_WORDS.includes(w.toLowerCase())).length;
  const casualCount = words.filter(w => CASUAL_WORDS.includes(w.toLowerCase())).length;
  const formalRatio = totalWords > 0 ? (formalCount - casualCount) / totalWords : 0;
  const formality = Math.max(0, Math.min(100, 50 + formalRatio * 500));

  // Top 2-3 word phrases
  const bigrams = new Map<string, number>();
  for (let i = 0; i < words.length - 1; i++) {
    const pair = `${words[i].toLowerCase()} ${words[i + 1].toLowerCase()}`;
    bigrams.set(pair, (bigrams.get(pair) || 0) + 1);
  }
  const topPhrases = [...bigrams.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([phrase]) => phrase);

  return {
    date: new Date().toISOString(),
    metrics: {
      avg_sentence_length: sentences.length > 0 ? Math.round(totalWords / sentences.length) : 0,
      emoji_frequency: Math.round(emojiFreq * 100) / 100,
      question_frequency: Math.round(questionFreq * 100) / 100,
      exclamation_frequency: Math.round(exclamationFreq * 100) / 100,
      hashtag_frequency: Math.round(hashtagFreq * 100) / 100,
      avg_word_length: totalWords > 0 ? Math.round((words.reduce((sum, w) => sum + w.length, 0) / totalWords) * 10) / 10 : 0,
      formality_score: Math.round(formality),
      unique_vocab_ratio: totalWords > 0 ? Math.round((uniqueWords.size / totalWords) * 100) / 100 : 0,
      top_phrases: topPhrases,
    },
    sample_size: posts.length,
  };
}

function emptyMetrics(): VoiceMetrics {
  return { avg_sentence_length: 0, emoji_frequency: 0, question_frequency: 0, exclamation_frequency: 0, hashtag_frequency: 0, avg_word_length: 0, formality_score: 50, unique_vocab_ratio: 0, top_phrases: [] };
}

// ─── Drift Detection ────────────────────────────────────────────────────────

export function analyzeVoiceDrift(approvedPosts: string[], _currentPersona?: unknown): DriftReport {
  const state = loadState<VoiceDriftState>('voice-drift', DEFAULT_STATE);
  const current = createSnapshot(approvedPosts);

  // Set baseline if none exists
  if (!state.baseline) {
    state.baseline = current;
    saveState('voice-drift', state);
    return { drift_detected: false, drift_score: 0, drift_direction: 'baseline set', recommendations: ['Baseline established. Will detect drift in future analyses.'], current, baseline: null };
  }

  const baseline = state.baseline;

  // Calculate drift per metric
  const drifts: Array<{ metric: string; delta: number; direction: string }> = [];

  const compare = (name: string, current: number, base: number, threshold: number) => {
    if (base === 0 && current === 0) return;
    const delta = base > 0 ? ((current - base) / base) * 100 : current > 0 ? 100 : 0;
    if (Math.abs(delta) > threshold) {
      drifts.push({ metric: name, delta: Math.round(delta), direction: delta > 0 ? 'increased' : 'decreased' });
    }
  };

  compare('sentence_length', current.metrics.avg_sentence_length, baseline.metrics.avg_sentence_length, 20);
  compare('emoji_usage', current.metrics.emoji_frequency, baseline.metrics.emoji_frequency, 30);
  compare('question_usage', current.metrics.question_frequency, baseline.metrics.question_frequency, 30);
  compare('exclamation_usage', current.metrics.exclamation_frequency, baseline.metrics.exclamation_frequency, 30);
  compare('hashtag_usage', current.metrics.hashtag_frequency, baseline.metrics.hashtag_frequency, 40);
  compare('formality', current.metrics.formality_score, baseline.metrics.formality_score, 15);
  compare('vocab_diversity', current.metrics.unique_vocab_ratio, baseline.metrics.unique_vocab_ratio, 20);

  // Drift score = weighted average of absolute deltas
  const driftScore = drifts.length > 0
    ? Math.min(100, Math.round(drifts.reduce((sum, d) => sum + Math.abs(d.delta), 0) / drifts.length))
    : 0;

  // Direction summary
  const directions = drifts.map(d => `${d.metric} ${d.direction} ${Math.abs(d.delta)}%`);
  const driftDirection = directions.length > 0 ? directions.join(', ') : 'stable';

  // Recommendations
  const recommendations: string[] = [];
  for (const d of drifts) {
    if (d.metric === 'formality' && d.direction === 'increased') {
      recommendations.push('Voice is becoming more formal. Consider using more casual language if your audience is informal.');
    }
    if (d.metric === 'emoji_usage' && d.direction === 'increased') {
      recommendations.push('Emoji usage has increased significantly. Check if this matches your brand voice.');
    }
    if (d.metric === 'sentence_length' && d.direction === 'decreased') {
      recommendations.push('Sentences are getting shorter. Voice may be becoming too terse.');
    }
    if (d.metric === 'vocab_diversity' && d.direction === 'decreased') {
      recommendations.push('Vocabulary is becoming repetitive. Try varying word choices.');
    }
  }

  // Save snapshot + drift history
  state.snapshots.push(current);
  if (state.snapshots.length > 52) state.snapshots = state.snapshots.slice(-52); // keep 1 year
  state.drift_history.push({ date: new Date().toISOString(), drift_score: driftScore, direction: driftDirection });
  if (state.drift_history.length > 100) state.drift_history = state.drift_history.slice(-100);
  state.last_analysis = new Date().toISOString();
  saveState('voice-drift', state);

  return {
    drift_detected: driftScore > 30,
    drift_score: driftScore,
    drift_direction: driftDirection,
    recommendations,
    current,
    baseline,
  };
}

// ─── Edit Analysis ──────────────────────────────────────────────────────────

export function analyzeUserEdits(original: string, published: string): Partial<EditPatterns> {
  const patterns: Partial<EditPatterns> = {};

  if (published.length < original.length * 0.8) patterns.shortened = 1;
  if (published.length > original.length * 1.2) patterns.lengthened = 1;

  const origEmoji = (original.match(EMOJI_REGEX) || []).length;
  const pubEmoji = (published.match(EMOJI_REGEX) || []).length;
  if (pubEmoji > origEmoji) patterns.added_emoji = 1;
  if (pubEmoji < origEmoji) patterns.removed_emoji = 1;

  if (original.endsWith('?') && !published.endsWith('?')) patterns.removed_question = 1;
  if (!original.endsWith('?') && published.endsWith('?')) patterns.added_question = 1;

  const origCasual = CASUAL_WORDS.filter(w => original.toLowerCase().includes(w)).length;
  const pubCasual = CASUAL_WORDS.filter(w => published.toLowerCase().includes(w)).length;
  if (pubCasual > origCasual) patterns.made_casual = 1;
  if (pubCasual < origCasual) patterns.made_formal = 1;

  return patterns;
}

export function recordEditPatterns(edits: Partial<EditPatterns>): void {
  const state = loadState<VoiceDriftState>('voice-drift', DEFAULT_STATE);
  for (const [key, val] of Object.entries(edits)) {
    if (val && key in state.edit_patterns) {
      (state.edit_patterns as unknown as Record<string, number>)[key] += val;
    }
  }
  state.edit_patterns.total_edits++;
  saveState('voice-drift', state);
}

// ─── Weekly Analysis Entry Point ────────────────────────────────────────────

export async function runWeeklyVoiceAnalysis(approvedPosts: string[]): Promise<DriftReport> {
  return analyzeVoiceDrift(approvedPosts);
}

// ─── State Queries ──────────────────────────────────────────────────────────

export function getBaseline(): VoiceSnapshot | null {
  return loadState<VoiceDriftState>('voice-drift', DEFAULT_STATE).baseline;
}

export function getSnapshots(): VoiceSnapshot[] {
  return loadState<VoiceDriftState>('voice-drift', DEFAULT_STATE).snapshots;
}

export function getDriftHistory(): Array<{ date: string; drift_score: number; direction: string }> {
  return loadState<VoiceDriftState>('voice-drift', DEFAULT_STATE).drift_history;
}

export function getEditPatterns(): EditPatterns {
  return loadState<VoiceDriftState>('voice-drift', DEFAULT_STATE).edit_patterns;
}

export function resetBaseline(posts: string[]): VoiceSnapshot {
  const state = loadState<VoiceDriftState>('voice-drift', DEFAULT_STATE);
  state.baseline = createSnapshot(posts);
  saveState('voice-drift', state);
  return state.baseline;
}
