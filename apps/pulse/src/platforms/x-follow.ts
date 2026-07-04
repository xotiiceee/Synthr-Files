/**
 * X/Twitter Follow & Unfollow API integration.
 * Rate limits vary by approved X API tier; default caps should stay conservative.
 */

import { buildOAuthHeader, xFetch, getUserId, getUserIdFromUsername, parseXApiError } from './x.js';
import { loadState, saveState, getTodayKey } from '../core/state.js';

interface FollowState {
  followsToday: number;
  followsThisMonth: number;
  todayKey: string;
  monthKey: string;
  lastFollowAt: string;
}

const STATE_KEY = 'x-follow-state';

function getMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function getState(): FollowState {
  const state = loadState<FollowState>(STATE_KEY, {
    followsToday: 0,
    followsThisMonth: 0,
    todayKey: getTodayKey(),
    monthKey: getMonthKey(),
    lastFollowAt: '',
  });
  // Reset daily counter
  const today = getTodayKey();
  if (state.todayKey !== today) {
    state.followsToday = 0;
    state.todayKey = today;
  }
  // Reset monthly counter
  const month = getMonthKey();
  if (state.monthKey !== month) {
    state.followsThisMonth = 0;
    state.monthKey = month;
  }
  return state;
}

/**
 * Follow a user on X.
 * POST /2/users/:id/following
 */
export async function xFollow(targetUserId: string): Promise<{ ok: boolean; error?: string }> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: 'Cannot resolve user ID' };

  // If targetUserId looks like a username (not numeric), resolve it
  let resolvedId = targetUserId;
  if (!/^\d+$/.test(targetUserId)) {
    const numericId = await getUserIdFromUsername(targetUserId);
    if (!numericId) return { ok: false, error: `Cannot resolve @${targetUserId} to user ID` };
    resolvedId = numericId;
  }

  const url = `https://api.twitter.com/2/users/${userId}/following`;

  try {
    const res = await xFetch(url, {
      method: 'POST',
      headers: {
        Authorization: buildOAuthHeader('POST', url),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ target_user_id: resolvedId }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const body = await res.text();
      if (res.status === 400) {
        return { ok: false, error: 'Already following or account suspended' };
      }
      return { ok: false, error: parseXApiError(res.status, body) };
    }

    // Track follow
    const state = getState();
    state.followsToday++;
    state.followsThisMonth++;
    state.lastFollowAt = new Date().toISOString();
    saveState(STATE_KEY, state);

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Unfollow a user on X.
 * DELETE /2/users/:id/following/:target_user_id
 */
export async function xUnfollow(targetUserId: string): Promise<{ ok: boolean; error?: string }> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: 'Cannot resolve user ID' };

  // If targetUserId looks like a username (not numeric), resolve it
  let resolvedId = targetUserId;
  if (!/^\d+$/.test(targetUserId)) {
    const numericId = await getUserIdFromUsername(targetUserId);
    if (!numericId) return { ok: false, error: `Cannot resolve @${targetUserId} to user ID` };
    resolvedId = numericId;
  }

  const url = `https://api.twitter.com/2/users/${userId}/following/${resolvedId}`;

  try {
    const res = await xFetch(url, {
      method: 'DELETE',
      headers: { Authorization: buildOAuthHeader('DELETE', url) },
      signal: AbortSignal.timeout(10_000),
    });

    // 404 = already unfollowed, that's fine
    if (!res.ok && res.status !== 404) {
      const body = await res.text();
      return { ok: false, error: parseXApiError(res.status, body) };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Check if we can follow more users today.
 */
export function checkFollowRateLimit(dailyCap: number = 15): { ok: boolean; remaining: number } {
  const state = getState();
  return {
    ok: state.followsToday < dailyCap && state.followsThisMonth < 300,
    remaining: Math.min(dailyCap - state.followsToday, 300 - state.followsThisMonth),
  };
}

/**
 * Get follow stats for dashboard display.
 */
export function getFollowStats(): { today: number; month: number; monthLimit: number } {
  const state = getState();
  return { today: state.followsToday, month: state.followsThisMonth, monthLimit: 300 };
}
