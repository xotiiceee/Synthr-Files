/**
 * GitHub OAuth + API integration for Hosted Pulse.
 *
 * Handles OAuth flow, token storage, repo listing, and context sync.
 * Token errors from GitHub are wrapped in GitHubAuthError for route handling.
 */

import crypto from 'node:crypto';
import { Octokit } from '@octokit/rest';
import { encrypt, decrypt } from './crypto.js';
import * as db from './db.js';

// ─── Error Types ─────────────────────────────────────────────────────────────

export class GitHubAuthError extends Error {
  constructor(message = 'GitHub token invalid or expired') {
    super(message);
    this.name = 'GitHubAuthError';
  }
}

// ─── OAuth State (HMAC-signed, stateless) ────────────────────────────────────

const STATE_TTL_MS = 10 * 60 * 1000;

function getStateSecret(): string {
  const secret = process.env.GITHUB_STATE_SECRET ?? process.env.TENANT_ENCRYPTION_KEY;
  if (!secret) throw new Error('TENANT_ENCRYPTION_KEY must be set');
  return secret;
}

export function issueGitHubOAuthState(tenantId: string): string {
  const payload = Buffer.from(
    JSON.stringify({ tenantId, exp: Date.now() + STATE_TTL_MS }),
  ).toString('base64url');
  const sig = crypto
    .createHmac('sha256', getStateSecret())
    .update(payload)
    .digest('base64url');
  return `${payload}.${sig}`;
}

export function consumeGitHubOAuthState(state: string): { tenantId: string } | null {
  const dot = state.lastIndexOf('.');
  if (dot === -1) return null;
  const payload = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  const expected = crypto
    .createHmac('sha256', getStateSecret())
    .update(payload)
    .digest('base64url');
  const sigBuf = Buffer.from(sig, 'base64url');
  const expBuf = Buffer.from(expected, 'base64url');
  if (sigBuf.length !== expBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      tenantId: string;
      exp: number;
    };
    if (!data.tenantId || !data.exp || Date.now() > data.exp) return null;
    return { tenantId: data.tenantId };
  } catch {
    return null;
  }
}

// ─── OAuth URL ───────────────────────────────────────────────────────────────

export function getGitHubAuthorizeUrl(state: string, callbackUrl: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GITHUB_OAUTH_CLIENT_ID!,
    redirect_uri: callbackUrl,
    scope: 'repo read:user',
    state,
  });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

// ─── Token Exchange ───────────────────────────────────────────────────────────

export async function exchangeGitHubCode(code: string, redirectUri: string): Promise<string> {
  const resp = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: process.env.GITHUB_OAUTH_CLIENT_ID,
      client_secret: process.env.GITHUB_OAUTH_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
    }),
  });
  const data = (await resp.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (data.error || !data.access_token) {
    throw new Error(`GitHub OAuth: ${data.error_description ?? data.error ?? 'no access_token'}`);
  }
  return data.access_token;
}

// ─── Token Storage ────────────────────────────────────────────────────────────

export function storeGitHubToken(tenantId: string, token: string): void {
  const { ciphertext, iv, authTag } = encrypt(token);
  db.storeSecret(tenantId, 'GITHUB_ACCESS_TOKEN', ciphertext, iv, authTag);
}

export function getGitHubToken(tenantId: string): string | null {
  const row = db.getSecret(tenantId, 'GITHUB_ACCESS_TOKEN');
  if (!row) return null;
  try {
    return decrypt(row.encrypted_value, row.iv, row.auth_tag);
  } catch {
    return null;
  }
}

// ─── Octokit Factory ─────────────────────────────────────────────────────────

function makeOctokit(tenantId: string): Octokit {
  const token = getGitHubToken(tenantId);
  if (!token) throw new GitHubAuthError();
  return new Octokit({ auth: token });
}

async function withGitHub<T>(tenantId: string, fn: (octokit: Octokit) => Promise<T>): Promise<T> {
  const octokit = makeOctokit(tenantId);
  try {
    return await fn(octokit);
  } catch (err: unknown) {
    const status = (err as Record<string, unknown>).status;
    if (status === 401) throw new GitHubAuthError();
    throw err;
  }
}

// ─── GitHub API Calls ─────────────────────────────────────────────────────────

export async function getGitHubViewer(tenantId: string): Promise<{
  id: string;
  login: string;
  name: string;
  avatarUrl: string;
}> {
  return withGitHub(tenantId, async (octokit) => {
    const { data } = await octokit.users.getAuthenticated();
    return {
      id: String(data.id),
      login: data.login,
      name: data.name ?? data.login,
      avatarUrl: data.avatar_url,
    };
  });
}

export async function listGitHubRepos(tenantId: string): Promise<
  Array<{
    repoId: string;
    owner: string;
    name: string;
    fullName: string;
    isPrivate: boolean;
    description: string;
    defaultBranch: string;
  }>
> {
  return withGitHub(tenantId, async (octokit) => {
    const repos = await octokit.paginate(octokit.repos.listForAuthenticatedUser, {
      visibility: 'all',
      affiliation: 'owner,collaborator,organization_member',
      per_page: 100,
    });
    return repos.map((repo) => ({
      repoId: String(repo.id),
      owner: repo.owner.login,
      name: repo.name,
      fullName: repo.full_name,
      isPrivate: repo.private,
      description: repo.description ?? '',
      defaultBranch: repo.default_branch,
    }));
  });
}

// ─── Context Sync ─────────────────────────────────────────────────────────────

export interface GitHubRepoSnapshot {
  repoId: string;
  fullName: string;
  trustMode: string;
  generatedAt: string;
  summary: string;
  metadata: {
    description: string;
    language: string;
    topics: string[];
    stars: number;
    defaultBranch: string;
  };
  readme?: string;
  files?: Array<{ path: string; content: string }>;
  commits?: Array<{ sha: string; message: string; author: string; date: string }>;
  prs?: Array<{ number: number; title: string; body: string }>;
  fileTree?: string[];
}

function matchesPatterns(filePath: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    if (pattern.includes('**')) {
      const re = new RegExp(
        '^' +
          pattern
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replace(/\*\*/g, '.*')
            .replace(/\*/g, '[^/]*') +
          '$',
      );
      return re.test(filePath);
    }
    if (pattern.startsWith('*.')) {
      return filePath.endsWith(pattern.slice(1)) && !filePath.includes('/');
    }
    return filePath === pattern || filePath.startsWith(pattern + '/');
  });
}

export async function syncGitHubRepoContext(
  tenantId: string,
  opts: {
    repoId: string;
    fullName: string;
    isPrivate: boolean;
    trustMode: string;
    allowedPaths: string[];
  },
): Promise<GitHubRepoSnapshot> {
  const [owner, repo] = opts.fullName.split('/');

  return withGitHub(tenantId, async (octokit) => {
    const { data: repoData } = await octokit.repos.get({ owner, repo });

    const metadata = {
      description: repoData.description ?? '',
      language: repoData.language ?? '',
      topics: repoData.topics ?? [],
      stars: repoData.stargazers_count,
      defaultBranch: repoData.default_branch,
    };

    const snapshot: GitHubRepoSnapshot = {
      repoId: opts.repoId,
      fullName: opts.fullName,
      trustMode: opts.trustMode,
      generatedAt: new Date().toISOString(),
      summary: `${opts.fullName} (${metadata.language || 'unknown'}) — ${metadata.description || 'no description'}`,
      metadata,
    };

    if (opts.trustMode === 'metadata') return snapshot;

    // docs + full: fetch README
    try {
      const { data: readmeData } = await octokit.repos.getReadme({ owner, repo });
      if (readmeData.encoding === 'base64') {
        snapshot.readme = Buffer.from(readmeData.content, 'base64').toString('utf8').slice(0, 8000);
      }
    } catch {
      // no readme
    }

    if (opts.trustMode === 'docs') {
      const patterns = opts.allowedPaths.length > 0 ? opts.allowedPaths : ['docs/**', '*.md'];
      try {
        const { data: treeData } = await octokit.git.getTree({
          owner,
          repo,
          tree_sha: repoData.default_branch,
          recursive: '1',
        });
        const matchedPaths = (treeData.tree ?? [])
          .filter((item) => item.type === 'blob' && item.path && matchesPatterns(item.path, patterns))
          .slice(0, 20)
          .map((item) => item.path!);

        const files: Array<{ path: string; content: string }> = [];
        for (const filePath of matchedPaths) {
          try {
            const { data: rawData } = await octokit.repos.getContent({ owner, repo, path: filePath });
            const fileData = rawData as { type?: string; encoding?: string; content?: string };
            if (!Array.isArray(rawData) && fileData.type === 'file' && fileData.encoding === 'base64' && fileData.content) {
              files.push({
                path: filePath,
                content: Buffer.from(fileData.content, 'base64').toString('utf8').slice(0, 4000),
              });
            }
          } catch {
            // skip unreadable file
          }
        }
        snapshot.files = files;
      } catch {
        // tree fetch failed
      }
      return snapshot;
    }

    // full mode: commits + open PRs + root file tree
    try {
      const { data: commits } = await octokit.repos.listCommits({ owner, repo, per_page: 20 });
      snapshot.commits = commits.map((c) => ({
        sha: c.sha.slice(0, 8),
        message: (c.commit.message ?? '').split('\n')[0].slice(0, 200),
        author: c.commit.author?.name ?? '',
        date: c.commit.author?.date ?? '',
      }));
    } catch {
      // skip
    }

    try {
      const { data: prs } = await octokit.pulls.list({ owner, repo, state: 'open', per_page: 20 });
      snapshot.prs = prs.map((pr) => ({
        number: pr.number,
        title: pr.title,
        body: (pr.body ?? '').slice(0, 1000),
      }));
    } catch {
      // skip
    }

    try {
      const { data: treeData } = await octokit.git.getTree({
        owner,
        repo,
        tree_sha: repoData.default_branch,
      });
      snapshot.fileTree = (treeData.tree ?? [])
        .filter((item) => item.path)
        .map((item) => `${item.type === 'tree' ? '/' : ''}${item.path!}`)
        .slice(0, 100);
    } catch {
      // skip
    }

    return snapshot;
  });
}

// ─── Context Hash ─────────────────────────────────────────────────────────────

export function buildGitHubContextHash(snapshot: GitHubRepoSnapshot): string {
  return crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

// ─── Batch Sync ──────────────────────────────────────────────────────────────

interface SyncRepoLink {
  repo_id: string;
  full_name: string;
  is_private: number;
  sync_enabled: number;
  trust_mode: string;
  allowed_paths: string;
}

/**
 * Sync all linked repos for a tenant in sequence, catching per-repo errors.
 * Designed to be called by the scheduler; dependencies are injected so the
 * caller controls which DB accessor and state writer are used.
 */
export async function syncAllLinkedRepos(
  tenantId: string,
  listRepoLinks: (tenantId: string) => SyncRepoLink[],
  saveState: (key: string, data: unknown) => void,
): Promise<void> {
  const links = listRepoLinks(tenantId).filter((r) => r.sync_enabled);
  for (const link of links) {
    try {
      const snapshot = await syncGitHubRepoContext(tenantId, {
        repoId: link.repo_id,
        fullName: link.full_name,
        isPrivate: !!link.is_private,
        trustMode: link.trust_mode,
        allowedPaths: JSON.parse(link.allowed_paths || '[]') as string[],
      });
      saveState(`github-context-${link.repo_id}`, {
        snapshot,
        hash: buildGitHubContextHash(snapshot),
      });
      console.log(`[GitHub Sync] ${tenantId}: synced ${link.full_name}`);
    } catch (err) {
      console.error(
        `[GitHub Sync] ${tenantId}/${link.full_name} failed:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}
