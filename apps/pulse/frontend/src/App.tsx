import { Routes, Route, Navigate } from 'react-router-dom'
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
import Admin from './pages/Admin'

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { loading, authenticated } = useAuth()
  if (loading) return <div className="flex items-center justify-center h-screen bg-surface-0"><div className="text-text-tertiary text-sm">Loading...</div></div>
  if (!authenticated) return <Navigate to="/" replace />
  return <>{children}</>
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
                <Routes>
                  <Route path="/" element={<Navigate to="/chat-setup" replace />} />
                  <Route path="/chat-setup" element={<Chat />} />
                  <Route path="/autopilot" element={<Autopilot />} />
                  <Route path="/create" element={<Create />} />
                  <Route path="/knowledge" element={<Knowledge />} />
                  <Route path="/activity" element={<Activity />} />
                  <Route path="/growth" element={<Growth />} />
                  <Route path="/media" element={<Media />} />
                  <Route path="/brand" element={<BrandIntelligence />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="/admin" element={<Admin />} />
                </Routes>
              </Layout>
            </AuthGuard>
          }
        />
      </Routes>
    </AuthProvider>
  )
}
