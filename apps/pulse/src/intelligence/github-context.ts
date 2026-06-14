/**
 * GitHub repo context injector for the autopost pipeline.
 *
 * Reads synced repo snapshots from state and builds a prompt block that the
 * LLM can use as authentic background knowledge about the tenant's projects.
 * Returns null when no repos are linked or no snapshots have been synced yet,
 * so callers without GitHub connected see zero behavior change.
 */

// ─── Minimal types (duck-typed, no hosted/ import) ──────────────────────────

interface RepoLinkLike {
  repo_id: string;
  full_name: string;
  is_private: number;
  sync_enabled: number;
  trust_mode: string;
}

interface RepoSnapshotLike {
  fullName?: string;
  trustMode?: string;
  metadata?: {
    description?: string;
    language?: string;
    topics?: string[];
    stars?: number;
    defaultBranch?: string;
  };
  readme?: string;
  files?: Array<{ path: string; content: string }>;
  commits?: Array<{ sha: string; message: string; author: string; date: string }>;
  prs?: Array<{ number: number; title: string; body: string }>;
  fileTree?: string[];
}

interface SnapshotEntry {
  snapshot: RepoSnapshotLike;
  hash?: string;
}

// ─── Per-repo summary ────────────────────────────────────────────────────────

function summarizeRepo(link: RepoLinkLike, snapshot: RepoSnapshotLike): string {
  const lines: string[] = [];

  lines.push(`Project: ${link.full_name} (${link.is_private ? 'private' : 'open source'})`);

  const meta = snapshot.metadata ?? {};
  if (meta.description) lines.push(meta.description);

  const details: string[] = [];
  if (meta.language) details.push(meta.language);
  if (meta.topics?.length) details.push(meta.topics.slice(0, 4).join(', '));
  if (details.length) lines.push(details.join(' · '));

  if (link.trust_mode === 'metadata') return lines.join('\n');

  const bullets: string[] = [];

  if (link.trust_mode === 'docs') {
    if (snapshot.readme) {
      const firstLine = snapshot.readme.split('\n').find((l) => l.trim() && !l.startsWith('#'));
      if (firstLine) bullets.push(firstLine.trim().slice(0, 120));
    }
    if (snapshot.files?.length) {
      const paths = snapshot.files
        .map((f) => f.path)
        .slice(0, 4)
        .join(', ');
      bullets.push(`Docs: ${paths}`);
    }
  }

  if (link.trust_mode === 'full') {
    if (snapshot.readme) {
      const firstLine = snapshot.readme.split('\n').find((l) => l.trim() && !l.startsWith('#'));
      if (firstLine) bullets.push(firstLine.trim().slice(0, 100));
    }
    for (const c of (snapshot.commits ?? []).slice(0, 3)) {
      bullets.push(`Commit: ${c.message.slice(0, 80)}`);
    }
    for (const pr of (snapshot.prs ?? []).slice(0, 2)) {
      bullets.push(`PR #${pr.number}: ${pr.title.slice(0, 70)} (open)`);
    }
    const tree = (snapshot.fileTree ?? [])
      .filter((f) => !f.startsWith('.') && f !== '/node_modules' && f !== '/dist')
      .slice(0, 5)
      .join(', ');
    if (tree) bullets.push(`Root: ${tree}`);
  }

  if (bullets.length) {
    lines.push('Recent activity:');
    for (const b of bullets) lines.push(`- ${b}`);
  }

  return lines.join('\n');
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Build a GitHub project context block for injection into the autopost prompt.
 *
 * SECURITY NOTE: README text and commit messages are external, user-controlled data
 * injected verbatim into LLM prompts (RAG injection). A malicious repo could include
 * prompt-injection payloads. The labeled section framing ("---BEGIN/END") mitigates the
 * worst cases, but sanitization of this content is a future hardening opportunity.
 *
 * @param tenantId       Current tenant — used to scope the repo link query.
 * @param listRepoLinks  Injected DB accessor (avoids cross-boundary static import).
 * @param getState       Injected state reader — reads github-context-{repoId} entries.
 * @returns              Formatted prompt block, or null if nothing to inject.
 */
export async function buildGitHubContextBlock(
  tenantId: string,
  listRepoLinks: (tenantId: string) => RepoLinkLike[],
  getState: <T>(key: string, defaultValue: T) => T,
): Promise<string | null> {
  const links = listRepoLinks(tenantId).filter((r) => r.sync_enabled);
  if (links.length === 0) return null;

  const summaries: string[] = [];

  for (const link of links) {
    const entry = getState<SnapshotEntry | null>(`github-context-${link.repo_id}`, null);
    if (!entry?.snapshot) continue;
    summaries.push(summarizeRepo(link, entry.snapshot));
  }

  if (summaries.length === 0) return null;

  return `[GitHub Project Context]
You work on and deeply understand the following project(s). Use this as authentic background knowledge.
When something is genuinely interesting or useful to your audience, share it naturally — not as an announcement bot, but as a developer who cares about their work.

${summaries.join('\n---\n')}
---`;
}
