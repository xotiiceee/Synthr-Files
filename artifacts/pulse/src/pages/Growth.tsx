import { useState, useEffect, useRef, useCallback } from 'react'
import {
  TrendingUp, Users, UserPlus, UserMinus, Shield, Target,
  Play, Pause, Loader2, Check, X, Zap,
  BarChart3,
} from 'lucide-react'
import { get, post } from '../lib/api'
import Modal from '../components/Modal'

// ─── Types ───────────────────────────────────────────────────────────────────

interface GrowthConfig {
  enabled: boolean
  dailyCap: number
  minConfidence: number
  minFollowerCount: number
  signals: {
    repost: boolean
    reply: boolean
    tag: boolean
    mention_positive: boolean
  }
}

interface FollowRecord {
  username: string
  platformId: string
  signal: string
  confidence: number
  followedAt: string
  unfollowAt: string | null
  status: 'active' | 'unfollowed'
}

interface GrowthStats {
  today: number
  month: number
  total: number
  active: number
  unfollowed: number
  bySignal: Record<string, number>
}

const DEFAULT_CONFIG: GrowthConfig = {
  enabled: false,
  dailyCap: 15,
  minConfidence: 70,
  minFollowerCount: 50,
  signals: { repost: true, reply: true, tag: true, mention_positive: true },
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: 'var(--card-bg)',
  border: '1px solid var(--card-border)',
  borderRadius: 12,
  padding: 24,
}

const labelStyle: React.CSSProperties = {
  fontSize: 13, fontWeight: 500, color: 'var(--text-3)', marginBottom: 6, display: 'block',
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px', background: 'var(--input-bg)',
  border: '1px solid var(--input-border)', borderRadius: 8,
  color: 'var(--text-1)', fontSize: 14, outline: 'none',
}

const numberInputStyle: React.CSSProperties = { ...inputStyle, width: 80 }

// ─── Toggle Component ────────────────────────────────────────────────────────

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      style={{
        width: 44, height: 24, borderRadius: 12, border: 'none',
        background: checked ? 'var(--accent)' : 'var(--bg-3)',
        position: 'relative', cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'background 0.2s', opacity: disabled ? 0.5 : 1, flexShrink: 0,
      }}
    >
      <span style={{
        position: 'absolute', top: 3, left: checked ? 23 : 3,
        width: 18, height: 18, borderRadius: '50%', background: 'var(--text-1)',
        transition: 'left 0.2s',
      }} />
    </button>
  )
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function Growth() {
  const [config, setConfig] = useState<GrowthConfig>(DEFAULT_CONFIG)
  const [stats, setStats] = useState<GrowthStats>({ today: 0, month: 0, total: 0, active: 0, unfollowed: 0, bySignal: {} })
  const [records, setRecords] = useState<FollowRecord[]>([])
  const [kols, setKols] = useState<string[]>([])
  const [pendingRemoveKol, setPendingRemoveKol] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [showGuide, setShowGuide] = useState(() => !localStorage.getItem('pulse_growth_guide_dismissed'))
  const [newKol, setNewKol] = useState('')
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loadedRef = useRef(false)

  // ─── Data fetching ──────────────────────────────────────────────────────

  useEffect(() => {
    const load = async () => {
      try {
        const data = await get<{
          config: GrowthConfig
          stats: GrowthStats
          records: FollowRecord[]
          kols: string[]
        }>('/api/growth')
        setConfig(data.config || DEFAULT_CONFIG)
        setStats(data.stats || stats)
        setRecords(data.records || [])
        setKols(data.kols || [])
      } catch {
        // Try loading from main config
        try {
          const data = await get<any>('/api/config')
          if (data.autoFollow) {
            setConfig({ ...DEFAULT_CONFIG, ...data.autoFollow })
          }
        } catch {}
      } finally {
        setLoading(false)
        loadedRef.current = true
      }
    }
    load()
  }, [])

  // ─── Auto-save config ──────────────────────────────────────────────────

  const autoSave = useCallback((updates: GrowthConfig) => {
    if (!loadedRef.current) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setSaveStatus('saving')
    debounceRef.current = setTimeout(async () => {
      try {
        await post('/api/growth/config', updates)
        setSaveStatus('saved')
        setTimeout(() => setSaveStatus('idle'), 2000)
      } catch {
        // Fallback: save through main config
        try {
          await post('/api/config', { autoFollow: updates })
          setSaveStatus('saved')
          setTimeout(() => setSaveStatus('idle'), 2000)
        } catch {
          setSaveStatus('idle')
        }
      }
    }, 1500)
  }, [])

  const prevRef = useRef<string>('')
  useEffect(() => {
    if (!loadedRef.current) return
    const snap = JSON.stringify(config)
    if (snap === prevRef.current) return
    prevRef.current = snap
    autoSave(config)
  }, [config, autoSave])

  // ─── KOL handlers ─────────────────────────────────────────────────────

  const addKol = async () => {
    const name = newKol.replace(/^@/, '').trim()
    if (!name || kols.includes(name)) return
    try {
      await post('/api/growth/kol/add', { username: name })
      setKols(prev => [...prev, name])
      setNewKol('')
    } catch {
      // Optimistic update if endpoint doesn't exist yet
      setKols(prev => [...prev, name])
      setNewKol('')
    }
  }

  const removeKol = async (name: string) => {
    try {
      await post('/api/growth/kol/remove', { username: name })
      setKols(prev => prev.filter(k => k !== name))
    } catch {
      setKols(prev => prev.filter(k => k !== name))
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  const formatTime = (ts: string) => {
    const d = new Date(ts)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffH = Math.floor(diffMs / 3600000)
    if (diffH < 1) return `${Math.floor(diffMs / 60000)}m ago`
    if (diffH < 24) return `${diffH}h ago`
    const diffD = Math.floor(diffH / 24)
    return `${diffD}d ago`
  }

  const signalLabel = (s: string) => {
    const map: Record<string, string> = {
      repost: 'Repost', reply: 'Reply', tag: 'Tag', mention_positive: 'Mention',
    }
    return map[s] || s
  }

  const signalColor = (s: string) => {
    const map: Record<string, string> = {
      repost: '#8b5cf6', reply: '#3b82f6', tag: '#f59e0b', mention_positive: '#10b981',
    }
    return map[s] || 'var(--text-3)'
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Loader2 size={24} style={{ color: 'var(--accent)', animation: 'spin 1s linear infinite' }} />
      </div>
    )
  }

  // ─── Render ───────────────────────────────────────────────────────────

  const isOff = !config.enabled

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '0 24px', minHeight: '100%', overflowY: 'auto', overflowX: 'hidden', boxSizing: 'border-box', wordBreak: 'break-word' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '24px 0 20px', borderBottom: '1px solid var(--border-subtle)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 42, height: 42, borderRadius: 12,
            background: 'var(--accent-dim)', border: '1px solid var(--accent-glow)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <TrendingUp size={20} style={{ color: 'var(--accent)' }} />
          </div>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--text-1)', margin: 0 }}>Growth</h1>
            <p style={{ fontSize: 13, color: 'var(--text-3)', margin: 0 }}>Audience builder — engage first, follow second</p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ fontSize: 13, color: saveStatus === 'saving' ? 'var(--text-3)' : saveStatus === 'saved' ? 'var(--accent)' : 'transparent', display: 'flex', alignItems: 'center', gap: 6, transition: 'color 0.2s' }}>
            {saveStatus === 'saving' && <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Saving...</>}
            {saveStatus === 'saved' && <><Check size={14} /> Saved</>}
          </span>
        </div>
      </div>

      {/* Master Toggle */}
      <div style={{ ...cardStyle, marginTop: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12,
            background: config.enabled ? 'rgba(16,185,129,0.1)' : 'var(--bg-3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.3s',
          }}>
            {config.enabled
              ? <Play size={20} style={{ color: '#10b981' }} />
              : <Pause size={20} style={{ color: 'var(--text-4)' }} />
            }
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-1)' }}>
              {config.enabled ? 'Growth Active' : 'Growth Paused'}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-3)' }}>
              {config.enabled
                ? `Following up to ${config.dailyCap} accounts/day based on engagement signals`
                : 'Enable to start building your audience automatically'
              }
            </div>
          </div>
        </div>
        <Toggle checked={config.enabled} onChange={v => setConfig(c => ({ ...c, enabled: v }))} />
      </div>

      {/* Stats Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginTop: 20 }}>
        {[
          { label: 'Today', value: stats.today, icon: UserPlus, color: 'var(--accent)' },
          { label: 'This Month', value: stats.month, icon: BarChart3, color: '#3b82f6' },
          { label: 'Active Follows', value: stats.active, icon: Users, color: '#10b981' },
          { label: 'KOLs', value: kols.length, icon: Shield, color: '#f59e0b' },
        ].map(s => (
          <div key={s.label} style={{ ...cardStyle, padding: 18, textAlign: 'center' }}>
            <s.icon size={18} style={{ color: s.color, margin: '0 auto 8px' }} />
            <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-1)', fontVariantNumeric: 'tabular-nums' }}>
              {s.value}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-4)', marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* How it works — dismissible banner, only shown once */}
      {showGuide && (
        <div style={{
          ...cardStyle, marginTop: 20, padding: 18,
          background: 'rgba(16,185,129,0.04)', border: '1px solid rgba(16,185,129,0.15)',
          display: 'flex', alignItems: 'flex-start', gap: 16,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)', marginBottom: 8 }}>How Growth works</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.7 }}>
              Pulse finds conversations in your niche, engages authentically (replies, likes), then follows users it has already interacted with. This is engagement-first growth — not a follow bot.
            </div>
          </div>
          <button
            className="btn-icon"
            onClick={() => { setShowGuide(false); localStorage.setItem('pulse_growth_guide_dismissed', '1') }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-4)', padding: 4, flexShrink: 0 }}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Configuration Grid */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20, marginTop: 20,
        opacity: isOff ? 0.4 : 1, pointerEvents: isOff ? 'none' : 'auto', transition: 'opacity 0.3s',
      }}>

        {/* Targeting */}
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <Target size={16} style={{ color: 'var(--accent)' }} />
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)' }}>Targeting</span>
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Daily follow cap</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input
                type="range" min={1} max={50}
                value={config.dailyCap}
                onChange={e => setConfig(c => ({ ...c, dailyCap: Number(e.target.value) }))}
                style={{ flex: 1, accentColor: 'var(--accent)' }}
              />
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)', minWidth: 28, textAlign: 'right' }}>
                {config.dailyCap}
              </span>
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-4)' }}>X safe limit: ~15/day. Max recommended: 30.</span>
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Min confidence score</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input
                type="range" min={30} max={95} step={5}
                value={config.minConfidence}
                onChange={e => setConfig(c => ({ ...c, minConfidence: Number(e.target.value) }))}
                style={{ flex: 1, accentColor: 'var(--accent)' }}
              />
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)', minWidth: 36, textAlign: 'right' }}>
                {config.minConfidence}%
              </span>
            </div>
          </div>

          <div>
            <label style={labelStyle}>Min follower count (spam filter)</label>
            <input
              type="number" min={0} max={10000}
              value={config.minFollowerCount}
              onChange={e => setConfig(c => ({ ...c, minFollowerCount: Number(e.target.value) }))}
              style={numberInputStyle}
            />
          </div>
        </div>

        {/* Signals */}
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <Zap size={16} style={{ color: 'var(--accent)' }} />
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)' }}>Follow Signals</span>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 16, lineHeight: 1.5 }}>
            Which engagement types should trigger a follow.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {([
              ['repost', 'Reposts', 'Someone reposts your content'],
              ['reply', 'Replies', 'Someone replies to your posts'],
              ['tag', 'Tags/Mentions', 'Someone tags you in a conversation'],
              ['mention_positive', 'Positive Mentions', 'Someone mentions you positively'],
            ] as const).map(([key, label, desc]) => (
              <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: config.signals[key] ? 'var(--text-1)' : 'var(--text-4)' }}>
                    {label}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-4)' }}>{desc}</div>
                </div>
                <Toggle
                  checked={config.signals[key]}
                  onChange={v => setConfig(c => ({
                    ...c,
                    signals: { ...c.signals, [key]: v },
                  }))}
                />
              </div>
            ))}
          </div>

          {/* Signal breakdown */}
          {Object.keys(stats.bySignal).length > 0 && (
            <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-4)', marginBottom: 8 }}>
                FOLLOWS BY SIGNAL
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {Object.entries(stats.bySignal).map(([signal, count]) => (
                  <span key={signal} style={{
                    padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 500,
                    background: `${signalColor(signal)}15`, color: signalColor(signal),
                    border: `1px solid ${signalColor(signal)}30`,
                  }}>
                    {signalLabel(signal)}: {count}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Key Accounts — auto-populated, manually editable */}
        <div style={{ ...cardStyle, gridColumn: '1 / -1' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Shield size={16} style={{ color: '#f59e0b' }} />
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)' }}>Key Accounts</span>
              <span style={{ fontSize: 12, color: 'var(--text-4)' }}>Always followed, never removed</span>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                value={newKol}
                onChange={e => setNewKol(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addKol() }}
                placeholder="Add @username..."
                style={{ ...inputStyle, width: 180, fontSize: 12, padding: '6px 10px' }}
              />
              <button
                className="btn-accent"
                onClick={addKol}
                disabled={!newKol.trim()}
                style={{
                  padding: '6px 12px', borderRadius: 8, border: 'none', fontSize: 12, fontWeight: 600,
                  background: newKol.trim() ? 'var(--accent)' : 'var(--bg-3)',
                  color: newKol.trim() ? '#fff' : 'var(--text-4)',
                  cursor: newKol.trim() ? 'pointer' : 'not-allowed', fontFamily: 'inherit',
                }}
              >
                Add
              </button>
            </div>
          </div>

          {kols.length === 0 ? (
            <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-4)', fontSize: 13 }}>
              No key accounts yet. Pulse will auto-add high-engagement accounts as it grows your audience, or add them manually above.
            </div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {kols.map(k => (
                <a key={k} href={`https://x.com/${k}`} target="_blank" rel="noreferrer" style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '5px 10px', borderRadius: 8, fontSize: 13,
                  background: 'var(--bg-3)', color: 'var(--text-2)',
                  textDecoration: 'none',
                }}>
                  @{k}
                  <button
                    className="btn-danger"
                    onClick={(e) => { e.preventDefault(); setPendingRemoveKol(k) }}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--text-4)', padding: 0, display: 'flex',
                    }}
                  >
                    <X size={12} />
                  </button>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent Follow Activity */}
      <div style={{ marginTop: 28, paddingBottom: 40, opacity: isOff ? 0.4 : 1, transition: 'opacity 0.3s' }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-1)', margin: '0 0 14px' }}>
          Recent Follows
        </h2>
        {records.length === 0 ? (
          <div style={{ ...cardStyle, textAlign: 'center', padding: 40 }}>
            <Users size={28} style={{ color: 'var(--text-4)', margin: '0 auto 12px' }} />
            <p style={{ color: 'var(--text-2)', fontSize: 14, margin: '0 0 4px' }}>No follow activity yet</p>
            <p style={{ color: 'var(--text-3)', fontSize: 13, margin: 0 }}>
              Enable growth mode and let Pulse engage with your niche.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {records.slice(0, 50).map((r, i) => (
              <div key={i} style={{
                ...cardStyle, padding: 14,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{
                    width: 34, height: 34, borderRadius: 8,
                    background: r.status === 'active' ? 'rgba(16,185,129,0.1)' : 'var(--bg-3)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {r.status === 'active'
                      ? <UserPlus size={16} style={{ color: '#10b981' }} />
                      : <UserMinus size={16} style={{ color: 'var(--text-4)' }} />
                    }
                  </div>
                  <div>
                    <a
                      href={`https://x.com/${r.username}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)', textDecoration: 'none' }}
                    >
                      @{r.username}
                    </a>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                      <span style={{
                        fontSize: 11, padding: '1px 8px', borderRadius: 10,
                        background: `${signalColor(r.signal)}15`, color: signalColor(r.signal),
                      }}>
                        {signalLabel(r.signal)}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text-4)' }}>
                        {r.confidence}% confidence
                      </span>
                    </div>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{formatTime(r.followedAt)}</div>
                  <div style={{
                    fontSize: 11, marginTop: 2,
                    color: r.status === 'active' ? '#10b981' : 'var(--text-4)',
                  }}>
                    {r.status === 'active' ? 'Following' : 'Unfollowed'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal
        open={pendingRemoveKol !== null}
        title="Remove Key Account"
        message={`Remove @${pendingRemoveKol} from your key accounts? You can always add them back later.`}
        confirmLabel="Remove"
        danger
        onConfirm={() => { if (pendingRemoveKol) removeKol(pendingRemoveKol); setPendingRemoveKol(null) }}
        onCancel={() => setPendingRemoveKol(null)}
      />
    </div>
  )
}
