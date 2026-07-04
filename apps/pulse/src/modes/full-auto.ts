/**
 * Full-auto mode — orchestrates all PULSE modes on schedule.
 * Checks which tasks are due and runs them in priority order.
 */

import { getDueTasks, markTaskComplete, type TaskType } from '../core/scheduler.js';
import { runOutreach, type OutreachResult } from './outreach.js';
import { runContent, type ContentResult } from './content.js';
import { runMonitor, type MonitorResult } from './monitor.js';
import { runAdaptation, type AdaptationReport } from '../intelligence/adaptation.js';
import { adaptThemes, shouldAdaptThemes, type ThemeAdaptationResult } from '../intelligence/adaptive-themes.js';
import {
  detectMentions,
  processPendingMentions,
} from '../intelligence/mention-detector.js';
import {
  getPostsNeedingEngagement,
} from '../intelligence/human-behavior.js';
import { runAutopost, publishApproved, type AutopostResult } from './autopost.js';
import { expireOldItems } from '../intelligence/approval-queue.js';
import { discoverOpportunities, autoEngageOpportunities } from '../core/opportunity-engine.js';
import { getConfig } from '../core/persona.js';
import { checkEngagement, getMonitorStats } from '../intelligence/engagement-monitor.js';
import { getFollowUpSummary } from '../intelligence/follow-up-engine.js';

// ─── Main ───────────────────────────────────────────────────────────────────

export async function runFullAuto(options: { dryRun?: boolean; autoPost?: boolean } = {}): Promise<void> {
  // Check emergency pause flag
  const { loadState } = await import('../core/state.js');
  const control = loadState('pulse-control', { paused: false });
  if (control.paused) {
    console.log('[Pulse] Paused via emergency stop. Run: npm run resume');
    return;
  }

  const dueTasks = getDueTasks();

  if (dueTasks.length === 0) {
    console.log('No tasks due — all caught up.');
    return;
  }

  console.log(`Tasks due: ${dueTasks.join(', ')}\n`);

  const results: Record<string, unknown> = {};

  // Run in priority order: discovery → outreach → content → monitor → adaptation
  const order: TaskType[] = ['discovery', 'outreach', 'content', 'monitor', 'adaptation'];

  for (const task of order) {
    if (!dueTasks.includes(task)) continue;

    const startTime = Date.now();
    console.log(`\n${'═'.repeat(50)}`);
    console.log(`  Running: ${task.toUpperCase()}`);
    console.log(`${'═'.repeat(50)}\n`);

    try {
      switch (task) {
        case 'discovery': {
          const opportunities = await discoverOpportunities();
          results.discovery = { found: opportunities.length };
          console.log(`  Found ${opportunities.length} new opportunities`);
          break;
        }
        case 'outreach': {
          const outreachResult: OutreachResult = await runOutreach({
            dryRun: options.dryRun,
            autoPost: options.autoPost,
          });
          results.outreach = outreachResult;
          break;
        }
        case 'content': {
          const contentResult: ContentResult = await runContent({
            dryRun: options.dryRun,
          });
          results.content = contentResult;
          break;
        }
        case 'monitor': {
          const monitorResult: MonitorResult = await runMonitor();
          results.monitor = monitorResult;
          break;
        }
        case 'adaptation': {
          const adaptResult: AdaptationReport = await runAdaptation();
          results.adaptation = adaptResult;

          // Run theme adaptation alongside topic adaptation
          if (shouldAdaptThemes()) {
            const themeResult: ThemeAdaptationResult = await adaptThemes();
            results.themeAdaptation = themeResult;
            console.log(`  Themes: +${themeResult.newThemes.length} new, -${themeResult.retiredThemes.length} retired`);
          }
          break;
        }
      }

      markTaskComplete(task);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`\n  ${task} completed in ${elapsed}s`);
    } catch (err) {
      console.error(`  ${task} FAILED: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Run autopost content generation + approval publishing (always, not task-gated)
  // Skip generation if content task already ran this cycle to prevent double-posting
  const contentAlreadyRan = !!results.content;
  try {
    console.log(`\n${'─'.repeat(50)}`);
    console.log('  Running: AUTO-POST CONTENT');
    console.log(`${'─'.repeat(50)}\n`);

    // Clean expired drafts from approval queue
    expireOldItems();

    let autopostGenerated = 0;
    let autopostQueued = 0;
    let autopostPublished = 0;

    if (contentAlreadyRan) {
      console.log('  Content task already ran this cycle — skipping autopost generation to avoid double-posting.');
    } else {
      // Generate new autopost content
      const autopostResult: AutopostResult = await runAutopost({ dryRun: options.dryRun });
      autopostGenerated = autopostResult.generated;
      autopostQueued = autopostResult.queued;
      autopostPublished = autopostResult.published;
      console.log(`  Generated ${autopostGenerated} post(s), ${autopostQueued} queued`);

      if (autopostResult.category) {
        console.log(`    [${autopostResult.category}] ${autopostResult.platform} (entry: ${autopostResult.entryId ?? 'none'})`);
      }
    }

    // Always publish approved items from the queue (even if generation was skipped)
    if (!options.dryRun) {
      const publishResult = await publishApproved();
      autopostPublished += publishResult.published;
      if (publishResult.published > 0) {
        console.log(`  Published ${publishResult.published} approved post(s)`);
      }
    }

    results.autopost = {
      generated: autopostGenerated,
      queued: autopostQueued,
      published: autopostPublished,
    };
  } catch (err) {
    console.error(`  Autopost FAILED: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Run mention detection + engagement loop (always, not task-gated)
  try {
    console.log(`\n${'─'.repeat(50)}`);
    console.log('  Running: MENTION DETECTION + ENGAGEMENT LOOP');
    console.log(`${'─'.repeat(50)}\n`);

    // Detect new brand mentions
    const newMentions = await detectMentions();
    if (newMentions.length > 0) {
      console.log(`  Found ${newMentions.length} new mention(s)`);
    }

    // Process pending mention replies (timing-delayed)
    const readyMentions = await processPendingMentions();
    if (readyMentions.length > 0) {
      console.log(`  ${readyMentions.length} mention reply(s) ready to send`);
    }
    results.mentions = { detected: newMentions.length, readyToReply: readyMentions.length };

    // Check engagement loop — replies to our own posts
    const postsNeedingEngagement = getPostsNeedingEngagement();
    if (postsNeedingEngagement.length > 0) {
      console.log(`  ${postsNeedingEngagement.length} own post(s) being monitored for replies`);
    }
    results.engagement = { trackedPosts: postsNeedingEngagement.length };

    // Run opportunity discovery (always — feeds the engage panel)
    const discoveredOpps = await discoverOpportunities();
    if (discoveredOpps.length > 0) {
      console.log(`  ${discoveredOpps.length} new opportunity(ies) discovered`);
    }

    // If auto-engage is enabled, use learned preferences to auto-reply
    const config = getConfig();
    if (config.autopost?.approvalMode === 'auto_all') {
      const engageResult = await autoEngageOpportunities({ maxReplies: 5 });
      console.log(`  Auto-engage: ${engageResult.replied} replied, ${engageResult.skipped} skipped`);
      results.opportunities = {
        discovered: discoveredOpps.length,
        autoReplied: engageResult.replied,
        autoSkipped: engageResult.skipped,
      };
    } else {
      results.opportunities = { discovered: discoveredOpps.length, autoReplied: 0, autoSkipped: 0 };
    }
  } catch (err) {
    console.error(`  Mentions/Engagement FAILED: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Run engagement feedback loop (check how posted content is performing)
  try {
    const engResult = await checkEngagement();
    if (engResult.checked > 0) {
      console.log(`\n  [Feedback] Checked ${engResult.checked} posts: ${engResult.updated} updated, ${engResult.highPerformers} high performers`);
    }
    const monStats = getMonitorStats();
    results.feedback = { ...engResult, tracking: monStats.tracking, avgScore: monStats.avgScore };
  } catch (err) {
    console.error(`  Engagement feedback FAILED: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Run follow-up intelligence (suggest warm lead re-engagement)
  try {
    const followUp = getFollowUpSummary();
    if (followUp.readyForFollowUp > 0) {
      console.log(`\n  [Follow-up] ${followUp.readyForFollowUp} warm leads ready for follow-up:`);
      for (const s of followUp.topSuggestions.slice(0, 3)) {
        console.log(`    @${s.username} (${s.warmth}/100) — ${s.reason}`);
      }
    }
    results.followUp = followUp;
  } catch (err) {
    console.error(`  Follow-up scan FAILED: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Summary
  console.log(`\n${'═'.repeat(50)}`);
  console.log('  FULL-AUTO SUMMARY');
  console.log(`${'═'.repeat(50)}`);

  if (results.outreach) {
    const o = results.outreach as OutreachResult;
    console.log(`  Outreach:  ${o.repliedCount} replies / ${o.searchedCount} searches`);
  }
  if (results.content) {
    const c = results.content as ContentResult;
    console.log(`  Content:   ${c.postsPublished} published / ${c.drafts.length} drafts`);
  }
  if (results.monitor) {
    const m = results.monitor as MonitorResult;
    console.log(`  Monitor:   ${m.mentions.length} mentions / ${m.alerts.length} alerts`);
  }
  if (results.adaptation) {
    const a = results.adaptation as AdaptationReport;
    console.log(`  Adapt:     ${a.retiredTopics.length} retired / ${a.newTopics.length} new topics`);
  }
  if (results.themeAdaptation) {
    const t = results.themeAdaptation as ThemeAdaptationResult;
    console.log(`  Themes:    +${t.newThemes.length} expanded / -${t.retiredThemes.length} retired`);
  }
  if (results.autopost) {
    const ap = results.autopost as { generated: number; queued: number; published: number };
    console.log(`  Autopost:  ${ap.generated} generated / ${ap.queued} queued / ${ap.published} published`);
  }
  if (results.mentions) {
    const mn = results.mentions as { detected: number; readyToReply: number };
    console.log(`  Mentions:  ${mn.detected} detected / ${mn.readyToReply} replies queued`);
  }
  if (results.engagement) {
    const e = results.engagement as { trackedPosts: number };
    console.log(`  Engage:    ${e.trackedPosts} posts monitored for replies`);
  }
  if (results.opportunities) {
    const op = results.opportunities as { discovered: number; autoReplied: number; autoSkipped: number };
    console.log(`  Opps:      ${op.discovered} discovered / ${op.autoReplied} auto-replied / ${op.autoSkipped} auto-skipped`);
  }

  console.log(`${'═'.repeat(50)}\n`);
}
