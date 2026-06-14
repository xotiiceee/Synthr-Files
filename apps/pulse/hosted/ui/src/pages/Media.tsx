import { useState, useEffect, useRef, useCallback } from 'react'
import { Image, Upload, Sparkles, Star, Trash2, Loader2, PenLine } from 'lucide-react'
import { get, post } from '../lib/api'

interface Asset {
  id: string
  name: string
  tags: string[]
  source: string
  mimeType?: string
  prompt?: string
  model?: string
  starred: boolean
  usageCount: number
  lastUsedAt?: string
  createdAt: string
}

const STYLE_PRESETS = [
  { id: 'meme', label: 'Meme / Degen', prompt: 'fun meme style, bold text, internet humor, slightly rough aesthetic' },
  { id: 'hype', label: 'Hype / Energy', prompt: 'futuristic cyberpunk energy, glowing neon, dynamic composition, bullish' },
  { id: 'clean', label: 'Professional', prompt: 'clean modern minimalist design, professional, corporate, subtle gradients' },
  { id: 'chart', label: 'Data / Chart', prompt: 'data visualization infographic style, clean charts, statistics' },
  { id: 'custom', label: 'Custom', prompt: '' },
]

const SIZE_PRESETS = [
  { id: 'landscape', label: '16:9 Standard', w: 1200, h: 675 },
  { id: 'square', label: '1:1 Square', w: 1080, h: 1080 },
  { id: 'portrait', label: '3:4 Portrait (max feed)', w: 1080, h: 1440 },
]

// Tag color — consistent per tag string
function tagColor(tag: string): string {
  let h = 0
  for (let i = 0; i < tag.length; i++) h = tag.charCodeAt(i) + ((h << 5) - h)
  return `hsl(${Math.abs(h) % 360}, 55%, 55%)`
}

export default function Media() {
  const [assets, setAssets] = useState<Asset[]>([])
  const [loading, setLoading] = useState(true)
  const [tagFilter, setTagFilter] = useState<string>('')
  const [showUpload, setShowUpload] = useState(false)
  const [showGenerate, setShowGenerate] = useState(false)
  const [selected, setSelected] = useState<Asset | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await get<{ assets: Asset[] }>('/api/media')
      setAssets(data.assets)
    } catch (e) { console.error(e) }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const toggleStar = async (id: string) => {
    const res = await post<{ starred: boolean }>(`/api/media/${id}/star`)
    setAssets(prev => prev.map(a => a.id === id ? { ...a, starred: res.starred } : a))
  }

  const deleteAsset = async (id: string) => {
    if (!confirm('Delete this image?')) return
    await post(`/api/media/${id}/delete`)
    setAssets(prev => prev.filter(a => a.id !== id))
    if (selected?.id === id) setSelected(null)
  }

  // Collect all unique tags for filter pills
  const allTags = [...new Set(assets.flatMap(a => a.tags))].sort()

  // Filter + sort
  const filtered = tagFilter
    ? assets.filter(a => a.tags.some(t => t.toLowerCase() === tagFilter.toLowerCase()))
    : assets
  const sorted = [...filtered].sort((a, b) => {
    if (a.starred !== b.starred) return a.starred ? -1 : 1
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  })

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-1)', margin: 0 }}>Media Library</h1>
          <p style={{ color: 'var(--text-3)', fontSize: 13, marginTop: 4 }}>
            {assets.length} image{assets.length !== 1 ? 's' : ''} — starred images get priority in auto-posts. Tag images so the bot knows when to use them.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setShowUpload(true)} style={btnStyle}>
            <Upload size={16} /> Upload
          </button>
          <button onClick={() => setShowGenerate(true)} style={{ ...btnStyle, background: 'var(--accent)', color: '#fff' }}>
            <Sparkles size={16} /> Generate
          </button>
        </div>
      </div>

      {/* Tag Filter */}
      {allTags.length > 0 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
          <FilterPill active={!tagFilter} onClick={() => setTagFilter('')}>All</FilterPill>
          {allTags.slice(0, 20).map(t => (
            <FilterPill key={t} active={tagFilter === t} onClick={() => setTagFilter(tagFilter === t ? '' : t)}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: tagColor(t), display: 'inline-block' }} />
              {t}
            </FilterPill>
          ))}
        </div>
      )}

      {/* Grid */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-3)' }}><Loader2 size={24} className="spin" /> Loading...</div>
      ) : sorted.length === 0 ? (
        <EmptyState onUpload={() => setShowUpload(true)} onGenerate={() => setShowGenerate(true)} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
          {sorted.map(asset => (
            <ImageCard
              key={asset.id}
              asset={asset}
              onClick={() => setSelected(asset)}
              onStar={() => toggleStar(asset.id)}
              onDelete={() => deleteAsset(asset.id)}
            />
          ))}
        </div>
      )}

      {showUpload && <UploadModal onClose={() => setShowUpload(false)} onDone={() => { setShowUpload(false); load() }} />}
      {showGenerate && <GenerateModal onClose={() => setShowGenerate(false)} onDone={() => { setShowGenerate(false); load() }} />}
      {selected && (
        <DetailModal
          asset={selected}
          onClose={() => setSelected(null)}
          onUpdate={(updated) => { setAssets(prev => prev.map(a => a.id === updated.id ? updated : a)); setSelected(updated) }}
          onDelete={() => { deleteAsset(selected.id); setSelected(null) }}
        />
      )}
    </div>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function FilterPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 20,
      border: `1px solid ${active ? 'var(--accent)' : 'var(--input-border)'}`,
      background: active ? 'rgba(16,185,129,0.1)' : 'transparent',
      color: active ? 'var(--accent)' : 'var(--text-3)', cursor: 'pointer', fontSize: 13,
    }}>
      {children}
    </button>
  )
}

function ImageCard({ asset, onClick, onStar, onDelete }: {
  asset: Asset; onClick: () => void; onStar: () => void; onDelete: () => void
}) {
  const imgSrc = asset.source.startsWith('http') ? asset.source : `/api/media-file/${asset.source}`
  return (
    <div onClick={onClick} style={{
      background: 'var(--card-bg)', borderRadius: 12, overflow: 'hidden', cursor: 'pointer',
      border: '1px solid var(--card-border)', transition: 'border-color 0.15s',
    }}>
      <div style={{ width: '100%', height: 160, overflow: 'hidden', background: '#111' }}>
        <img src={imgSrc} alt={asset.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
      </div>
      <div style={{ padding: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>
            {asset.name}
          </span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={(e) => { e.stopPropagation(); onStar() }} style={iconBtnStyle}>
              <Star size={14} fill={asset.starred ? 'var(--accent)' : 'none'} color={asset.starred ? 'var(--accent)' : 'var(--text-4)'} />
            </button>
            <button onClick={(e) => { e.stopPropagation(); onDelete() }} style={iconBtnStyle}>
              <Trash2 size={14} color="var(--text-4)" />
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
          {asset.tags.slice(0, 3).map(t => (
            <span key={t} style={{ ...tagBadge, background: `${tagColor(t)}18`, color: tagColor(t), borderColor: `${tagColor(t)}44` }}>
              {t}
            </span>
          ))}
          {asset.tags.length > 3 && (
            <span style={{ ...tagBadge, background: 'rgba(139,139,150,0.1)', color: 'var(--text-4)' }}>
              +{asset.tags.length - 3}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function EmptyState({ onUpload, onGenerate }: { onUpload: () => void; onGenerate: () => void }) {
  return (
    <div style={{ textAlign: 'center', padding: 80, color: 'var(--text-3)' }}>
      <Image size={48} style={{ margin: '0 auto 16px', opacity: 0.3 }} />
      <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-2)', marginBottom: 8 }}>No images yet</p>
      <p style={{ fontSize: 14, marginBottom: 20 }}>Upload your own or generate with AI. Tag them so the bot knows when to use each one.</p>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
        <button onClick={onUpload} style={btnStyle}><Upload size={16} /> Upload</button>
        <button onClick={onGenerate} style={{ ...btnStyle, background: 'var(--accent)', color: '#fff' }}><Sparkles size={16} /> Generate</button>
      </div>
    </div>
  )
}

// ─── Upload Modal ────────────────────────────────────────────────────────────

function UploadModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('')
  const [tags, setTags] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFile = (f: File) => {
    if (f.size > 5 * 1024 * 1024) { setError('Max 5MB'); return }
    if (!f.type.startsWith('image/')) { setError('Images only'); return }
    setFile(f)
    setName(f.name.replace(/\.[^.]+$/, '').slice(0, 80))
    setPreview(URL.createObjectURL(f))
    setError('')
  }

  const handleUpload = async () => {
    if (!file) return
    setSaving(true)
    try {
      const reader = new FileReader()
      const base64 = await new Promise<string>((resolve) => {
        reader.onload = () => resolve((reader.result as string).split(',')[1])
        reader.readAsDataURL(file)
      })
      await post('/api/media/upload', {
        name: name.trim() || file.name,
        imageData: base64,
        mimeType: file.type,
        tags: tags.split(',').map(t => t.trim()).filter(Boolean),
      })
      onDone()
    } catch (e: any) {
      setError(e.message || 'Upload failed')
    }
    setSaving(false)
  }

  return (
    <Overlay onClose={onClose}>
      <h2 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 700, color: 'var(--text-1)' }}>Upload Image</h2>

      <div
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]) }}
        style={{
          border: '2px dashed var(--input-border)', borderRadius: 12, padding: 40, textAlign: 'center',
          cursor: 'pointer', marginBottom: 16, background: preview ? '#111' : 'transparent',
        }}
      >
        {preview ? (
          <img src={preview} alt="Preview" style={{ maxHeight: 200, maxWidth: '100%', borderRadius: 8 }} />
        ) : (
          <>
            <Upload size={32} style={{ color: 'var(--text-4)', marginBottom: 8 }} />
            <p style={{ color: 'var(--text-3)', fontSize: 14 }}>Click or drag an image here</p>
            <p style={{ color: 'var(--text-4)', fontSize: 12 }}>PNG, JPG, GIF, WebP — max 5MB</p>
          </>
        )}
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
      </div>

      {file && (
        <>
          <label style={labelStyle}>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} placeholder="Image name" />

          <label style={labelStyle}>Tags — describe what this image is about and when to use it</label>
          <input value={tags} onChange={(e) => setTags(e.target.value)} style={inputStyle} placeholder="e.g. logo, brand, meme, educational, staking, hype" />
          <p style={{ color: 'var(--text-4)', fontSize: 12, marginTop: 4 }}>
            The bot matches image tags to post topics. More specific tags = smarter matching.
          </p>
        </>
      )}

      {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 8 }}>{error}</p>}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <button onClick={onClose} style={btnStyle}>Cancel</button>
        <button onClick={handleUpload} disabled={!file || saving} style={{ ...btnStyle, background: 'var(--accent)', color: '#fff', opacity: !file || saving ? 0.5 : 1 }}>
          {saving ? <><Loader2 size={14} className="spin" /> Uploading...</> : 'Upload'}
        </button>
      </div>
    </Overlay>
  )
}

// ─── Generate Modal ──────────────────────────────────────────────────────────

function GenerateModal({ onClose }: { onClose: () => void; onDone?: () => void }) {
  const [prompt, setPrompt] = useState('')
  const [stylePreset, setStylePreset] = useState('custom')
  const [size, setSize] = useState('landscape')
  const [model, setModel] = useState('fast')
  const [tags, setTags] = useState('')
  const [generating, setGenerating] = useState(false)
  const [result, setResult] = useState<{ imageUrl: string; asset: any; creditsUsed: number } | null>(null)
  const [error, setError] = useState('')

  const generate = async () => {
    setGenerating(true)
    setError('')
    setResult(null)
    try {
      const preset = STYLE_PRESETS.find(p => p.id === stylePreset)
      const sizePreset = SIZE_PRESETS.find(p => p.id === size)!
      const fullPrompt = preset?.prompt
        ? `${prompt.trim()}. Style: ${preset.prompt}`
        : prompt.trim()

      // Auto-generate tags from prompt + style + user tags
      const autoTags = prompt.toLowerCase().split(/\s+/).filter(w => w.length > 3).slice(0, 6)
      const userTags = tags.split(',').map(t => t.trim()).filter(Boolean)
      if (stylePreset !== 'custom') autoTags.push(stylePreset) // add style as a tag

      const res = await post<any>('/api/media/generate', {
        prompt: fullPrompt,
        model,
        tags: [...new Set([...userTags, ...autoTags])],
        width: sizePreset.w,
        height: sizePreset.h,
      })
      setResult(res)
    } catch (e: any) {
      setError(e.message || 'Generation failed')
    }
    setGenerating(false)
  }

  return (
    <Overlay onClose={onClose}>
      <h2 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 700, color: 'var(--text-1)' }}>Generate Image</h2>

      <label style={labelStyle}>Describe what you want</label>
      <textarea
        value={prompt} onChange={(e) => setPrompt(e.target.value)}
        style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }}
        placeholder="e.g. Futuristic robot holding a glowing crypto coin, dark background"
      />

      <label style={labelStyle}>Style</label>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {STYLE_PRESETS.map(p => (
          <button key={p.id} onClick={() => setStylePreset(p.id)} style={{
            ...tagBadge, cursor: 'pointer', padding: '6px 12px',
            background: stylePreset === p.id ? 'rgba(16,185,129,0.1)' : 'transparent',
            color: stylePreset === p.id ? 'var(--accent)' : 'var(--text-3)',
            borderColor: stylePreset === p.id ? 'var(--accent)' : 'var(--input-border)',
          }}>
            {p.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Size</label>
          <select value={size} onChange={(e) => setSize(e.target.value)} style={inputStyle}>
            {SIZE_PRESETS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Model</label>
          <select value={model} onChange={(e) => setModel(e.target.value)} style={inputStyle}>
            <option value="fast">Fast (~3 units)</option>
            <option value="quality">Quality (~15 units)</option>
            <option value="freepik">Freepik Mystic (~12 units)</option>
          </select>
        </div>
      </div>

      <label style={labelStyle}>Extra tags (optional)</label>
      <input value={tags} onChange={(e) => setTags(e.target.value)} style={inputStyle} placeholder="e.g. meme, raid, token-launch" />

      {result && (
        <div style={{ textAlign: 'center', marginTop: 12, marginBottom: 12 }}>
          <img src={result.imageUrl} alt="Generated" style={{ maxHeight: 300, maxWidth: '100%', borderRadius: 12, border: '1px solid var(--card-border)' }} />
          <p style={{ color: 'var(--accent)', fontSize: 13, marginTop: 8 }}>
            Saved to library — {result.creditsUsed} usage units used
          </p>
        </div>
      )}

      {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 8 }}>{error}</p>}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <button onClick={onClose} style={btnStyle}>{result ? 'Done' : 'Cancel'}</button>
        <button onClick={generate} disabled={!prompt.trim() || generating} style={{
          ...btnStyle, background: 'var(--accent)', color: '#fff',
          opacity: !prompt.trim() || generating ? 0.5 : 1,
        }}>
          {generating ? <><Loader2 size={14} className="spin" /> Generating...</> : result ? 'Generate Another' : 'Generate'}
        </button>
      </div>
    </Overlay>
  )
}

// ─── Detail Modal ────────────────────────────────────────────────────────────

function DetailModal({ asset, onClose, onUpdate, onDelete }: {
  asset: Asset; onClose: () => void; onUpdate: (a: Asset) => void; onDelete: () => void
}) {
  const [tags, setTags] = useState(asset.tags.join(', '))
  const [name, setName] = useState(asset.name)
  const [saving, setSaving] = useState(false)
  const [captionLoading, setCaptionLoading] = useState(false)
  const [caption, setCaption] = useState('')

  const save = async () => {
    setSaving(true)
    try {
      const res = await post<{ asset: Asset }>(`/api/media/${asset.id}/update`, {
        name: name.trim(),
        tags: tags.split(',').map(t => t.trim()).filter(Boolean),
      })
      onUpdate(res.asset)
    } catch {}
    setSaving(false)
  }

  const generateCaption = async () => {
    setCaptionLoading(true)
    try {
      const res = await post<{ caption: string; creditsUsed: number }>(`/api/media/${asset.id}/caption`, { platform: 'x' })
      setCaption(res.caption)
    } catch {}
    setCaptionLoading(false)
  }

  const copyCaption = () => {
    navigator.clipboard.writeText(caption)
  }

  const imgSrc = asset.source.startsWith('http') ? asset.source : `/api/media-file/${asset.source}`

  return (
    <Overlay onClose={onClose}>
      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        <img src={imgSrc} alt={asset.name} style={{ maxHeight: 300, maxWidth: '100%', borderRadius: 12 }} />
      </div>

      <label style={labelStyle}>Name</label>
      <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />

      <label style={labelStyle}>Tags — the bot matches these to post topics</label>
      <input value={tags} onChange={(e) => setTags(e.target.value)} style={inputStyle} placeholder="comma separated" />

      {asset.prompt && (
        <>
          <label style={labelStyle}>Generation prompt</label>
          <p style={{ color: 'var(--text-3)', fontSize: 13, margin: '0 0 12px', fontStyle: 'italic' }}>{asset.prompt}</p>
        </>
      )}

      <div style={{ color: 'var(--text-4)', fontSize: 12, marginTop: 8 }}>
        Used {asset.usageCount}x {asset.lastUsedAt ? `· Last used ${new Date(asset.lastUsedAt).toLocaleDateString()}` : ''}
      </div>

      {/* Image-first: generate caption for this image */}
      <div style={{ marginTop: 16, padding: 12, background: 'var(--bg-2)', borderRadius: 8, border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: caption ? 8 : 0 }}>
          <PenLine size={14} style={{ color: 'var(--accent)' }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-2)' }}>Create post with this image</span>
          <button onClick={generateCaption} disabled={captionLoading} style={{
            marginLeft: 'auto', padding: '4px 12px', borderRadius: 6, fontSize: 12,
            border: '1px solid var(--accent)', background: 'rgba(16,185,129,0.1)',
            color: 'var(--accent)', cursor: captionLoading ? 'wait' : 'pointer',
          }}>
            {captionLoading ? <><Loader2 size={12} className="spin" /> Generating...</> : caption ? 'Regenerate' : 'Generate Caption'}
          </button>
        </div>
        {caption && (
          <div>
            <div style={{
              padding: 10, background: 'var(--input-bg)', borderRadius: 8,
              fontSize: 14, lineHeight: 1.6, color: 'var(--text-1)', whiteSpace: 'pre-wrap',
            }}>
              {caption}
            </div>
            <button onClick={copyCaption} style={{
              marginTop: 6, padding: '4px 10px', borderRadius: 6, fontSize: 11,
              border: '1px solid var(--border)', background: 'transparent',
              color: 'var(--text-3)', cursor: 'pointer',
            }}>
              Copy to clipboard
            </button>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
        <button onClick={onDelete} style={{ ...btnStyle, color: 'var(--danger)', borderColor: 'rgba(239,68,68,0.3)' }}>
          <Trash2 size={14} /> Delete
        </button>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={btnStyle}>Cancel</button>
          <button onClick={save} disabled={saving} style={{ ...btnStyle, background: 'var(--accent)', color: '#fff' }}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </Overlay>
  )
}

// ─── Shared ──────────────────────────────────────────────────────────────────

function Overlay({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: 'var(--card-bg)', borderRadius: 16, padding: 24,
        width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto',
        border: '1px solid var(--card-border)',
      }}>
        {children}
      </div>
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8,
  border: '1px solid var(--input-border)', background: 'transparent',
  color: 'var(--text-2)', cursor: 'pointer', fontSize: 13, fontWeight: 500,
}

const iconBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 4,
}

const tagBadge: React.CSSProperties = {
  fontSize: 11, padding: '2px 8px', borderRadius: 12,
  border: '1px solid var(--input-border)', whiteSpace: 'nowrap',
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-2)', marginBottom: 6, marginTop: 12,
}

const inputStyle: React.CSSProperties = {
  width: '100%', background: 'var(--input-bg)', border: '1px solid var(--input-border)',
  borderRadius: 8, padding: '10px 14px', color: 'var(--text-1)', fontSize: 14,
  outline: 'none', boxSizing: 'border-box',
}
