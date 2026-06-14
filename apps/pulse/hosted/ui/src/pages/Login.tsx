import { useState, type CSSProperties, type FormEvent } from "react";
import { Navigate, Link } from "react-router-dom";
import { ApiError } from "../lib/api";
import { useAuth } from "../hooks/useAuth";

const shellStyle: CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
  background: "var(--bg-0)",
};

const cardStyle: CSSProperties = {
  width: "100%",
  maxWidth: 380,
  background: "var(--bg-1)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: 28,
  boxShadow: "0 20px 60px rgba(0,0,0,0.28)",
};

const labelStyle: CSSProperties = {
  display: "block",
  color: "var(--text-2)",
  fontSize: 13,
  fontWeight: 500,
  marginBottom: 8,
};

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "11px 12px",
  background: "var(--bg-0)",
  color: "var(--text-1)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 14,
  outline: "none",
};

function toMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.body?.error === "invalid_credentials")
      return "Incorrect email or password.";
    if (error.body?.error === "password_not_configured")
      return "This account does not have password sign-in enabled yet.";
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return "Sign-in failed. Please try again.";
}

export default function Login() {
  const { loading, authenticated, authProvider, login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-surface-0">
        <div className="text-text-tertiary text-sm">Loading...</div>
      </div>
    );
  }

  if (authenticated) return <Navigate to="/" replace />;

  if (authProvider !== "firstparty") {
    window.location.href = "/login";
    return null;
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await login(email, password);
    } catch (err) {
      setError(toMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={shellStyle}>
      <form style={cardStyle} onSubmit={submit}>
        <div style={{ marginBottom: 22 }}>
          <h1
            style={{
              margin: 0,
              color: "var(--text-1)",
              fontSize: 24,
              fontWeight: 700,
            }}
          >
            Sign in to Pulse
          </h1>
          <p
            style={{
              margin: "8px 0 0",
              color: "var(--text-3)",
              fontSize: 14,
              lineHeight: 1.5,
            }}
          >
            Use your first-party customer account to access the workspace.
          </p>
        </div>

        {error && (
          <div
            style={{
              marginBottom: 16,
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid rgba(239, 68, 68, 0.28)",
              background: "rgba(239, 68, 68, 0.10)",
              color: "#fca5a5",
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        <div style={{ marginBottom: 14 }}>
          <label htmlFor="email" style={labelStyle}>
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={inputStyle}
            required
          />
        </div>

        <div style={{ marginBottom: 18 }}>
          <label htmlFor="password" style={labelStyle}>
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={inputStyle}
            required
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          style={{
            width: "100%",
            height: 42,
            border: 0,
            borderRadius: 8,
            background: "var(--accent)",
            color: "#fff",
            fontSize: 14,
            fontWeight: 600,
            cursor: submitting ? "wait" : "pointer",
            opacity: submitting ? 0.7 : 1,
          }}
        >
          {submitting ? "Signing in..." : "Sign in"}
        </button>

        <p
          style={{
            margin: "16px 0 0",
            color: "var(--text-3)",
            fontSize: 13,
            textAlign: "center",
          }}
        >
          Don't have an account?{" "}
          <Link
            to="/signup"
            style={{
              color: "var(--accent)",
              textDecoration: "none",
              fontWeight: 500,
            }}
          >
            Sign up
          </Link>
        </p>
      </form>
    </div>
  );
}
