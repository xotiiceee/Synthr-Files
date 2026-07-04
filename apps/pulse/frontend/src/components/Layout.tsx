import { NavLink, useLocation } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { MessageSquare, Bot, PenLine, Brain, BarChart3, Settings, Plus, Coins, ExternalLink, LogOut, ChevronDown, Sun, Moon, TrendingUp, MessageCircle, X, Send, Check, Menu, Fingerprint, Image, Shield } from 'lucide-react'
import { post } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { useAgents } from '../hooks/useAgents'
import { useTheme } from '../hooks/useTheme'

const baseNavItems = [
  { to: '/chat-setup', label: 'Chat', icon: MessageSquare },
  { to: '/autopilot', label: 'Autopilot', icon: Bot },
  { to: '/create', label: 'Create', icon: PenLine },
  { to: '/knowledge', label: 'Knowledge', icon: Brain },
  { to: '/media', label: 'Media', icon: Image },
  { to: '/activity', label: 'Activity', icon: BarChart3 },
  { to: '/growth', label: 'Growth', icon: TrendingUp },
  { to: '/brand', label: 'Brand', icon: Fingerprint },
  { to: '/settings', label: 'Settings', icon: Settings },
]

const adminNavItem = { to: '/admin', label: 'Admin', icon: Shield }

const IDLE_TIMEOUT_MS = 30 * 60 * 1000

export default function Layout({ children }: { children: React.ReactNode }) {
  const { credits, projection, email, authProvider, isAdmin, logout } = useAuth()
  const { agents, activeId, switchAgent, createAgent } = useAgents()
  const { theme, toggle: toggleTheme } = useTheme()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [creating, setCreating] = useState(false)

  const navItems = isAdmin ? [...baseNavItems, adminNavItem] : baseNavItems

  // Idle timeout placeholder. The current split app does not have a PIN route yet,
  // so keep the session active instead of redirecting into a broken path.
  useEffect(() => {
    let timer = setTimeout(() => {}, IDLE_TIMEOUT_MS)
    const reset = () => { clearTimeout(timer); timer = setTimeout(() => {}, IDLE_TIMEOUT_MS) }
    window.addEventListener('mousemove', reset)
    window.addEventListener('keydown', reset)
    window.addEventListener('click', reset)
    window.addEventListener('scroll', reset)
    return () => { clearTimeout(timer); window.removeEventListener('mousemove', reset); window.removeEventListener('keydown', reset); window.removeEventListener('click', reset); window.removeEventListener('scroll', reset) }
  }, [])
  const [newName, setNewName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const location = useLocation()

  // Feedback
  const [fbOpen, setFbOpen] = useState(false)
  const [fbType, setFbType] = useState<'suggestion' | 'bug'>('suggestion')
  const [fbMsg, setFbMsg] = useState('')
  const [fbSending, setFbSending] = useState(false)
  const [fbSent, setFbSent] = useState(false)

  const [fbError, setFbError] = useState('')

  const submitFeedback = async () => {
    if (!fbMsg.trim() || fbSending) return
    setFbSending(true)
    setFbError('')
    try {
      await post('/api/feedback', { type: fbType, message: fbMsg.trim() })
      setFbSent(true)
      setFbMsg('')
      setTimeout(() => { setFbOpen(false); setFbSent(false) }, 1500)
    } catch (e: any) {
      const msg = e.message || ''
      if (msg.includes('Limit') || msg.includes('rate') || msg.includes('429')) {
        setFbError('You\'ve reached the daily limit (3 per day). Try again tomorrow.')
      } else {
        setFbError('Failed to send. Please try again.')
      }
    }
    setFbSending(false)
  }

  useEffect(() => { if (creating && inputRef.current) inputRef.current.focus() }, [creating])

  const handleCreate = async () => {
    if (!newName.trim()) return
    await createAgent(newName.trim())
    setNewName('')
    setCreating(false)
  }

  const handleLogout = async () => {
    try { await post('/auth/logout', {}) } catch {}
    await logout()
  }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--bg-0)' }}>
      {/* Mobile Header */}
      <div
        className="pulse-mobile-header"
        style={{
          display: 'none', position: 'fixed', top: 0, left: 0, right: 0, height: 56,
          background: 'var(--sidebar-bg)', borderBottom: '1px solid var(--border-subtle)',
          alignItems: 'center', padding: '0 16px', gap: 12, zIndex: 999,
        }}
      >
        <button
          onClick={() => setMobileOpen(o => !o)}
          style={{
            width: 36, height: 36, borderRadius: 8, border: '1px solid var(--border)',
            background: 'var(--bg-2)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: 'var(--text-2)',
          }}
        >
          <Menu size={18} />
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 30, height: 30, borderRadius: 8,
            background: 'linear-gradient(135deg, var(--accent) 0%, #059669 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 16px var(--accent-glow)',
          }}>
            <span style={{ color: '#fff', fontWeight: 700, fontSize: 14 }}>P</span>
          </div>
          <span style={{ color: 'var(--text-1)', fontWeight: 600, fontSize: 16 }}>Pulse</span>
        </div>
      </div>

      {/* Mobile Backdrop */}
      {mobileOpen && (
        <div
          className="pulse-backdrop"
          onClick={() => setMobileOpen(false)}
          style={{
            display: 'none', position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
            zIndex: 999,
          }}
        />
      )}

      {/* Sidebar */}
      <nav className={`pulse-sidebar${mobileOpen ? ' open' : ''}`} style={{
        width: 260, flexShrink: 0, display: 'flex', flexDirection: 'column',
        background: 'var(--sidebar-bg)',
        borderRight: '1px solid var(--border-subtle)',
        overflowY: 'auto',
      }}>
        {/* Brand + Theme Toggle */}
        <div style={{ padding: '24px 20px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: 'linear-gradient(135deg, var(--accent) 0%, #059669 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 20px var(--accent-glow)',
            }}>
              <span style={{ color: '#fff', fontWeight: 700, fontSize: 16 }}>P</span>
            </div>
            <div>
              <div style={{ color: 'var(--text-1)', fontWeight: 600, fontSize: 16, letterSpacing: '-0.01em' }}>Pulse</div>
              <div style={{ color: 'var(--text-4)', fontSize: 11, letterSpacing: '0.02em' }}>AI Marketing Agent</div>
            </div>
          </div>
          <button
            className="btn-icon"
            onClick={toggleTheme}
            style={{
              width: 32, height: 32, borderRadius: 8, border: '1px solid var(--border)',
              background: 'var(--bg-2)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: 'var(--text-3)', transition: 'all 0.15s',
            }}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>
        </div>

        {/* Agent Selector */}
        <div style={{ padding: '0 12px 16px' }}>
          <div style={{ color: 'var(--text-4)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', padding: '0 8px', marginBottom: 6 }}>
            Workspace
          </div>
          <div style={{
            margin: '0 8px 12px',
            padding: '10px 12px',
            borderRadius: 10,
            border: '1px solid var(--border)',
            background: 'var(--bg-2)',
            color: 'var(--text-2)',
            fontSize: 13,
            fontWeight: 500,
          }}>
            {authProvider === 'demo' ? 'Tonight workspace' : 'Pulse workspace'}
          </div>
          <div style={{ color: 'var(--text-4)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', padding: '0 8px', marginBottom: 6 }}>
            Agent
          </div>

          {agents.length === 0 && !creating ? (
            /* No agents — show create prompt */
            <button
              className="btn-accent"
              onClick={() => setCreating(true)}
              style={{
                width: '100%', padding: '10px 16px', background: 'var(--accent)', color: '#fff',
                borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}
            >
              <Plus size={14} /> Create Your Agent
            </button>
          ) : agents.length > 0 && !creating ? (
            /* Has agents — show selector + add */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ position: 'relative' }}>
                <select
                  value={activeId}
                  onChange={(e) => switchAgent(e.target.value)}
                  style={{
                    width: '100%', background: 'var(--select-bg)', color: 'var(--text-1)',
                    border: '1px solid var(--border)', borderRadius: 8,
                    padding: '9px 32px 9px 12px', fontSize: 14, fontWeight: 500,
                    outline: 'none', cursor: 'pointer', appearance: 'none' as const,
                    fontFamily: 'inherit', transition: 'border-color 0.15s',
                  }}
                >
                  {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <ChevronDown size={14} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-4)', pointerEvents: 'none' }} />
              </div>
              <button
                className="btn"
                onClick={() => setCreating(true)}
                style={{
                  width: '100%', padding: '6px 0', background: 'transparent', color: 'var(--text-3)',
                  border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, fontWeight: 500,
                  cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                }}
              >
                <Plus size={12} /> New Agent
              </button>
            </div>
          ) : null}

          {creating && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <input
                ref={inputRef}
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setCreating(false) }}
                placeholder="Agent name..."
                style={{
                  width: '100%', background: 'var(--select-bg)', color: 'var(--text-1)',
                  border: '1px solid var(--border)', borderRadius: 8,
                  padding: '10px 12px', fontSize: 14, outline: 'none', fontFamily: 'inherit',
                }}
              />
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn-accent" onClick={handleCreate} style={{
                  flex: 1, padding: '8px 0', background: 'var(--accent)', color: '#fff',
                  borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 600,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}>
                  Create
                </button>
                <button className="btn" onClick={() => setCreating(false)} style={{
                  padding: '8px 14px', background: 'var(--bg-3)', color: 'var(--text-2)',
                  border: '1px solid var(--border)', borderRadius: 8, fontSize: 13,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        <div style={{ margin: '0 16px', borderTop: '1px solid var(--border-subtle)' }} />

        {/* Nav Links */}
        <div style={{ flex: 1, padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {navItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              className="nav-item"
              onClick={() => setMobileOpen(false)}
              style={({ isActive }: { isActive: boolean }) => ({
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 14px', borderRadius: 10,
                fontSize: 14, fontWeight: 500, textDecoration: 'none',
                transition: 'all 0.15s',
                background: isActive ? 'var(--accent-dim)' : 'transparent',
                color: isActive ? 'var(--accent)' : 'var(--text-3)',
              })}
            >
              {({ isActive }: { isActive: boolean }) => (
                <>
                  <item.icon size={18} style={{ color: isActive ? 'var(--accent)' : 'var(--text-4)', flexShrink: 0, transition: 'color 0.15s' }} />
                  <span>{item.label}</span>
                  {isActive && <div style={{ marginLeft: 'auto', width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', boxShadow: '0 0 8px var(--accent-glow)' }} />}
                </>
              )}
            </NavLink>
          ))}
        </div>

        {/* Footer */}
        <div style={{ padding: '0 12px 20px' }}>
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {(() => {
              const isLow = credits != null && credits < 10;
              const isEmpty = credits != null && credits <= 0;
              const accentColor = isEmpty ? 'var(--danger)' : isLow ? '#f59e0b' : 'var(--accent)';
              return (
                <>
                  <div style={{
                    background: isEmpty ? 'rgba(239,68,68,0.08)' : isLow ? 'rgba(245,158,11,0.08)' : 'var(--bg-3)',
                    border: `1px solid ${isEmpty ? 'rgba(239,68,68,0.25)' : isLow ? 'rgba(245,158,11,0.25)' : 'var(--border)'}`,
                    borderRadius: 10, padding: '14px 16px',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Coins size={15} style={{ color: accentColor }} />
                        <span style={{ color: 'var(--text-2)', fontSize: 13, fontWeight: 500 }}>Credits</span>
                      </div>
                      <span style={{ color: accentColor, fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                        {credits != null ? credits.toLocaleString() : '—'}
                      </span>
                    </div>
                    {isEmpty && (
                      <div style={{ marginTop: 8, fontSize: 12, color: 'var(--danger)', lineHeight: 1.4, fontWeight: 500 }}>
                        Out of credits — top up to continue.
                      </div>
                    )}
                    {isLow && !isEmpty && (
                      <div style={{ marginTop: 8, fontSize: 12, color: '#f59e0b', lineHeight: 1.4, fontWeight: 500 }}>
                        Running low — top up soon.
                      </div>
                    )}
                    {projection && credits != null && credits > 0 && projection.daysRemaining != null && projection.daysRemaining <= 14 && (
                      <div style={{
                        marginTop: 6, fontSize: 11, lineHeight: 1.4,
                        color: projection.daysRemaining <= 1 ? 'var(--danger)'
                          : projection.daysRemaining <= 3 ? '#f59e0b'
                          : 'var(--text-4)',
                      }}>
                        {projection.daysRemaining <= 1 ? 'Less than a day of usage left'
                          : projection.daysRemaining <= 3 ? `About ${projection.daysRemaining} days left at current pace`
                          : `~${projection.daysRemaining} days at current pace`}
                      </div>
                    )}
                  </div>

                  <a
                    href="https://claw-net.org/dashboard" target="_blank" rel="noreferrer"
                    className="sidebar-btn"
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      background: isEmpty || isLow ? 'var(--accent)' : 'var(--bg-3)',
                      border: `1px solid ${isEmpty || isLow ? 'var(--accent)' : 'var(--border)'}`,
                      borderRadius: 10, padding: '9px 0', fontSize: 12, fontWeight: 500,
                      color: isEmpty || isLow ? '#fff' : 'var(--text-2)',
                      textDecoration: 'none', transition: 'all 0.15s',
                    }}
                  >
                    {isEmpty || isLow ? 'Top Up Credits' : 'ClawNet Dashboard'} <ExternalLink size={11} />
                  </a>
                </>
              );
            })()}

            <div style={{ display: 'flex', gap: 6 }}>
              <div style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--bg-3)',
                minWidth: 0,
              }}>
                <div style={{
                  width: 24,
                  height: 24,
                  borderRadius: 999,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'var(--accent-dim)',
                  color: 'var(--accent)',
                  fontSize: 11,
                  fontWeight: 700,
                  flexShrink: 0,
                }}>
                  P
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ color: 'var(--text-2)', fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {email || 'Pulse Workspace'}
                  </div>
                  <div style={{ color: 'var(--text-4)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {authProvider === 'demo' ? 'Built-in access mode' : 'Workspace session'}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setFbOpen(true)}
                className="sidebar-btn"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  fontSize: 12, fontWeight: 500, color: 'var(--text-2)', background: 'var(--bg-3)',
                  border: '1px solid var(--border)', borderRadius: 8,
                  cursor: 'pointer', padding: '8px 10px', fontFamily: 'inherit', transition: 'all 0.15s',
                }}
              >
                <MessageCircle size={12} />
              </button>
              <button
                onClick={handleLogout}
                className="sidebar-btn-danger"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  fontSize: 12, fontWeight: 500, color: 'var(--text-2)', background: 'var(--bg-3)',
                  border: '1px solid var(--border)', borderRadius: 8,
                  textDecoration: 'none', padding: '8px 10px', transition: 'all 0.15s',
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                <LogOut size={12} />
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Feedback Modal */}
      {fbOpen && (
        <div
          onClick={e => { if (e.target === e.currentTarget) { setFbOpen(false); setFbSent(false) } }}
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div style={{
            background: 'var(--bg-2)', border: '1px solid var(--border)',
            borderRadius: 16, padding: '24px 28px', maxWidth: 440, width: '92%',
            boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
          }}>
            {fbSent ? (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <Check size={28} style={{ color: 'var(--accent)', margin: '0 auto 12px' }} />
                <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-1)', margin: 0 }}>Thanks for the feedback!</p>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-1)', margin: 0 }}>Send Feedback</h3>
                  <button className="btn-icon" onClick={() => setFbOpen(false)} style={{
                    width: 28, height: 28, borderRadius: 8, border: 'none', background: 'var(--bg-3)',
                    color: 'var(--text-3)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <X size={14} />
                  </button>
                </div>
                <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                  {(['suggestion', 'bug'] as const).map(t => (
                    <button key={t} className="btn-tab" data-active={fbType === t ? "true" : "false"} onClick={() => setFbType(t)} style={{
                      padding: '5px 14px', borderRadius: 16, fontSize: 12, fontWeight: 500, fontFamily: 'inherit', cursor: 'pointer',
                      border: fbType === t ? 'none' : '1px solid var(--border)',
                      background: fbType === t ? 'var(--accent)' : 'transparent',
                      color: fbType === t ? '#fff' : 'var(--text-2)',
                    }}>
                      {t === 'suggestion' ? 'Suggestion' : 'Bug Report'}
                    </button>
                  ))}
                </div>
                <textarea
                  value={fbMsg}
                  onChange={e => setFbMsg(e.target.value)}
                  placeholder={fbType === 'bug' ? "What went wrong?" : "What would make Pulse better?"}
                  rows={4}
                  maxLength={2000}
                  style={{
                    width: '100%', background: 'var(--input-bg)', border: '1px solid var(--input-border)',
                    borderRadius: 8, padding: '10px 14px', color: 'var(--text-1)',
                    fontSize: 14, fontFamily: 'inherit', outline: 'none', resize: 'vertical', lineHeight: 1.6,
                  }}
                  autoFocus
                />
                {fbError && (
                  <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 8, fontSize: 12, color: '#f59e0b', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}>
                    {fbError}
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-4)' }}>{fbMsg.length}/2000</span>
                  <button className="btn-accent" onClick={submitFeedback} disabled={fbSending || !fbMsg.trim()} style={{
                    padding: '8px 20px', background: 'var(--accent)', color: '#fff',
                    border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600,
                    cursor: fbSending || !fbMsg.trim() ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                    display: 'flex', alignItems: 'center', gap: 6,
                    opacity: fbSending || !fbMsg.trim() ? 0.5 : 1,
                  }}>
                    {fbSending ? 'Sending...' : <><Send size={13} /> Send</>}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="pulse-main" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', background: 'var(--main-bg)' }}>
        <div key={location.pathname} style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', animation: 'fadeIn 0.2s ease-out' }}>
          {children}
        </div>
      </main>

      <style>{`
        .nav-item:hover { color: var(--text-2) !important; background: var(--accent-dim) !important; }
        .nav-item:hover svg { color: var(--text-3) !important; }
        @media (max-width: 768px) {
          .pulse-sidebar {
            position: fixed !important;
            left: -280px !important;
            top: 0 !important;
            bottom: 0 !important;
            z-index: 1000 !important;
            transition: left 0.2s ease !important;
            width: 270px !important;
          }
          .pulse-sidebar.open {
            left: 0 !important;
          }
          .pulse-mobile-header {
            display: flex !important;
          }
          .pulse-main {
            margin-left: 0 !important;
            padding-top: 56px !important;
          }
          .pulse-backdrop {
            display: block !important;
          }
        }
      `}</style>
    </div>
  )
}
