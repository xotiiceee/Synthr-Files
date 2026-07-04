/**
 * Unfollow Cron — runs daily, unfollows accounts that haven't followed back.
 * Max 5 unfollows per run to avoid rate limits.
 */

import { loadState, saveState } from "./state.js";
import { getConfig } from "./persona.js";
import { getFollowChurnExecutionDecision } from "./follow-engine.js";
import { xUnfollow } from "../platforms/x-follow.js";

interface FollowRecord {
  username: string;
  platformId: string;
  signal: string;
  confidence: number;
  followedAt: string;
  unfollowAt: string | null;
  status: "active" | "unfollowed";
}

export async function runUnfollowCron(): Promise<{ unfollowed: number }> {
  const gate = getFollowChurnExecutionDecision(getConfig() as any);
  if (!gate.allowed) return { unfollowed: 0 };

  const state = loadState<{ records: FollowRecord[]; kols: string[] }>(
    "follow-engine",
    { records: [], kols: [] },
  );
  const now = new Date();
  let unfollowed = 0;

  for (const record of state.records) {
    if (unfollowed >= 5) break;
    if (record.status !== "active") continue;
    if (!record.unfollowAt) continue;
    if (new Date(record.unfollowAt) > now) continue;

    // Don't unfollow KOLs
    if (state.kols.includes(record.username)) continue;

    const result = await xUnfollow(record.platformId);
    if (result.ok) {
      record.status = "unfollowed";
      unfollowed++;
      const days = Math.round(
        (now.getTime() - new Date(record.followedAt).getTime()) / 86400000,
      );
      console.log(
        `  [Unfollow] Unfollowed @${record.username} (no follow-back after ${days} days)`,
      );
    }

    // Rate limit gap between unfollows
    await new Promise((r) => setTimeout(r, 2000));
  }

  if (unfollowed > 0) saveState("follow-engine", state);
  return { unfollowed };
}
