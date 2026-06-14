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
    if (error.body?.error === "email_already_exists")
      return "An account with this email already exists.";
    if (error.body?.error === "password_too_weak")
      return error.body?.message ?? "Password is too weak.";
    if (error.body?.error === "invalid_email")
      return "Please enter a valid email address.";
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return "Sign-up failed. Please try again.";
}

export default function SignUp() {
  const { loading, authenticated, authProvider } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [verificationToken, setVerificationToken] = useState("");

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
      const res = await fetch("/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name: name || undefined }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new ApiError(res.status, data.error || "Sign-up failed", data);
      }
      setVerificationToken(data.verificationToken);
      setSuccess(
        "Account created. Check your email for a verification link (sent via Resend if configured).",
      );
    } catch (err) {
      setError(toMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div style={shellStyle}>
        <div style={cardStyle}>
          <h1
            style={{
              margin: "0 0 8px",
              color: "var(--text-1)",
              fontSize: 24,
              fontWeight: 700,
            }}
          >
            Check your email
          </h1>
          <p
            style={{
              margin: "0 0 20px",
              color: "var(--text-3)",
              fontSize: 14,
              lineHeight: 1.5,
            }}
          >
            {success}
          </p>
          {verificationToken && (
            <div
              style={{
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid rgba(88, 166, 255, 0.28)",
                background: "rgba(88, 166, 255, 0.08)",
                color: "#58a6ff",
                fontSize: 12,
                marginBottom: 16,
                wordBreak: "break-all",
              }}
            >
              Dev mode:{" "}
              <a
                href={`/auth/verify?token=${verificationToken}`}
                style={{ color: "#79c0ff" }}
              >
                Click here to verify
              </a>
            </div>
          )}
          <Link
            to="/login"
            style={{
              display: "inline-block",
              color: "var(--accent)",
              fontSize: 14,
              textDecoration: "none",
            }}
          >
            Go to sign in
          </Link>
        </div>
      </div>
    );
  }

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
            Create your account
          </h1>
          <p
            style={{
              margin: "8px 0 0",
              color: "var(--text-3)",
              fontSize: 14,
              lineHeight: 1.5,
            }}
          >
            Set up your Pulse workspace in seconds.
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
          <label htmlFor="name" style={labelStyle}>
            Name
          </label>
          <input
            id="name"
            type="text"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={inputStyle}
            placeholder="Your name (optional)"
          />
        </div>

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
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={inputStyle}
            required
            minLength={12}
            placeholder="At least 12 characters"
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
          {submitting ? "Creating account..." : "Create account"}
        </button>

        <p
          style={{
            margin: "16px 0 0",
            color: "var(--text-3)",
            fontSize: 13,
            textAlign: "center",
          }}
        >
          Already have an account?{" "}
          <Link
            to="/login"
            style={{
              color: "var(--accent)",
              textDecoration: "none",
              fontWeight: 500,
            }}
          >
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
