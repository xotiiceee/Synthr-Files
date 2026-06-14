/**
 * Monitor mode — track brand mentions and competitor activity.
 * Scans enabled platforms for mentions, analyzes sentiment, generates alerts.
 */

import { getConfig, getEnabledPlatforms } from '../core/persona.js';
import { loadState, saveState } from '../core/state.js';
import { watchCompetitors, type CompetitorMention } from '../intelligence/competitor-watcher.js';
import { isLLMAvailable, askLLM } from '../core/llm.js';
import type { Platform, BrandMention } from '../platforms/base.js';
import { x } from '../platforms/x.js';
import { reddit } from '../platforms/reddit.js';
import { hackernews } from '../platforms/hackernews.js';
import { producthunt } from '../platforms/producthunt.js';
import { linkedin } from '../platforms/linkedin.js';
import { discord } from '../platforms/discord.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MonitorResult {
  mentions: BrandMention[];
  competitorMentions: CompetitorMention[];
  alerts: string[];
}

interface MonitorState {
  lastRunAt: string;
  seenIds: string[];
  totalMentions: number;
  totalAlerts: number;
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

function buildSearchVariants(brandName: string): string[] {
  const variants = [brandName];
  // Add lowercase if different
  const lower = brandName.toLowerCase();
  if (lower !== brandName) variants.push(lower);
  // Add no-space variant (e.g., "My Brand" -> "mybrand")
  const noSpace = lower.replace(/\s+/g, '');
  if (noSpace !== lower) variants.push(noSpace);
  return variants;
}

// ─── Main ───────────────────────────────────────────────────────────────────

export async function runMonitor(): Promise<MonitorResult> {
  const config = getConfig();
  const state = loadState<MonitorState>('monitor', {
    lastRunAt: '',
    seenIds: [],
    totalMentions: 0,
    totalAlerts: 0,
  });

  const result: MonitorResult = {
    mentions: [],
    competitorMentions: [],
    alerts: [],
  };

  const brandName = config.persona.brandName;
  const keywords = buildSearchVariants(brandName);

  console.log(`Monitoring for: ${keywords.join(', ')}`);

  // Scan each enabled platform
  const enabledNames = getEnabledPlatforms();
  for (const name of enabledNames) {
    const instance = PLATFORM_REGISTRY[name];
    if (!instance || !instance.capabilities.canMonitor) continue;
    if (!instance.isConfigured()) continue;

    console.log(`  Scanning ${name}...`);

    try {
      const mentions = await instance.monitor(keywords);

      // Dedup against seen IDs
      const newMentions = mentions.filter((m) => !state.seenIds.includes(m.id));
      result.mentions.push(...newMentions);

      // Track seen
      for (const m of newMentions) state.seenIds.push(m.id);

      console.log(`  ${name}: ${newMentions.length} new mention(s)`);
    } catch (err) {
      console.log(`  ${name} monitor failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Competitor watching
  if (config.competitors.length > 0) {
    console.log(`Watching competitors: ${config.competitors.join(', ')}`);
    try {
      result.competitorMentions = await watchCompetitors();
      console.log(`  ${result.competitorMentions.length} competitor mention(s)`);
    } catch (err) {
      console.log(`  Competitor watch failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Classify sentiment via LLM (batch up to 10 at a time to save API calls)
  const unknownMentions = result.mentions.filter((m) => m.sentiment === 'unknown');
  if (unknownMentions.length > 0 && (await isLLMAvailable())) {
    const batch = unknownMentions.slice(0, 10);
    const numbered = batch.map((m, i) => `${i + 1}. "${m.text.slice(0, 150)}"`).join('\n');
    const sentimentPrompt = `Classify each text as positive, neutral, or negative. Return ONLY a JSON array of strings like ["positive","neutral","negative",...]. No explanation.\n\n${numbered}`;

    try {
      const raw = await askLLM(sentimentPrompt, { maxTokens: 200, temperature: 0 });
      if (raw) {
        let jsonStr = raw.trim();
        const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (fenceMatch) jsonStr = fenceMatch[1].trim();
        const labels = JSON.parse(jsonStr) as string[];
        for (let i = 0; i < Math.min(labels.length, batch.length); i++) {
          const label = labels[i]?.toLowerCase();
          if (label === 'positive' || label === 'neutral' || label === 'negative') {
            batch[i].sentiment = label;
          }
        }
      }
    } catch {
      // Sentiment classification failed — keep 'unknown', non-critical
    }
  }

  // Generate alerts for negative mentions
  for (const mention of result.mentions) {
    if (mention.sentiment === 'negative') {
      const alert = `[ALERT] Negative mention on ${mention.platform} by @${mention.author}: "${mention.text.slice(0, 100)}..." — ${mention.url}`;
      result.alerts.push(alert);
      console.log(`  ${alert}`);
    }
  }

  // Update state
  // Cap seen IDs at 5000
  if (state.seenIds.length > 5000) {
    state.seenIds = state.seenIds.slice(-5000);
  }
  state.lastRunAt = new Date().toISOString();
  state.totalMentions += result.mentions.length;
  state.totalAlerts += result.alerts.length;
  saveState('monitor', state);

  // Save latest results for dashboard
  saveState('monitor-latest', {
    mentions: result.mentions,
    competitorMentions: result.competitorMentions,
    alerts: result.alerts,
    timestamp: new Date().toISOString(),
  });

  console.log(
    `\nMonitor complete: ${result.mentions.length} mentions, ${result.competitorMentions.length} competitor, ${result.alerts.length} alerts`,
  );
  return result;
}
