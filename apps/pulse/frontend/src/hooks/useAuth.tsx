import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { get, post } from '../lib/api'

type AuthProviderName = 'unknown' | 'demo'

interface Projection {
  avgDailySpend: number
  daysRemaining: number | null
  burnRate: string
}

interface AdminOverride {
  test_credits?: number | null
  customer_mode?: boolean
}

interface AuthState {
  loading: boolean
  authenticated: boolean
  authProvider: AuthProviderName
  email: string
  userId: string | null
  orgId: string | null
  credits: number | null
  spendToday: number
  spendMonth: number
  projection: Projection | null
  isAdmin: boolean
  adminOverride: AdminOverride | null
  logout: () => Promise<void>
  refreshSession: () => Promise<void>
  refreshCredits: () => Promise<void>
  refreshAdminOverride: () => Promise<void>
}

const AuthContext = createContext<AuthState>({
  loading: true,
  authenticated: false,
  authProvider: 'unknown',
  email: '',
  userId: null,
  orgId: null,
  credits: null,
  spendToday: 0,
  spendMonth: 0,
  projection: null,
  isAdmin: false,
  adminOverride: null,
  logout: async () => {},
  refreshSession: async () => {},
  refreshCredits: async () => {},
  refreshAdminOverride: async () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Omit<AuthState, 'logout' | 'refreshSession' | 'refreshCredits' | 'refreshAdminOverride'>>({
    loading: true,
    authenticated: false,
    authProvider: 'unknown',
    email: '',
    userId: null,
    orgId: null,
    credits: null,
    spendToday: 0,
    spendMonth: 0,
    projection: null,
    isAdmin: false,
    adminOverride: null,
  })

  const clearUsageState = useCallback(() => {
    setState((s) => ({
      ...s,
      credits: null,
      spendToday: 0,
      spendMonth: 0,
      projection: null,
    }))
  }, [])

  const refreshCredits = useCallback(async () => {
    try {
      const data = await get<{
        credits: number
        spend?: { today: number; thisMonth: number }
        projection?: Projection
      }>('/api/credits')
      setState((s) => ({
        ...s,
        credits: data.credits,
        spendToday: data.spend?.today ?? 0,
        spendMonth: data.spend?.thisMonth ?? 0,
        projection: data.projection ?? null,
      }))
    } catch {}
  }, [])

  const refreshSession = useCallback(async () => {
    try {
      const session = await get<{
        ok: boolean
        authenticated: boolean
        authProvider?: AuthProviderName
        user?: { id?: string | null; email?: string | null }
        session?: { orgId?: string | null }
        isAdmin?: boolean
        adminOverride?: AdminOverride | null
      }>('/auth/session')

      if (!session.authenticated) {
        clearUsageState()
        setState((s) => ({
          ...s,
          loading: false,
          authenticated: false,
          authProvider: session.authProvider ?? 'unknown',
          email: '',
          userId: null,
          orgId: null,
          isAdmin: false,
          adminOverride: null,
        }))
        return
      }

      setState((s) => ({
        ...s,
        loading: false,
        authenticated: true,
        authProvider: session.authProvider ?? 'demo',
        email: session.user?.email ?? '',
        userId: session.user?.id ?? null,
        orgId: session.session?.orgId ?? null,
        isAdmin: Boolean(session.isAdmin),
        adminOverride: session.adminOverride ?? null,
      }))
      await refreshCredits()
    } catch {
      clearUsageState()
      setState((s) => ({
        ...s,
        loading: false,
        authenticated: false,
        authProvider: 'unknown',
        email: '',
        userId: null,
        orgId: null,
        isAdmin: false,
        adminOverride: null,
      }))
    }
  }, [clearUsageState, refreshCredits])

  const logout = useCallback(async () => {
    try {
      await post('/auth/logout', {})
    } catch {}
    clearUsageState()
    setState((s) => ({
      ...s,
      loading: false,
      authenticated: false,
      authProvider: 'demo',
      email: '',
      userId: null,
      orgId: null,
      isAdmin: false,
      adminOverride: null,
    }))
    await refreshSession()
  }, [clearUsageState, refreshSession])

  const refreshAdminOverride = useCallback(async () => {
    try {
      const data = await get<{ ok: boolean; override?: AdminOverride }>('/api/admin/state')
      setState((s) => ({
        ...s,
        adminOverride: data.override ?? s.adminOverride,
      }))
    } catch {}
  }, [])

  useEffect(() => {
    void refreshSession()
  }, [refreshSession])

  useEffect(() => {
    if (!state.authenticated) return
    const interval = setInterval(() => {
      void refreshCredits()
    }, 30_000)
    return () => clearInterval(interval)
  }, [refreshCredits, state.authenticated])

  const value = useMemo(
    () => ({
      ...state,
      logout,
      refreshSession,
      refreshCredits,
      refreshAdminOverride,
    }),
    [logout, refreshCredits, refreshSession, refreshAdminOverride, state],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
