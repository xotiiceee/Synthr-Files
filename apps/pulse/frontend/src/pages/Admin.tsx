import { useEffect, useMemo, useState } from 'react'
import { ShieldCheck, Wallet, RefreshCw, UserRound, Store, BadgeDollarSign, Tag, Plus } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { get, post } from '../lib/api'

const cardStyle: React.CSSProperties = {
  background: 'var(--card-bg)',
  border: '1px solid var(--card-border)',
  borderRadius: 12,
  padding: 20,
}

function money(value: number | null) {
  if (value == null) return '$0.00'
  return `$${value.toFixed(2)}`
}

interface DiscountCode {
  id: string
  code: string
  credits: number
  maxUses: number
  currentUses: number
  createdBy: string
  createdAt: string
  expiresAt: string | null
  active: boolean
}

export default function Admin() {
  const {
    email,
    userId,
    isAdmin,
    adminEmail,
    credits,
    balanceUsd,
    selectedBrandName,
    refreshCredits,
  } = useAuth()

  const [codes, setCodes] = useState<DiscountCode[]>([])
  const [newCode, setNewCode] = useState('')
  const [newCredits, setNewCredits] = useState(2500)
  const [newMaxUses, setNewMaxUses] = useState(100)
  const [creating, setCreating] = useState(false)
  const [addAmount, setAddAmount] = useState(2500)
  const [adding, setAdding] = useState(false)

  const loadCodes = async () => {
    try {
      const res = await get<{ok: boolean; codes: DiscountCode[]}>('/api/admin/discount-codes')
      setCodes(res.codes)
    } catch {}
  }

  useEffect(() => { void loadCodes() }, [])

  const createCode = async () => {
    if (!newCode.trim()) return
    setCreating(true)
    try {
      await post('/api/admin/discount-codes', { code: newCode.trim(), credits: newCredits, max_uses: newMaxUses })
      setNewCode('')
      await loadCodes()
    } catch {}
    setCreating(false)
  }

  const addCredits = async () => {
    setAdding(true)
    try {
      await post('/api/admin/credits', { credits: addAmount })
      await refreshCredits()
    } catch {}
    setAdding(false)
  }

  const summary = useMemo(() => ([
    { label: 'Admin email', value: adminEmail || email || 'Unassigned', icon: UserRound },
    { label: 'Signed in as', value: email || 'Unknown', icon: ShieldCheck },
    { label: 'Active brand', value: selectedBrandName || 'Main brand', icon: Store },
    { label: 'Effective balance', value: `${money(balanceUsd)}`, icon: Wallet },
  ]), [adminEmail, balanceUsd, credits, email, selectedBrandName])

  if (!isAdmin) return null

  return (
    <div style={{ maxWidth: 980, margin: '0 auto', padding: '0 16px 60px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <div style={{
          width: 42, height: 42, borderRadius: 12,
          background: 'var(--accent-dim)', border: '1px solid var(--accent-glow)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <ShieldCheck size={20} style={{ color: 'var(--accent)' }} />
        </div>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, color: 'var(--text-1)', fontSize: 22, fontWeight: 700 }}>Admin Dashboard</h1>
          <p style={{ margin: '4px 0 0', color: 'var(--text-3)', fontSize: 14 }}>
            Hidden testing controls for the admin account on this browser.
          </p>
        </div>
        <button onClick={() => { void refreshCredits(); void loadCodes() }} style={{
          display: 'inline-flex', alignItems: 'center', gap: 8, borderRadius: 10,
          border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text-2)',
          padding: '10px 14px', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
        }}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 20 }}>
        {summary.map((item) => (
          <div key={item.label} style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <item.icon size={15} style={{ color: 'var(--accent)' }} />
              <span style={{ color: 'var(--text-3)', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {item.label}
              </span>
            </div>
            <div style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 650, lineHeight: 1.4, wordBreak: 'break-word' }}>
              {item.value}
            </div>
          </div>
        ))}
      </div>

      <div style={{ ...cardStyle, marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <BadgeDollarSign size={16} style={{ color: 'var(--accent)' }} />
          <h2 style={{ margin: 0, color: 'var(--text-1)', fontSize: 16, fontWeight: 700 }}>Add Credits</h2>
        </div>
        <p style={{ margin: '0 0 16px', color: 'var(--text-3)', fontSize: 14, lineHeight: 1.6 }}>
          Add credits directly to your admin account (bypasses payment). Works with the backend billing ledger.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
          {[1000, 2500, 10000, 50000].map(n => (
            <button key={n} onClick={() => { setAddAmount(n); void addCredits() }} disabled={adding} style={{
              borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-2)',
              color: 'var(--text-2)', padding: '10px 14px', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
            }}>
              ${(n / 100).toFixed(0)}
            </button>
          ))}
        </div>
      </div>

      <div style={{ ...cardStyle, marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <Tag size={16} style={{ color: 'var(--accent)' }} />
          <h2 style={{ margin: 0, color: 'var(--text-1)', fontSize: 16, fontWeight: 700 }}>Discount Codes</h2>
        </div>
        <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          <input value={newCode} onChange={e => setNewCode(e.target.value)} placeholder="e.g. LAUNCH25"
            style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-1)', color: 'var(--text-1)', fontFamily: 'inherit', fontSize: 13, flex: '1 1 180px' }} />
          <select value={newCredits} onChange={e => setNewCredits(Number(e.target.value))}
            style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-1)', color: 'var(--text-1)', fontFamily: 'inherit', fontSize: 13 }}>
            <option value={1000}>$10 (1000 cr)</option>
            <option value={2500}>$25 (2500 cr)</option>
            <option value={5000}>$50 (5000 cr)</option>
            <option value={10000}>$100 (10000 cr)</option>
            <option value={50000}>$500 (50000 cr)</option>
          </select>
          <input type="number" value={newMaxUses} onChange={e => setNewMaxUses(Number(e.target.value))}
            placeholder="Max uses" style={{
              padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)',
              background: 'var(--bg-1)', color: 'var(--text-1)', fontFamily: 'inherit', fontSize: 13, width: 90,
            }} />
          <button onClick={createCode} disabled={creating || !newCode.trim()} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 8,
            border: '1px solid var(--accent)', background: 'var(--accent-dim)', color: 'var(--accent)',
            padding: '10px 16px', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, fontSize: 13,
            whiteSpace: 'nowrap',
          }}><Plus size={14} /> Create</button>
        </div>
        {codes.length ? (
          <div style={{ maxHeight: 300, overflowY: 'auto' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 1fr) 90px 90px 80px 120px 80px', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-4)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              <div>Code</div><div>Credits</div><div>Uses</div><div>Status</div><div>Created</div><div style={{ textAlign: 'right' }}>Max</div>
            </div>
            {codes.map(c => (
              <div key={c.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 1fr) 90px 90px 80px 120px 80px', gap: 10, alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                <div style={{ color: 'var(--text-1)', fontSize: 13, fontWeight: 700, fontFamily: 'monospace' }}>{c.code}</div>
                <div style={{ color: 'var(--text-2)', fontSize: 13, fontWeight: 650 }}>${(c.credits / 100).toFixed(0)}</div>
                <div style={{ color: 'var(--text-3)', fontSize: 13 }}>{c.currentUses}/{c.maxUses}</div>
                <div>
                  <span style={{ padding: '3px 8px', borderRadius: 999, background: c.active ? 'var(--accent-dim)' : 'var(--bg-3)', color: c.active ? 'var(--accent)' : 'var(--text-4)', fontSize: 11, fontWeight: 700 }}>
                    {c.active ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <div style={{ color: 'var(--text-4)', fontSize: 12 }}>{new Date(c.createdAt).toLocaleDateString()}</div>
                <div style={{ color: 'var(--text-4)', fontSize: 12, textAlign: 'right' }}>{c.maxUses}</div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>No discount codes yet. Create one above.</div>
        )}
      </div>

      <div style={cardStyle}>
        <h2 style={{ margin: '0 0 10px', color: 'var(--text-1)', fontSize: 16, fontWeight: 700 }}>Customer Testing Notes</h2>
        <p style={{ margin: 0, color: 'var(--text-3)', fontSize: 14, lineHeight: 1.7 }}>
          This browser binds the first signed-in Clerk email as the admin testing account. Other emails stay out of the admin route, which gives you a cleaner way to test onboarding, non-premium flows, and customer-facing copy without the extra testing controls showing up.
        </p>
        <p style={{ margin: '12px 0 0', color: 'var(--text-4)', fontSize: 12 }}>
          Current user id: {userId || 'unknown'}
        </p>
      </div>
    </div>
  )
}
