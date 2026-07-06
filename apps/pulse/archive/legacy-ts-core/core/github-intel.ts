/**
 * GitHub Context Intel (companion to X Intel Gateway)
 *
 * When a user links their GitHub (see hosted/ui GitHubSettings + backend github.ts),
 * we can pull key context (README, recent commits, selected files) and embed it
 * into the same semantic cache pattern (or a parallel collection).
 *
 * Goal: When chatting or planning, the agent has deep product/technical understanding
 * without expensive repeated LLM context window or API calls.
 *
 * Future: feed into the Rust gateway as another pluggable "data_type".
 */

import { searchKnowledge } from './x-intel-gateway.js';
import type { KnowledgeItem } from './knowledge-store.js';

export interface GitHubContext {
  repo: string;
  summary: string;
  keyFiles: Array<{ path: string; excerpt: string }>;
  lastUpdated: string;
}

/**
 * Real implementation: pull from unified intel gateway (populated by hosted/github push after sync).
 * Uses searchKnowledge (shipped) so after any trustMode sync, GitHub content is retrievable here too.
 */
export async function getLinkedGitHubContext(brandId: string): Promise<GitHubContext | null> {
  const res = searchKnowledge(brandId, 'github OR repo OR readme OR summary', 5);
  if (!res.items || res.items.length === 0) return null;

  const first = res.items[0];
  const repo = (first.metadata?.fullName as string) || first.source?.replace('github:', '') || 'linked-repo';
  const summary = first.content?.slice(0, 300) || 'GitHub context available via intel gateway.';
  const keyFiles = res.items
    .filter((it: KnowledgeItem) => it.metadata?.type === 'file' || it.metadata?.type === 'readme')
    .slice(0, 3)
    .map((it: KnowledgeItem) => ({ path: (it.metadata?.path as string) || 'file', excerpt: it.content?.slice(0, 120) || '' }));

  return {
    repo,
    summary,
    keyFiles: keyFiles.length ? keyFiles : [{ path: 'summary', excerpt: summary.slice(0, 120) }],
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Get GitHub-aware context snippet for chat / research (uses real shipped retrieval after sync).
 */
export async function getGitHubContextForChat(brandId: string, query: string): Promise<string> {
  const gh = await getLinkedGitHubContext(brandId);
  if (!gh) return '';

  return `\n\nLinked GitHub context for ${gh.repo} (for technical accuracy):\n${gh.summary}\n`;
}
