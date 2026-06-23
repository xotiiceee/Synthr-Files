import { useState, useEffect } from 'react'
import { GitBranch, Check, Loader2, RefreshCw, Lock, Globe } from 'lucide-react'
import { get, post } from '../lib/api'

const cardStyle: React.CSSProperties = {
  background: 'var(--card-bg)',
  border: '1px solid var(--card-border)',
  borderRadius: 12,
  padding: 24,
}

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  color: 'var(--text-3)',
  marginBottom: 6,
  display: 'block',
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  background: 'var(--input-bg)',
  border: '1px solid var(--input-border)',
  borderRadius: 8,
  color: 'var(--text-1)',
  fontSize: 14,
  outline: 'none',
}

const btnStyle: React.CSSProperties = {
  padding: '7px 14px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg-2)',
  color: 'var(--text-2)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'inherit',
}

const accentBtnStyle: React.CSSProperties = {
  ...btnStyle,
  background: 'var(--accent)',
  border: '1px solid var(--accent)',
  color: '#fff',
}

const TRUST_LABELS: Record<string, string> = {
  metadata: 'Metadata only',
  docs: 'Docs & README',
  full: 'Full context',
}

const TRUST_DESCRIPTIONS: Record<string, string> = {
  metadata: 'Repo name, description, language, and topics only',
  docs: 'README and selected doc files',
  full: 'Commits, open PRs, and file tree',
}

interface GHConnection {
  github_login: string
  github_name: string
  github_avatar: string
}

interface GHRepo {
  repoId: string
  fullName: string
  isPrivate: boolean
  description: string
  selected: boolean
  trustMode: 'metadata' | 'docs' | 'full'
  syncEnabled: boolean
  allowedPaths: string[]
  lastSyncedAt: string | null
  lastSyncStatus: string
}

interface LocalRepo {
  selected: boolean
  trustMode: 'metadata' | 'docs' | 'full'
  allowedPathsText: string
}

function initLocal(repos: GHRepo[]): Record<string, LocalRepo> {
  const map: Record<string, LocalRepo> = {}
  for (const r of repos) {
    map[r.repoId] = {
      selected: r.selected,
      trustMode: r.trustMode,
      allowedPathsText: r.allowedPaths.join(', '),
    }
  }
  return map
}

export default function GitHubSettings() {
  const [loading, setLoading] = useState(true)
  const [connected, setConnected] = useState(false)
  const [connection, setConnection] = useState<GHConnection | null>(null)
  const [repos, setRepos] = useState<GHRepo[]>([])
  const [reposLoading, setReposLoading] = useState(false)
  const [local, setLocal] = useState<Record<string, LocalRepo>>({})
  const [saving, setSaving] = useState(false)
  const [saveFeedback, setSaveFeedback] = useState<{ ok: boolean; msg: string } | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncFeedback, setSyncFeedback] = useState<{ ok: boolean; msg: string } | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)
  const [oauthMsg, setOauthMsg] = useState<{ ok: boolean; msg: string } | null>(null)

  const loadStatus = async () => {
    try {
      const data = await get<{ connected: boolean; connection: GHConnection | null; repos: GHRepo[] }>('/api/integrations/github')
      setConnected(data.connected)
      setConnection(data.connection ?? null)
      if (data.connected) loadRepos()
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  const loadRepos = async () => {
    setReposLoading(true)
    try {
      const data = await get<{ repos: GHRepo[] }>('/api/integrations/github/repos')
      setRepos(data.repos)
      setLocal(initLocal(data.repos))
    } catch {
      // ignore
    } finally {
      setReposLoading(false)
    }
  }

  useEffect(() => {
    // Read OAuth callback query params and clean the URL
    const params = new URLSearchParams(window.location.search)
    const ghConnected = params.get('github_connected')
    const ghError = params.get('github_error')
    if (ghConnected === '1') {
      const login = params.get('github_login')
      setOauthMsg({ ok: true, msg: login ? `Connected as @${login}` : 'Connected to GitHub' })
      setTimeout(() => setOauthMsg(null), 5000)
      const cleaned = new URL(window.location.href)
      cleaned.searchParams.delete('github_connected')
      cleaned.searchParams.delete('github_login')
      window.history.replaceState({}, '', cleaned.toString())
    } else if (ghError) {
      const msgs: Record<string, string> = {
        denied: 'Authorization was cancelled.',
        expired: 'OAuth session expired — try again.',
        failed: 'GitHub connection failed — try again.',
        oauth_not_configured: 'GitHub OAuth is not configured on this server.',
      }
      setOauthMsg({ ok: false, msg: msgs[ghError] ?? 'GitHub connection failed.' })
      setTimeout(() => setOauthMsg(null), 6000)
      const cleaned = new URL(window.location.href)
      cleaned.searchParams.delete('github_error')
      window.history.replaceState({}, '', cleaned.toString())
    }
    loadStatus()
  }, [])

  const handleDisconnect = async () => {
    if (disconnecting) return
    setDisconnecting(true)
    try {
      await post('/api/integrations/github/disconnect')
      setConnected(false)
      setConnection(null)
      setRepos([])
      setLocal({})
    } catch {
      // ignore
    } finally {
      setDisconnecting(false)
    }
  }

  const handleSave = async () => {
    if (saving) return
    setSaving(true)
    setSaveFeedback(null)
    try {
      const selected = repos
        .filter(r => local[r.repoId]?.selected)
        .map(r => {
          const l = local[r.repoId]
          return {
            repoId: r.repoId,
            trustMode: l.trustMode,
            allowedPaths: l.trustMode === 'docs'
              ? l.allowedPathsText.split(',').map(p => p.trim()).filter(Boolean)
              : [],
            syncEnabled: true,
          }
        })
      await post('/api/integrations/github/repos', { repos: selected })
      setSaveFeedback({ ok: true, msg: 'Saved' })
      setTimeout(() => setSaveFeedback(null), 3000)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Save failed'
      setSaveFeedback({ ok: false, msg })
      setTimeout(() => setSaveFeedback(null), 4000)
    } finally {
      setSaving(false)
    }
  }

  const handleSync = async () => {
    if (syncing) return
    setSyncing(true)
    setSyncFeedback(null)
    try {
      const result = await post<{ ok: boolean; synced: Array<{ repoId: string; status: string }> }>('/api/integrations/github/sync')
      const count = result.synced.length
      const allOk = result.synced.every(r => r.status === 'ok')
      setSyncFeedback({
        ok: allOk,
        msg: allOk
          ? `Synced ${count} repo${count !== 1 ? 's' : ''}`
          : 'Sync completed with errors — check repo status',
      })
      setTimeout(() => setSyncFeedback(null), 5000)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Sync failed'
      setSyncFeedback({ ok: false, msg })
      setTimeout(() => setSyncFeedback(null), 5000)
    } finally {
      setSyncing(false)
    }
  }

  const patchLocal = (repoId: string, patch: Partial<LocalRepo>) => {
    setLocal(prev => ({ ...prev, [repoId]: { ...prev[repoId], ...patch } }))
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 24, color: 'var(--text-4)', fontSize: 14 }}>
        <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Loading...
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* OAuth feedback toast */}
      {oauthMsg && (
        <div style={{
          padding: '10px 16px', borderRadius: 10, fontSize: 13, fontWeight: 500,
          background: oauthMsg.ok ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
          border: `1px solid ${oauthMsg.ok ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}`,
          color: oauthMsg.ok ? '#10b981' : 'var(--danger)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          {oauthMsg.ok ? <Check size={14} /> : null}
          {oauthMsg.msg}
        </div>
      )}

      {/* Connect card */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <GitBranch size={18} style={{ color: 'var(--accent)' }} />
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)' }}>GitHub</span>
          {connected && (
            <span style={{
              fontSize: 10, padding: '2px 8px', borderRadius: 10,
              background: 'rgba(16,185,129,0.1)', color: '#10b981', fontWeight: 600,
            }}>CONNECTED</span>
          )}
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 16, lineHeight: 1.5 }}>
          Connect your GitHub account to give your brand authentic context about your projects.
          Posts will naturally reference real commits, docs, and activity.
        </p>

        {connected && connection ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {connection.github_avatar && (
                <img
                  src={connection.github_avatar}
                  alt={connection.github_login}
                  style={{ width: 32, height: 32, borderRadius: '50%', border: '1px solid var(--border)' }}
                />
              )}
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>
                  {connection.github_name || connection.github_login}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-4)' }}>@{connection.github_login}</div>
              </div>
            </div>
            <button
              className="btn-danger"
              onClick={handleDisconnect}
              disabled={disconnecting}
              style={{
                padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500,
                background: 'rgba(239,68,68,0.08)', color: 'var(--danger)',
                border: '1px solid rgba(239,68,68,0.15)',
                cursor: disconnecting ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 5,
                opacity: disconnecting ? 0.6 : 1,
              }}
            >
              {disconnecting && <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />}
              Disconnect
            </button>
          </div>
        ) : (
          <a
            href="/auth/github/authorize"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '8px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600,
              background: 'var(--accent)', color: '#fff', textDecoration: 'none',
            }}
          >
            <GitBranch size={14} /> Connect GitHub
          </a>
        )}
      </div>

      {/* Repo list — only shown when connected */}
      {connected && (
        <div style={cardStyle}>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)' }}>Repositories</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
              Select which repos to include as context. Changes take effect after saving and syncing.
            </div>
          </div>

          {reposLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-4)', fontSize: 13, padding: '8px 0' }}>
              <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Loading repositories...
            </div>
          ) : repos.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-4)', padding: '8px 0' }}>No repositories found.</div>
          ) : (
            <div>
              {repos.map((repo, i) => {
                const l: LocalRepo = local[repo.repoId] ?? { selected: false, trustMode: 'metadata', allowedPathsText: '' }
                const isLast = i === repos.length - 1
                return (
                  <div key={repo.repoId} style={{
                    padding: '12px 0',
                    borderBottom: isLast ? 'none' : '1px solid var(--border-subtle)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                      <input
                        type="checkbox"
                        checked={l.selected}
                        onChange={e => patchLocal(repo.repoId, { selected: e.target.checked })}
                        style={{ marginTop: 3, flexShrink: 0, cursor: 'pointer', accentColor: 'var(--accent)' as string }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)', wordBreak: 'break-all' }}>
                            {repo.fullName}
                          </span>
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: 3,
                            fontSize: 10, padding: '1px 6px', borderRadius: 4,
                            background: 'var(--bg-3)', color: 'var(--text-4)', border: '1px solid var(--border)',
                            flexShrink: 0,
                          }}>
                            {repo.isPrivate ? <><Lock size={9} /> private</> : <><Globe size={9} /> public</>}
                          </span>
                        </div>
                        {repo.description && (
                          <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 2, lineHeight: 1.4 }}>
                            {repo.description}
                          </div>
                        )}

                        {l.selected && (
                          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {/* Trust mode selector */}
                            <div>
                              <label style={{ ...labelStyle, fontSize: 11 }}>Trust mode</label>
                              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                {(['metadata', 'docs', 'full'] as const).map(mode => (
                                  <button
                                    key={mode}
                                    title={TRUST_DESCRIPTIONS[mode]}
                                    onClick={() => patchLocal(repo.repoId, { trustMode: mode })}
                                    style={{
                                      padding: '4px 12px', borderRadius: 16, fontSize: 11, fontWeight: 500,
                                      border: l.trustMode === mode ? '1px solid var(--accent)' : '1px solid var(--border)',
                                      background: l.trustMode === mode ? 'var(--accent-dim)' : 'transparent',
                                      color: l.trustMode === mode ? 'var(--accent)' : 'var(--text-3)',
                                      cursor: 'pointer', fontFamily: 'inherit',
                                    }}
                                  >
                                    {TRUST_LABELS[mode]}
                                  </button>
                                ))}
                              </div>
                              <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 4 }}>
                                {TRUST_DESCRIPTIONS[l.trustMode]}
                              </div>
                            </div>

                            {/* Path filter — docs mode only */}
                            {l.trustMode === 'docs' && (
                              <div>
                                <label style={{ ...labelStyle, fontSize: 11 }}>
                                  File paths{' '}
                                  <span style={{ color: 'var(--text-4)', fontWeight: 400 }}>
                                    (comma-separated, e.g. docs/**, *.md)
                                  </span>
                                </label>
                                <input
                                  value={l.allowedPathsText}
                                  onChange={e => patchLocal(repo.repoId, { allowedPathsText: e.target.value })}
                                  placeholder="docs/**, *.md"
                                  style={{ ...inputStyle, fontSize: 12 }}
                                />
                              </div>
                            )}

                            {/* Last sync info */}
                            {repo.lastSyncedAt && (
                              <div style={{ fontSize: 11, color: 'var(--text-4)' }}>
                                Last synced: {new Date(repo.lastSyncedAt).toLocaleString()} · {repo.lastSyncStatus}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Action bar */}
      {connected && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button
            onClick={handleSave}
            disabled={saving || reposLoading}
            style={{
              ...accentBtnStyle,
              display: 'flex', alignItems: 'center', gap: 6,
              opacity: saving || reposLoading ? 0.6 : 1,
              cursor: saving || reposLoading ? 'not-allowed' : 'pointer',
            }}
          >
            {saving
              ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
              : <Check size={13} />}
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button
            onClick={handleSync}
            disabled={syncing || reposLoading}
            style={{
              ...btnStyle,
              display: 'flex', alignItems: 'center', gap: 6,
              opacity: syncing || reposLoading ? 0.6 : 1,
              cursor: syncing || reposLoading ? 'not-allowed' : 'pointer',
            }}
          >
            <RefreshCw size={13} style={syncing ? { animation: 'spin 1s linear infinite' } : {}} />
            {syncing ? 'Syncing...' : 'Sync Now'}
          </button>

          {saveFeedback && (
            <span style={{
              fontSize: 12, display: 'flex', alignItems: 'center', gap: 5,
              color: saveFeedback.ok ? 'var(--accent)' : 'var(--danger)',
            }}>
              {saveFeedback.ok && <Check size={12} />}
              {saveFeedback.msg}
            </span>
          )}
          {syncFeedback && (
            <span style={{
              fontSize: 12, display: 'flex', alignItems: 'center', gap: 5,
              color: syncFeedback.ok ? 'var(--accent)' : 'var(--danger)',
            }}>
              {syncFeedback.ok && <Check size={12} />}
              {syncFeedback.msg}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
