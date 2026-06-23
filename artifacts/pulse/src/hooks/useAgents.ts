import { useState, useEffect, useCallback } from 'react'
import { get, post } from '../lib/api'

export interface Agent {
  id: string
  name: string
  brandName: string
  niche: string
  tone: string
  topics: any[]
  competitors: string[]
}

export function useAgents() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [activeId, setActiveId] = useState('default')
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const data = await get<{ agents: Agent[]; activeId: string }>('/api/brands')
      setAgents(data.agents || [])
      setActiveId(data.activeId || 'default')
    } catch {} finally { setLoading(false) }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const switchAgent = async (id: string) => {
    // Set cookie first so server knows the active brand even if POST fails
    document.cookie = `pulse_agent=${encodeURIComponent(id)};path=/;max-age=${30 * 86400}`
    setActiveId(id)
    try {
      await post('/api/brands/switch', { id })
    } catch {}
    // Always reload — switching brands changes all backend context
    window.location.reload()
  }

  const createAgent = async (name: string) => {
    const data = await post<{ ok: boolean; agent: Agent }>('/api/brands', { name })
    if (data.ok && data.agent) {
      setAgents(prev => [...prev, data.agent])
      setActiveId(data.agent.id)
      document.cookie = `pulse_agent=${encodeURIComponent(data.agent.id)};path=/;max-age=${30 * 86400}`
      // Reload to switch to the new brand context
      window.location.reload()
    }
    return data.agent
  }

  const deleteAgent = async (id: string) => {
    await post('/api/brands', { action: 'delete', id })
    const remaining = agents.filter(a => a.id !== id)
    setAgents(remaining)
    // If deleted brand was active, switch to first remaining or clear
    if (activeId === id) {
      if (remaining.length > 0) {
        await switchAgent(remaining[0].id)
      } else {
        setActiveId('')
        document.cookie = 'pulse_agent=;path=/;max-age=0'
        window.location.reload()
      }
    }
  }

  return { agents, activeId, loading, switchAgent, createAgent, deleteAgent, refresh, setAgents }
}
