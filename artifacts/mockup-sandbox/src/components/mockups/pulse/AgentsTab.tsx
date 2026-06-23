import React, { useState } from 'react'

export default function PulseAgentsTabMock() {
  const [agents, setAgents] = useState([
    { id: 'a1', name: 'Acme Labs', niche: 'devtools', active: true },
    { id: 'a2', name: 'Sweet Treats Bakery', niche: 'consumer', active: false },
  ])
  const [newName, setNewName] = useState('')

  const add = () => {
    if (!newName) return
    setAgents(prev => [...prev, { id: 'new' + Date.now(), name: newName, niche: 'custom', active: false }])
    setNewName('')
  }

  return (
    <div style={{ padding: 24, background: '#0a0a0b', color: '#fff', fontFamily: 'Inter, system-ui', minHeight: '100%' }}>
      <h2 style={{ fontSize: 20, marginBottom: 4 }}>Settings → Agents</h2>
      <p style={{ color: '#888', marginBottom: 16 }}>This is the multi-agent tab / preset system from the complete modern Pulse (from pulse.zip).</p>

      <div style={{ maxWidth: 620 }}>
        {agents.map((a, i) => (
          <div key={i} style={{ background: '#111', padding: '14px 18px', borderRadius: 10, marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontWeight: 600 }}>{a.name}</div>
              <div style={{ fontSize: 13, color: '#666' }}>niche: {a.niche} • brand DNA + voice + competitors</div>
            </div>
            <div style={{ color: a.active ? '#22c55e' : '#666' }}>{a.active ? 'ACTIVE' : 'preset'}</div>
          </div>
        ))}

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="New brand / agent preset name" style={{ flex: 1, background: '#1a1a1c', color: '#fff', padding: 10, borderRadius: 8, border: '1px solid #333' }} />
          <button onClick={add} style={{ padding: '0 20px', background: '#3b82f6', color: '#fff', borderRadius: 8, border: 'none' }}>Create Agent</button>
        </div>
        <div style={{ fontSize: 12, color: '#555', marginTop: 20 }}>
          Each agent runs its own crew (Strategist, Content, Analyst, Community). Switch in sidebar. This is the modern complete setup.
        </div>
      </div>
    </div>
  )
}
