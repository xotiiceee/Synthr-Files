import { useEffect, useState, useCallback } from 'react'
import { Navigate } from 'react-router-dom'
import { Shield, Coins, UserCircle2, Loader2, Check, AlertTriangle, RefreshCw } from 'lucide-react'
import { get, post } from '../lib/api'
import { useAuth } from '../hooks/useAuth'

interface AdminOverride {
  test_credits?: number | null
  customer_mode?: boolean
}

interface AdminState {
  ok: boolean
  email?: string
  override?: AdminOverride
  adminEmails?: string[]
}

const cardStyle: React.CSSProperties = {
  background: 'var(--card-bg)',
  border: '1px solid var(--card-border)',
  borderRadius: 12,
  padding: 20,
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

export default function Admin() {
  const { isAdmin, email, authProvider, adminOverride, refreshAdminOverride, refreshCredits } = useAuth()
  const [state, setState] = useState<AdminState | null>(null)
  const [loading, setLoading] = useState(true)
  const [creditsInput, setCreditsInput] = useState<string>('')
  const [savingCredits, setSavingCredits] = useState(false)
  const [togglingCustomer, setTogglingCustomer] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const fetchState = useCallback(async () => {
    setLoading(true)
    try {
      const data = await get<AdminState>('/api/admin/state')
      setState(data)
      setCreditsInput(
        data.override?.test_credits != null
          ? String(data.override.test_credits)
          : '',
      )
    } catch (e) {
      const err = e as { message?: string }
      setMsg({ kind: 'err', text: err?.message || 'Failed to load admin state' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isAdmin) void fetchState()
  }, [isAdmin, fetchState])

  if (!isAdmin) {
    // Non-admins (including demo + non-allowlisted Clerk emails) get redirected.
    return <Navigate to="/chat-setup" replace />
  }

  const customerMode = Boolean(adminOverride?.customer_mode)

  const applyTestCredits = async () => {
    setSavingCredits(true)
    setMsg(null)
    try {
      const trimmed = creditsInput.trim()
      const credits =
        trimmed === '' ? null : Math.max(0, Math.floor(Number(trimmed)))
      if (trimmed !== '' && Number.isNaN(credits)) {
        throw new Error('Credits must be a non-negative integer')
      }
      await post('/api/admin/test-credits', { credits })
      await Promise.all([fetchState(), refreshAdminOverride(), refreshCredits()])
      setMsg({ kind: 'ok', text: 'Test credits updated' })
    } catch (e) {
      const err = e as { message?: string }
      setMsg({ kind: 'err', text: err?.message || 'Failed to update test credits' })
    } finally {
      setSavingCredits(false)
    }
  }

  const clearTestCredits = async () => {
    setSavingCredits(true)
    setMsg(null)
    try {
      await post('/api/admin/test-credits', { credits: null })
      setCreditsInput('')
      await Promise.all([fetchState(), refreshAdminOverride(), refreshCredits()])
      setMsg({ kind: 'ok', text: 'Test credits cleared — using default' })
    } catch (e) {
      const err = e as { message?: string }
      setMsg({ kind: 'err', text: err?.message || 'Failed to clear test credits' })
    } finally {
      setSavingCredits(false)
    }
  }

  const toggleCustomerMode = async () => {
    setTogglingCustomer(true)
    setMsg(null)
    try {
      await post('/api/admin/customer-mode', { enabled: !customerMode })
      await Promise.all([fetchState(), refreshAdminOverride(), refreshCredits()])
      setMsg({
        kind: 'ok',
        text: customerMode
          ? 'Test overrides re-enabled — admin test mode'
          : 'Customer mode on — acting like a normal customer',
      })
    } catch (e) {
      const err = e as { message?: string }
      setMsg({ kind: 'err', text: err?.message || 'Failed to toggle customer mode' })
    } finally {
      setTogglingCustomer(false)
    }
  }

  return (
    <div style={{ maxWidth: 880, margin: '0 auto', padding: '0 24px', minHeight: '100%', boxSizing: 'border-box', wordBreak: 'break-word' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14, padding: '24px 0 20px',
        borderBottom: '1px solid var(--border-subtle)',
      }}>
        <div style={{
          width: 42, height: 42, borderRadius: 12,
          background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.25)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Shield size={20} style={{ color: '#8b5cf6' }} />
        </div>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--text-1)', margin: 0 }}>Admin Dashboard</h1>
          <p style={{ fontSize: 13, color: 'var(--text-3)', margin: 0 }}>
            Test controls for allowlisted admin emails
          </p>
        </div>
        <button
          onClick={() => void fetchState()}
          style={{ ...btnStyle, display: 'inline-flex', alignItems: 'center', gap: 6 }}
          title="Refresh"
        >
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {/* Identity card */}
      <div style={{ ...cardStyle, marginTop: 24, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <UserCircle2 size={16} style={{ color: 'var(--text-3)' }} />
          <span style={{ fontSize: 13, color: 'var(--text-3)', fontWeight: 500 }}>Signed-in admin</span>
        </div>
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-1)' }}>
          {email || '—'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-4)' }}>
          auth: {authProvider}
        </div>
        {state?.adminEmails && state.adminEmails.length > 0 && (
          <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-4)' }}>
            Allowlist: {state.adminEmails.join(', ')}
          </div>
        )}
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)' }}>
          <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
        </div>
      ) : (
        <>
          {/* Customer-mode toggle */}
          <div style={{ ...cardStyle, marginTop: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)' }}>
                  Customer mode
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-4)', marginTop: 4, maxWidth: 480 }}>
                  When ON, your admin login behaves like a normal customer — no
                  fake credits, real onboarding/non-premium flows. When OFF,
                  admin test overrides apply.
                </div>
              </div>
              <button
                onClick={() => void toggleCustomerMode()}
                disabled={togglingCustomer}
                style={{
                  ...accentBtnStyle,
                  opacity: togglingCustomer ? 0.6 : 1,
                  cursor: togglingCustomer ? 'not-allowed' : 'pointer',
                  background: customerMode ? 'var(--bg-3)' : 'var(--accent)',
                  color: customerMode ? 'var(--text-2)' : '#fff',
                  border: customerMode ? '1px solid var(--border)' : '1px solid var(--accent)',
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                }}
              >
                {togglingCustomer && <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />}
                {customerMode ? 'Customer mode ON' : 'Admin test mode'}
              </button>
            </div>
          </div>

          {/* Test credits control */}
          <div style={{ ...cardStyle, marginTop: 16, opacity: customerMode ? 0.5 : 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <Coins size={16} style={{ color: 'var(--accent)' }} />
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)' }}>
                Test credits override
              </span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-4)', marginBottom: 12 }}>
              Force <code>/api/credits</code> to report a specific number so you
              can test empty/low/healthy credit states. Other emails see the
              default customer flow.
            </div>
            <label style={labelStyle} htmlFor="admin-credits">Credits</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                id="admin-credits"
                type="number"
                min={0}
                value={creditsInput}
                onChange={(e) => setCreditsInput(e.target.value)}
                placeholder="e.g. 0, 5, 1240"
                disabled={customerMode || savingCredits}
                style={inputStyle}
              />
              <button
                onClick={() => void applyTestCredits()}
                disabled={customerMode || savingCredits}
                style={{
                  ...accentBtnStyle,
                  opacity: customerMode || savingCredits ? 0.6 : 1,
                  cursor: customerMode || savingCredits ? 'not-allowed' : 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  whiteSpace: 'nowrap',
                }}
              >
                {savingCredits && <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />}
                Apply
              </button>
              <button
                onClick={() => void clearTestCredits()}
                disabled={customerMode || savingCredits}
                style={{
                  ...btnStyle,
                  opacity: customerMode || savingCredits ? 0.6 : 1,
                  cursor: customerMode || savingCredits ? 'not-allowed' : 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                Clear
              </button>
            </div>
            {adminOverride?.test_credits != null && !customerMode && (
              <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-3)' }}>
                Active override: <strong>{adminOverride.test_credits}</strong> credits
              </div>
            )}
          </div>

          {msg && (
            <div style={{
              marginTop: 16, padding: '10px 14px', borderRadius: 8, fontSize: 13,
              color: msg.kind === 'ok' ? 'var(--accent)' : 'var(--danger)',
              background: msg.kind === 'ok' ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
              border: `1px solid ${msg.kind === 'ok' ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}`,
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              {msg.kind === 'ok' ? <Check size={14} /> : <AlertTriangle size={14} />}
              {msg.text}
            </div>
          )}
        </>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
