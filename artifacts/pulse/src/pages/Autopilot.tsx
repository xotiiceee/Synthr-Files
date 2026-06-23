import { useState, useEffect, useRef, useCallback } from 'react'
import { Bot, Check, Loader2, ChevronDown, Zap, AlertTriangle, Shield, Clock } from 'lucide-react'
import { Link } from 'react-router-dom'
import { get, post } from '../lib/api'
import Modal from '../components/Modal'

type AutopilotMode = 'off' | 'semi' | 'full'

const cardStyle: React.CSSProperties = {
  background: 'var(--card-bg)',
  border: '1px solid var(--card-border)',
  borderRadius: 12,
  padding: 24,
  overflow: 'hidden',
  width: '100%',
  boxSizing: 'border-box',
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

const numberInputStyle: React.CSSProperties = {
  ...inputStyle,
  width: 80,
}

function Section({ title, icon: Icon, children, defaultOpen = false }: {
  title: string; icon: any; children: React.ReactNode; defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={cardStyle}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
          background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon size={16} style={{ color: 'var(--accent)' }} />
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)' }}>{title}</span>
        </div>
        <ChevronDown size={16} style={{
          color: 'var(--text-4)', transition: 'transform 0.2s',
          transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
        }} />
      </button>
      {open && <div style={{ marginTop: 16 }}>{children}</div>}
    </div>
  )
}

export default function Autopilot() {
  const [mode, setMode] = useState<AutopilotMode>('off')
  const [pendingMode, setPendingMode] = useState<AutopilotMode | null>(null)
  const [postsPerDay, setPostsPerDay] = useState(3)
  const [repliesPerDay, setRepliesPerDay] = useState(5)
  const [activeHoursStart, setActiveHoursStart] = useState('09:00')
  const [activeHoursEnd, setActiveHoursEnd] = useState('21:00')
  const [timezone, setTimezone] = useState('America/New_York')
  const [dailyPosts, setDailyPosts] = useState(5)
  const [dailyReplies, setDailyReplies] = useState(10)
  const [dailyReposts, setDailyReposts] = useState(3)
  const [dailyLikes, setDailyLikes] = useState(20)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [agentRunning, setAgentRunning] = useState(false)
  const [lastPostTime, setLastPostTime] = useState<string | null>(null)
  const [postNowResult, setPostNowResult] = useState<string | null>(null)
  const [recentActions, setRecentActions] = useState<Array<{ type: string; content: string; platform: string; timestamp: string; targetUrl?: string; engagement?: { likes: number; replies: number; reposts: number } }>>([])
  const [expandedAction, setExpandedAction] = useState<number | null>(null)
  const [isNewAgent, setIsNewAgent] = useState(false)
  const [replyDrafts, setReplyDrafts] = useState<Array<{ id: number; replyText: string; targetUrl: string; targetAuthor: string; targetText: string; createdAt: string }>>([])

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loadedRef = useRef(false)

  // Detect new agent redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('new')) {
      setIsNewAgent(true)
      // Clear the query param without reload
      window.history.replaceState({}, '', '/autopilot')
      // Auto-dismiss after 15 seconds
      setTimeout(() => setIsNewAgent(false), 15_000)
    }
  }, [])

  useEffect(() => {
    get('/api/reply-drafts').then((d: any) => { if (d.drafts) setReplyDrafts(d.drafts) }).catch(() => {})
    get('/api/brands').then((d: any) => {
      const agents = d.agents || []
      const activeId = d.activeId || ''
      const active = agents.find((a: any) => a.id === activeId)
      setAgentRunning(!!active?.running)
    }).catch(() => {})
    get('/api/activity?period=7d').then((d: any) => {
      const items = d.actions || d.items || d.activity || []
      const lastPost = items.find((i: any) => i.type === 'post' && (i.status === 'published' || i.status === 'posted'))
      if (lastPost) setLastPostTime(lastPost.createdAt || lastPost.timestamp)
      // Populate recent actions feed
      setRecentActions(items.slice(0, 10).map((a: any) => ({
        type: a.type || 'post',
        content: (a.content || '').slice(0, 140),
        platform: a.platform || 'x',
        timestamp: a.timestamp || a.createdAt || '',
        targetUrl: a.targetUrl,
        engagement: a.engagement,
      })))
    }).catch(() => {})

    get('/api/config').then((data: any) => {
      const ap = data.autopilot || {}
      setMode(ap.mode || 'off')
      setPostsPerDay(ap.postsPerDay ?? 3)
      setRepliesPerDay(ap.repliesPerDay ?? 5)
      setActiveHoursStart(ap.activeHoursStart || '09:00')
      setActiveHoursEnd(ap.activeHoursEnd || '21:00')
      setTimezone(ap.timezone || 'America/New_York')
      setDailyPosts(ap.dailyPosts ?? 5)
      setDailyReplies(ap.dailyReplies ?? 10)
      setDailyReposts(ap.dailyReposts ?? 3)
      setDailyLikes(ap.dailyLikes ?? 20)
      loadedRef.current = true
    }).catch(() => { loadedRef.current = true })
  }, [])

  const autoSave = useCallback((updates: Record<string, any>) => {
    if (!loadedRef.current) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setSaveStatus('saving')
    debounceRef.current = setTimeout(async () => {
      try {
        await post('/api/config', { autopilot: updates })
        setSaveStatus('saved')
        setTimeout(() => setSaveStatus('idle'), 2000)
      } catch {
        setSaveStatus('idle')
      }
    }, 1500)
  }, [])

  const getSnapshot = useCallback(() => ({
    mode, postsPerDay, repliesPerDay, activeHoursStart, activeHoursEnd, timezone,
    dailyPosts, dailyReplies, dailyReposts, dailyLikes,
  }), [mode, postsPerDay, repliesPerDay, activeHoursStart, activeHoursEnd, timezone, dailyPosts, dailyReplies, dailyReposts, dailyLikes])

  const prevSnapshotRef = useRef<string>('')
  useEffect(() => {
    if (!loadedRef.current) return
    const snap = JSON.stringify(getSnapshot())
    if (snap === prevSnapshotRef.current) return
    prevSnapshotRef.current = snap
    autoSave(getSnapshot())
  }, [getSnapshot, autoSave])

  const [activeAction, setActiveAction] = useState<string | null>(null)

  const runAction = async (action: 'post' | 'reply') => {
    if (activeAction) return
    setActiveAction(action)
    setPostNowResult(null)
    try {
      if (action === 'post') {
        if (mode === 'full') {
          // Full auto — generate AND post immediately
          const d = await post<any>('/api/autopilot/post', { platform: 'x' })
          if (d.ok && d.text) {
            const truncated = d.text.length > 200 ? d.text.slice(0, 200) + '...' : d.text
            setPostNowResult(d.url
              ? `Posted! "${truncated}" <a href="${d.url}" target="_blank" rel="noopener" style="color:var(--accent);text-decoration:underline;margin-left:6px;">View on X →</a>`
              : `Posted: "${truncated}"`)
          } else if (d.ok) {
            setPostNowResult('Posted!')
          } else {
            setPostNowResult(d.error || 'Generation failed. Try again.')
          }
        } else {
          // Semi/off — draft for review
          const d = await post<any>('/api/generate', { topic: 'auto', platform: 'x', type: 'post' })
          if (d.ok && d.content) {
            const text = typeof d.content === 'string' ? d.content : d.content.text || d.content.content || ''
            await post('/api/content-queue', { content: text, platform: 'x', type: 'post', status: 'draft', theme: 'autopilot' })
            setPostNowResult('Post drafted! Check the Create tab to review and publish.')
          } else {
            setPostNowResult('Generation failed. Try again.')
          }
        }
      } else {
        if (mode === 'full') {
          // Full auto — find conversation and reply immediately
          const d = await post<any>('/api/autopilot/reply', { platform: 'x' })
          if (d.ok && (d.repliedCount > 0 || d.likedCount > 0)) {
            const parts: string[] = []
            if (d.repliedCount > 0) parts.push(`replied to ${d.repliedCount}`)
            if (d.likedCount > 0) parts.push(`liked ${d.likedCount}`)
            let msg = `Engaged! ${parts.join(', ')} conversation${(d.repliedCount + d.likedCount) > 1 ? 's' : ''}.`

            // Show draft replies with "Reply on X" links when direct replies are restricted.
            if (d.drafts?.length > 0) {
              msg += '<div style="margin-top:10px;border-top:1px solid var(--border);padding-top:10px;">'
              msg += '<div style="font-size:12px;color:var(--text-3);margin-bottom:8px;">Generated replies — click to post manually:</div>'
              for (const draft of d.drafts) {
                const intentUrl = `https://x.com/intent/tweet?in_reply_to=${draft.targetUrl.split('/status/')[1]?.split(/[?#]/)[0] || ''}&text=${encodeURIComponent(draft.replyText)}`
                msg += `<div style="margin-bottom:8px;padding:8px;background:var(--bg-2);border-radius:6px;font-size:12px;">`
                msg += `<div style="color:var(--text-4);margin-bottom:4px;">@${draft.targetAuthor}: ${draft.targetText}...</div>`
                msg += `<div style="color:var(--text-1);margin-bottom:6px;">${draft.replyText.slice(0, 200)}</div>`
                msg += `<a href="${intentUrl}" target="_blank" rel="noopener" style="color:var(--accent);text-decoration:underline;font-size:11px;">Reply on X →</a>`
                msg += `</div>`
              }
              msg += '<div style="font-size:10px;color:var(--text-4);margin-top:4px;">X API access controls auto-reply volume. Use a tier and policy that match your approved automation plan.</div>'
              msg += '</div>'
            }
            setPostNowResult(msg)
          } else if (d.ok) {
            setPostNowResult('Engaged!')
          } else {
            setPostNowResult(d.error || 'No conversations found right now. Try again later.')
          }
        } else {
          // Semi/off — draft for review
          const d = await post<any>('/api/generate', { topic: 'auto', platform: 'x', type: 'post' })
          if (d.ok && d.content) {
            const text = typeof d.content === 'string' ? d.content : d.content.text || d.content.content || ''
            await post('/api/content-queue', { content: text, platform: 'x', type: 'reply', status: 'draft', theme: 'engagement' })
            setPostNowResult('Reply drafted! Check the Create tab to review.')
          } else {
            setPostNowResult('No conversations found. Try again later.')
          }
        }
      }
    } catch (err: any) {
      setPostNowResult(`Failed: ${err?.message || 'Unknown error. Check credits and X connection.'}`)
    }
    setActiveAction(null)
  }

  const isOff = mode === 'off'
  const modeLabel = mode === 'full' ? 'Full Auto' : mode === 'semi' ? 'Semi-Auto' : 'Off'

  const timeOptions: string[] = []
  for (let h = 6; h <= 23; h++) {
    timeOptions.push(`${String(h).padStart(2, '0')}:00`)
  }

  return (
    <div style={{ width: '100%', maxWidth: 720, margin: '0 auto', padding: '0 24px', overflowX: 'hidden', boxSizing: 'border-box', wordBreak: 'break-word', minWidth: 0 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--accent-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Bot size={20} style={{ color: 'var(--accent)' }} />
          </div>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--text-1)', margin: 0 }}>Autopilot</h1>
            <p style={{ fontSize: 13, color: 'var(--text-3)', margin: 0 }}>Control how your brand posts</p>
          </div>
        </div>
        <div style={{ fontSize: 13, color: saveStatus === 'saving' ? 'var(--text-3)' : saveStatus === 'saved' ? 'var(--accent)' : 'transparent', display: 'flex', alignItems: 'center', gap: 6, transition: 'color 0.2s' }}>
          {saveStatus === 'saving' && <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Saving...</>}
          {saveStatus === 'saved' && <><Check size={14} /> Saved</>}
        </div>
      </div>

      {/* ─── New Brand Welcome ─── */}
      {isNewAgent && (
        <div style={{
          ...cardStyle, marginBottom: 16,
          background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.2)',
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--accent)', marginBottom: 6 }}>
            Brand created!
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.5 }}>
            Pulse is researching your niche in the background — learning what your community talks about,
            how they sound, and what gets engagement. This takes about 30 seconds.
            You can start using your brand now — content quality improves as research completes.
          </div>
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-4)' }}>
            Next steps: set your mode above, connect X in Settings, then click Generate Post.
          </div>
        </div>
      )}

      {/* ─── Summary Card ─── */}
      <div style={{
        ...cardStyle, marginBottom: 20,
        border: isOff ? '1px solid var(--card-border)' : '1px solid var(--accent)',
        background: isOff ? 'var(--card-bg)' : 'rgba(16,185,129,0.04)',
      }}>
        {/* Mode toggle */}
        <div style={{ display: 'flex', gap: 0, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)', marginBottom: 20 }}>
          {([['off', 'Off'], ['semi', 'Semi-Auto'], ['full', 'Full Auto']] as const).map(([key, label]) => (
            <button
              key={key}
              className="btn-tab"
              data-active={mode === key ? "true" : "false"}
              onClick={() => key === 'full' && mode !== 'full' ? setPendingMode('full') : setMode(key)}
              style={{
                flex: 1, padding: '10px 16px', border: 'none',
                background: mode === key ? 'var(--accent)' : 'var(--bg-2)',
                color: mode === key ? '#fff' : 'var(--text-3)',
                fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {isOff ? (
          <div style={{ textAlign: 'center', padding: '12px 0' }}>
            <Bot size={28} style={{ color: 'var(--text-4)', margin: '0 auto 10px' }} />
            <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-2)', margin: '0 0 4px' }}>Autopilot is off</p>
            <p style={{ fontSize: 13, color: 'var(--text-4)', margin: 0 }}>
              Choose Semi-Auto or Full Auto to start posting.
            </p>
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <Zap size={14} style={{ color: 'var(--accent)' }} />
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)' }}>{modeLabel} is active</span>
            </div>
            <div style={{
              background: 'var(--bg-2)', borderRadius: 10, padding: '14px 18px',
              fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7,
            }}>
              <div>Posting <strong style={{ color: 'var(--text-1)' }}>~{postsPerDay} posts</strong> + <strong style={{ color: 'var(--text-1)' }}>~{repliesPerDay} replies</strong>/day</div>
              <div>Active <strong style={{ color: 'var(--text-1)' }}>{activeHoursStart}–{activeHoursEnd}</strong> {timezone.split('/').pop()?.replace('_', ' ')}</div>
              {mode === 'semi' && (
                <div style={{ marginTop: 4, color: 'var(--text-4)', fontSize: 12 }}>
                  Drafts require your approval before posting.
                </div>
              )}
            </div>

            {/* Warning: autopilot on but brand is paused */}
            {!agentRunning && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10, marginTop: 14,
                padding: '10px 14px', borderRadius: 8,
                background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)',
              }}>
                <AlertTriangle size={14} style={{ color: '#f59e0b', flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: '#f59e0b', lineHeight: 1.4 }}>
                  Autopilot is configured but your brand is paused. <Link to="/settings" style={{ color: '#f59e0b', fontWeight: 600 }}>Start it in Settings</Link> to begin posting.
                </span>
              </div>
            )}

            {/* Status */}
            <div style={{
              marginTop: 14, padding: '10px 14px', borderRadius: 8, background: 'var(--bg-2)',
              fontSize: 12, color: 'var(--text-4)',
            }}>
              {lastPostTime
                ? `Last post: ${(() => {
                    const mins = Math.round((Date.now() - new Date(lastPostTime).getTime()) / 60000)
                    if (mins < 60) return `${mins}m ago`
                    if (mins < 1440) return `${Math.round(mins / 60)}h ago`
                    return `${Math.round(mins / 1440)}d ago`
                  })()}`
                : 'No posts yet'}
            </div>

            {/* Quick Actions */}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              {([
                { key: 'post' as const, label: 'Generate Post', activeLabel: 'Generating...' },
                { key: 'reply' as const, label: 'Find & Reply', activeLabel: 'Searching...' },
              ]).map(a => (
                <button
                  key={a.key}
                  onClick={() => runAction(a.key)}
                  disabled={!!activeAction}
                  style={{
                    flex: 1, padding: '10px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                    background: activeAction === a.key ? 'var(--accent)' : 'var(--bg-2)',
                    color: activeAction === a.key ? '#fff' : 'var(--text-2)',
                    border: activeAction === a.key ? '1px solid var(--accent)' : '1px solid var(--border)',
                    cursor: activeAction ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    opacity: activeAction && activeAction !== a.key ? 0.4 : 1,
                    transition: 'all 0.15s',
                  }}
                >
                  {activeAction === a.key && <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />}
                  {activeAction === a.key ? a.activeLabel : a.label}
                </button>
              ))}
            </div>
            {postNowResult && (
              <div style={{
                marginTop: 8, padding: '8px 14px', borderRadius: 8, fontSize: 12,
                background: postNowResult.startsWith('Failed') || postNowResult.startsWith('No ') ? 'rgba(239,68,68,0.08)' : 'rgba(16,185,129,0.08)',
                color: postNowResult.startsWith('Failed') || postNowResult.startsWith('No ') ? 'var(--danger)' : 'var(--accent)',
                border: `1px solid ${postNowResult.startsWith('Failed') || postNowResult.startsWith('No ') ? 'rgba(239,68,68,0.2)' : 'rgba(16,185,129,0.2)'}`,
                wordBreak: 'break-word', overflow: 'hidden',
              }}>
                <span dangerouslySetInnerHTML={{ __html: postNowResult }} />
                <button onClick={() => setPostNowResult(null)} style={{
                  marginLeft: 8, background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--text-4)', fontSize: 11, textDecoration: 'underline',
                }}>dismiss</button>
              </div>
            )}

            {/* Quick controls */}
            <div style={{ display: 'flex', gap: 20, marginTop: 16 }}>
              <div>
                <label style={labelStyle}>Posts / day</label>
                <input
                  type="number" min={1} max={50} value={postsPerDay}
                  onChange={e => setPostsPerDay(Number(e.target.value))}
                  style={numberInputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Replies / day</label>
                <input
                  type="number" min={0} max={50} value={repliesPerDay}
                  onChange={e => setRepliesPerDay(Number(e.target.value))}
                  style={numberInputStyle}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ─── Reply Drafts (persisted, sorted newest first) ─── */}
      {replyDrafts.length > 0 && (
        <div style={{ ...cardStyle, marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)' }}>Reply Drafts ({replyDrafts.length})</div>
            <span style={{ fontSize: 11, color: 'var(--text-4)' }}>Click to reply on X — one click to post</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 400, overflowY: 'auto' }}>
            {replyDrafts.map(draft => {
              const tweetId = draft.targetUrl.split('/status/')[1]?.split(/[?#]/)[0] || ''
              const intentUrl = `https://x.com/intent/tweet?in_reply_to=${tweetId}&text=${encodeURIComponent(draft.replyText)}`
              const age = Math.round((Date.now() - new Date(draft.createdAt).getTime()) / 60000)
              const ageLabel = age < 60 ? `${age}m ago` : age < 1440 ? `${Math.round(age / 60)}h ago` : `${Math.round(age / 1440)}d ago`
              return (
                <div key={draft.id} style={{
                  padding: 10, background: 'var(--bg-2)', borderRadius: 8,
                  border: '1px solid var(--border)', fontSize: 13,
                }}>
                  <div style={{ color: 'var(--text-4)', fontSize: 11, marginBottom: 4 }}>
                    @{draft.targetAuthor} · {ageLabel}: {draft.targetText}...
                  </div>
                  <div style={{ color: 'var(--text-1)', marginBottom: 8, lineHeight: 1.4 }}>
                    {draft.replyText}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <a href={intentUrl} target="_blank" rel="noopener" style={{
                      padding: '4px 12px', borderRadius: 6, fontSize: 12, fontWeight: 500,
                      background: 'var(--accent)', color: '#fff', textDecoration: 'none',
                    }}>
                      Reply on X →
                    </a>
                    <button onClick={async () => {
                      await post(`/api/reply-drafts/${draft.id}/dismiss`)
                      setReplyDrafts(prev => prev.filter(d => d.id !== draft.id))
                    }} style={{
                      padding: '4px 12px', borderRadius: 6, fontSize: 12,
                      background: 'none', border: '1px solid var(--border)',
                      color: 'var(--text-4)', cursor: 'pointer',
                    }}>
                      Dismiss
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-4)', marginTop: 8 }}>
            X API access controls auto-reply volume. These drafts are ready to post manually; use an X API tier that matches your approved automation policy.
          </div>
        </div>
      )}

      {/* ─── Recent Activity ─── */}
      {recentActions.length > 0 && (
        <div style={{ ...cardStyle, marginBottom: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)', marginBottom: 14 }}>Recent Activity</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 400, overflowY: 'auto' }}>
            {recentActions.map((action, i) => {
              const timeAgo = (() => {
                if (!action.timestamp) return ''
                const mins = Math.round((Date.now() - new Date(action.timestamp).getTime()) / 60000)
                if (mins < 60) return `${mins}m ago`
                if (mins < 1440) return `${Math.round(mins / 60)}h ago`
                return `${Math.round(mins / 1440)}d ago`
              })()
              const typeLabel = action.type === 'thread-reply' ? 'Reply (thread)' : action.type === 'reply' ? 'Reply' : action.type === 'post' ? 'Post' : action.type
              const eng = action.engagement
              const engText = eng ? `${eng.likes}L ${eng.replies}R ${eng.reposts}RT` : ''
              const isExpanded = expandedAction === i
              return (
                <div key={i}
                  onClick={() => setExpandedAction(isExpanded ? null : i)}
                  style={{
                    padding: '8px 12px', borderRadius: 8, background: 'var(--bg-2)',
                    fontSize: 12, lineHeight: 1.5, cursor: 'pointer',
                    border: isExpanded ? '1px solid var(--border)' : '1px solid transparent',
                    transition: 'border-color 0.15s',
                  }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <span style={{
                      flexShrink: 0, padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                      background: action.type.includes('reply') ? 'rgba(59,130,246,0.1)' : 'rgba(16,185,129,0.1)',
                      color: action.type.includes('reply') ? '#3b82f6' : 'var(--accent)',
                    }}>
                      {typeLabel}
                    </span>
                    <span style={{
                      color: 'var(--text-2)', flex: 1, overflow: 'hidden',
                      textOverflow: isExpanded ? 'unset' : 'ellipsis',
                      whiteSpace: isExpanded ? 'pre-wrap' : 'nowrap',
                      wordBreak: isExpanded ? 'break-word' : undefined,
                    }}>
                      {action.content || '(no content)'}
                    </span>
                    {engText && <span style={{ flexShrink: 0, color: 'var(--text-4)', fontSize: 10 }}>{engText}</span>}
                    <span style={{ flexShrink: 0, color: 'var(--text-4)', fontSize: 10 }}>{timeAgo}</span>
                  </div>
                  {isExpanded && action.targetUrl && (
                    <div style={{ marginTop: 6, paddingLeft: 42 }}>
                      <a href={action.targetUrl} target="_blank" rel="noreferrer"
                        onClick={e => e.stopPropagation()}
                        style={{ color: 'var(--accent)', fontSize: 11, textDecoration: 'none' }}>
                        View on X →
                      </a>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ─── Advanced Settings (collapsed) ─── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Section title="Schedule" icon={Clock}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div>
              <label style={labelStyle}>Active hours start</label>
              <select value={activeHoursStart} onChange={e => setActiveHoursStart(e.target.value)}
                style={{ ...inputStyle, background: 'var(--select-bg)' }}>
                {timeOptions.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Active hours end</label>
              <select value={activeHoursEnd} onChange={e => setActiveHoursEnd(e.target.value)}
                style={{ ...inputStyle, background: 'var(--select-bg)' }}>
                {timeOptions.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label style={labelStyle}>Timezone</label>
            <input type="text" value={timezone} onChange={e => setTimezone(e.target.value)}
              style={inputStyle} placeholder="America/New_York" />
          </div>
        </Section>

        <Section title="Daily Limits" icon={Shield}>
          <p style={{ fontSize: 12, color: 'var(--text-4)', margin: '0 0 14px', lineHeight: 1.4 }}>Hard caps — your brand will never exceed these, even in Full Auto.</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {([
              ['Posts', dailyPosts, setDailyPosts],
              ['Replies', dailyReplies, setDailyReplies],
              ['Reposts', dailyReposts, setDailyReposts],
              ['Likes', dailyLikes, setDailyLikes],
            ] as const).map(([label, value, setter]) => (
              <div key={label}>
                <label style={labelStyle}>{label}/day</label>
                <input type="number" min={0} max={100} value={value}
                  onChange={e => (setter as any)(Number(e.target.value))} style={numberInputStyle} />
              </div>
            ))}
          </div>
        </Section>
      </div>

      <div style={{ height: 32 }} />

      <Modal
        open={pendingMode === 'full'}
        title="Enable Full Auto?"
        message="Full Auto mode will post to your connected accounts autonomously. Your brand voice comes from your knowledge notes and brand settings."
        confirmLabel="Enable Full Auto"
        danger={false}
        onConfirm={() => { setMode('full'); setPendingMode(null) }}
        onCancel={() => setPendingMode(null)}
      />
    </div>
  )
}
