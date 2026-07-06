import { Routes, Route, Navigate } from 'react-router-dom'
import { Component, type ReactNode } from 'react'
import { SignIn, SignUp } from '@clerk/react'
import { AuthProvider, useAuth } from './hooks/useAuth'
import Layout from './components/Layout'
import Chat from './pages/Chat'
import Autopilot from './pages/Autopilot'
import Create from './pages/Create'
import Knowledge from './pages/Knowledge'
import Activity from './pages/Activity'
import Settings from './pages/Settings'
import Growth from './pages/Growth'
import BrandIntelligence from './pages/BrandIntelligence'
import Media from './pages/Media'
import Spend from './pages/Spend'
import Admin from './pages/Admin'

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          padding: 32, maxWidth: 600, margin: '40px auto',
          background: 'var(--card-bg)', border: '1px solid var(--danger)',
          borderRadius: 12, textAlign: 'center',
        }}>
          <h2 style={{ color: 'var(--danger)', fontSize: 18, margin: '0 0 12px' }}>Something went wrong</h2>
          <p style={{ color: 'var(--text-2)', fontSize: 14, margin: '0 0 16px', lineHeight: 1.5 }}>
            {this.state.error.message}
          </p>
          <pre style={{
            background: 'var(--bg-2)', padding: 16, borderRadius: 8,
            fontSize: 11, color: 'var(--text-3)', overflowX: 'auto',
            textAlign: 'left', maxHeight: 300, overflowY: 'auto',
          }}>
            {this.state.error.stack}
          </pre>
          <button onClick={() => this.setState({ error: null })} style={{
            marginTop: 16, padding: '8px 20px', borderRadius: 8,
            background: 'var(--accent)', color: '#fff', border: 'none',
            fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          }}>
            Try Again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { loading, authenticated } = useAuth()
  if (loading) return <div className="flex items-center justify-center h-screen bg-surface-0"><div className="text-text-tertiary text-sm">Loading...</div></div>
  if (!authenticated) return <AuthScreen />
  return <>{children}</>
}

function AdminGuard({ children }: { children: React.ReactNode }) {
  const { loading, authenticated, isAdmin } = useAuth()
  if (loading) return <div className="flex items-center justify-center h-screen bg-surface-0"><div className="text-text-tertiary text-sm">Loading...</div></div>
  if (!authenticated) return <AuthScreen />
  if (!isAdmin) return <Navigate to="/chat-setup" replace />
  return <>{children}</>
}

function AuthScreen() {
  const isSignUp = window.location.pathname === '/sign-up'
  return (
    <div style={{
      minHeight: '100vh',
      display: 'grid',
      placeItems: 'center',
      padding: 24,
      background: 'var(--main-bg)',
    }}>
      <div style={{ width: '100%', maxWidth: 440 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            margin: '0 auto 14px',
            background: 'linear-gradient(135deg, var(--accent) 0%, #059669 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontWeight: 800,
            fontSize: 20,
            boxShadow: '0 0 24px var(--accent-glow)',
          }}>P</div>
          <h1 style={{ color: 'var(--text-1)', fontSize: 22, lineHeight: 1.2, marginBottom: 6 }}>Pulse</h1>
          <p style={{ color: 'var(--text-3)', fontSize: 14 }}>Sign in to your brands</p>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          {isSignUp ? (
            <SignUp routing="hash" signInUrl="/" fallbackRedirectUrl="/chat-setup" />
          ) : (
            <SignIn routing="hash" signUpUrl="/sign-up" fallbackRedirectUrl="/chat-setup" />
          )}
        </div>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route
          path="*"
          element={
            <AuthGuard>
              <Layout>
                <ErrorBoundary>
                <Routes>
                  <Route path="/" element={<Navigate to="/chat-setup" replace />} />
                  <Route path="/chat-setup" element={<Chat />} />
                  <Route path="/autopilot" element={<Autopilot />} />
                  <Route path="/create" element={<Create />} />
                  <Route path="/knowledge" element={<Knowledge />} />
                  <Route path="/activity" element={<Activity />} />
                  <Route path="/growth" element={<Growth />} />
                  <Route path="/media" element={<Media />} />
                  <Route path="/spend" element={<Spend />} />
                  <Route path="/brand" element={<BrandIntelligence />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="/admin" element={<AdminGuard><Admin /></AdminGuard>} />
                </Routes>
                </ErrorBoundary>
              </Layout>
            </AuthGuard>
          }
        />
      </Routes>
    </AuthProvider>
  )
}
