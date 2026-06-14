import { useState, useRef, useEffect, useCallback } from 'react'
import { Send, Loader2, Sparkles, Bot, User, ChevronDown, ChevronUp, CheckCircle, RotateCcw, Copy, Check } from 'lucide-react'
import { get, post } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import Modal from '../components/Modal'

interface Message {
  role: 'user' | 'assistant' | 'system' | 'action'
  content: string
}

interface ChatModel {
  id: string
  label: string
  provider: string
  credits: number
  desc: string
}

// Pending request tracker — survives component unmount
let pendingRequest: { promise: Promise<any>; msg: string } | null = null

/** Render basic markdown: **bold**, numbered lists, bullet lists */
function renderMarkdown(text: string): React.ReactNode {
  const lines = text.split('\n')
  const elements: React.ReactNode[] = []

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]

    // Inline formatting: **bold** and [text](url)
    const parts: React.ReactNode[] = []
    let lastIdx = 0
    const inlineRx = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)]+)\)/g
    let match
    while ((match = inlineRx.exec(line)) !== null) {
      if (match.index > lastIdx) parts.push(line.slice(lastIdx, match.index))
      if (match[1]) {
        // Bold
        parts.push(<strong key={`b${i}-${match.index}`}>{match[1]}</strong>)
      } else if (match[2] && match[3]) {
        // Link
        const isInternal = match[3].startsWith('/')
        parts.push(
          <a key={`l${i}-${match.index}`} href={match[3]}
            {...(isInternal ? {} : { target: '_blank', rel: 'noreferrer' })}
            style={{ color: 'var(--accent)', textDecoration: 'underline', fontWeight: 500 }}
          >{match[2]}</a>
        )
      }
      lastIdx = match.index + match[0].length
    }
    if (lastIdx < line.length) parts.push(line.slice(lastIdx))
    if (parts.length === 0) parts.push(line)

    // Numbered list: "1. " or "1) "
    const numMatch = line.match(/^\d+[.)]\s+/)
    if (numMatch) {
      elements.push(<div key={i} style={{ paddingLeft: 8, marginTop: i > 0 && !lines[i-1].match(/^\d+[.)]\s+/) ? 8 : 2 }}>{parts}</div>)
      continue
    }

    // Bullet list: "- " or "• "
    if (line.match(/^[-•]\s+/)) {
      elements.push(<div key={i} style={{ paddingLeft: 8, marginTop: 2 }}>{parts}</div>)
      continue
    }

    // Empty line = paragraph break
    if (line.trim() === '') {
      elements.push(<div key={i} style={{ height: 8 }} />)
      continue
    }

    elements.push(<span key={i}>{parts}{i < lines.length - 1 ? '\n' : ''}</span>)
  }

  return elements
}

export default function Chat() {
  const { refreshCredits } = useAuth()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [models, setModels] = useState<ChatModel[]>([])
  const [selectedModel, setSelectedModel] = useState('gpt-4o-mini')
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  const [expandedMsgs, setExpandedMsgs] = useState<Set<number>>(new Set())
  const [showNewChatConfirm, setShowNewChatConfirm] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const greeting: Message = {
    role: 'assistant',
    content: "Hey! I'm Pulse, your AI marketing assistant. I can set up your brand, adjust any settings, add knowledge, or help with strategy — all through conversation.\n\nWhat would you like to do?",
  }

  const loadHistory = useCallback(async () => {
    try {
      const d = await get<{ messages: Array<{ role: string; content: string }> }>('/api/chat-setup/history')
      if (d.messages?.length) {
        setMessages([
          greeting,
          ...d.messages.map(m => ({ role: m.role as Message['role'], content: m.content })),
        ])
      } else if (messages.length === 0) {
        setMessages([greeting])
      }
    } catch {
      if (messages.length === 0) setMessages([greeting])
      setMessages(prev => [...prev, { role: 'system', content: 'Failed to load chat history.' }])
    }
  }, [])

  useEffect(() => {
    // Show greeting immediately — don't wait for history fetch
    if (messages.length === 0) setMessages([greeting])

    get<{ models: ChatModel[] }>('/api/chat-models').then(d => {
      setModels(d.models)
      const saved = localStorage.getItem('pulse_chat_model')
      if (saved && d.models.some(m => m.id === saved)) setSelectedModel(saved)
    }).catch(() => {})

    // If there was a pending request from before tab switch
    if (pendingRequest) {
      setSending(true)
      pendingRequest.promise
        .then(() => { loadHistory(); setSending(false) })
        .catch(() => { loadHistory(); setSending(false) })
        .finally(() => { pendingRequest = null })
    } else {
      // Load history in background — messages already visible
      loadHistory()
    }
  }, [loadHistory])

  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  useEffect(() => { scrollToBottom() }, [messages])

  const autoResize = () => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px'
  }

  const sendMessage = async (overrideMsg?: string | React.MouseEvent) => {
    if (typeof overrideMsg !== 'string') overrideMsg = undefined;
    const msg = (overrideMsg || input).trim()
    if (!msg || sending) return
    setInput('')
    setSending(true)
    setMessages(prev => [...prev, { role: 'user', content: msg }])
    if (textareaRef.current) textareaRef.current.style.height = 'auto'

    // Fire the request — tracked globally so it survives tab switches
    const requestPromise = post('/api/chat-setup', { message: msg, model: selectedModel })
    pendingRequest = { promise: requestPromise, msg }

    try {
      const data = await requestPromise
      pendingRequest = null

      if (data.reply) {
        setMessages(prev => [...prev, { role: 'assistant', content: data.reply }])
      }
      if (data.actionResults?.length) {
        setMessages(prev => [...prev, ...data.actionResults.map((r: string) => ({ role: 'action' as const, content: r }))])
      }
      // Handle profile export download
      if (data.exportProfile) {
        const blob = new Blob([JSON.stringify(data.exportProfile, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `pulse-profile-${(data.exportProfile.agent?.brandName || 'agent').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pulse.json`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      }
      if (data.configReady && data.config) {
        try {
          await post('/api/chat-setup/apply', { config: data.config })
        } catch {
          setMessages(prev => [...prev, { role: 'system', content: 'Failed to apply config changes. Please try again.' }])
        }
      }
      refreshCredits()
    } catch (err: any) {
      pendingRequest = null
      const msg = err?.body?.error || err?.message || "The AI service is unavailable. Check that your LLM provider is configured under Settings or contact your admin."
      setMessages(prev => [...prev, { role: 'assistant', content: msg }])
    }
    setSending(false)
    textareaRef.current?.focus()
  }

  const handleNewChat = async () => {
    try {
      await post('/api/chat-setup/reset', {})
      setMessages([greeting])
    } catch {
      setMessages(prev => [...prev, { role: 'system', content: 'Failed to reset chat. Please try again.' }])
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', maxWidth: 840, margin: '0 auto', padding: '0 24px', overflowX: 'hidden', boxSizing: 'border-box', wordBreak: 'break-word', minWidth: 0 }}>
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
            <Sparkles size={20} style={{ color: 'var(--accent)' }} />
          </div>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--text-1)', margin: 0 }}>Chat</h1>
            <p style={{ fontSize: 13, color: 'var(--text-3)', margin: 0 }}>Set up and configure your brand through conversation</p>
          </div>
        </div>
        {messages.length > 3 && (
          <button
            className="btn"
            onClick={() => setShowNewChatConfirm(true)}
            disabled={sending}
            title="Start a new conversation"
            style={{
              padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border)',
              background: 'var(--bg-2)', color: 'var(--text-3)', fontSize: 12, fontWeight: 500,
              cursor: sending ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', gap: 6, opacity: sending ? 0.5 : 1,
            }}
          >
            <RotateCcw size={12} /> New Chat
          </button>
        )}
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 0', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {messages.map((msg, i) => (
          <div key={i} style={{
            display: 'flex', gap: 12,
            flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
            alignItems: 'flex-start',
            ...(msg.role === 'system' ? { justifyContent: 'center' } : {}),
          }}>
            {msg.role === 'action' && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 16px', borderRadius: 10,
                background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.15)',
                fontSize: 12, color: '#10b981', fontWeight: 500,
                maxWidth: '80%',
              }}>
                <CheckCircle size={14} />
                {msg.content}
              </div>
            )}
            {msg.role !== 'system' && msg.role !== 'action' && (
              <div style={{
                width: 32, height: 32, borderRadius: 10, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: msg.role === 'assistant' ? 'var(--accent-dim)' : 'var(--bg-3)',
                border: `1px solid ${msg.role === 'assistant' ? 'var(--accent-glow)' : 'var(--border)'}`,
              }}>
                {msg.role === 'assistant'
                  ? <Bot size={15} style={{ color: 'var(--accent)' }} />
                  : <User size={15} style={{ color: 'var(--text-2)' }} />
                }
              </div>
            )}

            {msg.role !== 'action' && <div style={{
              maxWidth: msg.role === 'system' ? '80%' : '75%',
              padding: msg.role === 'system' ? '10px 20px' : '14px 18px',
              borderRadius: 16, fontSize: 14, lineHeight: 1.7, whiteSpace: 'pre-wrap',
              position: 'relative',
              ...(msg.role === 'user' ? {
                background: 'linear-gradient(135deg, var(--accent) 0%, #059669 100%)',
                color: '#fff', borderBottomRightRadius: 6,
                boxShadow: '0 2px 12px var(--accent-glow)',
                userSelect: 'text' as const, WebkitUserSelect: 'text' as const, cursor: 'text',
              } : msg.role === 'system' ? {
                background: 'var(--accent-dim)', border: '1px solid var(--accent-glow)',
                color: 'var(--accent)', fontSize: 13, textAlign: 'center' as const,
              } : {
                background: 'var(--msg-bot-bg)', border: '1px solid var(--msg-bot-border)',
                color: 'var(--msg-bot-text)', borderBottomLeftRadius: 6,
                userSelect: 'text' as const,
              }),
            }}>
              {(() => {
                const isLong = (msg.role === 'assistant' || msg.role === 'user') && msg.content.split('\n').length > 8
                const isExpanded = expandedMsgs.has(i)
                const shouldCollapse = isLong && !isExpanded
                return (
                  <>
                    <div style={shouldCollapse ? {
                      maxHeight: 160, overflow: 'hidden',
                      WebkitMaskImage: 'linear-gradient(to bottom, black 60%, transparent 100%)',
                      maskImage: 'linear-gradient(to bottom, black 60%, transparent 100%)',
                    } : undefined}>
                      {msg.role === 'assistant' ? renderMarkdown(msg.content) : msg.content}
                    </div>
                    {isLong && (
                      <button
                        className="btn-ghost"
                        onClick={() => setExpandedMsgs(prev => {
                          const next = new Set(prev)
                          isExpanded ? next.delete(i) : next.add(i)
                          return next
                        })}
                        style={{
                          background: 'rgba(0,0,0,0.15)', border: 'none', cursor: 'pointer', padding: '4px 10px',
                          fontSize: 12, fontWeight: 600, color: '#fff',
                          display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: 'inherit',
                          borderRadius: 8, marginTop: 4,
                        }}
                      >
                        {isExpanded ? <><ChevronUp size={13} /> Show less</> : <><ChevronDown size={13} /> Show more</>}
                      </button>
                    )}
                  </>
                )
              })()}
              {msg.role === 'assistant' && (
                <div style={{ marginTop: 4, display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    className="btn-ghost"
                    onClick={() => {
                      navigator.clipboard.writeText(msg.content).then(() => {
                        setCopiedIdx(i)
                        setTimeout(() => setCopiedIdx(null), 2000)
                      })
                    }}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px',
                      borderRadius: 6, display: 'flex', alignItems: 'center', gap: 4,
                      fontSize: 11, color: copiedIdx === i ? 'var(--accent)' : 'var(--text-4)',
                      transition: 'color 0.15s',
                    }}
                  >
                    {copiedIdx === i ? <><Check size={11} /> Copied</> : <><Copy size={11} /> Copy</>}
                  </button>
                </div>
              )}
            </div>}
          </div>
        ))}

        {sending && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 10,
              background: 'var(--accent-dim)', border: '1px solid var(--accent-glow)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Loader2 size={15} style={{ color: 'var(--accent)', animation: 'spin 1s linear infinite' }} />
            </div>
            <span style={{ color: 'var(--text-3)', fontSize: 13 }}>Pulse is thinking...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick prompt chips — shown only before user's first message */}
      {messages.length <= 1 && !sending && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '0 0 12px' }}>
          {[
            'Set up my brand identity',
            'Help me write my first post',
            'What can you do?',
            'Change my AI model',
          ].map(prompt => (
            <button
              key={prompt}
              onClick={() => sendMessage(prompt)}
              style={{
                padding: '8px 16px', borderRadius: 20, fontSize: 13, fontWeight: 500,
                background: 'var(--bg-2)', color: 'var(--text-2)',
                border: '1px solid var(--border)', cursor: 'pointer',
                fontFamily: 'inherit', transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-2)' }}
            >
              {prompt}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div style={{ borderTop: '1px solid var(--border-subtle)', padding: '16px 0 12px' }}>
        {/* Model selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <div style={{ position: 'relative' }}>
            <select
              value={selectedModel}
              onChange={e => { setSelectedModel(e.target.value); localStorage.setItem('pulse_chat_model', e.target.value) }}
              style={{
                background: 'var(--bg-2)', color: 'var(--text-2)',
                border: '1px solid var(--border)', borderRadius: 8,
                padding: '5px 28px 5px 10px', fontSize: 12, fontWeight: 500,
                outline: 'none', cursor: 'pointer', appearance: 'none' as const,
                fontFamily: 'inherit',
              }}
            >
              {models.map(m => (
                <option key={m.id} value={m.id}>
                  {m.label} — {m.credits} units/msg
                </option>
              ))}
            </select>
            <ChevronDown size={12} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-4)', pointerEvents: 'none' }} />
          </div>
        </div>

        <div style={{
          display: 'flex', gap: 12, alignItems: 'flex-end',
          background: 'var(--input-bg)', border: '1px solid var(--input-border)',
          borderRadius: 16, padding: '6px 6px 6px 18px',
        }}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => { setInput(e.target.value); autoResize() }}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
            placeholder="Type your message..."
            rows={1}
            style={{
              flex: 1, background: 'transparent', color: 'var(--text-1)',
              border: 'none', outline: 'none', resize: 'none',
              fontSize: 14, lineHeight: 1.6, padding: '10px 0',
              minHeight: 24, maxHeight: 200, fontFamily: 'inherit',
            }}
          />
          <button
            className="btn-accent"
            onClick={sendMessage}
            disabled={sending || !input.trim()}
            style={{
              width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: sending || !input.trim() ? 'var(--bg-3)' : 'var(--accent)',
              borderRadius: 12, border: 'none',
              cursor: sending || !input.trim() ? 'not-allowed' : 'pointer',
              color: '#fff', flexShrink: 0, transition: 'all 0.15s',
              opacity: sending || !input.trim() ? 0.4 : 1,
            }}
          >
            {sending ? <Loader2 size={17} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={17} />}
          </button>
        </div>
        <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-4)', marginTop: 8 }}>
          Shift+Enter for new line
        </div>
      </div>

      <Modal
        open={showNewChatConfirm}
        title="Start New Chat?"
        message="This will archive the current conversation and start fresh. Your chat history is saved and can be viewed later."
        confirmLabel="New Chat"
        onConfirm={() => { setShowNewChatConfirm(false); handleNewChat() }}
        onCancel={() => setShowNewChatConfirm(false)}
      />
    </div>
  )
}
