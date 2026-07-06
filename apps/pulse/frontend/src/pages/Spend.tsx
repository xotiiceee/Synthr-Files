import { useEffect, useMemo, useState } from 'react'
import { BadgeDollarSign, CheckCircle2, ChevronDown, ChevronRight, Database, ExternalLink, Gift, RefreshCw, ShieldCheck, Zap } from 'lucide-react'
import { get, post } from '../lib/api'

interface SpendEvent {
  id: string
  createdAt: string
  category: 'x402' | 'llm' | 'internal'
  rail: string
  recipient: string
  provider?: string | null
  endpoint?: string | null
  endpointPath?: string | null
  method?: string | null
  queryText?: string | null
  dataType?: string | null
  sinceHours?: number | null
  purpose: string
  step: string
  amountUsd: number
  amountDisplay: string
  cacheHit?: boolean | null
  savingsUsd?: number
  decisionTrace?: string | null
  status: string
  verifiable: boolean
}

interface SpendHistory {
  currency: string
  summary: {
    totalUsd: number
    totalDisplay: string
    eventCount: number
  }
  events: SpendEvent[]
}

const cardStyle: React.CSSProperties = {
  background: 'var(--card-bg)',
  border: '1px solid var(--card-border)',
  borderRadius: 12,
}

function money(value: number) {
  return `$${value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '.00')}`
}

function endpointLabel(event: SpendEvent) {
  if (event.endpointPath) return event.endpointPath
  if (!event.endpoint) return event.provider || event.recipient
  try {
    return new URL(event.endpoint).pathname || event.endpoint
  } catch {
    return event.endpoint
  }
}

function startOfWeek(date: Date) {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day
  d.setHours(0, 0, 0, 0)
  d.setDate(diff)
  return d
}

function weekLabel(start: Date) {
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  const sameYear = start.getFullYear() === end.getFullYear()
  const startText = start.toLocaleDateString([], { month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' })
  const endText = end.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
  return `${startText} - ${endText}`
}

export default function Spend() {
  const [data, setData] = useState<SpendHistory | null>(null)
  const [loading, setLoading] = useState(true)
  const [openWeeks, setOpenWeeks] = useState<Set<string>>(new Set())
  const [redeemCode, setRedeemCode] = useState('')
  const [redeeming, setRedeeming] = useState(false)
  const [redeemMsg, setRedeemMsg] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const res = await get<SpendHistory>('/api/spend/history')
      setData(res)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const doRedeem = async () => {
    if (!redeemCode.trim() || redeeming) return
    setRedeeming(true)
    setRedeemMsg('')
    try {
      const res = await post<{ok: boolean; code: string; creditsAdded: number; newBalance: number; error?: string}>('/api/redeem-code', { code: redeemCode.trim() })
      if (res.ok) {
        setRedeemMsg(`+$${(res.creditsAdded / 100).toFixed(0)} added (balance: $${(res.newBalance / 100).toFixed(2)})`)
        setRedeemCode('')
      }
    } catch (e: any) {
      setRedeemMsg(e.body?.error || 'Invalid or expired code')
    }
    setRedeeming(false)
  }

  const totals = useMemo(() => {
    const events = data?.events ?? []
    return {
      x402: events.filter(e => e.category === 'x402').reduce((sum, e) => sum + e.amountUsd, 0),
      llm: events.filter(e => e.category === 'llm').reduce((sum, e) => sum + e.amountUsd, 0),
      saved: events.reduce((sum, e) => sum + (e.savingsUsd ?? 0), 0),
    }
  }, [data])

  const weeklyGroups = useMemo(() => {
    const groups = new Map<string, { key: string; label: string; events: SpendEvent[]; total: number; x402: number; llm: number }>()
    for (const event of data?.events ?? []) {
      const start = startOfWeek(new Date(event.createdAt))
      const key = start.toISOString().slice(0, 10)
      const current = groups.get(key) ?? { key, label: weekLabel(start), events: [], total: 0, x402: 0, llm: 0 }
      current.events.push(event)
      current.total += event.amountUsd
      if (event.category === 'x402') current.x402 += event.amountUsd
      if (event.category === 'llm') current.llm += event.amountUsd
      groups.set(key, current)
    }
    return [...groups.values()].sort((a, b) => b.key.localeCompare(a.key))
  }, [data])

  useEffect(() => {
    if (weeklyGroups.length && openWeeks.size === 0) {
      setOpenWeeks(new Set([weeklyGroups[0].key]))
    }
  }, [openWeeks.size, weeklyGroups])

  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set())

  const toggleEvent = (id: string) => {
    setExpandedEvents(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleWeek = (key: string) => {
    setOpenWeeks(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: 'var(--main-bg)' }}>
      <div style={{ padding: '28px 32px', maxWidth: 1180, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-1)', marginBottom: 4 }}>Spend</h1>
            <p style={{ fontSize: 14, color: 'var(--text-3)', margin: 0 }}>x402, model, cache, and agent execution charges</p>
          </div>
          <button
            onClick={load}
            className="btn"
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '9px 14px', borderRadius: 8, border: '1px solid var(--border)',
              background: 'var(--bg-2)', color: 'var(--text-2)', cursor: 'pointer',
              fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
            }}
          >
            <RefreshCw size={14} /> Refresh
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12, marginBottom: 18 }}>
          {[
            { label: 'Total', value: data?.summary.totalDisplay ?? '$0.00', icon: BadgeDollarSign },
            { label: 'x402', value: money(totals.x402), icon: Zap },
            { label: 'LLM', value: money(totals.llm), icon: Database },
            { label: 'Saved', value: money(totals.saved), icon: ShieldCheck },
          ].map(item => (
            <div key={item.label} style={{ ...cardStyle, padding: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-3)', fontSize: 12, fontWeight: 600, marginBottom: 10 }}>
                <item.icon size={15} style={{ color: 'var(--accent)' }} /> {item.label}
              </div>
              <div style={{ color: 'var(--text-1)', fontSize: 24, fontWeight: 750, fontVariantNumeric: 'tabular-nums' }}>{item.value}</div>
            </div>
          ))}
        </div>

        <div style={{ ...cardStyle, padding: 16, marginBottom: 18, display: 'flex', gap: 10, alignItems: 'center' }}>
          <Gift size={18} style={{ color: 'var(--accent)', flexShrink: 0 }} />
          <input value={redeemCode} onChange={e => setRedeemCode(e.target.value)} placeholder="Redeem a code..."
            onKeyDown={e => e.key === 'Enter' && doRedeem()}
            style={{
              padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-1)',
              color: 'var(--text-1)', fontFamily: 'inherit', fontSize: 13, flex: 1, maxWidth: 240,
            }} />
          <button onClick={doRedeem} disabled={redeeming || !redeemCode.trim()} style={{
            borderRadius: 8, border: '1px solid var(--accent)', background: 'var(--accent-dim)', color: 'var(--accent)',
            padding: '10px 16px', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, fontSize: 13,
            whiteSpace: 'nowrap',
          }}>{redeeming ? '...' : 'Redeem'}</button>
          {redeemMsg && <span style={{ color: redeemMsg.startsWith('+') ? 'var(--accent)' : 'var(--text-3)', fontSize: 13, fontWeight: 600 }}>{redeemMsg}</span>}
        </div>

        <div style={{ ...cardStyle, overflow: 'hidden' }}>
          {loading ? (
            <div style={{ padding: 28, color: 'var(--text-3)' }}>Loading spend history...</div>
          ) : weeklyGroups.length ? (
            <div style={{ maxHeight: 'calc(100vh - 275px)', overflowY: 'auto' }}>
              {weeklyGroups.map(group => {
                const open = openWeeks.has(group.key)
                return (
                  <div key={group.key} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <button
                      onClick={() => toggleWeek(group.key)}
                      style={{
                        width: '100%', display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 14,
                        alignItems: 'center', padding: '14px 16px', border: 'none',
                        background: open ? 'var(--bg-2)' : 'var(--card-bg)',
                        cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                        {open ? <ChevronDown size={15} style={{ color: 'var(--text-4)', flexShrink: 0 }} /> : <ChevronRight size={15} style={{ color: 'var(--text-4)', flexShrink: 0 }} />}
                        <div style={{ minWidth: 0 }}>
                          <div style={{ color: 'var(--text-1)', fontSize: 14, fontWeight: 700 }}>{group.label}</div>
                          <div style={{ color: 'var(--text-4)', fontSize: 12 }}>{group.events.length} transaction{group.events.length === 1 ? '' : 's'}</div>
                        </div>
                      </div>
                      <div style={{ color: 'var(--text-3)', fontSize: 12, fontWeight: 650 }}>x402 {money(group.x402)}</div>
                      <div style={{ color: 'var(--text-3)', fontSize: 12, fontWeight: 650 }}>LLM {money(group.llm)}</div>
                      <div style={{ color: 'var(--text-1)', fontSize: 15, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{money(group.total)}</div>
                    </button>

                    {open && (
                      <>
                        <div style={{ display: 'grid', gridTemplateColumns: '140px 90px minmax(180px, 1fr) minmax(190px, 240px) 110px 100px', gap: 12, padding: '10px 16px', borderTop: '1px solid var(--border-subtle)', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-4)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                          <div>Time</div>
                          <div>Rail</div>
                          <div>Purpose</div>
                          <div>Endpoint</div>
                          <div>Amount</div>
                          <div>Verify</div>
                        </div>

                        {group.events.map(event => {
                          const expanded = expandedEvents.has(event.id)
                          return (
                          <div key={event.id} style={{ cursor: 'pointer' }} onClick={() => toggleEvent(event.id)}>
                            <div style={{ display: 'grid', gridTemplateColumns: '140px 90px minmax(180px, 1fr) minmax(190px, 240px) 110px 100px', gap: 12, alignItems: 'center', padding: '13px 16px', borderBottom: '1px solid var(--border-subtle)', background: expanded ? 'var(--bg-2)' : undefined }}>
                              <div style={{ color: 'var(--text-3)', fontSize: 12 }}>{new Date(event.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
                              <div>
                                <span style={{ padding: '4px 8px', borderRadius: 999, background: event.category === 'x402' ? 'var(--accent-dim)' : 'var(--bg-3)', color: event.category === 'x402' ? 'var(--accent)' : 'var(--text-2)', fontSize: 12, fontWeight: 700 }}>
                                  {event.rail}
                                </span>
                              </div>
                              <div style={{ minWidth: 0 }}>
                                <div style={{ color: 'var(--text-1)', fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{event.purpose}</div>
                                <div style={{ color: 'var(--text-4)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {event.step}{event.cacheHit != null ? ` · cache ${event.cacheHit ? 'hit' : 'miss'}` : ''}{event.savingsUsd ? ` · saved ${money(event.savingsUsd)}` : ''}
                                </div>
                              </div>
                              <div style={{ minWidth: 0 }}>
                                <div style={{ color: 'var(--text-2)', fontSize: 12, fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {(event.method || 'POST')} {endpointLabel(event)}
                                </div>
                                <div style={{ color: 'var(--text-4)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={[event.endpoint, event.queryText].filter(Boolean).join(' | ')}>
                                  {event.provider || event.recipient}{event.dataType ? ` · ${event.dataType}` : ''}{event.sinceHours ? ` · ${event.sinceHours}h` : ''}
                                </div>
                              </div>
                              <div style={{ color: 'var(--text-1)', fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{event.amountDisplay}</div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: event.verifiable ? 'var(--accent)' : 'var(--text-4)', fontSize: 12, fontWeight: 600 }}>
                                {event.verifiable ? <CheckCircle2 size={14} /> : <ExternalLink size={14} />}
                                {event.verifiable ? 'Ready' : 'Internal'}
                              </div>
                              {expanded && <ChevronDown size={12} style={{ position: 'absolute', right: 8, top: 8, color: 'var(--text-4)' }} />}
                            </div>
                            {expanded && (
                              <div style={{ padding: '12px 16px 14px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-1)', fontSize: 12 }}>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '8px 16px' }}>
                                  {event.endpoint && <div><span style={{ color: 'var(--text-4)', fontWeight: 700 }}>Endpoint: </span><span style={{ color: 'var(--text-2)', fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>{event.endpoint}</span></div>}
                                  {event.endpointPath && <div><span style={{ color: 'var(--text-4)', fontWeight: 700 }}>Path: </span><span style={{ color: 'var(--text-2)' }}>{event.endpointPath}</span></div>}
                                  {event.queryText && <div><span style={{ color: 'var(--text-4)', fontWeight: 700 }}>Query: </span><span style={{ color: 'var(--text-2)' }}>"{event.queryText}"</span></div>}
                                  {event.dataType && <div><span style={{ color: 'var(--text-4)', fontWeight: 700 }}>Data type: </span><span style={{ color: 'var(--text-2)' }}>{event.dataType}</span></div>}
                                  {event.sinceHours != null && <div><span style={{ color: 'var(--text-4)', fontWeight: 700 }}>Since: </span><span style={{ color: 'var(--text-2)' }}>{event.sinceHours}h</span></div>}
                                  <div><span style={{ color: 'var(--text-4)', fontWeight: 700 }}>ID: </span><span style={{ color: 'var(--text-2)', fontFamily: 'monospace', fontSize: 11 }}>{event.id}</span></div>
                                  {event.decisionTrace && <div style={{ gridColumn: '1 / -1' }}><span style={{ color: 'var(--text-4)', fontWeight: 700 }}>Decision trace: </span><span style={{ color: 'var(--text-2)' }}>{event.decisionTrace}</span></div>}
                                </div>
                              </div>
                            )}
                          </div>
                          )
                        })}
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div style={{ padding: 34, textAlign: 'center', color: 'var(--text-3)' }}>
              <ShieldCheck size={24} style={{ color: 'var(--accent)', margin: '0 auto 10px' }} />
              <div style={{ color: 'var(--text-1)', fontWeight: 650, marginBottom: 4 }}>No spend events yet</div>
              <div style={{ fontSize: 13 }}>New x402 and model charges will appear here as your agents run.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
