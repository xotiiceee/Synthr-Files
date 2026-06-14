import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  ApiError,
  get,
  getFirstPartySession,
  loginFirstParty,
  logoutFirstParty,
  type FirstPartyCsrfBundle,
} from "../lib/api";

interface Projection {
  avgDailySpend: number;
  daysRemaining: number | null;
  burnRate: string;
}

type AuthProviderName = "unknown" | "clawnet" | "firstparty";

interface AuthState {
  loading: boolean;
  authenticated: boolean;
  authProvider: AuthProviderName;
  email: string;
  credits: number | null;
  spendToday: number;
  spendMonth: number;
  projection: Projection | null;
  csrf: FirstPartyCsrfBundle | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
  refreshCredits: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  loading: true,
  authenticated: false,
  authProvider: "unknown",
  email: "",
  credits: null,
  spendToday: 0,
  spendMonth: 0,
  projection: null,
  csrf: null,
  login: async () => {},
  logout: async () => {},
  refreshSession: async () => {},
  refreshCredits: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<
    Omit<AuthState, "refreshCredits" | "refreshSession" | "login" | "logout">
  >({
    loading: true,
    authenticated: false,
    authProvider: "unknown",
    email: "",
    credits: null,
    spendToday: 0,
    spendMonth: 0,
    projection: null,
    csrf: null,
  });

  const clearUsageState = useCallback(() => {
    setState((s) => ({
      ...s,
      credits: null,
      spendToday: 0,
      spendMonth: 0,
      projection: null,
    }));
  }, []);

  const refreshCredits = useCallback(async () => {
    try {
      const data = await get<{
        credits: number;
        spend?: { today: number; thisMonth: number };
        projection?: Projection;
      }>("/api/credits");
      setState((s) => ({
        ...s,
        credits: data.credits,
        spendToday: data.spend?.today ?? 0,
        spendMonth: data.spend?.thisMonth ?? 0,
        projection: data.projection ?? null,
      }));
    } catch {}
  }, []);

  const applyFirstPartySession = useCallback(
    (session: Awaited<ReturnType<typeof getFirstPartySession>>) => {
      if (!session.authenticated) {
        clearUsageState();
        setState((s) => ({
          ...s,
          loading: false,
          authenticated: false,
          authProvider: "firstparty",
          email: "",
          csrf: null,
        }));
        return;
      }

      setState((s) => ({
        ...s,
        loading: false,
        authenticated: true,
        authProvider: "firstparty",
        email: session.user?.email ?? "",
        csrf: session.csrf ?? null,
      }));
    },
    [clearUsageState],
  );

  const loadClawNetSession = useCallback(async () => {
    try {
      await get("/api/usage", { authRedirect: "none" });
      setState((s) => ({
        ...s,
        loading: false,
        authenticated: true,
        authProvider: "clawnet",
        email: "",
        csrf: null,
      }));
      await refreshCredits();
    } catch {
      clearUsageState();
      setState((s) => ({
        ...s,
        loading: false,
        authenticated: false,
        authProvider: "clawnet",
        email: "",
        csrf: null,
      }));
    }
  }, [clearUsageState, refreshCredits]);

  const refreshSession = useCallback(async () => {
    try {
      const session = await getFirstPartySession();
      applyFirstPartySession(session);
      if (session.authenticated) await refreshCredits();
      return;
    } catch (error) {
      if (error instanceof ApiError) {
        if (
          error.status === 404 &&
          error.body?.code === "AUTH_PROVIDER_DISABLED"
        ) {
          await loadClawNetSession();
          return;
        }
        if (error.status === 401) {
          clearUsageState();
          setState((s) => ({
            ...s,
            loading: false,
            authenticated: false,
            authProvider: "firstparty",
            email: "",
            csrf: null,
          }));
          return;
        }
      }

      await loadClawNetSession();
    }
  }, [
    applyFirstPartySession,
    clearUsageState,
    loadClawNetSession,
    refreshCredits,
  ]);

  const login = useCallback(
    async (email: string, password: string) => {
      const result = await loginFirstParty(email, password);
      setState((s) => ({
        ...s,
        loading: false,
        authenticated: true,
        authProvider: "firstparty",
        email: result.user.email,
        csrf: result.csrf,
      }));
      await refreshCredits();
    },
    [refreshCredits],
  );

  const logout = useCallback(async () => {
    if (state.authProvider === "firstparty") {
      try {
        await logoutFirstParty();
      } catch {}
      clearUsageState();
      setState((s) => ({
        ...s,
        loading: false,
        authenticated: false,
        email: "",
        csrf: null,
      }));
      window.location.href = "/login";
      return;
    }

    window.location.href = "/auth/logout";
  }, [clearUsageState, state.authProvider]);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  useEffect(() => {
    if (!state.authenticated) return;
    const interval = setInterval(() => {
      void refreshCredits();
    }, 30_000);
    return () => clearInterval(interval);
  }, [refreshCredits, state.authenticated]);

  const value = useMemo(
    () => ({
      ...state,
      login,
      logout,
      refreshSession,
      refreshCredits,
    }),
    [login, logout, refreshCredits, refreshSession, state],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
