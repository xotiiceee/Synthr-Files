import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Brain, Loader2, Plus, Trash2, Edit3, Lock, Unlock, Bot, User, X, Search } from 'lucide-react'
import { get, post } from '../lib/api'
import Modal from '../components/Modal'

interface Note {
  id: string
  title: string
  content: string
  tags?: string[]
  priority: number | string
  locked?: boolean
  editedBy?: 'bot' | 'user'
  createdAt?: string
  updatedAt?: string
}

const priorities = [0, 1, 2, 3] as const
const priorityLabels: Record<number, string> = { 0: 'Low', 1: 'Normal', 2: 'High', 3: 'Always' }
const priorityNames: Record<string, number> = { low: 0, normal: 1, high: 2, always: 3 }

function normPriority(p: number | string): number {
  if (typeof p === 'string') return priorityNames[p] ?? 1
  return p
}

const priorityBadgeStyle = (p: number): React.CSSProperties => {
  switch (p) {
    case 0: return { background: 'rgba(139,139,150,0.1)', color: 'var(--text-3)', border: '1px solid rgba(139,139,150,0.2)' }
    case 2: return { background: 'rgba(245,158,11,0.1)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.2)' }
    case 3: return { background: 'rgba(239,68,68,0.1)', color: 'var(--danger)', border: '1px solid rgba(239,68,68,0.2)' }
    default: return { background: 'rgba(16,185,129,0.1)', color: 'var(--accent)', border: '1px solid rgba(16,185,129,0.2)' }
  }
}

const priorityLetter = (p: number): string => ['L', 'N', 'H', 'A'][p] || 'N'

function NoteModal({ open, title, noteTitle, setNoteTitle, content, setContent, tags, setTags, priority, setPriority, saving, onSave, onClose, saveLabel = 'Save Note' }: {
  open: boolean; title: string
  noteTitle: string; setNoteTitle: (v: string) => void
  content: string; setContent: (v: string) => void
  tags: string; setTags: (v: string) => void
  priority: number; setPriority: (v: number) => void
  saving: boolean; onSave: () => void; onClose: () => void; saveLabel?: string
}) {
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  const inputStyle: React.CSSProperties = {
    width: '100%', background: 'var(--input-bg)', border: '1px solid var(--input-border)',
    borderRadius: 8, padding: '10px 14px', color: 'var(--text-1)',
    fontSize: 14, fontFamily: 'inherit', outline: 'none',
  }

  return (
    <div
      ref={overlayRef}
      onClick={e => { if (e.target === overlayRef.current) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'modalFadeIn 0.15s ease-out',
      }}
    >
      <div style={{
        background: 'var(--bg-2)', border: '1px solid var(--border)',
        borderRadius: 16, padding: '24px 28px', maxWidth: 520, width: '92%',
        boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
        animation: 'modalSlideIn 0.15s ease-out',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-1)', margin: 0 }}>{title}</h3>
          <button className="btn-icon" onClick={onClose} style={{
            width: 28, height: 28, borderRadius: 8, border: 'none', background: 'var(--bg-3)',
            color: 'var(--text-3)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <X size={14} />
          </button>
        </div>

        <input value={noteTitle} onChange={e => setNoteTitle(e.target.value)} placeholder="Note title" style={inputStyle} autoFocus />
        <textarea value={content} onChange={e => setContent(e.target.value)} placeholder="Note content — context, facts, guidelines..."
          rows={4} style={{ ...inputStyle, marginTop: 10, resize: 'vertical', lineHeight: 1.6 }} />
        <input value={tags} onChange={e => setTags(e.target.value)} placeholder="Tags (comma-separated)" style={{ ...inputStyle, marginTop: 10 }} />

        <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Priority:</span>
          {priorities.map(p => (
            <button key={p} className="btn-tab" data-active={priority === p ? "true" : "false"} onClick={() => setPriority(p)} style={{
              padding: '4px 12px', borderRadius: 16, fontSize: 11, fontWeight: 500, fontFamily: 'inherit', cursor: 'pointer',
              border: priority === p ? 'none' : '1px solid var(--border)',
              background: priority === p ? 'var(--accent)' : 'transparent',
              color: priority === p ? '#fff' : 'var(--text-2)',
            }}>
              {priorityLabels[p]}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
          <button className="btn" onClick={onClose} style={{
            padding: '9px 20px', background: 'var(--bg-3)', color: 'var(--text-2)',
            border: '1px solid var(--border)', borderRadius: 10, fontSize: 13, fontWeight: 500,
            cursor: 'pointer', fontFamily: 'inherit',
          }}>
            Cancel
          </button>
          <button className="btn-accent" onClick={onSave} disabled={saving || !noteTitle.trim() || !content.trim()} style={{
            padding: '9px 20px', background: 'var(--accent)', color: '#fff',
            border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit',
            opacity: saving || !noteTitle.trim() || !content.trim() ? 0.5 : 1,
          }}>
            {saving ? 'Saving...' : saveLabel}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes modalFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes modalSlideIn { from { opacity: 0; transform: scale(0.95) translateY(8px); } to { opacity: 1; transform: scale(1) translateY(0); } }
      `}</style>
    </div>
  )
}

export default function Knowledge() {
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [search, setSearch] = useState('')
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Form state
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [tags, setTags] = useState('')
  const [priority, setPriority] = useState(1)

  // Edit form state
  const [editTitle, setEditTitle] = useState('')
  const [editContent, setEditContent] = useState('')
  const [editTags, setEditTags] = useState('')
  const [editPriority, setEditPriority] = useState(1)

  const fetchNotes = async () => {
    try {
      const data = await get<{ notes?: Note[], items?: Note[] }>('/api/knowledge')
      setNotes(data.notes || data.items || (Array.isArray(data) ? data : []))
    } catch {
      setNotes([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchNotes() }, [])

  // Sort: locked first, then by priority desc, then alphabetical
  const sortedNotes = [...notes].sort((a, b) => {
    const al = a.locked ? 1 : 0, bl = b.locked ? 1 : 0
    if (al !== bl) return bl - al
    const ap = normPriority(a.priority), bp = normPriority(b.priority)
    if (ap !== bp) return bp - ap
    return a.title.localeCompare(b.title)
  })

  const q = search.toLowerCase().trim()
  const filteredNotes = q
    ? sortedNotes.filter(n => n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q) || (n.tags || []).some(t => t.toLowerCase().includes(q)))
    : sortedNotes

  const handleSave = async () => {
    if (!title.trim() || !content.trim() || saving) return
    setSaving(true)
    try {
      await post('/api/knowledge', {
        action: 'add', title: title.trim(), content: content.trim(),
        tags: tags.split(',').map(t => t.trim()).filter(Boolean).join(','), priority,
      })
      setTitle(''); setContent(''); setTags(''); setPriority(1); setShowAdd(false)
      await fetchNotes()
    } catch { } finally { setSaving(false) }
  }

  const handleDelete = async (id: string) => {
    try {
      await post('/api/knowledge', { action: 'delete', id })
      if (expandedId === id) setExpandedId(null)
      await fetchNotes()
    } catch {
      setErrorMsg('Failed to delete note. Please try again.')
      setTimeout(() => setErrorMsg(null), 3000)
    }
  }

  const handleLock = async (id: string, lock: boolean) => {
    try {
      await post('/api/knowledge', { action: lock ? 'lock' : 'unlock', id })
      await fetchNotes()
    } catch { }
  }

  const startEdit = (note: Note) => {
    setEditingId(note.id)
    setEditTitle(note.title)
    setEditContent(note.content)
    setEditTags((note.tags || []).join(', '))
    setEditPriority(normPriority(note.priority))
  }

  const handleUpdate = async (id: string) => {
    if (!editTitle.trim() || !editContent.trim()) return
    setSaving(true)
    try {
      await post('/api/knowledge', {
        action: 'update', id, title: editTitle.trim(), content: editContent.trim(),
        tags: editTags.split(',').map(t => t.trim()).filter(Boolean).join(','), priority: editPriority,
      })
      setEditingId(null)
      await fetchNotes()
    } catch { } finally { setSaving(false) }
  }

  const lockedCount = notes.filter(n => n.locked).length
  const botCount = notes.filter(n => n.editedBy === 'bot').length

  return (
    <div style={{ maxWidth: 1000, width: '100%', margin: '0 auto', padding: '0 24px', minHeight: '100%', overflowX: 'hidden', boxSizing: 'border-box', wordBreak: 'break-word' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '24px 0 20px',
        borderBottom: '1px solid var(--border-subtle)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 42, height: 42, borderRadius: 12,
            background: 'var(--accent-dim)', border: '1px solid var(--accent-glow)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Brain size={20} style={{ color: 'var(--accent)' }} />
          </div>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--text-1)', margin: 0 }}>Knowledge</h1>
            <p style={{ fontSize: 13, color: 'var(--text-3)', margin: 0 }}>
              {notes.length} note{notes.length !== 1 ? 's' : ''}
              {lockedCount > 0 && <span> · {lockedCount} locked</span>}
              {botCount > 0 && <span> · {botCount} by Pulse</span>}
            </p>
          </div>
        </div>
        <button
          className="btn-accent"
          onClick={() => setShowAdd(true)}
          style={{
            padding: '8px 18px', borderRadius: 10, border: 'none', fontSize: 13, fontWeight: 600,
            background: 'var(--accent)', color: '#fff',
            cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          <Plus size={14} />
          Add Note
        </button>
      </div>

      {/* Add Note Modal */}
      <NoteModal
        open={showAdd}
        title="Add Note"
        noteTitle={title} setNoteTitle={setTitle}
        content={content} setContent={setContent}
        tags={tags} setTags={setTags}
        priority={priority} setPriority={setPriority}
        saving={saving}
        onSave={handleSave}
        onClose={() => setShowAdd(false)}
      />

      {/* Edit Note Modal */}
      <NoteModal
        open={editingId !== null}
        title="Edit Note"
        noteTitle={editTitle} setNoteTitle={setEditTitle}
        content={editContent} setContent={setEditContent}
        tags={editTags} setTags={setEditTags}
        priority={editPriority} setPriority={setEditPriority}
        saving={saving}
        onSave={() => editingId && handleUpdate(editingId)}
        onClose={() => setEditingId(null)}
        saveLabel="Save Changes"
      />

      {/* Note Detail Modal */}
      {expandedId && (() => {
        const note = notes.find(n => n.id === expandedId)
        if (!note) return null
        const np = normPriority(note.priority)
        return (
          <div
            onClick={e => { if (e.target === e.currentTarget) setExpandedId(null) }}
            style={{
              position: 'fixed', inset: 0, zIndex: 9999,
              background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              animation: 'modalFadeIn 0.15s ease-out',
            }}
          >
            <div style={{
              background: 'var(--bg-2)', border: '1px solid var(--border)',
              borderRadius: 16, padding: '24px 28px', maxWidth: 560, width: '92%',
              boxShadow: '0 16px 48px rgba(0,0,0,0.5)', maxHeight: '80vh', overflowY: 'auto',
              animation: 'modalSlideIn 0.15s ease-out',
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 6, ...priorityBadgeStyle(np) }}>
                      {priorityLabels[np]}
                    </span>
                    {note.locked && (
                      <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 6, background: 'rgba(88,166,255,0.1)', color: 'var(--accent)', border: '1px solid rgba(88,166,255,0.2)', display: 'flex', alignItems: 'center', gap: 3 }}>
                        <Lock size={9} /> Locked
                      </span>
                    )}
                    {note.editedBy && (
                      <span style={{ fontSize: 10, color: 'var(--text-4)', display: 'flex', alignItems: 'center', gap: 3 }}>
                        {note.editedBy === 'bot' ? <><Bot size={10} /> Pulse</> : <><User size={10} /> You</>}
                      </span>
                    )}
                  </div>
                  <h3 style={{ fontSize: 17, fontWeight: 600, color: 'var(--text-1)', margin: 0 }}>{note.title}</h3>
                </div>
                <button className="btn-icon" onClick={() => setExpandedId(null)} style={{
                  width: 28, height: 28, borderRadius: 8, border: 'none', background: 'var(--bg-3)',
                  color: 'var(--text-3)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  <X size={14} />
                </button>
              </div>

              <p style={{ fontSize: 14, color: 'var(--text-2)', lineHeight: 1.7, margin: '0 0 16px', whiteSpace: 'pre-wrap' }}>
                {note.content}
              </p>

              {note.tags && note.tags.length > 0 && (
                <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
                  {note.tags.map(t => (
                    <span key={t} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: 'var(--bg-3)', color: 'var(--text-3)' }}>{t}</span>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, borderTop: '1px solid var(--border-subtle)', paddingTop: 16 }}>
                <button className="btn" onClick={() => handleLock(note.id, !note.locked)} style={{
                  padding: '8px 16px', background: note.locked ? 'rgba(88,166,255,0.1)' : 'var(--bg-3)',
                  color: note.locked ? 'var(--accent)' : 'var(--text-3)', border: `1px solid ${note.locked ? 'rgba(88,166,255,0.2)' : 'var(--border)'}`,
                  borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 5,
                }}>
                  {note.locked ? <><Unlock size={12} /> Unlock</> : <><Lock size={12} /> Lock</>}
                </button>
                <button className="btn" onClick={() => { setExpandedId(null); startEdit(note) }} style={{
                  padding: '8px 16px', background: 'var(--bg-3)', color: 'var(--text-2)',
                  border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, fontWeight: 500,
                  cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 5,
                }}>
                  <Edit3 size={12} /> Edit
                </button>
                <button className="btn-danger" onClick={() => setPendingDeleteId(note.id)} style={{
                  padding: '8px 16px', background: 'rgba(239,68,68,0.08)', color: 'var(--danger)',
                  border: '1px solid rgba(239,68,68,0.15)', borderRadius: 8, fontSize: 12, fontWeight: 500,
                  cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 5,
                }}>
                  <Trash2 size={12} /> Delete
                </button>
              </div>
            </div>

            <style>{`
              @keyframes modalFadeIn { from { opacity: 0; } to { opacity: 1; } }
              @keyframes modalSlideIn { from { opacity: 0; transform: scale(0.95) translateY(8px); } to { opacity: 1; transform: scale(1) translateY(0); } }
            `}</style>
          </div>
        )
      })()}

      {/* Error toast */}
      {errorMsg && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 9998,
          background: 'var(--danger)', color: '#fff', padding: '10px 20px', borderRadius: 10,
          fontSize: 13, fontWeight: 500, boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
        }}>
          {errorMsg}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <Modal
        open={pendingDeleteId !== null}
        title="Delete Note"
        message="Are you sure you want to delete this note? This cannot be undone."
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          if (pendingDeleteId) {
            handleDelete(pendingDeleteId)
            setExpandedId(null)
          }
          setPendingDeleteId(null)
        }}
        onCancel={() => setPendingDeleteId(null)}
      />

      {/* Search */}
      {notes.length > 0 && (
        <div style={{ position: 'relative', marginTop: 16 }}>
          <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-4)', pointerEvents: 'none' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search notes..."
            style={{
              width: '100%', padding: '9px 12px 9px 34px',
              background: 'var(--input-bg)', border: '1px solid var(--input-border)',
              borderRadius: 10, color: 'var(--text-1)', fontSize: 13, fontFamily: 'inherit', outline: 'none',
            }}
          />
        </div>
      )}

      {/* Notes Grid */}
      <div style={{ marginTop: 12 }}>
        {loading ? (
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 12, padding: 40, textAlign: 'center' }}>
            <Loader2 size={20} style={{ color: 'var(--accent)', animation: 'spin 1s linear infinite', margin: '0 auto 8px' }} />
            <p style={{ color: 'var(--text-3)', fontSize: 13, margin: 0 }}>Loading notes...</p>
          </div>
        ) : notes.length === 0 ? (
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 12, padding: 40, textAlign: 'center' }}>
            <Brain size={28} style={{ color: 'var(--text-4)', margin: '0 auto 12px' }} />
            <p style={{ color: 'var(--text-2)', fontSize: 14, margin: '0 0 4px' }}>No knowledge notes yet</p>
            <p style={{ color: 'var(--text-3)', fontSize: 13, margin: 0 }}>
              <Link to="/chat-setup" style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 500 }}>Chat with Pulse</Link> to auto-generate notes, or add them manually above.
            </p>
          </div>
        ) : filteredNotes.length === 0 ? (
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 12, padding: 40, textAlign: 'center' }}>
            <Search size={24} style={{ color: 'var(--text-4)', margin: '0 auto 10px' }} />
            <p style={{ color: 'var(--text-3)', fontSize: 13, margin: 0 }}>No notes match "{search}"</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
            {filteredNotes.map(note => {
              const np = normPriority(note.priority)
              return (
                <div
                  key={note.id}
                  className="card-hover"
                  onClick={() => setExpandedId(note.id)}
                  style={{
                    background: note.locked ? 'rgba(88,166,255,0.03)' : 'var(--card-bg)',
                    border: `1px solid ${note.locked ? 'rgba(88,166,255,0.15)' : 'var(--card-border)'}`,
                    borderRadius: 10, padding: '14px 16px', cursor: 'pointer',
                    transition: 'border-color 0.15s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--accent)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = note.locked ? 'rgba(88,166,255,0.15)' : 'var(--card-border)' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 5, ...priorityBadgeStyle(np) }}>
                      {priorityLetter(np)}
                    </span>
                    {note.locked && <Lock size={10} style={{ color: 'var(--accent)' }} />}
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {note.title}
                    </span>
                    {note.editedBy === 'bot' && <Bot size={10} style={{ color: 'var(--accent)', flexShrink: 0 }} />}
                  </div>
                  <p style={{
                    fontSize: 12, color: 'var(--text-3)', lineHeight: 1.5, margin: 0,
                    overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                  }}>
                    {note.content}
                  </p>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div style={{ height: 32 }} />
    </div>
  )
}
