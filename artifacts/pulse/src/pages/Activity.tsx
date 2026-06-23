import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { BarChart3, Loader2, PenLine, MessageSquare, AtSign, UserPlus, Heart, Clock, Filter, TrendingUp, Zap, Award, Hash } from 'lucide-react'
import { get } from '../lib/api'

interface Engagement {
  likes: number
  replies: number
  reposts: number
}

interface ActivityItem {
  id: string
  type: 'post' | 'reply' | 'mention' | 'follow' | 'like' | 'comment' | 'repost'
  content?: string
  status?: string
  platform?: string
  theme?: string
  createdAt?: string
  timestamp?: string
  engagement?: Engagement
  targetUrl?: string
}

interface ThemeStat {
  theme: string
  postCount: number
  avgEngagement: number
}

interface ActivityStats {
  total: number
  totalEngagement: number
  avgEngagement: number
  byPlatform: Record<string, number>
  byType: Record<string, number>
  bestPost: { content: string; platform: string; engagement: Engagement } | null
  topThemes: ThemeStat[]
}

const typeFilters = ['All', 'Posts', 'Replies', 'Mentions', 'Follows'] as const
const periods = [
  { label: '1 day', value: '1d' },
  { label: '7 days', value: '7d' },
  { label: '30 days', value: '30d' },
  { label: 'All time', value: 'all' },
]

const typeToFilter: Record<string, typeof typeFilters[number]> = {
  post: 'Posts', reply: 'Replies', mention: 'Mentions', follow: 'Follows',
}

const platformColors: Record<string, string> = {
  x: '#1DA1F2',
}

const typeIcon = (type: string) => {
  switch (type) {
    case 'post': return <PenLine size={15} style={{ color: 'var(--accent)' }} />
    case 'reply': return <MessageSquare size={15} style={{ color: '#8b5cf6' }} />
    case 'mention': return <AtSign size={15} style={{ color: '#3b82f6' }} />
    case 'follow': return <UserPlus size={15} style={{ color: '#f59e0b' }} />
    case 'like': return <Heart size={15} style={{ color: '#ef4444' }} />
    default: return <Clock size={15} style={{ color: 'var(--text-3)' }} />
  }
}

const typeIconBg = (type: string) => {
  switch (type) {
    case 'post': return { background: 'var(--accent-dim)', border: '1px solid var(--accent-glow)' }
    case 'reply': return { background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.2)' }
    case 'mention': return { background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)' }
    case 'follow': return { background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)' }
    case 'like': return { background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }
    default: return { background: 'var(--bg-3)', border: '1px solid var(--border)' }
  }
}

const statusBadge = (status?: string) => {
  if (!status) return null
  const styles: Record<string, React.CSSProperties> = {
    published: { background: 'rgba(16,185,129,0.1)', color: 'var(--accent)', border: '1px solid rgba(16,185,129,0.2)' },
    sent: { background: 'rgba(16,185,129,0.1)', color: 'var(--accent)', border: '1px solid rgba(16,185,129,0.2)' },
    pending: { background: 'rgba(245,158,11,0.1)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.2)' },
    failed: { background: 'rgba(239,68,68,0.1)', color: 'var(--danger)', border: '1px solid rgba(239,68,68,0.2)' },
  }
  const s = styles[status] || styles.pending
  return (
    <span style={{ fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 12, ...s }}>
      {status}
    </span>
  )
}

const engBadge = (eng?: Engagement) => {
  if (!eng) return null
  const total = (eng.likes ?? 0) + (eng.replies ?? 0) + (eng.reposts ?? 0)
  if (total === 0) return null
  return (
    <span style={{
      fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 12,
      background: 'rgba(16,185,129,0.1)', color: 'var(--accent)', border: '1px solid rgba(16,185,129,0.2)',
      display: 'inline-flex', alignItems: 'center', gap: 4,
    }}>
      <Zap size={10} /> {total}
    </span>
  )
}

export default function Activity() {
  const [items, setItems] = useState<ActivityItem[]>([])
  const [stats, setStats] = useState<ActivityStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeFilter, setActiveFilter] = useState<typeof typeFilters[number]>('All')
  const [period, setPeriod] = useState('7d')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const fetchActivity = async () => {
    setLoading(true)
    try {
      const data = await get<{ actions?: ActivityItem[], stats?: ActivityStats }>(`/api/activity?period=${period}`)
      setItems(data.actions || (Array.isArray(data) ? data : []))
      if (data.stats) setStats(data.stats)
    } catch {
      setItems([])
      setStats(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchActivity() }, [period])

  const filteredItems = items.filter(item => {
    if (activeFilter === 'All') return true
    return typeToFilter[item.type] === activeFilter
  })

  const formatTime = (ts?: string) => {
    if (!ts) return ''
    const d = new Date(ts)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    const days = Math.floor(hrs / 24)
    if (days < 7) return `${days}d ago`
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }

  const cardStyle: React.CSSProperties = {
    background: 'var(--card-bg)', border: '1px solid var(--card-border)',
    borderRadius: 12, padding: 20,
  }

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '0 24px', minHeight: '100%', overflowX: 'hidden', boxSizing: 'border-box', wordBreak: 'break-word' }}>
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
          <BarChart3 size={20} style={{ color: 'var(--accent)' }} />
        </div>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--text-1)', margin: 0 }}>Activity</h1>
          <p style={{ fontSize: 13, color: 'var(--text-3)', margin: 0 }}>Performance metrics and post history</p>
        </div>
      </div>

      {/* Stats cards */}
      {!loading && stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginTop: 24 }}>
          <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <PenLine size={16} style={{ color: 'var(--accent)' }} />
              <span style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 500 }}>Total Posts</span>
            </div>
            <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-1)', lineHeight: 1 }}>
              {stats.total}
            </div>
          </div>

          <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <Zap size={16} style={{ color: '#f59e0b' }} />
              <span style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 500 }}>Total Engagement</span>
            </div>
            <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-1)', lineHeight: 1 }}>
              {stats.totalEngagement}
            </div>
          </div>

          <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <TrendingUp size={16} style={{ color: '#10b981' }} />
              <span style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 500 }}>Avg / Post</span>
            </div>
            <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-1)', lineHeight: 1 }}>
              {stats.avgEngagement}
            </div>
          </div>

          <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <Hash size={16} style={{ color: '#8b5cf6' }} />
              <span style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 500 }}>Platforms</span>
            </div>
            <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-1)', lineHeight: 1 }}>
              {Object.keys(stats.byPlatform).length}
            </div>
          </div>
        </div>
      )}

      {/* Platform breakdown + Top themes row */}
      {!loading && stats && (Object.keys(stats.byPlatform).length > 0 || stats.topThemes.length > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: stats.topThemes.length > 0 ? '1fr 1fr' : '1fr', gap: 12, marginTop: 12 }}>
          {/* Platform breakdown */}
          {Object.keys(stats.byPlatform).length > 0 && (
            <div style={cardStyle}>
              <h3 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-2)', margin: '0 0 14px' }}>By Platform</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {Object.entries(stats.byPlatform)
                  .sort((a, b) => b[1] - a[1])
                  .map(([platform, count]) => {
                    const pct = stats.total > 0 ? Math.round((count / stats.total) * 100) : 0
                    return (
                      <div key={platform} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 12, color: 'var(--text-2)', width: 70, fontWeight: 500, textTransform: 'capitalize' }}>
                          {platform}
                        </span>
                        <div style={{ flex: 1, height: 6, background: 'var(--bg-3)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{
                            width: `${pct}%`, height: '100%', borderRadius: 3,
                            background: platformColors[platform] || 'var(--accent)',
                          }} />
                        </div>
                        <span style={{ fontSize: 11, color: 'var(--text-3)', width: 36, textAlign: 'right' }}>
                          {count}
                        </span>
                      </div>
                    )
                  })}
              </div>
            </div>
          )}

          {/* Top themes */}
          {stats.topThemes.length > 0 && (
            <div style={cardStyle}>
              <h3 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-2)', margin: '0 0 14px' }}>Top Themes</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {stats.topThemes.map((t, i) => (
                  <div key={t.theme} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{
                      fontSize: 11, fontWeight: 700, color: i === 0 ? '#f59e0b' : 'var(--text-3)',
                      width: 18, textAlign: 'center',
                    }}>
                      {i === 0 ? <Award size={14} style={{ color: '#f59e0b' }} /> : `#${i + 1}`}
                    </span>
                    <span style={{
                      fontSize: 12, color: 'var(--text-2)', flex: 1,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {t.theme}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-3)', flexShrink: 0 }}>
                      {t.postCount} posts / {t.avgEngagement.toFixed(1)} avg
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Best post highlight */}
      {!loading && stats?.bestPost && (
        <div style={{ ...cardStyle, marginTop: 12, borderColor: 'rgba(245,158,11,0.3)', background: 'rgba(245,158,11,0.03)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Award size={14} style={{ color: '#f59e0b' }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: '#f59e0b' }}>Best Performing Post</span>
            <span style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'capitalize' }}>on {stats.bestPost.platform}</span>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-1)', lineHeight: 1.5, margin: 0 }}>
            {stats.bestPost.content}
          </p>
          <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
            {stats.bestPost.engagement.likes > 0 && (
              <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                <Heart size={10} style={{ display: 'inline', marginRight: 3, verticalAlign: 'middle' }} />
                {stats.bestPost.engagement.likes}
              </span>
            )}
            {stats.bestPost.engagement.replies > 0 && (
              <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                <MessageSquare size={10} style={{ display: 'inline', marginRight: 3, verticalAlign: 'middle' }} />
                {stats.bestPost.engagement.replies}
              </span>
            )}
            {stats.bestPost.engagement.reposts > 0 && (
              <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                <TrendingUp size={10} style={{ display: 'inline', marginRight: 3, verticalAlign: 'middle' }} />
                {stats.bestPost.engagement.reposts}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Filter bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 12, marginTop: 24,
      }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {typeFilters.map(tab => (
            <button
              key={tab}
              className="btn-tab"
              data-active={activeFilter === tab ? "true" : "false"}
              onClick={() => setActiveFilter(tab)}
              style={{
                padding: '6px 16px', borderRadius: 20, fontSize: 13, fontFamily: 'inherit',
                cursor: 'pointer', transition: 'all 0.15s', border: 'none',
                background: activeFilter === tab ? 'var(--accent)' : 'var(--bg-3)',
                color: activeFilter === tab ? '#fff' : 'var(--text-2)',
              }}
            >
              {tab}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Filter size={14} style={{ color: 'var(--text-3)' }} />
          <select
            value={period}
            onChange={e => setPeriod(e.target.value)}
            style={{
              background: 'var(--select-bg)', border: '1px solid var(--input-border)',
              borderRadius: 8, padding: '6px 12px', color: 'var(--text-1)',
              fontSize: 13, fontFamily: 'inherit', outline: 'none', cursor: 'pointer',
            }}
          >
            {periods.map(p => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Timeline */}
      <div style={{ marginTop: 16 }}>
        {loading ? (
          <div style={{
            background: 'var(--card-bg)', border: '1px solid var(--card-border)',
            borderRadius: 12, padding: 40, textAlign: 'center',
          }}>
            <Loader2 size={20} style={{ color: 'var(--accent)', animation: 'spin 1s linear infinite', margin: '0 auto 8px' }} />
            <p style={{ color: 'var(--text-3)', fontSize: 13, margin: 0 }}>Loading activity...</p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div style={{
            background: 'var(--card-bg)', border: '1px solid var(--card-border)',
            borderRadius: 12, padding: 40, textAlign: 'center',
          }}>
            <BarChart3 size={28} style={{ color: 'var(--text-4)', margin: '0 auto 12px' }} />
            <p style={{ color: 'var(--text-2)', fontSize: 14, margin: '0 0 4px' }}>No activity yet</p>
            <p style={{ color: 'var(--text-3)', fontSize: 13, margin: 0 }}>
              <Link to="/create" style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 500 }}>Create your first post</Link> to start tracking activity.
            </p>
          </div>
        ) : (
          <div style={{ position: 'relative' }}>
            {/* Timeline line */}
            <div style={{
              position: 'absolute', left: 19, top: 0, bottom: 0, width: 1,
              background: 'var(--border-subtle)',
            }} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {filteredItems.map(item => (
                <div key={item.id} style={{
                  display: 'flex', gap: 16, alignItems: 'flex-start', padding: '12px 0',
                  position: 'relative',
                }}>
                  {/* Icon */}
                  <div style={{
                    width: 38, height: 38, borderRadius: 10, flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    position: 'relative', zIndex: 1,
                    ...typeIconBg(item.type),
                  }}>
                    {typeIcon(item.type)}
                  </div>

                  {/* Content card — click to expand */}
                  <div
                    onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                    style={{
                      flex: 1, background: 'var(--card-bg)', border: '1px solid var(--card-border)',
                      borderRadius: 12, padding: '14px 18px', cursor: 'pointer', transition: 'border-color 0.15s',
                      ...(expandedId === item.id ? { borderColor: 'var(--accent)' } : {}),
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', textTransform: 'capitalize' }}>
                            {item.type}
                          </span>
                          {item.platform && (
                            <span style={{
                              fontSize: 10, fontWeight: 500, padding: '1px 6px', borderRadius: 8,
                              background: 'var(--bg-3)', color: platformColors[item.platform] || 'var(--text-3)',
                              textTransform: 'capitalize',
                            }}>
                              {item.platform}
                            </span>
                          )}
                          {statusBadge(item.status)}
                          {engBadge(item.engagement)}
                        </div>
                        {item.content && (
                          <p style={{
                            fontSize: 14, color: 'var(--text-1)', lineHeight: 1.6, margin: 0,
                            ...(expandedId === item.id ? {} : { overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }),
                          }}>
                            {item.content.replace(/^\[DRAFT\]\s*|^\[QUEUED\]\s*|^\[QUEUED THREAD\]\s*|^\[THREAD \d+\/\d+\]\s*/i, '')}
                          </p>
                        )}
                      </div>
                      <span style={{ fontSize: 12, color: 'var(--text-4)', flexShrink: 0, whiteSpace: 'nowrap' }}>
                        {formatTime(item.createdAt || item.timestamp)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={{ height: 32 }} />
    </div>
  )
}
