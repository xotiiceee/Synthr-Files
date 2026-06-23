import { useState, useEffect } from 'react'
import {
  PenLine, Loader2, Send, Sparkles, Clock, CheckCircle, AlertCircle,
  Edit3, RefreshCw, Trash2, Calendar, Save, X,
  Copy, Eye, Image, ShieldCheck,
} from 'lucide-react'
import { get, post, del, loadAccountPermissions, type AccountPermissionsResponse } from '../lib/api'
import Modal from '../components/Modal'

// ─── Platform SVG Icons ──────────────────────────────────────────────────────

const PlatformIcon = ({ platform, size = 16, color }: { platform: string; size?: number; color?: string }) => {
  switch (platform) {
    case 'x':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill={color || 'currentColor'}>
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      )
    default:
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
      )
  }
}

// ─── Platform & Content Type Config ──────────────────────────────────────────

interface PlatformDef {
  key: string
  label: string
  charLimit: number
  color: string
}

const PLATFORMS: PlatformDef[] = [
  { key: 'x', label: 'X', charLimit: 280, color: '#1d9bf0' },
]

const CONTENT_TYPES: Record<string, Array<{ key: string; label: string }>> = {
  x: [{ key: 'post', label: 'Post' }, { key: 'thread', label: 'Thread' }],
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface QueueItem {
  id: number
  content: string
  platform: string
  type: string
  status: string
  theme?: string
  scheduledAt?: string
  publishedAt?: string
  createdAt?: string
}

interface GeneratedContent {
  text: string
  platform: string
  type: string
  thread?: string[]
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: 'var(--card-bg)',
  border: '1px solid var(--card-border)',
  borderRadius: 12,
  padding: 24,
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function Create() {
  // Platform & content
  const [platform, setPlatform] = useState('x')
  const [contentType, setContentType] = useState('post')
  const [topic, setTopic] = useState('')

  // Generation
  const [generating, setGenerating] = useState(false)
  const [preview, setPreview] = useState<GeneratedContent | null>(null)
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState('')

  // Queue
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [queueFilter, setQueueFilter] = useState('all')
  const [platformFilter, setPlatformFilter] = useState('all')
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  // Edit queue item
  const [editingItem, setEditingItem] = useState<number | null>(null)
  const [editItemText, setEditItemText] = useState('')

  // Schedule
  const [scheduling, setScheduling] = useState(false)
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null)
  const [scheduleDate, setScheduleDate] = useState('')
  const [scheduleTime, setScheduleTime] = useState('12:00')

  // Model & cost
  const [contentModel, setContentModel] = useState('llama-3.3-70b')
  const [modelLabel, setModelLabel] = useState('Llama 3.3 70B')
  const [estimatedCost, setEstimatedCost] = useState(0)
  const [lastCost, setLastCost] = useState<number | null>(null)
  const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null)
  const [creditError, setCreditError] = useState<string | null>(null)
  const [permissions, setPermissions] =
    useState<AccountPermissionsResponse | null>(null)

  // Image attachment
  const [attachedImage, setAttachedImage] = useState<{ id: string; name: string; source: string; tags: string[] } | null>(null)
  const [showImagePicker, setShowImagePicker] = useState(false)
  const [libraryImages, setLibraryImages] = useState<any[]>([])
  const [imagePickerLoading, setImagePickerLoading] = useState(false)

  // ─── Data fetching ──────────────────────────────────────────────────────

  const fetchQueue = async () => {
    try {
      const data = await get<{ queue: QueueItem[] }>('/api/content-queue')
      setQueue(data.queue || [])
    } catch {
      // Fallback to old queue endpoint
      try {
        const data = await get<{ queue?: QueueItem[] }>('/api/queue')
        setQueue(data.queue || [])
      } catch {
        setQueue([])
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchQueue() }, [])

  useEffect(() => {
    loadAccountPermissions()
      .then(setPermissions)
      .catch(() => setPermissions(null))
  }, [])

  // Load user's model preference and estimate cost
  useEffect(() => {
    get('/api/config').then((cfg: any) => {
      const model = cfg?.account?.contentModel || 'llama-3.3-70b'
      setContentModel(model)
    }).catch(() => {})
    get('/api/content-models').then((d: any) => {
      if (d.models) {
        const model = contentModel
        const m = d.models.find((x: any) => x.id === model)
        if (m) setModelLabel(m.label)
      }
    }).catch(() => {})
  }, [])

  // Update cost estimate when model or content type changes
  useEffect(() => {
    const action = contentType === 'thread' ? 'thread_generation' : 'generate_post'
    post('/api/estimate', { action, model: contentModel })
      .then((d: any) => { if (d.cost != null) setEstimatedCost(d.cost) })
      .catch(() => {})
  }, [contentModel, contentType])

  // Reset content type when platform changes
  useEffect(() => {
    const types = CONTENT_TYPES[platform] || CONTENT_TYPES['x']
    if (!types.some(t => t.key === contentType)) {
      setContentType(types[0].key)
    }
  }, [platform])

  // ─── Handlers ───────────────────────────────────────────────────────────

  const generate = async () => {
    if (!topic.trim() || generating) return
    setGenerating(true)
    setPreview(null)
    try {
      const data = await post<{ ok: boolean; content: any; cost?: number; creditsRemaining?: number }>('/api/generate', {
        topic: topic.trim(),
        platform: platform === 'all' ? 'x' : platform,
        type: contentType,
        model: contentModel,
      })
      if (data.ok && data.content) {
        const text = typeof data.content === 'string' ? data.content
          : data.content.text || data.content.content || JSON.stringify(data.content)
        setPreview({
          text,
          platform: platform === 'all' ? 'x' : platform,
          type: contentType,
          thread: Array.isArray(data.content) ? data.content
            : data.content.tweets || data.content.thread || undefined,
        })
        setEditText(text)
        if (data.cost != null) setLastCost(data.cost)
        if (data.creditsRemaining != null) setCreditsRemaining(data.creditsRemaining)
      }
    } catch (e: any) {
      if (e.message?.includes('Insufficient credits') || e.message?.includes('Not enough credits')) {
        setCreditError('Not enough usage entitlement. Manage your plan in Settings to continue.')
      } else {
        setCreditError('Generation failed — please try again.')
      }
    } finally {
      setGenerating(false)
    }
  }

  const addToQueue = async (status: 'draft' | 'scheduled') => {
    if (!preview) return
    const text = editing ? editText : preview.text
    const body: any = {
      content: text,
      platform: preview.platform,
      type: preview.type,
      theme: topic,
      status,
    }
    if (status === 'scheduled' && scheduleDate) {
      body.scheduledAt = `${scheduleDate}T${scheduleTime}:00.000Z`
    }
    try {
      await post('/api/content-queue', body)
      setPreview(null)
      setEditing(false)
      setScheduling(false)
      setTopic('')
      await fetchQueue()
    } catch (e) {
      console.error('Queue add failed:', e)
    }
  }

  const publishNow = async () => {
    if (!preview) return
    const text = editing ? editText : preview.text
    try {
      await post('/api/content-queue/publish-now', {
        content: text,
        platform: preview.platform,
        type: preview.type,
        theme: topic,
      })
      setPreview(null)
      setEditing(false)
      setTopic('')
      await fetchQueue()
    } catch (e) {
      console.error('Publish failed:', e)
    }
  }

  const queueAction = async (id: number, action: string, data?: any) => {
    setActionLoading(`${id}-${action}`)
    try {
      await post(`/api/content-queue/${id}/${action}`, data || {})
      if (action === 'edit') setEditingItem(null)
      await fetchQueue()
    } catch (e) {
      console.error(`Queue ${action} failed:`, e)
    } finally {
      setActionLoading(null)
    }
  }

  const deleteQueueItem = async (id: number) => {
    setActionLoading(`${id}-delete`)
    try {
      await del(`/api/content-queue/${id}`)
      await fetchQueue()
    } catch {
      // Fallback to POST delete
      try {
        await post(`/api/content-queue/${id}/delete`)
        await fetchQueue()
      } catch (e) {
        console.error('Delete failed:', e)
      }
    } finally {
      setActionLoading(null)
    }
  }

  // ─── Derived state ─────────────────────────────────────────────────────

  const activePlatform = PLATFORMS.find(p => p.key === platform)!
  const activeTypes = CONTENT_TYPES[platform] || CONTENT_TYPES['x']
  const charLimit = activePlatform.charLimit
  const previewLength = preview ? (editing ? editText.length : preview.text.length) : 0
  const overLimit = charLimit > 0 && previewLength > charLimit
  const canApproveDrafts = permissions?.permissions.draftApprove === true
  const canCreateDrafts = permissions?.permissions.draftCreate === true
  const roleLabel = permissions?.role || 'loading'

  const filteredQueue = queue.filter(item => {
    if (queueFilter !== 'all' && item.status !== queueFilter) return false
    if (platformFilter !== 'all' && item.platform !== platformFilter) return false
    return true
  })

  const statusFilters = ['all', 'draft', 'scheduled', 'published', 'failed'] as const
  const queuePlatforms = [...new Set(queue.map(q => q.platform))]

  const formatTime = (ts?: string) => {
    if (!ts) return ''
    const d = new Date(ts)
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' +
      d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  }

  const platformBadge = (key: string) => {
    const p = PLATFORMS.find(pl => pl.key === key)
    if (!p) return null
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 22, height: 22, borderRadius: 6,
        background: `${p.color}20`, flexShrink: 0,
      }}>
        <PlatformIcon platform={key} size={14} color={p.color} />
      </span>
    )
  }

  const statusBadge = (status: string) => {
    const styles: Record<string, { bg: string; color: string; icon: any }> = {
      draft: { bg: 'rgba(245,158,11,0.1)', color: '#f59e0b', icon: Edit3 },
      scheduled: { bg: 'rgba(59,130,246,0.1)', color: '#3b82f6', icon: Clock },
      published: { bg: 'rgba(16,185,129,0.1)', color: '#10b981', icon: CheckCircle },
      failed: { bg: 'rgba(239,68,68,0.1)', color: '#ef4444', icon: AlertCircle },
      approved: { bg: 'rgba(16,185,129,0.08)', color: '#34d399', icon: Sparkles },
      pending: { bg: 'rgba(245,158,11,0.1)', color: '#f59e0b', icon: Clock },
    }
    const s = styles[status] || styles.draft
    const Icon = s.icon
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 500,
        background: s.bg, color: s.color, border: `1px solid ${s.color}20`,
      }}>
        <Icon size={12} />
        {status}
      </span>
    )
  }

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '0 24px', minHeight: '100%', overflowY: 'auto', overflowX: 'hidden', boxSizing: 'border-box', wordBreak: 'break-word' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14, padding: '24px 0 20px',
        borderBottom: '1px solid var(--border-subtle)',
      }}>
        <div style={{
          width: 42, height: 42, borderRadius: 12,
          background: 'var(--accent-dim)', border: '1px solid var(--accent-glow)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <PenLine size={20} style={{ color: 'var(--accent)' }} />
        </div>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--text-1)', margin: 0 }}>Create</h1>
          <p style={{ fontSize: 13, color: 'var(--text-3)', margin: 0 }}>Create and schedule X content and review drafts</p>
        </div>
      </div>

      {/* Platform Selector */}
      <div style={{ marginTop: 24, marginBottom: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
          Platform
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {PLATFORMS.map(p => (
            <button
              key={p.key}
              className="btn-tab"
              data-active={platform === p.key ? "true" : "false"}
              onClick={() => setPlatform(p.key)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 16px', borderRadius: 10, fontSize: 13, fontWeight: 600,
                cursor: 'pointer', transition: 'all 0.15s', border: 'none',
                fontFamily: 'inherit',
                background: platform === p.key ? p.color : 'var(--bg-3)',
                color: platform === p.key ? '#fff' : 'var(--text-2)',
              }}
            >
              <span style={{
                width: 20, height: 20, borderRadius: 5,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: platform === p.key ? 'rgba(255,255,255,0.2)' : `${p.color}20`,
              }}>
                <PlatformIcon platform={p.key} size={13} color={platform === p.key ? '#fff' : p.color} />
              </span>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content Type Selector */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10, marginTop: 16 }}>
          Content Type
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {activeTypes.map(t => (
            <button
              key={t.key}
              className="btn-tab"
              data-active={contentType === t.key ? "true" : "false"}
              onClick={() => setContentType(t.key)}
              style={{
                padding: '7px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500,
                cursor: 'pointer', transition: 'all 0.15s', fontFamily: 'inherit',
                border: contentType === t.key ? '1px solid var(--accent)' : '1px solid var(--border)',
                background: contentType === t.key ? 'var(--accent-dim)' : 'var(--bg-2)',
                color: contentType === t.key ? 'var(--accent)' : 'var(--text-3)',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Input Area */}
      <div style={{ ...cardStyle, marginTop: 8 }}>
        <textarea
          value={topic}
          onChange={e => setTopic(e.target.value)}
          placeholder={
            platform === 'all'
              ? 'Enter a topic — we\'ll generate platform-specific versions...'
              : contentType === 'thread'
                ? 'Enter a topic for your thread...'
                : `What do you want to post on ${activePlatform.label}?`
          }
          rows={4}
          style={{
            width: '100%', background: 'var(--input-bg)', border: '1px solid var(--input-border)',
            borderRadius: 8, padding: '12px 14px', color: 'var(--text-1)',
            fontSize: 14, lineHeight: 1.6, resize: 'vertical', fontFamily: 'inherit',
            outline: 'none',
          }}
          onFocus={e => e.target.style.borderColor = 'var(--accent)'}
          onBlur={e => e.target.style.borderColor = 'var(--input-border)'}
          onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) generate() }}
        />

        {creditError && (
          <div style={{
            fontSize: 13, color: 'var(--danger)', background: 'rgba(239,68,68,0.06)',
            border: '1px solid rgba(239,68,68,0.15)', borderRadius: 10,
            padding: '10px 14px', marginTop: 14, lineHeight: 1.5,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <span>{creditError}</span>
            <a href="/settings" style={{
              padding: '5px 14px', background: 'var(--accent)', color: '#fff',
              borderRadius: 8, fontSize: 12, fontWeight: 600, textDecoration: 'none', flexShrink: 0,
            }}>
              Manage Plan
            </a>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              className="btn-accent"
              onClick={() => { setCreditError(null); generate(); }}
              disabled={generating || !topic.trim()}
              style={{
                padding: '10px 22px', background: 'var(--accent)', color: '#fff',
                borderRadius: 10, border: 'none', fontSize: 14, fontWeight: 600,
                cursor: generating || !topic.trim() ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 8,
                opacity: generating || !topic.trim() ? 0.5 : 1, transition: 'all 0.15s',
              }}
            >
              {generating
                ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                : <Sparkles size={16} />
              }
              Generate
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {estimatedCost > 0 && (
              <span style={{
                fontSize: 12, fontWeight: 500, padding: '4px 12px', borderRadius: 20,
                background: 'var(--accent-dim)', color: 'var(--accent)',
                border: '1px solid var(--accent-glow)',
              }}>
                ~{estimatedCost} cr · {modelLabel}
                <span style={{ color: 'var(--text-4)', fontWeight: 400, marginLeft: 4 }}>
                  {estimatedCost <= 2 ? '(fast)' : estimatedCost <= 10 ? '(balanced)' : '(best quality)'}
                </span>
              </span>
            )}
            {charLimit > 0 && (
              <span style={{ fontSize: 12, color: 'var(--text-4)' }}>
                {activePlatform.label}: {charLimit.toLocaleString()} chars
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Preview Card */}
      {preview && (
        <div style={{
          ...cardStyle, marginTop: 20,
          borderColor: overLimit ? '#ef4444' : 'var(--accent)',
          borderWidth: 1, borderStyle: 'solid',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Eye size={16} style={{ color: 'var(--accent)' }} />
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)' }}>Preview</span>
              {platformBadge(preview.platform)}
              <span style={{ fontSize: 12, color: 'var(--text-4)' }}>{preview.type}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {charLimit > 0 && (
                <span style={{
                  fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
                  color: overLimit ? '#ef4444' : previewLength > charLimit * 0.9 ? '#f59e0b' : 'var(--text-4)',
                }}>
                  {previewLength} / {charLimit}
                </span>
              )}
              <button
                onClick={() => { setEditing(!editing); if (!editing) setEditText(preview.text) }}
                style={{
                  padding: '5px 10px', borderRadius: 6, fontSize: 12, fontWeight: 500,
                  border: '1px solid var(--border)', background: editing ? 'var(--accent-dim)' : 'var(--bg-2)',
                  color: editing ? 'var(--accent)' : 'var(--text-3)', cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                {editing ? 'Done' : 'Edit'}
              </button>
            </div>
          </div>

          {editing ? (
            <textarea
              value={editText}
              onChange={e => setEditText(e.target.value)}
              style={{
                width: '100%', background: 'var(--input-bg)', border: '1px solid var(--input-border)',
                borderRadius: 8, padding: '12px 14px', color: 'var(--text-1)',
                fontSize: 14, lineHeight: 1.7, resize: 'vertical', fontFamily: 'inherit',
                outline: 'none', minHeight: 100,
              }}
            />
          ) : (
            <div style={{
              color: 'var(--text-1)', fontSize: 14, lineHeight: 1.7,
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              padding: '12px 14px', background: 'var(--bg-2)', borderRadius: 8,
            }}>
              {preview.text}
            </div>
          )}

          {/* Cost info */}
          {lastCost != null && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12, marginTop: 12,
              padding: '8px 14px', background: 'var(--bg-2)', borderRadius: 8, fontSize: 12,
            }}>
              <span style={{ color: 'var(--text-3)' }}>Usage: <strong style={{ color: 'var(--accent)' }}>{lastCost} units</strong></span>
              {creditsRemaining != null && (
                <span style={{ color: 'var(--text-4)' }}>Allowance: {creditsRemaining.toLocaleString()} units</span>
              )}
            </div>
          )}

          {/* Image attachment */}
          <div style={{ marginTop: 12, padding: 12, background: 'var(--bg-2)', borderRadius: 8, border: '1px solid var(--border)' }}>
            {attachedImage ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <img
                  src={attachedImage.source.startsWith('http') ? attachedImage.source : `/api/media-file/${attachedImage.source}`}
                  alt={attachedImage.name}
                  style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 8 }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>{attachedImage.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-4)' }}>{attachedImage.tags.slice(0, 4).join(', ')}</div>
                </div>
                <button onClick={() => setAttachedImage(null)} style={{
                  background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--text-4)',
                }}>
                  <X size={16} />
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Image size={16} style={{ color: 'var(--text-4)' }} />
                <span style={{ fontSize: 13, color: 'var(--text-3)' }}>No image attached</span>
                <button onClick={async () => {
                  setShowImagePicker(true)
                  setImagePickerLoading(true)
                  try {
                    const data = await get<{ assets: any[] }>('/api/media')
                    setLibraryImages(data.assets || [])
                  } catch {}
                  setImagePickerLoading(false)
                }} style={{
                  marginLeft: 'auto', padding: '4px 12px', borderRadius: 6, fontSize: 12,
                  border: '1px solid var(--border)', background: 'transparent',
                  color: 'var(--text-3)', cursor: 'pointer',
                }}>
                  Browse Library
                </button>
              </div>
            )}
          </div>

          {/* Image picker modal */}
          {showImagePicker && (
            <div onClick={() => setShowImagePicker(false)} style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000,
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
            }}>
              <div onClick={e => e.stopPropagation()} style={{
                background: 'var(--card-bg)', borderRadius: 16, padding: 24,
                width: '100%', maxWidth: 600, maxHeight: '80vh', overflowY: 'auto',
                border: '1px solid var(--card-border)',
              }}>
                <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 700, color: 'var(--text-1)' }}>
                  Pick an image
                </h3>
                {imagePickerLoading ? (
                  <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-3)' }}><Loader2 size={20} className="spin" /></div>
                ) : libraryImages.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-3)' }}>
                    <p>No images in library. Go to the Media tab to upload or generate images.</p>
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
                    {libraryImages.map((img: any) => (
                      <div key={img.id} onClick={() => {
                        setAttachedImage({ id: img.id, name: img.name, source: img.source, tags: img.tags })
                        setShowImagePicker(false)
                      }} style={{
                        cursor: 'pointer', borderRadius: 8, overflow: 'hidden',
                        border: '2px solid transparent', transition: 'border-color 0.15s',
                      }}>
                        <img
                          src={img.source.startsWith('http') ? img.source : `/api/media-file/${img.source}`}
                          alt={img.name}
                          style={{ width: '100%', height: 100, objectFit: 'cover' }}
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                        />
                        <div style={{ padding: 4, fontSize: 11, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {img.name}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
                  <button onClick={() => setShowImagePicker(false)} style={{
                    padding: '6px 14px', borderRadius: 6, fontSize: 13,
                    border: '1px solid var(--border)', background: 'transparent',
                    color: 'var(--text-3)', cursor: 'pointer',
                  }}>
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
            <button
              className="btn"
              onClick={publishNow}
              disabled={!canApproveDrafts}
              style={{
                padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                background: canApproveDrafts ? 'var(--accent)' : 'var(--bg-3)',
                color: canApproveDrafts ? '#fff' : 'var(--text-4)', border: 'none',
                cursor: canApproveDrafts ? 'pointer' : 'not-allowed',
                fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              <Send size={14} /> Post Now
            </button>
            <button
              className="btn"
              onClick={() => setScheduling(!scheduling)}
              disabled={!canCreateDrafts}
              style={{
                padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500,
                background: 'var(--bg-2)', color: 'var(--text-2)', border: '1px solid var(--border)',
                cursor: canCreateDrafts ? 'pointer' : 'not-allowed',
                opacity: canCreateDrafts ? 1 : 0.55,
                fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              <Calendar size={14} /> Schedule
            </button>
            <button
              className="btn"
              onClick={() => addToQueue('draft')}
              disabled={!canCreateDrafts}
              style={{
                padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500,
                background: 'var(--bg-2)', color: 'var(--text-2)', border: '1px solid var(--border)',
                cursor: canCreateDrafts ? 'pointer' : 'not-allowed',
                opacity: canCreateDrafts ? 1 : 0.55,
                fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              <Save size={14} /> Save Draft
            </button>
            <button
              className="btn"
              onClick={generate}
              disabled={generating}
              style={{
                padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500,
                background: 'var(--bg-2)', color: 'var(--text-2)', border: '1px solid var(--border)',
                cursor: generating ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', gap: 6,
                opacity: generating ? 0.5 : 1,
              }}
            >
              <RefreshCw size={14} /> Regenerate
            </button>
            <button
              className="btn"
              onClick={() => { navigator.clipboard.writeText(editing ? editText : preview.text) }}
              style={{
                padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500,
                background: 'var(--bg-2)', color: 'var(--text-2)', border: '1px solid var(--border)',
                cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              <Copy size={14} /> Copy
            </button>
            <button
              className="btn-danger"
              onClick={() => { setPreview(null); setEditing(false) }}
              style={{
                padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500,
                background: 'transparent', color: 'var(--text-4)', border: '1px solid var(--border)',
                cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              <X size={14} /> Discard
            </button>
          </div>

          {/* Schedule picker */}
          {scheduling && (
            <div style={{
              marginTop: 12, padding: 14, background: 'var(--bg-2)', borderRadius: 8,
              border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <input
                type="date"
                value={scheduleDate}
                onChange={e => setScheduleDate(e.target.value)}
                style={{
                  padding: '6px 10px', background: 'var(--input-bg)', border: '1px solid var(--input-border)',
                  borderRadius: 6, color: 'var(--text-1)', fontSize: 13, fontFamily: 'inherit', outline: 'none',
                }}
              />
              <input
                type="time"
                value={scheduleTime}
                onChange={e => setScheduleTime(e.target.value)}
                style={{
                  padding: '6px 10px', background: 'var(--input-bg)', border: '1px solid var(--input-border)',
                  borderRadius: 6, color: 'var(--text-1)', fontSize: 13, fontFamily: 'inherit', outline: 'none',
                }}
              />
              <button
                onClick={() => addToQueue('scheduled')}
                disabled={!scheduleDate || !canCreateDrafts}
                style={{
                  padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600,
                  background: scheduleDate && canCreateDrafts ? 'var(--accent)' : 'var(--bg-3)',
                  color: scheduleDate && canCreateDrafts ? '#fff' : 'var(--text-4)',
                  border: 'none', cursor: scheduleDate && canCreateDrafts ? 'pointer' : 'not-allowed', fontFamily: 'inherit',
                }}
              >
                Confirm
              </button>
            </div>
          )}
        </div>
      )}

      {/* Queue Section */}
      <div style={{ marginTop: 32, paddingBottom: 40 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-1)', margin: 0 }}>Queue</h2>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 5, height: 24,
              padding: '0 8px', borderRadius: 12, fontSize: 11, fontWeight: 600,
              color: canApproveDrafts ? 'var(--accent)' : 'var(--text-3)',
              background: canApproveDrafts ? 'var(--accent-dim)' : 'var(--bg-3)',
              border: canApproveDrafts ? '1px solid var(--accent-glow)' : '1px solid var(--border)',
              textTransform: 'capitalize',
            }}>
              <ShieldCheck size={12} /> {roleLabel}
            </span>
          </div>
          <span style={{ fontSize: 13, color: 'var(--text-3)' }}>
            {queue.length} item{queue.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Status filters */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
          {statusFilters.map(f => (
            <button
              key={f}
              className="btn-tab"
              data-active={queueFilter === f ? "true" : "false"}
              onClick={() => setQueueFilter(f)}
              style={{
                padding: '5px 14px', borderRadius: 20, fontSize: 12, fontWeight: 500,
                cursor: 'pointer', transition: 'all 0.15s', border: 'none', fontFamily: 'inherit',
                background: queueFilter === f ? 'var(--accent)' : 'var(--bg-3)',
                color: queueFilter === f ? '#fff' : 'var(--text-3)',
                textTransform: 'capitalize',
              }}
            >
              {f}
            </button>
          ))}
          {queuePlatforms.length > 1 && (
            <>
              <div style={{ width: 1, background: 'var(--border)', margin: '0 4px' }} />
              {['all', ...queuePlatforms].map(p => (
                <button
                  key={p}
                  className="btn-tab"
                  data-active={platformFilter === p ? "true" : "false"}
                  onClick={() => setPlatformFilter(p)}
                  style={{
                    padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 500,
                    cursor: 'pointer', transition: 'all 0.15s', border: 'none', fontFamily: 'inherit',
                    background: platformFilter === p ? 'var(--accent)' : 'var(--bg-3)',
                    color: platformFilter === p ? '#fff' : 'var(--text-3)',
                    textTransform: 'capitalize',
                  }}
                >
                  {p === 'all' ? 'All' : PLATFORMS.find(pl => pl.key === p)?.label || p}
                </button>
              ))}
            </>
          )}
        </div>

        {/* Queue items */}
        {loading ? (
          <div style={{ ...cardStyle, textAlign: 'center', padding: 40 }}>
            <Loader2 size={20} style={{ color: 'var(--accent)', animation: 'spin 1s linear infinite', margin: '0 auto 8px' }} />
            <p style={{ color: 'var(--text-3)', fontSize: 13, margin: 0 }}>Loading queue...</p>
          </div>
        ) : filteredQueue.length === 0 ? (
          <div style={{ ...cardStyle, textAlign: 'center', padding: 40 }}>
            <PenLine size={28} style={{ color: 'var(--text-4)', margin: '0 auto 12px' }} />
            <p style={{ color: 'var(--text-2)', fontSize: 14, margin: '0 0 4px' }}>
              {queueFilter === 'all' && platformFilter === 'all' ? 'Queue is empty' : 'No matching items'}
            </p>
            <p style={{ color: 'var(--text-3)', fontSize: 13, margin: 0 }}>
              Generate content above to get started.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filteredQueue.map(item => (
              <div key={item.id} style={{ ...cardStyle, padding: 18 }}>
                {/* Item header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {platformBadge(item.platform)}
                    <span style={{ fontSize: 12, color: 'var(--text-3)', textTransform: 'capitalize' }}>{item.type}</span>
                    {item.theme && (
                      <span style={{ fontSize: 12, color: 'var(--text-4)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.theme}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {item.scheduledAt && (
                      <span style={{ fontSize: 12, color: 'var(--text-4)', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Clock size={11} /> {formatTime(item.scheduledAt)}
                      </span>
                    )}
                    {statusBadge(item.status)}
                  </div>
                </div>

                {/* Content */}
                {editingItem === item.id ? (
                  <div style={{ marginBottom: 10 }}>
                    <textarea
                      value={editItemText}
                      onChange={e => setEditItemText(e.target.value)}
                      style={{
                        width: '100%', background: 'var(--input-bg)', border: '1px solid var(--accent)',
                        borderRadius: 8, padding: '10px 12px', color: 'var(--text-1)',
                        fontSize: 13, lineHeight: 1.6, resize: 'vertical', fontFamily: 'inherit',
                        outline: 'none', minHeight: 80,
                      }}
                    />
                    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                      <button
                        onClick={() => queueAction(item.id, 'edit', { content: editItemText })}
                        disabled={actionLoading === `${item.id}-edit`}
                        style={{
                          padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                          background: 'var(--accent)', color: '#fff', border: 'none',
                          cursor: 'pointer', fontFamily: 'inherit',
                        }}
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingItem(null)}
                        style={{
                          padding: '5px 12px', borderRadius: 6, fontSize: 12,
                          background: 'var(--bg-3)', color: 'var(--text-3)', border: 'none',
                          cursor: 'pointer', fontFamily: 'inherit',
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <p style={{
                    color: 'var(--text-1)', fontSize: 13, lineHeight: 1.6, margin: '0 0 10px',
                    overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
                  }}>
                    {item.content}
                  </p>
                )}

                {/* Actions */}
                {editingItem !== item.id && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {item.status === 'draft' && (
                      <button
                        className="btn-accent"
                        onClick={() => queueAction(item.id, 'approve')}
                        disabled={actionLoading === `${item.id}-approve` || !canApproveDrafts}
                        style={{
                          ...queueBtnStyle,
                          cursor: canApproveDrafts ? 'pointer' : 'not-allowed',
                          opacity: canApproveDrafts ? 1 : 0.55,
                        }}
                      >
                        <CheckCircle size={12} /> Approve
                      </button>
                    )}
                    {(item.status === 'draft' || item.status === 'scheduled') && (
                      <button
                        className="btn"
                        onClick={() => queueAction(item.id, 'publish')}
                        disabled={actionLoading === `${item.id}-publish` || !canApproveDrafts}
                        style={{
                          ...queueBtnStyle,
                          background: canApproveDrafts ? 'var(--accent)' : 'var(--bg-3)',
                          color: canApproveDrafts ? '#fff' : 'var(--text-4)',
                          border: 'none',
                          cursor: canApproveDrafts ? 'pointer' : 'not-allowed',
                        }}
                      >
                        <Send size={12} /> Post Now
                      </button>
                    )}
                    <button
                      className="btn"
                      onClick={() => { setEditingItem(item.id); setEditItemText(item.content) }}
                      style={queueBtnStyle}
                    >
                      <Edit3 size={12} /> Edit
                    </button>
                    <button
                      className="btn-ghost"
                      onClick={() => { navigator.clipboard.writeText(item.content) }}
                      style={queueBtnStyle}
                    >
                      <Copy size={12} /> Copy
                    </button>
                    <button
                      className="btn-danger"
                      onClick={() => setPendingDeleteId(item.id)}
                      disabled={actionLoading === `${item.id}-delete`}
                      style={{ ...queueBtnStyle, color: '#ef4444' }}
                    >
                      <Trash2 size={12} /> Delete
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal
        open={pendingDeleteId !== null}
        title="Delete Queue Item"
        message="Are you sure you want to delete this item? This cannot be undone."
        confirmLabel="Delete"
        danger
        onConfirm={() => { if (pendingDeleteId !== null) deleteQueueItem(pendingDeleteId); setPendingDeleteId(null) }}
        onCancel={() => setPendingDeleteId(null)}
      />
    </div>
  )
}

const queueBtnStyle: React.CSSProperties = {
  padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 500,
  background: 'var(--bg-2)', color: 'var(--text-3)', border: '1px solid var(--border)',
  cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4,
  transition: 'all 0.15s',
}
