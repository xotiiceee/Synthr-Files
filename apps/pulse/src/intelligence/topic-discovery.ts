/**
 * Topic Discovery — uses LLM to generate intelligent search topics.
 *
 * Instead of dumb regex extraction, asks the LLM:
 * "Given this brand and its knowledge, what conversations on X
 *  would they want to engage with?"
 *
 * Produces search queries that find real discussions, not brand-specific terms.
 * Runs once on first setup, then refreshes weekly with niche trends.
 */

import { askLLM } from '../core/llm.js';
import { loadState } from '../core/state.js';
import { currentRuntimeAgentId as currentAgentId } from '../core/runtime-agent-state.js';
import { loadBrandProfile } from './brand-profile.js';
import { getDataDir } from '../core/state.js';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

/**
 * Generate intelligent search topics using LLM.
 * Reads knowledge notes + brand profile, asks LLM what conversations to join.
 * Writes results to pulse.yaml topics array.
 *
 * Cost: ~0.5 credits (one Llama call)
 */
export async function discoverSearchTopics(agentId?: string): Promise<string[]> {
  const profile = loadBrandProfile(agentId);
  const aid = agentId || currentAgentId();

  // Load knowledge notes for context
  let notes = loadState<Array<{ title: string; content: string }>>(`knowledge-notes-${aid}`, []);
  if (notes.length === 0) notes = loadState(`knowledge-notes`, []);

  if (notes.length === 0 && !profile.identity.name) {
    console.log('[TopicDiscovery] No knowledge notes or brand name — skipping');
    return [];
  }

  // Build context summary from notes (truncated to fit in one call)
  const notesSummary = notes.slice(0, 5).map(n => `${n.title}: ${n.content.slice(0, 200)}`).join('\n');

  const prompt = `You are helping a brand find conversations to engage with on X (Twitter).

Brand: ${profile.identity.name || 'Unknown'}
${profile.identity.description ? `Description: ${profile.identity.description.slice(0, 300)}` : ''}
${profile.stance ? `Stance: ${profile.stance}` : ''}

Brand knowledge:
${notesSummary}

Generate 8 X/Twitter search queries that would find conversations this brand should engage with. These should be:
- Topics people ACTUALLY discuss on X (not brand-specific jargon)
- Broad enough to find multiple conversations daily
- Related to the brand's space but not about the brand itself
- Mix of technical discussions, pain points, and trending topics

Return ONLY a JSON array of strings. No explanation, no markdown. Just the array.
Example: ["AI agent infrastructure", "API rate limiting solutions", "USDC payments crypto"]`;

  const response = await askLLM(prompt, { maxTokens: 300, temperature: 0.7 });
  if (!response) {
    console.log('[TopicDiscovery] LLM call failed');
    return [];
  }

  // Parse the JSON array
  let topics: string[] = [];
  try {
    const cleaned = response.trim().replace(/^```json?\s*/, '').replace(/```\s*$/, '');
    topics = JSON.parse(cleaned);
    if (!Array.isArray(topics)) topics = [];
    topics = topics.filter(t => typeof t === 'string' && t.length > 3).slice(0, 8);
  } catch {
    console.log('[TopicDiscovery] Failed to parse LLM response:', response.slice(0, 100));
    return [];
  }

  if (topics.length === 0) return [];

  // Write to pulse.yaml
  try {
    const configPath = path.join(getDataDir(), 'pulse.yaml');
    if (fs.existsSync(configPath)) {
      const existing = YAML.parse(fs.readFileSync(configPath, 'utf-8')) || {};
      existing.topics = topics.map((query, i) => ({
        id: `smart-${i + 1}`,
        query,
      }));
      fs.writeFileSync(configPath, YAML.stringify(existing), 'utf-8');
      console.log(`[TopicDiscovery] Generated ${topics.length} search topics: ${topics.join(', ')}`);
    }
  } catch (err) {
    console.error('[TopicDiscovery] Failed to write topics:', err);
  }

  return topics;
}

/**
 * Check if topics need discovery and run if needed.
 * Safe to call on every scheduler tick — only runs when topics are empty or stale.
 */
export async function ensureTopicsExist(agentId?: string): Promise<void> {
  try {
    const configPath = path.join(getDataDir(), 'pulse.yaml');
    if (!fs.existsSync(configPath)) return;

    const existing = YAML.parse(fs.readFileSync(configPath, 'utf-8')) || {};
    const topics = existing.topics ?? [];

    // Run discovery if: no topics, or topics have bad auto-generated queries
    const needsDiscovery = topics.length === 0
      || topics.some((t: any) => t.query?.includes('value proposition') || t.query?.includes('overview') || t.id?.startsWith('auto-'));

    if (needsDiscovery) {
      await discoverSearchTopics(agentId);
    }
  } catch {}
}
