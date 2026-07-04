/**
 * Outreach mode — find relevant conversations and reply.
 * The core PULSE loop: search → filter → LLM check → reply.
 */

import { getConfig, getEnabledPlatforms } from '../core/persona.js';
import {
  loadOutreachState,
  saveOutreachState,
  logAction,
  getTodayKey,
  generateId,
  type OutreachState,
} from '../core/state.js';
import { isLLMAvailable } from '../core/llm.js';
import { checkRelevance } from '../intelligence/relevance-filter.js';
import { generateReply, generateThreadReply } from '../intelligence/reply-generator.js';
import type { Platform, Conversation } from '../platforms/base.js';
import { recordPostTiming, detectSuspiciousPatterns } from '../intelligence/human-behavior.js';
import { x } from '../platforms/x.js';
import { reddit } from '../platforms/reddit.js';
import { hackernews } from '../platforms/hackernews.js';
import { producthunt } from '../platforms/producthunt.js';
import { linkedin } from '../platforms/linkedin.js';
import { discord } from '../platforms/discord.js';
import { analyzeThread, extractTweetId } from '../intelligence/thread-analyzer.js';
import { isClawNetConfigured } from '../core/clawnet-client.js';
import { getNextAmplifyItem, markAmplifyUsed } from '../core/asset-library.js';
import { trackPostedItem } from '../intelligence/engagement-monitor.js';
import { getXWriteClient, withXWriteUsage } from '../platforms/x-write-client.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DraftReply {
  id: string;
  platform: string;
  targetUrl: string;
  targetText: string;
  targetAuthor: string;
  replyText: string;
  topicId: string;
  createdAt: string;
  /** Thread engagement metadata — present when replying to a comment, not OP */
  threadContext?: {
    rootTweetId: string;
    rootAuthor: string;
    rootText: string;
    targetTweetId: string;
    targetReplyType: string;
    targetAccountLabel: string;
    somaVerified: boolean;
  };
}

export interface OutreachResult {
  repliedCount: number;
  likedCount: number;
  searchedCount: number;
  candidatesFound: number;
  skippedReasons: Record<string, number>;
  drafts: DraftReply[]; // Draft replies for review (default mode)
}

// ─── Platform Registry ──────────────────────────────────────────────────────

const PLATFORM_REGISTRY: Record<string, Platform> = {
  x,
  reddit,
  hackernews,
  producthunt,
  linkedin,
  discord,
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function getDailyCount(state: OutreachState): number {
  return state.dailyCounts[getTodayKey()] ?? 0;
}

function getTotalDailyLimit(): number {
  const config = getConfig();
  return Object.values(config.platforms)
    .filter((p) => p.enabled)
    .reduce((sum, p) => sum + p.maxPerDay, 0);
}

// ─── Main ───────────────────────────────────────────────────────────────────

/**
 * Run outreach — find relevant conversations and generate reply drafts.
 *
 * DEFAULT: Draft mode — finds conversations, generates replies, saves as drafts for review.
 * --auto: Auto-post mode — actually posts replies (use with caution).
 *
 * WARNING: Some platforms (notably X/Twitter) restrict unsolicited automated replies.
 * Auto-posting may result in reduced visibility, rate limiting, or account suspension.
 * Draft mode is recommended — review and post manually for safety.
 */
export async function runOutreach(
  options: {
    dryRun?: boolean;
    autoPost?: boolean;
    platforms?: string[];
    xWriteOperationIdPrefix?: string;
  } = {},
): Promise<OutreachResult> {
  const config = getConfig();
  const state = loadOutreachState();
  const today = getTodayKey();
  const result: OutreachResult = {
    repliedCount: 0,
    likedCount: 0,
    searchedCount: 0,
    candidatesFound: 0,
    skippedReasons: {},
    drafts: [],
  };

  const skip = (reason: string) => {
    result.skippedReasons[reason] = (result.skippedReasons[reason] ?? 0) + 1;
  };
  const buildXWriteOperationId = (
    ...parts: Array<string | number | undefined | null>
  ) => {
    if (!options.xWriteOperationIdPrefix) return undefined;
    const suffix = parts
      .filter((part) => part !== undefined && part !== null && String(part).trim())
      .map((part) => String(part).replace(/[:\s]+/g, '_'));
    return [options.xWriteOperationIdPrefix, ...suffix].join(':');
  };

  // Check global daily limit
  const dailyCount = getDailyCount(state);
  const dailyLimit = getTotalDailyLimit();
  if (dailyCount >= dailyLimit) {
    console.log(`Daily limit reached (${dailyCount}/${dailyLimit}) — skipping outreach.`);
    return result;
  }

  // Determine which platforms to run
  const enabledNames = options.platforms ?? getEnabledPlatforms();
  const platforms: Array<{ name: string; instance: Platform }> = [];
  for (const name of enabledNames) {
    const instance = PLATFORM_REGISTRY[name];
    if (!instance) {
      console.log(`  Unknown platform: ${name} — skipping.`);
      continue;
    }
    if (!instance.isConfigured()) {
      console.log(`  ${name} not configured — skipping.`);
      continue;
    }
    platforms.push({ name, instance });
  }

  if (platforms.length === 0) {
    console.log('No configured platforms available.');
    return result;
  }

  // Check LLM availability
  const llmAvailable = await isLLMAvailable();

  // For each platform, pick random topics and search
  for (const { name, instance } of platforms) {
    const platformSettings = config.platforms[name];
    if (!platformSettings) continue;

    const platformMaxPerRun = platformSettings.maxPerRun;
    let platformReplies = 0;

    // Pick up to 6 random topics for this run (better coverage across 15+ topics)
    const platformTopics = config.topics.filter(
      (t) => !t.platform || t.platform === name,
    );
    const selectedTopics = shuffle(platformTopics).slice(0, 6);

    for (const topic of selectedTopics) {
      if (platformReplies >= platformMaxPerRun) break;
      if (getDailyCount(state) >= dailyLimit) break;

      console.log(`Searching [${topic.id}] on ${name}: "${topic.query}"`);
      result.searchedCount++;

      let conversations: Conversation[];
      try {
        conversations = await instance.search(topic.query, topic.id);
      } catch (err) {
        console.log(`  Search failed: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }

      // Pre-filter candidates
      const candidates = conversations.filter((c) => {
        // Dedup
        if (state.repliedIds.includes(c.id)) {
          skip('already_replied');
          return false;
        }
        // Minimum text length
        if (!c.text || c.text.length < 30) {
          skip('too_short');
          return false;
        }
        // Keyword matching
        if (topic.textMustMatch && topic.textMustMatch.length > 0) {
          const lower = c.text.toLowerCase();
          const match = topic.textMustMatch.some((kw) => lower.includes(kw.toLowerCase()));
          if (!match) {
            skip('keyword_mismatch');
            return false;
          }
        }
        return true;
      });

      result.candidatesFound += candidates.length;

      // Sort by engagement (higher = more visibility)
      candidates.sort(
        (a, b) =>
          b.engagement.likes + b.engagement.replies - (a.engagement.likes + a.engagement.replies),
      );

      // Try top 3 candidates per topic (don't give up after 1 rejection)
      let target: typeof candidates[0] | null = null;
      for (const candidate of candidates.slice(0, 3)) {
        if (llmAvailable) {
          const relevance = await checkRelevance(candidate, name);
          if (!relevance.relevant) {
            skip('irrelevant');
            console.log(`  Skipped (irrelevant): ${candidate.text.slice(0, 60)}...`);
            continue;
          }
        }
        target = candidate;
        break;
      }
      if (!target) continue;

      // ── Amplification Check ─────────────────────────────────────────────
      // If there's an active amplify item and this is X, consider quote-tweeting
      // the amplify link instead of replying. Only does this ~30% of the time to
      // keep the feed natural (not every reply is a boost).
      if (name === 'x' && Math.random() < 0.30) {
        const amplifyItem = getNextAmplifyItem();
        if (amplifyItem) {
          const amplifyReply = await generateReply(
            { ...target, text: target.text + `\n\nRelated: ${amplifyItem.tweetText.slice(0, 100)}` },
            name,
          );
          if (amplifyReply) {
            const draft: DraftReply = {
              id: generateId(),
              platform: name,
              targetUrl: target.url,
              targetText: `[Amplify] ${target.text.slice(0, 200)}`,
              targetAuthor: target.author,
              replyText: amplifyReply,
              topicId: topic.id,
              createdAt: new Date().toISOString(),
              threadContext: undefined,
            };
            // In auto mode, quote-tweet the amplify link
            if (options.autoPost) {
              const quoteTweetId = amplifyItem.tweetUrl.match(/status\/(\d+)/)?.[1];
              const postContent = {
                text: amplifyReply,
                type: 'post',
                metadata: { quoteTweetId },
              } as const;
              const operationId = buildXWriteOperationId('amplify', target.id, amplifyItem.id);
              const postResult = name === 'x' && operationId
                ? await getXWriteClient().post(
                    withXWriteUsage(postContent, {
                      operationId,
                      metadata: {
                        source: 'outreach',
                        platform: name,
                        topicId: topic.id,
                        targetId: target.id,
                        amplifyItemId: amplifyItem.id,
                      },
                    }),
                  )
                : await instance.post(postContent);
              if (postResult.ok) {
                markAmplifyUsed(amplifyItem.id);
                recordPostTiming();
                state.repliedIds.push(target.id);
                state.dailyCounts[today] = (state.dailyCounts[today] ?? 0) + 1;
                result.repliedCount++;
                console.log(`  [Amplify] Quote-tweeted: ${postResult.url}`);
                continue;
              }
            } else {
              // Draft mode — save for review
              draft.replyText = `${amplifyReply}\n\n[Would quote-tweet: ${amplifyItem.tweetUrl}]`;
              result.drafts.push(draft);
              markAmplifyUsed(amplifyItem.id);
              result.repliedCount++;
              state.repliedIds.push(target.id);
              console.log(`  [DRAFT] Amplify saved: ${amplifyItem.tweetUrl.slice(0, 60)}`);
              continue;
            }
          }
        }
      }

      // ── Thread-Aware Engagement (X/Twitter + ClawNet) ─────────────────
      // If ClawNet is configured and this is an X post with enough engagement,
      // analyze the reply thread and target the best comment instead of OP.
      const tweetId = name === 'x' ? extractTweetId(target.url) : null;
      const useThreadEngagement = tweetId
        && isClawNetConfigured()
        && (target.engagement.replies >= 3 || target.engagement.likes >= 10);

      let replyText: string | null = null;
      let threadDraft: DraftReply['threadContext'] | undefined;

      if (useThreadEngagement && tweetId) {
        console.log(`  [Thread] Analyzing ${target.engagement.replies} replies for thread riding...`);
        const thread = await analyzeThread(
          tweetId,
          target.author,
          target.text,
          1, // pick best single target
          config.persona.xHandle,
        );

        if (thread.targets.length > 0) {
          const threadTarget = thread.targets[0];
          console.log(`  [Thread] Target: @${threadTarget.author} (${threadTarget.replyType}, score ${threadTarget.overallScore}) — ${threadTarget.reason}`);

          replyText = await generateThreadReply(thread, threadTarget, name);

          if (replyText) {
            // Override the reply target — we're replying to the comment, not OP
            threadDraft = {
              rootTweetId: tweetId,
              rootAuthor: target.author,
              rootText: target.text.slice(0, 200),
              targetTweetId: threadTarget.tweetId,
              targetReplyType: threadTarget.replyType,
              targetAccountLabel: threadTarget.accountScore.label,
              somaVerified: !!thread.provenance,
            };
          }
        } else {
          console.log(`  [Thread] No quality targets in thread — falling back to OP reply`);
        }
      }

      // Fallback to standard OP reply if thread analysis didn't produce a reply
      if (!replyText) {
        replyText = await generateReply(target, name);
      }

      if (!replyText) {
        skip('reply_generation_failed');
        continue;
      }

      if (options.dryRun) {
        console.log(`  [DRY RUN] Would reply to ${threadDraft ? `@${threadDraft.rootAuthor}'s thread (targeting comment)` : target.url}`);
        console.log(`  Reply: ${replyText.slice(0, 120)}...`);
        result.repliedCount++;
        continue;
      }

      // Default: DRAFT MODE — save reply for manual review
      if (!options.autoPost) {
        const draft: DraftReply = {
          id: generateId(),
          platform: name,
          targetUrl: target.url,
          targetText: threadDraft ? `[Thread reply to @${target.author}] ${target.text.slice(0, 200)}` : target.text.slice(0, 300),
          targetAuthor: target.author,
          replyText,
          topicId: topic.id,
          createdAt: new Date().toISOString(),
          threadContext: threadDraft,
        };
        result.drafts.push(draft);
        if (threadDraft) {
          console.log(`  [DRAFT] Thread reply saved for review:`);
          console.log(`    Thread by: @${threadDraft.rootAuthor}`);
          console.log(`    Replying to comment: ${threadDraft.targetReplyType} (${threadDraft.targetAccountLabel})`);
          console.log(`    Soma verified: ${threadDraft.somaVerified ? 'yes' : 'no'}`);
        } else {
          console.log(`  [DRAFT] Reply saved for review:`);
          console.log(`    To: ${target.text.slice(0, 80)}...`);
        }
        console.log(`    Reply: ${replyText.slice(0, 120)}...`);
        console.log(`    URL: ${target.url}`);
        result.repliedCount++;
        state.repliedIds.push(target.id);
        continue;
      }

      // AUTO MODE — actually post (opt-in, with risk)
      // Like + reply
      try {
        const operationId = buildXWriteOperationId('like', target.id, topic.id);
        if (name === 'x' && operationId) {
          await getXWriteClient().like(target.id, {
            operationId,
            metadata: {
              source: 'outreach',
              platform: name,
              topicId: topic.id,
              targetId: target.id,
            },
          });
        } else {
          await instance.like(target.id);
        }
      } catch {
        // Like failure is non-critical
      }

      // If thread engagement, reply to the specific comment tweet ID
      const replyTarget = threadDraft
        ? { ...target, id: threadDraft.targetTweetId }
        : target;

      const operationId = buildXWriteOperationId(
        threadDraft ? 'thread_reply' : 'reply',
        replyTarget.id,
        topic.id,
      );
      const postResult = name === 'x' && operationId
        ? await getXWriteClient().reply(
            withXWriteUsage(replyTarget, {
              operationId,
              metadata: {
                source: 'outreach',
                platform: name,
                topicId: topic.id,
                targetId: replyTarget.id,
                rootTargetId: target.id,
                threadReply: Boolean(threadDraft),
              },
            }),
            replyText,
          )
        : await instance.reply(replyTarget, replyText);
      if (postResult.ok) {
        console.log(`  Replied${threadDraft ? ' (thread)' : ''}: ${postResult.url ?? target.url}`);
        result.repliedCount++;
        platformReplies++;

        // Record timing for human-like cadence
        recordPostTiming();

        // Check for suspicious patterns after posting
        const warnings = detectSuspiciousPatterns();
        for (const w of warnings) {
          console.log(`  [Anti-detect] ${w}`);
        }

        // Update state
        state.repliedIds.push(target.id);
        if (threadDraft) state.repliedIds.push(threadDraft.targetTweetId);
        state.dailyCounts[today] = (state.dailyCounts[today] ?? 0) + 1;
        state.totalReplies++;

        // Log action + track for engagement feedback
        const actionId = generateId();
        logAction({
          id: actionId,
          timestamp: new Date().toISOString(),
          platform: name,
          type: threadDraft ? 'thread-reply' : 'reply',
          topicId: topic.id,
          content: replyText,
          targetText: target.text,
          targetUrl: target.url,
        });

        // Track for engagement monitoring (checks metrics 4-36h later)
        if (postResult.postId) {
          trackPostedItem({
            actionId,
            postId: postResult.postId,
            platform: name,
            postType: threadDraft ? 'thread-reply' : 'reply',
            text: replyText,
            url: postResult.url,
            topicId: topic.id,
          });
        }
      } else {
        // Reply failed (likely X API tier restriction) — the like still went through
        result.likedCount++;
        console.log(`  Reply failed: ${postResult.error} — liked instead, saving draft for manual post`);
        // Still mark as interacted so we don't retry
        state.repliedIds.push(target.id);

        // Save as draft so user can post manually via X intent URL
        result.drafts.push({
          id: generateId(),
          platform: name,
          targetUrl: target.url,
          targetText: target.text,
          targetAuthor: target.author,
          replyText,
          topicId: topic.id,
          createdAt: new Date().toISOString(),
        });

        logAction({
          id: generateId(),
          timestamp: new Date().toISOString(),
          platform: name,
          type: 'like',
          topicId: topic.id,
          content: `Liked + draft reply: ${replyText.slice(0, 100)}`,
          targetUrl: target.url,
        });
      }
    }
  }

  // Save drafts to file for review
  if (result.drafts.length > 0 && !options.dryRun) {
    const { loadState: loadDrafts, saveState: saveDrafts } = await import('../core/state.js');
    const existing = loadDrafts<DraftReply[]>('outreach-drafts', []);
    const allDrafts = [...existing, ...result.drafts];
    if (allDrafts.length > 200) allDrafts.splice(0, allDrafts.length - 200);
    saveDrafts('outreach-drafts', allDrafts);
    console.log(`\n  ${result.drafts.length} draft replies saved to data/outreach-drafts.json`);
    console.log('  Review and post manually, or re-run with --auto to auto-post.');
  }

  // Auto-post warning
  if (options.autoPost) {
    console.log('\n  ⚠ AUTO-POST MODE — replies were posted automatically.');
    console.log('  Some platforms (X, Reddit) may flag automated replies.');
    console.log('  Consider using draft mode (default) for safer operation.');
  }

  // Finalize
  state.lastRunAt = new Date().toISOString();
  state.totalSearches += result.searchedCount;
  saveOutreachState(state);

  console.log(
    `\nOutreach complete: ${result.repliedCount} ${options.autoPost ? 'replies posted' : 'drafts generated'}, ${result.searchedCount} searches, ${result.candidatesFound} candidates`,
  );
  return result;
}
