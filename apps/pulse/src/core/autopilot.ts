/**
 * Autopilot Engine — confidence scoring, auto-approve, calibration, learning.
 *
 * The autopilot system works with the existing autopost queue:
 * - Items enter the queue as 'pending'
 * - Autopilot scores each item's confidence (0-100)
 * - Above threshold (default 75): auto-approved
 * - Below threshold: stays pending for manual review
 * - Every approve/reject decision trains the system
 * - After 10 calibration decisions, autopilot is fully armed
 */

import { loadState, saveState } from './state.js';
import { getConfig, saveConfig } from './persona.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AutopilotState {
  totalDecisions: number;
  approvals: number;
  rejections: number;
  edits: number;
  // Topic preference scores (topic -> score from -1 to 1)
  topicScores: Record<string, number>;
  // Category preference scores
  categoryScores: Record<string, number>;
  // Format preference scores (thread/single/quote/poll)
  formatScores: Record<string, number>;
  // Average voice score of approved items
  avgApprovedVoiceScore: number;
  // Confidence threshold adjustments based on learning
  thresholdAdjustment: number;
  // Last digest sent
  lastDigestSent?: string;
}

const DEFAULT_STATE: AutopilotState = {
  totalDecisions: 0,
  approvals: 0,
  rejections: 0,
  edits: 0,
  topicScores: {},
  categoryScores: {},
  formatScores: {},
  avgApprovedVoiceScore: 80,
  thresholdAdjustment: 0,
};

// ─── State Management ───────────────────────────────────────────────────────

export function getAutopilotState(): AutopilotState {
  return loadState<AutopilotState>('autopilot', DEFAULT_STATE);
}

export function saveAutopilotState(state: AutopilotState): void {
  saveState('autopilot', state);
}

// ─── Autopilot Status ───────────────────────────────────────────────────────

export function isAutopilotEnabled(): boolean {
  const config = getConfig();
  return config.autopilot?.enabled ?? false;
}

export function isCalibrationComplete(): boolean {
  const config = getConfig();
  return config.autopilot?.calibrationComplete ?? false;
}

export function getCalibrationProgress(): { current: number; required: number; complete: boolean } {
  const config = getConfig();
  const current = config.autopilot?.calibrationDecisions ?? 0;
  const required = 10;
  return { current, required, complete: current >= required };
}

// ─── Confidence Scoring ─────────────────────────────────────────────────────

/**
 * Score an item's confidence for auto-approval.
 * Combines voice score with learned preferences.
 * Returns 0-100.
 */
export function scoreConfidence(item: {
  voiceScore: number;
  category: string;
  format?: string;
  content: string;
}): number {
  const state = getAutopilotState();

  // Base: voice score (0-100)
  // SAFETY: If voiceScore is NaN/undefined (e.g., scoring failed upstream),
  // default to 0 so the item won't auto-approve. Never let a broken score bypass review.
  let score = Number.isFinite(item.voiceScore) ? item.voiceScore : 0;

  // Adjust based on category preference (-20 to +20)
  const catScore = state.categoryScores[item.category] ?? 0;
  score += catScore * 20;

  // Adjust based on format preference (-10 to +10)
  if (item.format) {
    const fmtScore = state.formatScores[item.format] ?? 0;
    score += fmtScore * 10;
  }

  // Adjust based on historical approval rate (dampened to prevent feedback loop)
  if (state.totalDecisions > 5) {
    const approvalRate = state.approvals / state.totalDecisions;
    // Cap at +3 to prevent overconfidence spiral
    score += Math.min((approvalRate - 0.5) * 5, 3);
  }

  // Apply learning decay — reduce learned preferences by 5% each scoring
  // Prevents stale preferences from months ago dominating decisions
  for (const key of Object.keys(state.categoryScores)) {
    state.categoryScores[key] = (state.categoryScores[key] ?? 0) * 0.95;
  }
  for (const key of Object.keys(state.formatScores)) {
    state.formatScores[key] = (state.formatScores[key] ?? 0) * 0.95;
  }

  // Apply threshold adjustment from learning
  score += state.thresholdAdjustment;

  // Clamp to 0-100
  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Determine if an item should be auto-approved based on confidence.
 */
export function shouldAutoApprove(item: {
  voiceScore: number;
  category: string;
  format?: string;
  content: string;
}): { autoApprove: boolean; confidence: number; reason: string } {
  const config = getConfig();

  if (!config.autopilot?.enabled) {
    return { autoApprove: false, confidence: 0, reason: 'autopilot_disabled' };
  }

  if (!config.autopilot.calibrationComplete) {
    return { autoApprove: false, confidence: 0, reason: 'calibrating' };
  }

  const threshold = config.autopilot.confidenceThreshold ?? 75;
  const confidence = scoreConfidence(item);

  // SAFETY: If confidence is NaN (e.g., all scoring inputs were broken),
  // never auto-approve. A broken score must not bypass human review.
  if (!Number.isFinite(confidence)) {
    return { autoApprove: false, confidence: 0, reason: 'score_invalid' };
  }

  if (confidence >= threshold) {
    return { autoApprove: true, confidence, reason: 'above_threshold' };
  }

  return { autoApprove: false, confidence, reason: 'below_threshold' };
}

// ─── Learning ───────────────────────────────────────────────────────────────

/**
 * Record a user decision (approve/reject/edit) for learning.
 */
export function recordDecision(decision: 'approve' | 'reject' | 'edit', item: {
  voiceScore: number;
  category: string;
  format?: string;
}): void {
  const state = getAutopilotState();
  const config = getConfig();

  state.totalDecisions++;

  if (decision === 'approve') {
    state.approvals++;
    // Boost category and format scores
    state.categoryScores[item.category] = Math.min(1, (state.categoryScores[item.category] ?? 0) + 0.1);
    if (item.format) {
      state.formatScores[item.format] = Math.min(1, (state.formatScores[item.format] ?? 0) + 0.05);
    }
    // Update average approved voice score (rolling average)
    state.avgApprovedVoiceScore = Math.round(
      ((state.avgApprovedVoiceScore * (state.approvals - 1)) + item.voiceScore) / state.approvals
    );
  } else if (decision === 'reject') {
    state.rejections++;
    // Decrease category and format scores
    state.categoryScores[item.category] = Math.max(-1, (state.categoryScores[item.category] ?? 0) - 0.15);
    if (item.format) {
      state.formatScores[item.format] = Math.max(-1, (state.formatScores[item.format] ?? 0) - 0.1);
    }
  } else if (decision === 'edit') {
    state.edits++;
    // Edit = close but not perfect, slight category boost
    state.categoryScores[item.category] = Math.min(1, (state.categoryScores[item.category] ?? 0) + 0.03);
  }

  // Update calibration progress
  if (config.autopilot) {
    config.autopilot.calibrationDecisions = state.totalDecisions;
    if (state.totalDecisions >= 10 && !config.autopilot.calibrationComplete) {
      config.autopilot.calibrationComplete = true;
      console.log('[Autopilot] Calibration complete! Autopilot is fully armed.');
    }
    saveConfig(config);
  }

  saveAutopilotState(state);
}

// ─── Autopilot Summary ──────────────────────────────────────────────────────

export interface AutopilotSummary {
  enabled: boolean;
  calibrationProgress: { current: number; required: number; complete: boolean };
  stats: {
    totalDecisions: number;
    approvalRate: number;
    avgConfidence: number;
  };
  activeHours: { start: string; end: string };
  limits: {
    profilePostsPerDay: number;
    repliesPerDay: number;
  };
}

export function getAutopilotSummary(): AutopilotSummary {
  const config = getConfig();
  const state = getAutopilotState();
  const ap = config.autopilot;

  return {
    enabled: ap?.enabled ?? false,
    calibrationProgress: getCalibrationProgress(),
    stats: {
      totalDecisions: state.totalDecisions,
      approvalRate: state.totalDecisions > 0 ? Math.round((state.approvals / state.totalDecisions) * 100) : 0,
      avgConfidence: state.avgApprovedVoiceScore,
    },
    activeHours: ap?.activeHours ?? { start: '09:00', end: '22:00' },
    limits: {
      profilePostsPerDay: config.autopost?.limits?.profilePostsPerDay ?? 3,
      repliesPerDay: config.autopost?.limits?.repliesPerDay ?? 10,
    },
  };
}
