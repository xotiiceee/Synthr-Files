import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Settings as SettingsIcon,
  Plus,
  Trash2,
  Check,
  Loader2,
  Zap,
  Play,
  Pause,
  ChevronDown,
  ChevronUp,
  LinkIcon,
  Download,
  Upload,
} from 'lucide-react'
import { get, post } from '../lib/api'
import Modal from '../components/Modal'
import GitHubSettings from './GitHubSettings'
import ProductionReadinessPanel from '../components/ProductionReadinessPanel'
import { useAuth } from '../hooks/useAuth'

type Tab = 'brand' | 'account' | 'integrations'

interface Agent {
  id: string
  name: string
  brandName: string
  niche: string
  tone: string
  running: boolean
}

function getImportKind(data: any): 'profile' | 'brand-memory' | null {
  if (data?.$schema === 'pulse-agent-profile') return 'profile'
  if (
    data?.$schema === 'pulse-privacy-export' &&
    Array.isArray(data.brandProfiles) &&
    Array.isArray(data.brandKnowledgeNotes)
  ) {
    return 'brand-memory'
  }
  return null
}

const cardStyle: React.CSSProperties = {
  background: 'var(--card-bg)',
  border: '1px solid var(--card-border)',
  borderRadius: 12,
  padding: 24,
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
}

const accentBtnStyle: React.CSSProperties = {
  ...btnStyle,
  background: 'var(--accent)',
  border: '1px solid var(--accent)',
  color: '#fff',
}

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      className="btn-ghost"
      onClick={() => !disabled && onChange(!checked)}
      style={{
        width: 44,
        height: 24,
        borderRadius: 12,
        border: 'none',
        background: checked ? 'var(--accent)' : 'var(--bg-3)',
        position: 'relative',
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'background 0.2s',
        opacity: disabled ? 0.5 : 1,
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 3,
          left: checked ? 23 : 3,
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: 'var(--text-1)',
          transition: 'left 0.2s',
        }}
      />
    </button>
  )
}

export default function Settings() {
  const { authProvider, credits, spendToday, spendMonth, projection } =
    useAuth()
  const [tab, setTab] = useState<Tab>(() => {
    const t = new URLSearchParams(window.location.search).get('tab')
    return t === 'brand' || t === 'account' || t === 'integrations'
      ? t
      : 'brand'
  })
  const [_config, setConfig] = useState<any>(null)
  const [agents, setAgents] = useState<Agent[]>([])
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>(
    'idle',
  )
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loadedRef = useRef(false)

  // Account state
  const [aiProvider, setAiProvider] = useState('groq')
  const [searchProvider, setSearchProvider] = useState('serper')
  const [_providers, setProviders] = useState<{
    llm: Record<string, boolean>
    search: Record<string, boolean>
  }>({ llm: {}, search: {} })
  const [mentionsEnabled, setMentionsEnabled] = useState(true)
  const [contentRules, setContentRules] = useState<
    Array<{ id: string; text: string; enabled: boolean }>
  >([])
  const [rulesLoaded, setRulesLoaded] = useState(false)
  const [rulesSaving, setRulesSaving] = useState(false)
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null)
  const [editingRuleText, setEditingRuleText] = useState('')
  const [newRuleText, setNewRuleText] = useState('')

  const saveRules = (rules: typeof contentRules) => {
    setRulesSaving(true)
    post('/api/content-rules', { rules })
      .then(() => setRulesSaving(false))
      .catch(() => setRulesSaving(false))
  }

  // Content model state
  const [contentModel, setContentModel] = useState('llama-3.3-70b')

  // X API keys state (legacy — now per-brand in Brand tab)
  const [_xKeysConfigured, setXKeysConfigured] = useState(false)

  // Brand state
  const [showNewAgent, setShowNewAgent] = useState(false)
  const [newAgentName, setNewAgentName] = useState('')
  const [newAgentNiche, setNewAgentNiche] = useState('')
  const [newAgentTone, setNewAgentTone] = useState('professional')
  const [newAgentWebsite, setNewAgentWebsite] = useState('')
  const [newAgentXHandle, setNewAgentXHandle] = useState('')

  // Brand control panel state
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null)
  const [agentXKeys, setAgentXKeys] = useState<
    Record<
      string,
      {
        apiKey: string
        apiSecret: string
        accessToken: string
        accessTokenSecret: string
      }
    >
  >({})
  const [xConnected, setXConnected] = useState<Record<string, boolean>>({})

  // Profile export/import state
  const [exporting, setExporting] = useState(false)
  const [importData, setImportData] = useState<any>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const exportProfile = async () => {
    setExporting(true)
    try {
      const profile = await get('/api/profile/export')
      const blob = new Blob([JSON.stringify(profile, null, 2)], {
        type: 'application/json',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `pulse-profile-${((profile as any).agent?.brandName || 'agent').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pulse.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {}
    setExporting(false)
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string)
        if (!getImportKind(data)) {
          setImportError(
            'Not a valid Pulse profile or brand memory export file.',
          )
          setImportData(null)
        } else {
          setImportData(data)
          setImportError(null)
        }
      } catch {
        setImportError(
          "Could not read file. Make sure it's a .pulse.json file.",
        )
        setImportData(null)
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const confirmImport = async () => {
    if (!importData) return
    setImporting(true)
    try {
      await post('/api/profile/import', { profile: importData })
      setImportData(null)
      // Reload the page to pick up new config
      window.location.reload()
    } catch {
      setImportError('Import failed. Try again.')
    }
    setImporting(false)
  }

  // Snapshot refs for auto-save diffing (declared before load effect)
  const prevAccountRef = useRef('')

  useEffect(() => {
    get('/api/providers')
      .then((p) => setProviders(p))
      .catch(() => {})
    get('/api/content-rules')
      .then((d: any) => {
        if (d.rules) {
          setContentRules(d.rules)
          setRulesLoaded(true)
        }
      })
      .catch(() => {})
    get('/api/keys/x/status')
      .then((d) => setXKeysConfigured(d.configured))
      .catch(() => {})
    Promise.all([
      get('/api/config').catch(() => null),
      get('/api/brands').catch(() => []),
    ]).then(([cfg, ags]) => {
      const acct = cfg?.account || {}
      if (cfg) {
        setConfig(cfg)
        setAiProvider(acct.aiProvider || 'groq')
        setSearchProvider(acct.searchProvider || 'serper')
        setMentionsEnabled(acct.mentionsEnabled ?? true)
        if (acct.contentModel) setContentModel(acct.contentModel)
      }
      const agentList = Array.isArray(ags) ? ags : ags?.agents || []
      setAgents(agentList.map((a: any) => ({ ...a, running: !!a.running })))
      // Check X connection status for each agent
      for (const a of agentList) {
        get(`/api/keys/x/status?agentId=${a.id}`)
          .then((d: any) => {
            setXConnected((prev) => ({ ...prev, [a.id]: d.configured }))
          })
          .catch(() => {})
      }
      // Seed snapshot refs BEFORE setting loadedRef — prevents auto-save on first render
      prevAccountRef.current = JSON.stringify({
        aiProvider: acct.aiProvider || 'groq',
        searchProvider: acct.searchProvider || 'serper',
        mentionsEnabled: acct.mentionsEnabled ?? true,
        contentModel: acct.contentModel || 'llama-3.3-70b',
      })
      loadedRef.current = true
      // Delay enabling auto-save to let React settle after state hydration
      setTimeout(() => {
        readyToSaveRef.current = true
      }, 500)
    })
  }, [])

  const readyToSaveRef = useRef(false)

  const autoSave = useCallback((data: any) => {
    if (!readyToSaveRef.current) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setSaveStatus('saving')
    debounceRef.current = setTimeout(async () => {
      try {
        await post('/api/config', data)
        setSaveStatus('saved')
        setTimeout(() => setSaveStatus('idle'), 2000)
      } catch {
        setSaveStatus('idle')
      }
    }, 1500)
  }, [])

  const saveAccount = useCallback(() => {
    autoSave({
      account: { aiProvider, searchProvider, mentionsEnabled, contentModel },
    })
  }, [aiProvider, searchProvider, mentionsEnabled, contentModel, autoSave])

  useEffect(() => {
    if (!loadedRef.current) return
    const snap = JSON.stringify({
      aiProvider,
      searchProvider,
      mentionsEnabled,
      contentModel,
    })
    if (snap === prevAccountRef.current) return
    prevAccountRef.current = snap
    saveAccount()
  }, [saveAccount])

  const toggleRunning = async (id: string, running: boolean) => {
    try {
      await post('/api/brands/toggle-running', { id, running })
      setAgents((prev) =>
        prev.map((a) => (a.id === id ? { ...a, running } : a)),
      )
    } catch {}
  }

  const [deleteModal, setDeleteModal] = useState<{
    open: boolean
    agentId: string
    agentName: string
  }>({ open: false, agentId: '', agentName: '' })
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const deleteAgent = async (id: string) => {
    if (deleting) return
    setDeleting(true)
    try {
      await post('/api/brands', { action: 'delete', id })
      setAgents((prev) => prev.filter((a) => a.id !== id))
    } catch {
      setDeleteError('Failed to delete brand. Please try again.')
      setTimeout(() => setDeleteError(null), 3000)
    }
    setDeleting(false)
    setDeleteModal({ open: false, agentId: '', agentName: '' })
  }

  const createAgent = async () => {
    if (!newAgentName.trim()) return
    try {
      const result = await post('/api/brands', {
        name: newAgentName,
        brandName: newAgentName.trim(),
        niche: newAgentNiche,
        tone: newAgentTone,
        website: newAgentWebsite,
        xHandle: newAgentXHandle,
      })
      if (result && (result.id || result.agent?.id)) {
        const agentId = result.id || result.agent?.id
        document.cookie = `pulse_agent=${encodeURIComponent(agentId)};path=/;max-age=${30 * 86400}`
        // Redirect to Autopilot — the brand's home page. Research runs in background.
        window.location.href = `/autopilot?new=${encodeURIComponent(agentId)}`
        return
      }
    } catch {}
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'brand', label: 'Brand' },
    { key: 'account', label: 'Account' },
    { key: 'integrations', label: 'Integrations' },
  ]

  return (
    <div
      style={{
        maxWidth: 960,
        margin: '0 auto',
        padding: '0 24px',
        overflowX: 'hidden',
        boxSizing: 'border-box',
        wordBreak: 'break-word',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 24,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: 'var(--accent-dim)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <SettingsIcon size={20} style={{ color: 'var(--accent)' }} />
          </div>
          <div>
            <h1
              style={{
                fontSize: 20,
                fontWeight: 600,
                color: 'var(--text-1)',
                margin: 0,
              }}
            >
              Settings
            </h1>
            <p style={{ fontSize: 13, color: 'var(--text-3)', margin: 0 }}>
              Configure your brand
            </p>
          </div>
        </div>
        <div
          style={{
            fontSize: 13,
            color:
              saveStatus === 'saving'
                ? 'var(--text-3)'
                : saveStatus === 'saved'
                  ? 'var(--accent)'
                  : 'transparent',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            transition: 'color 0.2s',
          }}
        >
          {saveStatus === 'saving' && (
            <>
              <Loader2
                size={14}
                style={{ animation: 'spin 1s linear infinite' }}
              />{' '}
              Saving...
            </>
          )}
          {saveStatus === 'saved' && (
            <>
              <Check size={14} /> Saved
            </>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          gap: 0,
          borderBottom: '1px solid var(--border)',
          marginBottom: 24,
        }}
      >
        {tabs.map((t) => (
          <button
            key={t.key}
            className="btn-tab"
            data-active={tab === t.key ? 'true' : 'false'}
            onClick={() => setTab(t.key)}
            style={{
              padding: '10px 20px',
              background: 'none',
              border: 'none',
              borderBottom:
                tab === t.key
                  ? '2px solid var(--accent)'
                  : '2px solid transparent',
              color: tab === t.key ? 'var(--text-1)' : 'var(--text-3)',
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Brand Tab */}
      {tab === 'brand' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Profile Export/Import */}
          <div
            style={{
              background: 'var(--card-bg)',
              border: '1px solid var(--card-border)',
              borderRadius: 12,
              padding: '16px 20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: 'var(--text-1)',
                }}
              >
                Brand Profile
              </div>
              <div
                style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}
              >
                Export to share or import from a .pulse.json file
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn"
                onClick={exportProfile}
                disabled={exporting}
                style={{
                  ...btnStyle,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  opacity: exporting ? 0.5 : 1,
                }}
              >
                {exporting ? (
                  <Loader2
                    size={13}
                    style={{ animation: 'spin 1s linear infinite' }}
                  />
                ) : (
                  <Download size={13} />
                )}
                Export
              </button>
              <button
                className="btn"
                onClick={() => fileInputRef.current?.click()}
                style={{
                  ...btnStyle,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Upload size={13} /> Import
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,.pulse.json"
                style={{ display: 'none' }}
                onChange={handleFileSelect}
              />
            </div>
          </div>

          {/* Import confirmation modal */}
          {importData &&
            (() => {
              const importKind = getImportKind(importData)
              const isBrandMemory = importKind === 'brand-memory'
              return (
                <div
                  onClick={(e) => {
                    if (e.target === e.currentTarget) {
                      setImportData(null)
                      setImportError(null)
                    }
                  }}
                  style={{
                    position: 'fixed',
                    inset: 0,
                    zIndex: 9999,
                    background: 'rgba(0,0,0,0.6)',
                    backdropFilter: 'blur(4px)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <div
                    style={{
                      background: 'var(--bg-2)',
                      border: '1px solid var(--border)',
                      borderRadius: 16,
                      padding: '24px 28px',
                      maxWidth: 480,
                      width: '92%',
                      boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
                    }}
                  >
                    <h3
                      style={{
                        fontSize: 16,
                        fontWeight: 600,
                        color: 'var(--text-1)',
                        margin: '0 0 16px',
                      }}
                    >
                      {isBrandMemory ? 'Import Brand Memory' : 'Import Profile'}
                    </h3>
                    <div
                      style={{
                        background: 'var(--bg-3)',
                        borderRadius: 10,
                        padding: 16,
                        marginBottom: 16,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 15,
                          fontWeight: 600,
                          color: 'var(--text-1)',
                        }}
                      >
                        {isBrandMemory
                          ? 'Hosted brand memory export'
                          : importData.agent?.brandName}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: 'var(--text-3)',
                          marginTop: 4,
                        }}
                      >
                        {isBrandMemory
                          ? `${importData.brandProfiles?.length || 0} profiles · ${importData.brandKnowledgeNotes?.length || 0} knowledge notes`
                          : `${importData.agent?.niche} · ${importData.agent?.tone}`}
                      </div>
                      {(importData.exportedBy || importData.generatedAt) && (
                        <div
                          style={{
                            fontSize: 11,
                            color: 'var(--text-4)',
                            marginTop: 6,
                          }}
                        >
                          Shared by {importData.exportedBy}
                        </div>
                      )}
                      {!isBrandMemory && (
                        <div
                          style={{
                            fontSize: 11,
                            color: 'var(--text-4)',
                            marginTop: 4,
                          }}
                        >
                          {importData.knowledgeNotes?.length || 0} knowledge
                          notes · {importData.contentThemes?.length || 0} themes
                          · {importData.topics?.length || 0} topics
                        </div>
                      )}
                    </div>
                    <p
                      style={{
                        fontSize: 13,
                        color: 'var(--text-3)',
                        lineHeight: 1.5,
                        margin: '0 0 16px',
                      }}
                    >
                      {isBrandMemory
                        ? 'This will restore hosted brand profiles and knowledge notes for matching brands in this workspace.'
                        : "This will update your brand persona, voice, topics, and themes. Knowledge notes will be merged (duplicates skipped)."}
                    </p>
                    {importError && (
                      <div
                        style={{
                          fontSize: 12,
                          color: 'var(--danger)',
                          marginBottom: 12,
                        }}
                      >
                        {importError}
                      </div>
                    )}
                    <div
                      style={{
                        display: 'flex',
                        gap: 10,
                        justifyContent: 'flex-end',
                      }}
                    >
                      <button
                        className="btn"
                        onClick={() => {
                          setImportData(null)
                          setImportError(null)
                        }}
                        style={btnStyle}
                      >
                        Cancel
                      </button>
                      <button
                        className="btn-accent"
                        onClick={confirmImport}
                        disabled={importing}
                        style={{
                          ...accentBtnStyle,
                          opacity: importing ? 0.5 : 1,
                        }}
                      >
                        {importing ? 'Importing...' : 'Import'}
                      </button>
                    </div>
                  </div>
                </div>
              )
            })()}

          {agents.map((agent) => {
            const isRunning = agent.running
            const expanded = expandedAgent === agent.id
            return (
              <div
                key={agent.id}
                style={{
                  ...cardStyle,
                  border: isRunning
                    ? '1px solid var(--accent)'
                    : '1px solid var(--card-border)',
                  padding: 0,
                  overflow: 'hidden',
                }}
              >
                {/* Brand header row */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '16px 20px',
                    cursor: 'pointer',
                  }}
                  onClick={() => setExpandedAgent(expanded ? null : agent.id)}
                >
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: 12 }}
                  >
                    <div
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: 10,
                        background: isRunning
                          ? 'rgba(16,185,129,0.1)'
                          : 'var(--bg-3)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {isRunning ? (
                        <Play size={16} style={{ color: '#10b981' }} />
                      ) : (
                        <Pause size={16} style={{ color: 'var(--text-4)' }} />
                      )}
                    </div>
                    <div>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 15,
                            fontWeight: 600,
                            color: 'var(--text-1)',
                          }}
                        >
                          {agent.name}
                        </span>
                        {isRunning && (
                          <span
                            style={{
                              fontSize: 10,
                              padding: '2px 8px',
                              borderRadius: 10,
                              background: 'rgba(16,185,129,0.1)',
                              color: '#10b981',
                              fontWeight: 600,
                            }}
                          >
                            RUNNING
                          </span>
                        )}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: 'var(--text-4)',
                          marginTop: 2,
                          display: 'flex',
                          gap: 12,
                        }}
                      >
                        {agent.niche && <span>{agent.niche}</span>}
                        {agent.tone && <span>{agent.tone}</span>}
                      </div>
                    </div>
                  </div>
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                  >
                    {/* Play/Pause toggle */}
                    <button
                      className="btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleRunning(agent.id, !isRunning)
                      }}
                      style={{
                        padding: '6px 14px',
                        borderRadius: 8,
                        fontSize: 12,
                        fontWeight: 600,
                        border: 'none',
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                        background: isRunning
                          ? 'rgba(245,158,11,0.1)'
                          : 'rgba(16,185,129,0.1)',
                        color: isRunning ? '#f59e0b' : '#10b981',
                      }}
                    >
                      {isRunning ? (
                        <>
                          <Pause size={12} /> Pause
                        </>
                      ) : (
                        <>
                          <Play size={12} /> Start
                        </>
                      )}
                    </button>
                    <button
                      className="btn-danger btn-icon"
                      onClick={(e) => {
                        e.stopPropagation()
                        setDeleteModal({
                          open: true,
                          agentId: agent.id,
                          agentName: agent.name,
                        })
                      }}
                      style={{
                        padding: '6px 8px',
                        borderRadius: 8,
                        border: '1px solid var(--border)',
                        background: 'var(--bg-2)',
                        cursor: 'pointer',
                        color: 'var(--text-4)',
                        display: 'flex',
                        alignItems: 'center',
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                    {expanded ? (
                      <ChevronUp size={14} style={{ color: 'var(--text-4)' }} />
                    ) : (
                      <ChevronDown
                        size={14}
                        style={{ color: 'var(--text-4)' }}
                      />
                    )}
                  </div>
                </div>

                {/* Expanded: X API keys for this brand */}
                {expanded && (
                  <div
                    style={{
                      padding: '0 20px 20px',
                      borderTop: '1px solid var(--border-subtle)',
                    }}
                  >
                    <div style={{ paddingTop: 16 }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          marginBottom: 12,
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                          }}
                        >
                          <LinkIcon
                            size={14}
                            style={{ color: 'var(--text-3)' }}
                          />
                          <span
                            style={{
                              fontSize: 13,
                              fontWeight: 600,
                              color: 'var(--text-1)',
                            }}
                          >
                            X Connection
                          </span>
                        </div>
                        {xConnected[agent.id] ? (
                          <span
                            style={{
                              padding: '6px 14px',
                              borderRadius: 8,
                              fontSize: 12,
                              fontWeight: 600,
                              background: 'rgba(16,185,129,0.1)',
                              color: '#10b981',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 5,
                            }}
                          >
                            <Check size={12} /> Connected
                          </span>
                        ) : (
                          <a
                            className="btn-accent"
                            href={`/auth/x/authorize?agentId=${agent.id}`}
                            style={{
                              padding: '6px 14px',
                              borderRadius: 8,
                              fontSize: 12,
                              fontWeight: 600,
                              background: 'var(--accent)',
                              color: '#fff',
                              textDecoration: 'none',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 5,
                            }}
                          >
                            Connect with X
                          </a>
                        )}
                      </div>
                      <p
                        style={{
                          fontSize: 11,
                          color: 'var(--text-4)',
                          marginBottom: 10,
                          lineHeight: 1.5,
                        }}
                      >
                        {xConnected[agent.id]
                          ? 'Your X account is connected and ready to post.'
                          : 'Click "Connect with X" for one-click sign-in, or paste API keys manually below.'}
                      </p>
                      {xConnected[agent.id] ? (
                        <button
                          className="btn-danger"
                          onClick={async () => {
                            try {
                              await post('/api/keys/x/disconnect', {
                                agentId: agent.id,
                              })
                              setXConnected((prev) => ({
                                ...prev,
                                [agent.id]: false,
                              }))
                            } catch {}
                          }}
                          style={{
                            padding: '6px 14px',
                            borderRadius: 8,
                            fontSize: 12,
                            fontWeight: 500,
                            background: 'rgba(239,68,68,0.08)',
                            color: 'var(--danger)',
                            border: '1px solid rgba(239,68,68,0.15)',
                            cursor: 'pointer',
                            fontFamily: 'inherit',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 5,
                          }}
                        >
                          Disconnect X
                        </button>
                      ) : (
                        <details style={{ marginBottom: 8 }}>
                          <summary
                            style={{
                              fontSize: 12,
                              color: 'var(--text-4)',
                              cursor: 'pointer',
                              marginBottom: 8,
                            }}
                          >
                            Manual API keys (advanced)
                          </summary>
                          <div
                            style={{
                              display: 'grid',
                              gridTemplateColumns: '1fr 1fr',
                              gap: 8,
                            }}
                          >
                            {(
                              [
                                'apiKey',
                                'apiSecret',
                                'accessToken',
                                'accessTokenSecret',
                              ] as const
                            ).map((field) => (
                              <div key={field}>
                                <label style={{ ...labelStyle, fontSize: 11 }}>
                                  {field === 'apiKey'
                                    ? 'API Key'
                                    : field === 'apiSecret'
                                      ? 'API Secret'
                                      : field === 'accessToken'
                                        ? 'Access Token'
                                        : 'Access Token Secret'}
                                </label>
                                <input
                                  type="password"
                                  value={
                                    (agentXKeys[agent.id] || {})[field] || ''
                                  }
                                  onChange={(e) =>
                                    setAgentXKeys((prev) => ({
                                      ...prev,
                                      [agent.id]: {
                                        ...(prev[agent.id] || {
                                          apiKey: '',
                                          apiSecret: '',
                                          accessToken: '',
                                          accessTokenSecret: '',
                                        }),
                                        [field]: e.target.value,
                                      },
                                    }))
                                  }
                                  placeholder="••••••••"
                                  style={{ ...inputStyle, fontSize: 12 }}
                                />
                              </div>
                            ))}
                            <div style={{ gridColumn: '1 / -1' }}>
                              <button
                                className="btn-accent"
                                onClick={async () => {
                                  const k = agentXKeys[agent.id]
                                  if (
                                    !k?.apiKey ||
                                    !k?.apiSecret ||
                                    !k?.accessToken ||
                                    !k?.accessTokenSecret
                                  )
                                    return
                                  try {
                                    await post('/api/keys/x', {
                                      ...k,
                                      agentId: agent.id,
                                    })
                                    setAgentXKeys((prev) => ({
                                      ...prev,
                                      [agent.id]: {
                                        apiKey: '',
                                        apiSecret: '',
                                        accessToken: '',
                                        accessTokenSecret: '',
                                      },
                                    }))
                                    setXConnected((prev) => ({
                                      ...prev,
                                      [agent.id]: true,
                                    }))
                                    setSaveStatus('saved')
                                    setTimeout(
                                      () => setSaveStatus('idle'),
                                      2000,
                                    )
                                  } catch {}
                                }}
                                disabled={!agentXKeys[agent.id]?.apiKey}
                                style={{
                                  padding: '8px 20px',
                                  background: 'var(--accent)',
                                  color: '#fff',
                                  border: 'none',
                                  borderRadius: 8,
                                  fontSize: 13,
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                  fontFamily: 'inherit',
                                  opacity: agentXKeys[agent.id]?.apiKey
                                    ? 1
                                    : 0.5,
                                }}
                              >
                                Save X Keys for This Brand
                              </button>
                            </div>
                          </div>
                        </details>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          {agents.length === 0 && !showNewAgent && (
            <div style={{ ...cardStyle, textAlign: 'center', padding: 40 }}>
              <Pause
                size={28}
                style={{ color: 'var(--text-4)', margin: '0 auto 12px' }}
              />
              <p
                style={{
                  color: 'var(--text-2)',
                  fontSize: 14,
                  margin: '0 0 4px',
                }}
              >
                No brands yet
              </p>
              <p style={{ color: 'var(--text-3)', fontSize: 13, margin: 0 }}>
                Create your first brand to start posting.
              </p>
            </div>
          )}

          {!showNewAgent ? (
            <button
              className="btn"
              onClick={() => setShowNewAgent(true)}
              style={{
                ...btnStyle,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                alignSelf: 'flex-start',
              }}
            >
              <Plus size={14} /> New Brand
            </button>
          ) : (
            <div style={cardStyle}>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: 'var(--text-1)',
                  marginBottom: 16,
                }}
              >
                New Brand
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 14,
                }}
              >
                <div>
                  <label style={labelStyle}>Brand Name</label>
                  <input
                    value={newAgentName}
                    onChange={(e) => setNewAgentName(e.target.value)}
                    style={inputStyle}
                    placeholder="e.g. Acme Tools, MyBrand"
                  />
                </div>
                <div>
                  <label style={labelStyle}>Niche</label>
                  <input
                    value={newAgentNiche}
                    onChange={(e) => setNewAgentNiche(e.target.value)}
                    style={inputStyle}
                    placeholder="e.g. AI agents, DeFi, fitness"
                  />
                </div>
                <div>
                  <label style={labelStyle}>Tone</label>
                  <select
                    value={newAgentTone}
                    onChange={(e) => setNewAgentTone(e.target.value)}
                    style={{ ...inputStyle, background: 'var(--select-bg)' }}
                  >
                    {[
                      'professional',
                      'casual',
                      'witty',
                      'technical',
                      'friendly',
                      'authoritative',
                    ].map((t) => (
                      <option key={t} value={t}>
                        {t.charAt(0).toUpperCase() + t.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>
                    Website{' '}
                    <span style={{ color: 'var(--text-4)', fontWeight: 400 }}>
                      (optional)
                    </span>
                  </label>
                  <input
                    value={newAgentWebsite}
                    onChange={(e) => setNewAgentWebsite(e.target.value)}
                    style={inputStyle}
                    placeholder="https://..."
                  />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={labelStyle}>
                    X Handle{' '}
                    <span style={{ color: 'var(--text-4)', fontWeight: 400 }}>
                      (optional)
                    </span>
                  </label>
                  <input
                    value={newAgentXHandle}
                    onChange={(e) => setNewAgentXHandle(e.target.value)}
                    style={inputStyle}
                    placeholder="@yourhandle"
                  />
                </div>
              </div>
              <p
                style={{
                  fontSize: 11,
                  color: 'var(--text-4)',
                  margin: '12px 0 0',
                  lineHeight: 1.4,
                }}
              >
                Pulse will research your niche automatically to learn what your
                community talks about, how they sound, and what gets engagement.
                {newAgentWebsite &&
                  ' Your website will be scanned for product details.'}
                {newAgentXHandle &&
                  ' Your X profile will be analyzed for voice and tone.'}
              </p>
              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <button
                  className="btn-accent"
                  onClick={createAgent}
                  style={accentBtnStyle}
                >
                  Create Brand
                </button>
                <button
                  className="btn"
                  onClick={() => setShowNewAgent(false)}
                  style={btnStyle}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Account Tab */}
      {tab === 'account' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <ProductionReadinessPanel
            authProvider={authProvider}
            credits={credits}
            spendToday={spendToday}
            spendMonth={spendMonth}
            projection={projection}
          />

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))',
              gap: 20,
            }}
          >
            {/* AI Model — single clean picker */}
            <div style={cardStyle}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 6,
                }}
              >
                <Zap size={16} style={{ color: 'var(--accent)' }} />
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: 'var(--text-1)',
                  }}
                >
                  AI Model
                </span>
              </div>
              <p
                style={{
                  fontSize: 12,
                  color: 'var(--text-3)',
                  marginBottom: 16,
                  lineHeight: 1.5,
                }}
              >
                Choose the AI quality level for all content generation. Better
                models produce higher quality posts and use more plan allowance.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {[
                  {
                    id: 'llama-3.3-70b',
                    label: 'Llama 3.3 70B',
                    desc: 'Fast, low allowance use',
                    tier: '~0.5 units/post',
                  },
                  {
                    id: 'gpt-4o-mini',
                    label: 'GPT-4o Mini',
                    desc: 'Good balance',
                    tier: '~0.5 units/post',
                  },
                  {
                    id: 'claude-haiku',
                    label: 'Claude Haiku 4.5',
                    desc: 'High quality',
                    tier: '~2-4 units/post',
                  },
                  {
                    id: 'gpt-4o',
                    label: 'GPT-4o',
                    desc: 'Very high quality',
                    tier: '~4-8 units/post',
                  },
                  {
                    id: 'claude-sonnet',
                    label: 'Claude Sonnet 4',
                    desc: 'Best quality',
                    tier: '~5-10 units/post',
                  },
                ].map((m) => {
                  const selected = contentModel === m.id
                  return (
                    <button
                      key={m.id}
                      className="btn"
                      data-active={selected ? 'true' : 'false'}
                      onClick={() => setContentModel(m.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '12px 14px',
                        borderRadius: 10,
                        border: selected
                          ? '1px solid var(--accent)'
                          : '1px solid var(--border)',
                        background: selected
                          ? 'var(--accent-dim)'
                          : 'var(--bg-2)',
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        textAlign: 'left',
                        transition: 'all 0.15s',
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            color: selected ? 'var(--accent)' : 'var(--text-1)',
                          }}
                        >
                          {m.label}
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            color: 'var(--text-4)',
                            marginTop: 2,
                          }}
                        >
                          {m.desc}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 700,
                            color: selected ? 'var(--accent)' : 'var(--text-1)',
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          {m.tier}
                        </div>
                        <div
                          style={{
                            fontSize: 10,
                            color: 'var(--text-4)',
                            marginTop: 1,
                          }}
                        >
                          Billed per actual usage + 15%
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            <div style={cardStyle}>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: 'var(--text-1)',
                  marginBottom: 6,
                }}
              >
                Mentions
              </div>
              <p
                style={{
                  fontSize: 12,
                  color: 'var(--text-4)',
                  marginBottom: 16,
                  lineHeight: 1.4,
                }}
              >
                When someone mentions your brand on X, should it reply
                automatically?
              </p>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <label style={{ ...labelStyle, marginBottom: 0 }}>
                  Auto-reply to mentions
                </label>
                <Toggle
                  checked={mentionsEnabled}
                  onChange={setMentionsEnabled}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Integrations Tab */}
      {tab === 'integrations' && <GitHubSettings />}

      {/* Connections tab removed — X connection is per-brand in Brand tab, posting config is in Autopilot */}

      {/* Content Rules — visible, editable integrity rules */}
      {tab !== 'integrations' && rulesLoaded && (
        <div style={{ ...cardStyle, marginTop: 20 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--text-1)',
              marginBottom: 4,
            }}
          >
            Content Rules
          </div>
          <p
            style={{
              fontSize: 12,
              color: 'var(--text-4)',
              marginBottom: 16,
              lineHeight: 1.4,
            }}
          >
            These rules are enforced on every generated post. Toggle, edit, or
            remove any. Add your own at the bottom.
          </p>
          {contentRules.map((rule, i) => (
            <div
              key={rule.id}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                padding: '8px 0',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <input
                type="checkbox"
                checked={rule.enabled}
                onChange={() => {
                  const updated = contentRules.map((r, j) =>
                    j === i ? { ...r, enabled: !r.enabled } : r,
                  )
                  setContentRules(updated)
                  saveRules(updated)
                }}
                style={{ marginTop: 3, flexShrink: 0, cursor: 'pointer' }}
              />
              {editingRuleId === rule.id ? (
                <div style={{ flex: 1, display: 'flex', gap: 6 }}>
                  <input
                    value={editingRuleText}
                    onChange={(e) => setEditingRuleText(e.target.value)}
                    style={{
                      ...inputStyle,
                      fontSize: 13,
                      padding: '4px 8px',
                      flex: 1,
                    }}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const updated = contentRules.map((r, j) =>
                          j === i ? { ...r, text: editingRuleText.trim() } : r,
                        )
                        setContentRules(updated)
                        saveRules(updated)
                        setEditingRuleId(null)
                      }
                      if (e.key === 'Escape') setEditingRuleId(null)
                    }}
                  />
                  <button
                    onClick={() => {
                      const updated = contentRules.map((r, j) =>
                        j === i ? { ...r, text: editingRuleText.trim() } : r,
                      )
                      setContentRules(updated)
                      saveRules(updated)
                      setEditingRuleId(null)
                    }}
                    style={{
                      fontSize: 11,
                      color: 'var(--accent)',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    save
                  </button>
                </div>
              ) : (
                <span
                  style={{
                    fontSize: 13,
                    color: rule.enabled ? 'var(--text-2)' : 'var(--text-4)',
                    textDecoration: rule.enabled ? 'none' : 'line-through',
                    lineHeight: 1.4,
                    flex: 1,
                  }}
                >
                  {rule.text}
                </span>
              )}
              <button
                onClick={() => {
                  setEditingRuleId(rule.id)
                  setEditingRuleText(rule.text)
                }}
                style={{
                  fontSize: 11,
                  color: 'var(--text-4)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                edit
              </button>
              <button
                onClick={() => {
                  const updated = contentRules.filter((_, j) => j !== i)
                  setContentRules(updated)
                  saveRules(updated)
                }}
                style={{
                  fontSize: 11,
                  color: 'var(--danger)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  flexShrink: 0,
                  opacity: 0.6,
                }}
              >
                ×
              </button>
            </div>
          ))}

          {/* Add new rule */}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <input
              value={newRuleText}
              onChange={(e) => setNewRuleText(e.target.value)}
              placeholder="Add a custom rule..."
              style={{
                ...inputStyle,
                fontSize: 13,
                padding: '6px 10px',
                flex: 1,
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newRuleText.trim()) {
                  const newRule = {
                    id: `custom-${Date.now()}`,
                    text: newRuleText.trim(),
                    enabled: true,
                  }
                  const updated = [...contentRules, newRule]
                  setContentRules(updated)
                  saveRules(updated)
                  setNewRuleText('')
                }
              }}
            />
            <button
              onClick={() => {
                if (!newRuleText.trim()) return
                const newRule = {
                  id: `custom-${Date.now()}`,
                  text: newRuleText.trim(),
                  enabled: true,
                }
                const updated = [...contentRules, newRule]
                setContentRules(updated)
                saveRules(updated)
                setNewRuleText('')
              }}
              style={{
                padding: '6px 14px',
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 500,
                background: 'var(--accent)',
                color: '#fff',
                border: 'none',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              Add
            </button>
          </div>

          {rulesSaving && (
            <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 8 }}>
              Saving...
            </div>
          )}
        </div>
      )}

      {deleteError && (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 9998,
            background: 'var(--danger)',
            color: '#fff',
            padding: '10px 20px',
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 500,
            boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
          }}
        >
          {deleteError}
        </div>
      )}

      <Modal
        open={deleteModal.open}
        title="Delete Brand"
        message={`Are you sure you want to delete "${deleteModal.agentName}"? This cannot be undone.`}
        confirmLabel="Delete"
        danger
        loading={deleting}
        onConfirm={() => deleteAgent(deleteModal.agentId)}
        onCancel={() => {
          if (!deleting)
            setDeleteModal({ open: false, agentId: '', agentName: '' })
        }}
      />
    </div>
  )
}
