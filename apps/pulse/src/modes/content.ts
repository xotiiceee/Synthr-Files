/**
 * Content mode — generate and publish original posts.
 * Creates brand-aligned content across enabled platforms.
 */

import { getConfig, getEnabledPlatforms } from '../core/persona.js';
import { logAction, generateId, loadState, saveState, getTodayKey } from '../core/state.js';
import { generatePost } from '../intelligence/content-generator.js';
import type { Platform } from '../platforms/base.js';
import {
  shouldPostNow,
  recordPostTiming,
  trackOwnPost,
  checkBreakingNews,
} from '../intelligence/human-behavior.js';
import { pickThemeWeighted } from '../intelligence/adaptive-themes.js';
import { getContentHook } from '../intelligence/conversation-hooks.js';
import { x } from '../platforms/x.js';
import { getXWriteClient } from '../platforms/x-write-client.js';
import { reddit } from '../platforms/reddit.js';
import { hackernews } from '../platforms/hackernews.js';
import { producthunt } from '../platforms/producthunt.js';
import { linkedin } from '../platforms/linkedin.js';
import { discord } from '../platforms/discord.js';
import { findBestImage, markAssetUsed, downloadAssetImage } from '../core/asset-library.js';
import { trackPostedItem } from '../intelligence/engagement-monitor.js';
import fs from 'node:fs';
import path from 'node:path';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ContentResult {
  postsGenerated: number;
  postsPublished: number;
  drafts: Array<{ platform: string; text: string }>;
}

interface ContentState {
  dailyCounts: Record<string, number>;
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

// Draft-only platforms — can't auto-post, save for manual publishing
const DRAFT_ONLY = new Set(['linkedin', 'hackernews', 'producthunt']);

// ─── Main ───────────────────────────────────────────────────────────────────

export async function runContent(
  options: { dryRun?: boolean; platforms?: string[] } = {},
): Promise<ContentResult> {
  const config = getConfig();
  const contentState = loadState<ContentState>('content', { dailyCounts: {} });
  const today = getTodayKey();
  const result: ContentResult = {
    postsGenerated: 0,
    postsPublished: 0,
    drafts: [],
  };

  // Check daily content limit
  const todayCount = contentState.dailyCounts[today] ?? 0;
  const limit = config.schedule.contentPostsPerDay;
  if (todayCount >= limit) {
    console.log(`Content limit reached (${todayCount}/${limit}) — skipping.`);
    return result;
  }

  const remaining = limit - todayCount;

  // Human-like timing check — should we post right now?
  if (!options.dryRun) {
    const timing = shouldPostNow();
    if (!timing.shouldPost) {
      const delayMin = Math.round(timing.delayMs / 60_000);
      console.log(`Timing: not posting now (${timing.reason}). Next window in ~${delayMin}m.`);
      return result;
    }
  }

  // Check for breaking news — gets priority over scheduled content
  let breakingHeadline: string | null = null;
  if (!options.dryRun) {
    const news = await checkBreakingNews();
    if (news) {
      console.log(`Breaking news detected: "${news.headline.slice(0, 80)}..."`);
      breakingHeadline = news.headline;
    }
  }

  // Determine platforms
  const enabledNames = options.platforms ?? getEnabledPlatforms();
  const themes = breakingHeadline
    ? [breakingHeadline]
    : (config.contentThemes ?? []).length > 0
      ? config.contentThemes
      : ['general industry insight'];

  let postsThisRun = 0;

  for (const name of enabledNames) {
    if (postsThisRun >= remaining) break;

    const instance = PLATFORM_REGISTRY[name];
    if (!instance) continue;
    if (!instance.isConfigured() && !DRAFT_ONLY.has(name)) continue;

    // Pick a theme — conversation hook (30%) or weighted theme (70%)
    let theme: string;
    let hookUsed = false;
    if (breakingHeadline) {
      theme = themes[0];
    } else if (Math.random() < 0.30) {
      const hook = getContentHook();
      if (hook) {
        theme = hook.contentPrompt;
        hookUsed = true;
        console.log(`  [Hook] Using conversation hook (${hook.hookType}): "${hook.sourceText.slice(0, 60)}..."`);
      } else {
        theme = pickThemeWeighted(themes, postsThisRun);
      }
    } else {
      theme = pickThemeWeighted(themes, postsThisRun);
    }

    console.log(`Generating content for ${name} — ${hookUsed ? 'conversation hook' : `theme: "${theme.slice(0, 60)}"`}`);

    const generated = await generatePost(theme, name);
    if (!generated) {
      console.log(`  Content generation failed for ${name}.`);
      continue;
    }

    const text = generated.text;
    result.postsGenerated++;

    // Draft-only platforms
    if (DRAFT_ONLY.has(name)) {
      result.drafts.push({ platform: name, text });
      console.log(`  [DRAFT] ${name}: ${text.slice(0, 80)}...`);
      console.log(`  Save this draft and post manually on ${name}.`);

      logAction({
        id: generateId(),
        timestamp: new Date().toISOString(),
        platform: name,
        type: 'post',
        topicId: 'content',
        content: `[DRAFT] ${text}`,
        theme,
      });

      postsThisRun++;
      continue;
    }

    if (options.dryRun) {
      console.log(`  [DRY RUN] Would post to ${name}: ${text.slice(0, 80)}...`);
      postsThisRun++;
      continue;
    }

    // Auto-attach image from asset library (X only), tag-based matching
    // Image mode from config: 'auto' (library + generate), 'library' (library only), 'off'
    let mediaIds: string[] | undefined;
    let imageAsset: import('../core/asset-library.js').Asset | null = null;
    if (name === 'x') {
      const imageMode = config.imageMode ?? 'library';
      if (imageMode !== 'off') {
        const imgCtx = generated.imageContext;
        imageAsset = findBestImage({
          tags: imgCtx?.tags,
        });

        // Auto-generate if no library match and mode is 'auto'
        if (!imageAsset && imageMode === 'auto' && imgCtx) {
          try {
            const { generateImage } = await import('../intelligence/image-gen.js');
            const { loadBrandProfile } = await import('../intelligence/brand-profile.js');
            const profile = loadBrandProfile();
            const brandName = profile.identity?.name || config.persona.brandName || '';
            const genPrompt = `Social media image for ${brandName}. Theme: ${imgCtx.tags.join(', ')}. Style should match the brand and topic naturally.`;
            const genResult = await generateImage(genPrompt, {
              model: 'fast',
              tags: imgCtx.tags,
              categories: [generated.type],
              width: 1200,
              height: 675,
            });
            imageAsset = genResult.asset;
            console.log(`  [Media] Auto-generated image: ${genResult.model} (${genResult.creditsUsed} credits)`);
          } catch (err) {
            console.log(`  [Media] Auto-generate failed: ${err instanceof Error ? err.message : err}`);
          }
        }

        if (imageAsset) {
          try {
            const localFile = await downloadAssetImage(imageAsset);
            if (localFile) {
              const { getDataDir } = await import('../core/state.js');
              const fullPath = path.join(getDataDir(), 'assets', localFile);
              const buffer = fs.readFileSync(fullPath);
              const mediaId = await getXWriteClient().uploadMedia(buffer, imageAsset.mimeType || 'image/png');
              if (mediaId) {
                mediaIds = [mediaId];
                markAssetUsed(imageAsset.id);
                console.log(`  [Media] Attached image: ${imageAsset.name} [${imageAsset.tags.slice(0, 3).join(',')}] (used ${imageAsset.usageCount + 1}x)`);
              }
            }
          } catch (err) {
            console.log(`  [Media] Image attach failed: ${err instanceof Error ? err.message : err}`);
          }
        }
      }
    }

    // Publish
    const postResult = await instance.post({ text, type: 'post', mediaIds });
    if (postResult.ok) {
      console.log(`  Published: ${postResult.url ?? name}`);
      result.postsPublished++;
      postsThisRun++;

      // Record timing for human-like cadence
      recordPostTiming();

      // Track own post for engagement loop (reply-to-replies)
      if (postResult.postId) {
        trackOwnPost(postResult.postId, name, text);
      }

      const actionId = generateId();
      logAction({
        id: actionId,
        timestamp: new Date().toISOString(),
        platform: name,
        type: 'post',
        topicId: 'content',
        content: text,
        targetUrl: postResult.url,
        theme,
      });

      // Track for engagement monitoring (checks metrics 4-36h later)
      if (postResult.postId) {
        trackPostedItem({
          actionId,
          postId: postResult.postId,
          platform: name,
          postType: 'post',
          text,
          url: postResult.url,
          topicId: theme,
          contentType: generated.type,
          imageAssetId: imageAsset?.id,
        });
      }
    } else {
      console.log(`  Post failed: ${postResult.error}`);
    }
  }

  // Update daily count
  contentState.dailyCounts[today] = todayCount + postsThisRun;
  // Clean old entries
  const cutoff = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
  for (const date of Object.keys(contentState.dailyCounts)) {
    if (date < cutoff) delete contentState.dailyCounts[date];
  }
  saveState('content', contentState);

  console.log(
    `\nContent complete: ${result.postsGenerated} generated, ${result.postsPublished} published, ${result.drafts.length} drafts`,
  );
  return result;
}
