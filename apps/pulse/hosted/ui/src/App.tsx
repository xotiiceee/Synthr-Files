import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import Layout from "./components/Layout";
import Chat from "./pages/Chat";
import Autopilot from "./pages/Autopilot";
import Create from "./pages/Create";
import Knowledge from "./pages/Knowledge";
import Activity from "./pages/Activity";
import Settings from "./pages/Settings";
import Growth from "./pages/Growth";
import BrandIntelligence from "./pages/BrandIntelligence";
import Media from "./pages/Media";
import Operations from "./pages/Operations";
import Login from "./pages/Login";
import SignUp from "./pages/SignUp";
import Billing from "./pages/Billing";

export const APP_ROUTE_PATHS = [
  "/",
  "/login",
  "/signup",
  "/chat-setup",
  "/autopilot",
  "/create",
  "/knowledge",
  "/activity",
  "/growth",
  "/media",
  "/operations",
  "/brand",
  "/settings",
  "/billing",
] as const;

function LoadingScreen() {
  return (
    <div className="flex items-center justify-center h-screen bg-surface-0">
      <div className="text-text-tertiary text-sm">Loading...</div>
    </div>
  );
}

function LoginRoute() {
  const { loading, authenticated } = useAuth();

  if (loading) return <LoadingScreen />;
  if (authenticated) return <Navigate to="/chat-setup" replace />;
  return <Login />;
}

function SignUpRoute() {
  const { loading, authenticated } = useAuth();

  if (loading) return <LoadingScreen />;
  if (authenticated) return <Navigate to="/chat-setup" replace />;
  return <SignUp />;
}

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { loading, authenticated, authProvider } = useAuth();

  if (loading) return <LoadingScreen />;
  if (!authenticated) {
    window.location.href =
      authProvider === "firstparty" ? "/login" : "/auth/logout";
    return null;
  }

  return <>{children}</>;
}

function AppRoutes() {
  const location = useLocation();

  if (location.pathname === "/login") return <LoginRoute />;
  if (location.pathname === "/signup") return <SignUpRoute />;

  return (
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
          <Route path="/operations" element={<Operations />} />
          <Route path="/brand" element={<BrandIntelligence />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/billing" element={<Billing />} />
        </Routes>
      </Layout>
    </AuthGuard>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
