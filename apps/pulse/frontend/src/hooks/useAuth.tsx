import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAuth as useClerkAuth, useClerk, useUser } from '@clerk/react'
import { get, setAuthTokenProvider, setUserEmailProvider, setBrandProvider } from '../lib/api'

type AuthProviderName = 'unknown' | 'demo' | 'clerk'

interface Projection {
  avgDailySpend: number
  daysRemaining: number | null
  burnRate: string
}

interface BrandSummary {
  id: string
  name: string
}

interface AuthState {
  loading: boolean
  authenticated: boolean
  authProvider: AuthProviderName
  email: string
  userId: string | null
  orgId: string | null
  isAdmin: boolean
  adminEmail: string | null
  credits: number | null
  balanceUsd: number | null
  spendToday: number
  spendMonth: number
  projection: Projection | null
  brands: BrandSummary[]
  selectedBrandId: string
  selectedBrandName: string
  switchBrand: (id: string) => void
  createBrand: (name: string) => void
  setAdminTestCredits: (credits: number) => void
  clearAdminTestCredits: () => void
  logout: () => Promise<void>
  refreshSession: () => Promise<void>
  refreshCredits: () => Promise<void>
}

const AuthContext = createContext<AuthState>({
  loading: true,
  authenticated: false,
  authProvider: 'unknown',
  email: '',
  userId: null,
  orgId: null,
  isAdmin: false,
  adminEmail: null,
  credits: null,
  balanceUsd: null,
  spendToday: 0,
  spendMonth: 0,
  projection: null,
  brands: [],
  selectedBrandId: 'default',
  selectedBrandName: 'Main brand',
  switchBrand: () => {},
  createBrand: () => {},
  setAdminTestCredits: () => {},
  clearAdminTestCredits: () => {},
  logout: async () => {},
  refreshSession: async () => {},
  refreshCredits: async () => {},
})

const ADMIN_EMAIL_KEY = 'pulse_admin_control_email'

function creditsKey(email: string) {
  return `pulse_admin_test_credits_${email.toLowerCase()}`
}

function readStoredAdminEmail() {
  try {
    return localStorage.getItem(ADMIN_EMAIL_KEY)
  } catch {
    return null
  }
}

function readStoredAdminCredits(email: string) {
  try {
    const raw = localStorage.getItem(creditsKey(email))
    if (!raw) return null
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : null
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const clerk = useClerk()
  const { isLoaded, isSignedIn, getToken, orgId } = useClerkAuth()
  const { user } = useUser()
  const clerkEmail = user?.primaryEmailAddress?.emailAddress ?? ''
  const brandStorageKey = user?.id ? `pulse_brands_${user.id}` : 'pulse_brands_guest'
  const [brands, setBrands] = useState<BrandSummary[]>([])
  const [selectedBrandId, setSelectedBrandId] = useState('default')
  const [state, setState] = useState<Omit<AuthState, 'logout' | 'refreshSession' | 'refreshCredits' | 'switchBrand' | 'createBrand' | 'setAdminTestCredits' | 'clearAdminTestCredits'>>({
    loading: true,
    authenticated: false,
    authProvider: 'unknown',
    email: '',
    userId: null,
    orgId: null,
    isAdmin: false,
    adminEmail: null,
    credits: null,
    balanceUsd: null,
    spendToday: 0,
    spendMonth: 0,
    projection: null,
    brands: [],
    selectedBrandId: 'default',
    selectedBrandName: 'Main brand',
  })

  const clearUsageState = useCallback(() => {
    setState((s) => ({
      ...s,
      credits: null,
      balanceUsd: null,
      spendToday: 0,
      spendMonth: 0,
      projection: null,
    }))
  }, [])

  useEffect(() => {
    if (!isLoaded || !isSignedIn) {
      setAuthTokenProvider(null)
      return
    }
    setAuthTokenProvider(() => getToken())
    return () => setAuthTokenProvider(null)
  }, [getToken, isLoaded, isSignedIn])

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !clerkEmail) {
      setUserEmailProvider(null)
      return
    }
    setUserEmailProvider(() => clerkEmail)
    return () => setUserEmailProvider(null)
  }, [clerkEmail, isLoaded, isSignedIn])

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return
    const fallback = [{ id: 'default', name: 'Main brand' }]
    let parsed = fallback
    try {
      const saved = localStorage.getItem(brandStorageKey)
      if (saved) {
        const value = JSON.parse(saved)
        if (Array.isArray(value) && value.length) parsed = value
      }
    } catch {}
    const selected = localStorage.getItem(`${brandStorageKey}_selected`) || parsed[0].id
    const safeSelected = parsed.some((brand) => brand.id === selected) ? selected : parsed[0].id
    setBrands(parsed)
    setSelectedBrandId(safeSelected)
  }, [isLoaded, isSignedIn, brandStorageKey])

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !clerkEmail) return
    try {
      if (!localStorage.getItem(ADMIN_EMAIL_KEY)) {
        localStorage.setItem(ADMIN_EMAIL_KEY, clerkEmail.toLowerCase())
      }
    } catch {}
  }, [clerkEmail, isLoaded, isSignedIn])

  useEffect(() => {
    setBrandProvider(() => selectedBrandId || 'default')
    return () => setBrandProvider(null)
  }, [selectedBrandId])

  const refreshCredits = useCallback(async () => {
    if (!isLoaded) return
    const storedAdminEmail = readStoredAdminEmail()
    const effectiveEmail = (clerkEmail || state.email || '').toLowerCase()
    const isAdmin = Boolean(effectiveEmail) && storedAdminEmail === effectiveEmail
    try {
      const data = await get<{
        credits: number
        balanceUsd?: number
        spend?: { today: number; thisMonth: number }
        projection?: Projection
      }>('/api/credits')
      const overrideCredits = isAdmin && clerkEmail ? readStoredAdminCredits(clerkEmail) : null
      const effectiveCredits = overrideCredits ?? data.credits
      const effectiveBalance = overrideCredits != null ? effectiveCredits / 100 : (data.balanceUsd ?? data.credits / 100)
      setState((s) => ({
        ...s,
        isAdmin,
        adminEmail: storedAdminEmail,
        credits: effectiveCredits,
        balanceUsd: effectiveBalance,
        spendToday: data.spend?.today ?? 0,
        spendMonth: data.spend?.thisMonth ?? 0,
        projection: data.projection ?? null,
      }))
    } catch {}
  }, [clerkEmail, isLoaded, isSignedIn, state.email])

  const refreshSession = useCallback(async () => {
    if (!isLoaded) return

    if (!isSignedIn) {
      clearUsageState()
      setUserEmailProvider(null)
      setState((s) => ({
        ...s,
        loading: false,
        authenticated: false,
        authProvider: 'unknown',
        email: '',
        userId: null,
        orgId: null,
        isAdmin: false,
        adminEmail: readStoredAdminEmail(),
      }))
      return
    }

    try {
      const session = await get<{
        ok: boolean
        authenticated: boolean
        authProvider?: AuthProviderName
        user?: { id?: string | null; email?: string | null }
        session?: { orgId?: string | null }
      }>('/auth/session', { authRedirect: 'none' })

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
          adminEmail: readStoredAdminEmail(),
        }))
        return
      }

      const effectiveEmail = clerkEmail || session.user?.email || ''
      const storedAdminEmail = readStoredAdminEmail()
      const isAdmin = Boolean(effectiveEmail) && storedAdminEmail === effectiveEmail.toLowerCase()
      setState((s) => ({
        ...s,
        loading: false,
        authenticated: true,
        authProvider: clerkEmail ? 'clerk' : (session.authProvider ?? 'clerk'),
        email: effectiveEmail,
        userId: user?.id ?? session.user?.id ?? null,
        orgId: session.session?.orgId ?? orgId ?? null,
        isAdmin,
        adminEmail: storedAdminEmail,
        brands,
        selectedBrandId,
        selectedBrandName: brands.find((brand) => brand.id === selectedBrandId)?.name ?? 'Main brand',
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
        adminEmail: readStoredAdminEmail(),
      }))
    }
  }, [clearUsageState, clerkEmail, isLoaded, isSignedIn, orgId, refreshCredits, selectedBrandId, user?.id, brands])

  const switchBrand = useCallback((id: string) => {
    if (!brands.some((brand) => brand.id === id)) return
    localStorage.setItem(`${brandStorageKey}_selected`, id)
    setSelectedBrandId(id)
    void refreshCredits()
    window.location.reload()
  }, [refreshCredits, brandStorageKey, brands])

  const createBrand = useCallback((name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    const id = `ws_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
    const next = [...brands, { id, name: trimmed }]
    localStorage.setItem(brandStorageKey, JSON.stringify(next))
    localStorage.setItem(`${brandStorageKey}_selected`, id)
    setBrands(next)
    setSelectedBrandId(id)
    window.location.reload()
  }, [brandStorageKey, brands])

  const setAdminTestCredits = useCallback((credits: number) => {
    if (!clerkEmail) return
    const next = Math.max(0, Math.round(credits))
    localStorage.setItem(creditsKey(clerkEmail), String(next))
    setState((s) => ({
      ...s,
      credits: next,
      balanceUsd: next / 100,
    }))
  }, [clerkEmail])

  const clearAdminTestCredits = useCallback(() => {
    if (!clerkEmail) return
    localStorage.removeItem(creditsKey(clerkEmail))
    void refreshCredits()
  }, [clerkEmail, refreshCredits])

  const logout = useCallback(async () => {
    await clerk.signOut({ redirectUrl: '/' })
    setAuthTokenProvider(null)
    setUserEmailProvider(null)
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
      adminEmail: readStoredAdminEmail(),
      brands: [],
      selectedBrandId: 'default',
      selectedBrandName: 'Main brand',
    }))
  }, [clearUsageState, clerk])

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
      brands,
      selectedBrandId,
      selectedBrandName: brands.find((brand) => brand.id === selectedBrandId)?.name ?? 'Main brand',
      switchBrand,
      createBrand,
      setAdminTestCredits,
      clearAdminTestCredits,
      logout,
      refreshSession,
      refreshCredits,
    }),
    [clearAdminTestCredits, createBrand, logout, refreshCredits, refreshSession, selectedBrandId, setAdminTestCredits, state, switchBrand, brands],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
