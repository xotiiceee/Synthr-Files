/**
 * Follow-Up Intelligence — detect warm leads and suggest re-engagement.
 *
 * Scans the CRM for leads who showed interest (replied to us, liked our reply)
 * and haven't been contacted in 3-7 days. Generates follow-up suggestions.
 *
 * The highest-value activity on X isn't cold outreach — it's warming up
 * people who already showed interest. One follow-up to a warm lead is worth
 * 20 cold replies.
 */

// CRM imports (graceful fallback if CRM not available)
let crmAvailable = false;
let listLeads: ((options: any) => any[]) | undefined;
let getInteractionsForLead: ((leadId: number, limit?: number) => any[]) | undefined;
let createFollowUp: ((data: any) => void) | undefined;
let getPendingFollowUps: ((leadId?: number) => any[]) | undefined;

try {
  const leads = await import('../crm/leads.js');
  const interactions = await import('../crm/interactions.js');
  listLeads = leads.listLeads;
  getInteractionsForLead = interactions.getInteractionsForLead;
  createFollowUp = interactions.createFollowUp;
  getPendingFollowUps = interactions.getPendingFollowUps;
  crmAvailable = true;
} catch { /* CRM not available */ }

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FollowUpSuggestion {
  leadId: number;
  username: string;
  platform: string;
  /** Why this person is worth following up with */
  reason: string;
  /** What kind of follow-up to do */
  action: 'reply_to_their_post' | 'engage_with_content' | 'continue_conversation';
  /** How warm is this lead (0-100) */
  warmth: number;
  /** Days since last interaction */
  daysSinceLastContact: number;
  /** Number of prior interactions */
  interactionCount: number;
  /** Their last message to us (if any) */
  lastTheirContent?: string;
}

// ─── Core Logic ─────────────────────────────────────────────────────────────

/**
 * Scan CRM for warm leads that are ripe for follow-up.
 *
 * A "warm lead" is someone who:
 * - Has interacted with us at least once
 * - Showed positive signals (replied, liked)
 * - Hasn't been contacted in 3-7 days (sweet spot — not stalking, not forgotten)
 */
export function findFollowUpCandidates(): FollowUpSuggestion[] {
  if (!crmAvailable || !listLeads || !getInteractionsForLead) return [];

  const suggestions: FollowUpSuggestion[] = [];
  const now = Date.now();
  const MIN_GAP_DAYS = 3;
  const MAX_GAP_DAYS = 14;

  try {
    const leads = listLeads({ limit: 100, sortBy: 'score' });

    for (const lead of leads) {
      // Skip leads with no interactions
      if (!lead.interaction_count || lead.interaction_count < 1) continue;

      // Skip leads we're already following up with
      if (getPendingFollowUps) {
        const pending = getPendingFollowUps(lead.id);
        if (pending.length > 0) continue;
      }

      // Calculate days since last interaction
      const lastInteraction = lead.last_interaction_at
        ? new Date(lead.last_interaction_at).getTime()
        : 0;
      if (!lastInteraction) continue;

      const daysSince = (now - lastInteraction) / (24 * 3600_000);

      // Sweet spot: 3-14 days since last contact
      if (daysSince < MIN_GAP_DAYS || daysSince > MAX_GAP_DAYS) continue;

      // Get their interactions to assess warmth
      const interactions = getInteractionsForLead(lead.id, 10);
      if (interactions.length === 0) continue;

      // Calculate warmth signals
      const theyReplied = interactions.some((i: any) => i.type === 'reply_received' || i.their_content);
      const theyLiked = interactions.some((i: any) => i.type === 'like_received');
      const multipleInteractions = interactions.length >= 2;
      const recentInteraction = daysSince < 7;

      let warmth = lead.score ?? 0;
      if (theyReplied) warmth += 25;
      if (theyLiked) warmth += 10;
      if (multipleInteractions) warmth += 15;
      if (recentInteraction) warmth += 10;
      warmth = Math.min(100, warmth);

      // Only suggest leads with warmth >= 30
      if (warmth < 30) continue;

      // Determine the best follow-up action
      let action: FollowUpSuggestion['action'] = 'engage_with_content';
      let reason = '';

      if (theyReplied) {
        action = 'continue_conversation';
        reason = `replied to you ${Math.round(daysSince)} days ago — conversation worth continuing`;
      } else if (theyLiked && multipleInteractions) {
        action = 'reply_to_their_post';
        reason = `engaged ${interactions.length} times, liked your content — find their latest post and reply`;
      } else if (multipleInteractions) {
        action = 'engage_with_content';
        reason = `${interactions.length} interactions over time — like or reply to something they posted`;
      } else {
        reason = `showed interest ${Math.round(daysSince)} days ago — worth a natural follow-up`;
      }

      // Get their last message
      const theirLastMessage = interactions.find((i: any) => i.their_content);

      suggestions.push({
        leadId: lead.id,
        username: lead.username || lead.platform_id || 'unknown',
        platform: lead.platform,
        reason,
        action,
        warmth,
        daysSinceLastContact: Math.round(daysSince),
        interactionCount: interactions.length,
        lastTheirContent: theirLastMessage?.their_content?.slice(0, 200),
      });
    }
  } catch (err) {
    console.error(`[FollowUp] Error scanning leads: ${err instanceof Error ? err.message : err}`);
  }

  // Sort by warmth (highest first)
  suggestions.sort((a, b) => b.warmth - a.warmth);

  // Return top 10
  return suggestions.slice(0, 10);
}

/**
 * Create a CRM follow-up task for a suggested lead.
 */
export function scheduleFollowUp(suggestion: FollowUpSuggestion, message?: string): void {
  if (!crmAvailable || !createFollowUp) return;

  createFollowUp({
    leadId: suggestion.leadId,
    platform: suggestion.platform,
    action: suggestion.action,
    message: message || suggestion.reason,
    dueAt: new Date(Date.now() + 24 * 3600_000).toISOString(), // Due tomorrow
    status: 'pending',
  });
}

/**
 * Get a summary of follow-up opportunities.
 */
export function getFollowUpSummary(): {
  totalWarmLeads: number;
  readyForFollowUp: number;
  topSuggestions: FollowUpSuggestion[];
} {
  const suggestions = findFollowUpCandidates();
  return {
    totalWarmLeads: suggestions.length,
    readyForFollowUp: suggestions.filter(s => s.warmth >= 50).length,
    topSuggestions: suggestions.slice(0, 5),
  };
}
