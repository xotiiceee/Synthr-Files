import { useState, useEffect, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Fingerprint, Loader2, Sparkles, TrendingUp, TrendingDown, BarChart3, Brain, Lightbulb, Hash, Clock, MessageSquare, Plus, X, Check } from 'lucide-react'
import { get, post } from '../lib/api'

// ─── Types ──────────────────────────────────────────────────────────────────

interface BrandProfile {
  identity: { name: string; tagline: string; description: string; keyFacts: string[] }
  voice: { neverSay: string[]; signatures: string[]; toneNotes: string }
  styleRules: { useHashtags: boolean; usePolls: boolean; emojiUsage: string; useStoryOpeners: boolean; customRules: string[] }
  contentThemes: string[]
  contentMix: { educational: number; personal: number; engagement: number; promotional: number }
  learned: { topPerformers: string[]; bottomPerformers: string[]; bestHours: number[]; insights: string[]; updatedAt?: string }
  updatedAt: string
}

interface DomainKnowledge {
  chunks?: Array<{ topic: string; content: string; tags: string[] }>
  researchedAt?: string
  niche?: string
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: 'var(--card-bg)', border: '1px solid var(--card-border)',
  borderRadius: 12, padding: 24,
}

const baseTag: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '4px 12px', borderRadius: 12, fontSize: 12, fontWeight: 500,
  background: 'var(--bg-3)', color: 'var(--text-2)', border: '1px solid var(--border)',
}

const emptyHint: React.CSSProperties = { fontSize: 13, color: 'var(--text-4)', fontStyle: 'italic' }

const sectionLabel: React.CSSProperties = { fontSize: 12, fontWeight: 500, color: 'var(--text-3)', display: 'block', marginBottom: 8 }

// ─── Editable Tag ───────────────────────────────────────────────────────────

function EditableTag({ value, tagColors, onEdit, onRemove }: {
  value: string
  tagColors?: React.CSSProperties
  onEdit: (newVal: string) => void
  onRemove: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])

  const commit = () => {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== value) onEdit(trimmed)
    else setDraft(value)
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value); setEditing(false) } }}
        onBlur={commit}
        style={{
          ...baseTag, ...(tagColors || {}),
          outline: 'none', width: Math.max(60, draft.length * 7.5 + 24),
          cursor: 'text', boxSizing: 'border-box',
        }}
      />
    )
  }

  return (
    <span style={{ ...baseTag, ...(tagColors || {}), cursor: 'default' }}>
      <span onClick={() => { setDraft(value); setEditing(true) }} style={{ cursor: 'text' }}>{value}</span>
      <X size={11} onClick={onRemove} style={{ cursor: 'pointer', opacity: 0.4, marginLeft: 2, transition: 'opacity 0.15s' }} onMouseEnter={e => (e.currentTarget.style.opacity = '1')} onMouseLeave={e => (e.currentTarget.style.opacity = '0.4')} />
    </span>
  )
}

// ─── Add Tag Button ─────────────────────────────────────────────────────────

function AddTag({ placeholder, tagColors, onAdd }: {
  placeholder: string
  tagColors?: React.CSSProperties
  onAdd: (val: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (open) inputRef.current?.focus() }, [open])

  const commit = () => {
    const trimmed = draft.trim()
    if (trimmed) onAdd(trimmed)
    setDraft('')
    setOpen(false)
  }

  if (open) {
    return (
      <input
        ref={inputRef}
        value={draft}
        placeholder={placeholder}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(''); setOpen(false) } }}
        onBlur={() => { if (draft.trim()) commit(); else setOpen(false) }}
        style={{
          ...baseTag, ...(tagColors || {}),
          outline: 'none', width: Math.max(100, placeholder.length * 7 + 24),
          cursor: 'text', boxSizing: 'border-box',
        }}
      />
    )
  }

  return (
    <span
      onClick={() => setOpen(true)}
      style={{ ...baseTag, cursor: 'pointer', opacity: 0.5, transition: 'opacity 0.15s' }}
      onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
      onMouseLeave={e => (e.currentTarget.style.opacity = '0.5')}
    >
      <Plus size={11} />
    </span>
  )
}

// ─── Editable Tag List ──────────────────────────────────────────────────────

function TagList({ items, field, tagColors, placeholder, onSave }: {
  items: string[]
  field: string
  tagColors?: React.CSSProperties
  placeholder: string
  onSave: (field: string, items: string[]) => void
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {items.map((item, i) => (
        <EditableTag
          key={`${field}-${i}`}
          value={item}
          tagColors={tagColors}
          onEdit={newVal => { const next = [...items]; next[i] = newVal; onSave(field, next) }}
          onRemove={() => onSave(field, items.filter((_, j) => j !== i))}
        />
      ))}
      <AddTag placeholder={placeholder} tagColors={tagColors} onAdd={val => { if (!items.includes(val)) onSave(field, [...items, val]) }} />
    </div>
  )
}

// ─── Mix Bar ────────────────────────────────────────────────────────────────

function MixBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
      <span style={{ fontSize: 13, color: 'var(--text-2)', width: 100, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 20, background: 'var(--bg-3)', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ width: `${Math.round(value * 100)}%`, height: '100%', background: color, borderRadius: 10, transition: 'width 0.5s' }} />
      </div>
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)', width: 40, textAlign: 'right' }}>{Math.round(value * 100)}%</span>
    </div>
  )
}

// ─── Component ──────────────────────────────────────────────────────────────

const EMOJI_CYCLE = ['none', 'minimal', 'moderate', 'heavy'] as const
const EMOJI_LABELS: Record<string, string> = { none: 'None', minimal: 'Minimal', moderate: 'Moderate', heavy: 'Heavy' }

export default function BrandIntelligence() {
  const [profile, setProfile] = useState<BrandProfile | null>(null)
  const [domain, setDomain] = useState<DomainKnowledge | null>(null)
  const [loading, setLoading] = useState(true)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    (async () => {
      try {
        const data = await get<{ profile: BrandProfile; domain: DomainKnowledge }>('/api/brand-profile')
        setProfile(data.profile)
        setDomain(data.domain)
      } catch { /* empty state */ }
      finally { setLoading(false) }
    })()
  }, [])

  const save = useCallback((updates: Record<string, unknown>) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    setSaveStatus('saving')
    saveTimer.current = setTimeout(async () => {
      try {
        const res = await post<{ ok: boolean; profile: BrandProfile }>('/api/brand-profile', updates)
        if (res.profile) setProfile(res.profile)
        setSaveStatus('saved')
        setTimeout(() => setSaveStatus('idle'), 1500)
      } catch { setSaveStatus('idle') }
    }, 400)
  }, [])

  const saveList = useCallback((field: string, items: string[]) => save({ [field]: items }), [save])

  const toggleStyle = useCallback((key: string, current: boolean) => {
    save({ [key]: !current })
  }, [save])

  const cycleEmoji = useCallback(() => {
    if (!profile) return
    const idx = EMOJI_CYCLE.indexOf(profile.styleRules.emojiUsage as typeof EMOJI_CYCLE[number])
    const next = EMOJI_CYCLE[(idx + 1) % EMOJI_CYCLE.length]
    save({ emojiUsage: next })
  }, [profile, save])

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
        <Loader2 size={20} style={{ color: 'var(--accent)', animation: 'spin 1s linear infinite' }} />
      </div>
    )
  }

  if (!profile) {
    return (
      <div style={{ textAlign: 'center', padding: '80px 20px', color: 'var(--text-3)' }}>
        <Fingerprint size={40} style={{ margin: '0 auto 12px', opacity: 0.4 }} />
        <p style={{ fontSize: 15 }}>No brand profile yet. Create a brand to get started.</p>
        <Link to="/chat-setup" style={{ color: 'var(--accent)', fontSize: 14 }}>Set up in Chat</Link>
      </div>
    )
  }

  const hasIdentity = profile.identity.name || profile.identity.description
  const hasVoice = profile.voice.toneNotes || profile.voice.neverSay.length > 0 || profile.voice.signatures.length > 0
  const hasResearch = domain?.chunks && domain.chunks.length > 0
  const hasLearned = profile.learned.topPerformers.length > 0 || profile.learned.insights.length > 0 || profile.learned.bestHours.length > 0

  const pillStyle = (active: boolean): React.CSSProperties => ({
    padding: '5px 14px', borderRadius: 20, fontSize: 12, fontWeight: 500, cursor: 'pointer',
    background: active ? 'rgba(16,185,129,0.1)' : 'var(--bg-3)',
    color: active ? 'var(--accent)' : 'var(--text-4)',
    border: `1px solid ${active ? 'rgba(16,185,129,0.2)' : 'var(--border)'}`,
    transition: 'all 0.15s', userSelect: 'none' as const,
  })

  const dangerTag = { background: 'rgba(239,68,68,0.1)', color: 'var(--danger)', border: '1px solid rgba(239,68,68,0.2)' }
  const purpleTag = { background: 'rgba(139,92,246,0.1)', color: '#8b5cf6', border: '1px solid rgba(139,92,246,0.2)' }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '0 16px 60px', overflowX: 'hidden', boxSizing: 'border-box', wordBreak: 'break-word' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          background: 'var(--accent-dim)', border: '1px solid var(--accent-glow)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Fingerprint size={18} style={{ color: 'var(--accent)' }} />
        </div>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--text-1)', margin: 0 }}>Brand Intelligence</h1>
          <p style={{ fontSize: 13, color: 'var(--text-3)', margin: 0 }}>What Pulse knows about your brand</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {saveStatus === 'saving' && <span style={{ fontSize: 12, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 4 }}><Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> Saving</span>}
          {saveStatus === 'saved' && <span style={{ fontSize: 12, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 4 }}><Check size={12} /> Saved</span>}
          <Link to="/chat-setup" style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '7px 14px', borderRadius: 8, fontSize: 13, fontWeight: 500,
            background: 'var(--accent)', color: '#fff', textDecoration: 'none',
          }}>
            <MessageSquare size={14} /> Customize in Chat
          </Link>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* ── Identity ─────────────────────────────────────────────────── */}
        <div style={cardStyle}>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-1)', margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sparkles size={16} style={{ color: 'var(--accent)' }} /> Identity
          </h3>
          {hasIdentity ? (
            <>
              {profile.identity.name && <p style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-1)', margin: '0 0 4px' }}>{profile.identity.name}</p>}
              {profile.identity.tagline && <p style={{ fontSize: 14, color: 'var(--text-3)', margin: '0 0 12px' }}>{profile.identity.tagline}</p>}
              {profile.identity.description && <p style={{ fontSize: 14, color: 'var(--text-2)', margin: 0, lineHeight: 1.6 }}>{profile.identity.description}</p>}
              <div style={{ marginTop: 16 }}>
                <span style={sectionLabel}>Key Facts</span>
                <TagList items={profile.identity.keyFacts} field="keyFacts" placeholder="add a fact" onSave={saveList} />
              </div>
            </>
          ) : (
            <p style={emptyHint}>Pulse will learn your brand identity from your niche and conversations.</p>
          )}
        </div>

        {/* ── Voice ────────────────────────────────────────────────────── */}
        <div style={cardStyle}>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-1)', margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Brain size={16} style={{ color: '#8b5cf6' }} /> Voice
          </h3>
          {hasVoice ? (
            <>
              {profile.voice.toneNotes && <p style={{ fontSize: 14, color: 'var(--text-2)', margin: '0 0 16px' }}>{profile.voice.toneNotes}</p>}
              <div style={{ marginBottom: 16 }}>
                <span style={sectionLabel}>Never Say</span>
                <TagList items={profile.voice.neverSay} field="neverSay" tagColors={dangerTag} placeholder="add banned word" onSave={saveList} />
              </div>
              {profile.voice.signatures.length > 0 && (
                <div>
                  <span style={sectionLabel}>Signature Phrases</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {profile.voice.signatures.map((s, i) => <span key={i} style={{ ...baseTag, ...purpleTag }}>{s}</span>)}
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <p style={emptyHint}>Pulse analyzes your niche to learn how your community sounds.</p>
              <div style={{ marginTop: 12 }}>
                <span style={sectionLabel}>Never Say</span>
                <TagList items={[]} field="neverSay" tagColors={dangerTag} placeholder="add banned word" onSave={saveList} />
              </div>
            </>
          )}
        </div>

        {/* ── Style Rules ─────────────────────────────────────────────── */}
        <div style={cardStyle}>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-1)', margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Hash size={16} style={{ color: '#f59e0b' }} /> Style
          </h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <span style={pillStyle(profile.styleRules.useHashtags)} onClick={() => toggleStyle('useHashtags', profile.styleRules.useHashtags)}>
              {profile.styleRules.useHashtags ? '\u2713' : '\u2715'} Hashtags
            </span>
            <span style={pillStyle(profile.styleRules.usePolls)} onClick={() => toggleStyle('usePolls', profile.styleRules.usePolls)}>
              {profile.styleRules.usePolls ? '\u2713' : '\u2715'} Polls
            </span>
            <span style={pillStyle(profile.styleRules.useStoryOpeners)} onClick={() => toggleStyle('useStoryOpeners', profile.styleRules.useStoryOpeners)}>
              {profile.styleRules.useStoryOpeners ? '\u2713' : '\u2715'} Story Openers
            </span>
            <span style={{ ...pillStyle(false), cursor: 'pointer' }} onClick={cycleEmoji}>
              Emoji: {EMOJI_LABELS[profile.styleRules.emojiUsage] || 'None'}
            </span>
          </div>
          <div style={{ marginTop: 16 }}>
            <span style={sectionLabel}>Custom Rules</span>
            <TagList items={profile.styleRules.customRules} field="customRules" placeholder="add a rule" onSave={saveList} />
          </div>
        </div>

        {/* ── Content Mix ─────────────────────────────────────────────── */}
        <div style={cardStyle}>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-1)', margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <BarChart3 size={16} style={{ color: 'var(--accent)' }} /> Content Mix
            {profile.learned.updatedAt && <span style={{ fontSize: 11, color: 'var(--text-4)', fontWeight: 400, marginLeft: 'auto' }}>Adjusted from engagement</span>}
          </h3>
          <MixBar label="Educational" value={profile.contentMix.educational} color="#10b981" />
          <MixBar label="Personal" value={profile.contentMix.personal} color="#8b5cf6" />
          <MixBar label="Engagement" value={profile.contentMix.engagement} color="#3b82f6" />
          <MixBar label="Promotional" value={profile.contentMix.promotional} color="#f59e0b" />
          <p style={{ fontSize: 12, color: 'var(--text-4)', marginTop: 8, marginBottom: 0 }}>Auto-adjusts based on what your audience engages with.</p>
        </div>

        {/* ── Content Themes ──────────────────────────────────────────── */}
        <div style={cardStyle}>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-1)', margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Lightbulb size={16} style={{ color: '#f59e0b' }} /> Content Themes
          </h3>
          <TagList items={profile.contentThemes} field="contentThemes" placeholder="add a theme" onSave={saveList} />
          {profile.contentThemes.length === 0 && <p style={{ ...emptyHint, marginTop: 8 }}>Themes are seeded from niche research and grow from engagement.</p>}
        </div>

        {/* ── Niche Research ──────────────────────────────────────────── */}
        {hasResearch && (
          <div style={cardStyle}>
            <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-1)', margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Sparkles size={16} style={{ color: '#3b82f6' }} /> Niche Research
              {domain!.researchedAt && <span style={{ fontSize: 11, color: 'var(--text-4)', fontWeight: 400, marginLeft: 'auto' }}>Researched {new Date(domain!.researchedAt).toLocaleDateString()}</span>}
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {domain!.chunks!.map((chunk, i) => (
                <div key={i} style={{ padding: 12, background: 'var(--bg-2)', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{chunk.topic}</span>
                    {chunk.tags.map((tag, j) => (
                      <span key={j} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 6, background: 'var(--bg-3)', color: 'var(--text-4)', border: '1px solid var(--border)' }}>{tag}</span>
                    ))}
                  </div>
                  <p style={{ fontSize: 13, color: 'var(--text-2)', margin: 0, lineHeight: 1.5 }}>{chunk.content}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Learned Patterns ────────────────────────────────────────── */}
        {hasLearned && (
          <div style={cardStyle}>
            <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-1)', margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <TrendingUp size={16} style={{ color: 'var(--accent)' }} /> Learned from Engagement
            </h3>
            {profile.learned.topPerformers.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <span style={sectionLabel}>What Resonates</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {profile.learned.topPerformers.map((p, i) => (
                    <span key={i} style={{ ...baseTag, background: 'rgba(16,185,129,0.1)', color: 'var(--accent)', border: '1px solid rgba(16,185,129,0.2)' }}>
                      <TrendingUp size={11} /> {p}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {profile.learned.bottomPerformers.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <span style={sectionLabel}>What Doesn't Land</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {profile.learned.bottomPerformers.map((p, i) => (
                    <span key={i} style={{ ...baseTag, background: 'rgba(239,68,68,0.1)', color: 'var(--danger)', border: '1px solid rgba(239,68,68,0.2)' }}>
                      <TrendingDown size={11} /> {p}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {profile.learned.bestHours.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <span style={sectionLabel}>Best Posting Hours</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {profile.learned.bestHours.map((h, i) => <span key={i} style={baseTag}><Clock size={11} /> {h}:00</span>)}
                </div>
              </div>
            )}
            {profile.learned.insights.length > 0 && (
              <div>
                <span style={sectionLabel}>Insights</span>
                {profile.learned.insights.map((insight, i) => (
                  <p key={i} style={{ fontSize: 13, color: 'var(--text-2)', margin: '0 0 6px', paddingLeft: 12, borderLeft: '2px solid var(--accent)' }}>{insight}</p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
