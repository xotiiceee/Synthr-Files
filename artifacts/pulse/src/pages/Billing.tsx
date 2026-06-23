import { useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { post as apiPost } from "../lib/api";
import { Check, Zap } from "lucide-react";

const plans = [
  {
    id: "starter",
    name: "Starter",
    price: "$19",
    period: "/month",
    priceId: "starter",
    features: [
      "1 X account",
      "3 posts per day",
      "Basic analytics",
      "Email support",
    ],
    highlighted: false,
  },
  {
    id: "growth",
    name: "Growth",
    price: "$49",
    period: "/month",
    priceId: "growth",
    features: [
      "3 X accounts",
      "15 posts per day",
      "Advanced analytics",
      "Priority support",
      "Auto-engagement",
    ],
    highlighted: true,
  },
  {
    id: "pro",
    name: "Pro",
    price: "$99",
    period: "/month",
    priceId: "pro",
    features: [
      "10 X accounts",
      "50 posts per day",
      "Full analytics suite",
      "Priority support",
      "Auto-engagement",
      "Team collaboration",
    ],
    highlighted: false,
  },
];

export default function Billing() {
  const { credits, spendToday } = useAuth();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState("");

  const subscribe = async (priceId: string) => {
    setLoading(priceId);
    setError("");
    try {
      const res = await apiPost<{ ok: boolean; url?: string; error?: string }>(
        "/api/billing/checkout",
        { priceId },
        { authRedirect: "none" },
      );
      if (res.url) {
        window.location.href = res.url;
      } else {
        setError(res.error || "Failed to start checkout. Is Stripe configured?");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(null);
    }
  };

  const manageSubscription = async () => {
    setLoading("portal");
    setError("");
    try {
      const res = await apiPost<{ ok: boolean; url?: string; error?: string }>(
        "/api/billing/portal",
        {},
        { authRedirect: "none" },
      );
      if (res.url) {
        window.location.href = res.url;
      } else {
        setError(res.error || "Customer portal not available yet.");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(null);
    }
  };

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "40px 24px" }}>
      <div style={{ textAlign: "center", marginBottom: 40 }}>
        <h1
          style={{
            color: "var(--text-1)",
            fontSize: 28,
            fontWeight: 700,
            margin: "0 0 8px",
            letterSpacing: "-0.02em",
          }}
        >
          Plans & Billing
        </h1>
        <p style={{ color: "var(--text-3)", fontSize: 15, margin: 0 }}>
          Choose the right plan for your brand. Upgrade or downgrade anytime.
        </p>
      </div>

      {error && (
        <div
          style={{
            maxWidth: 500,
            margin: "0 auto 24px",
            padding: "12px 16px",
            borderRadius: 10,
            border: "1px solid rgba(239,68,68,0.25)",
            background: "rgba(239,68,68,0.08)",
            color: "#fca5a5",
            fontSize: 13,
            textAlign: "center",
          }}
        >
          {error}
        </div>
      )}

      {(credits != null || spendToday > 0) && (
        <div
          style={{
            maxWidth: 500,
            margin: "0 auto 32px",
            padding: "16px 20px",
            borderRadius: 12,
            border: "1px solid var(--border)",
            background: "var(--bg-2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div style={{ color: "var(--text-3)", fontSize: 12, fontWeight: 500 }}>
              Current Balance
            </div>
            <div style={{ color: "var(--text-1)", fontSize: 20, fontWeight: 700, marginTop: 2 }}>
              {credits != null ? `$${(credits / 100).toFixed(2)}` : "—"}
            </div>
            {credits != null && credits <= 0 && (
              <div style={{ color: "var(--danger)", fontSize: 12, marginTop: 4 }}>
                Out of credits — top up below
              </div>
            )}
          </div>
          <button
            onClick={manageSubscription}
            disabled={loading === "portal"}
            style={{
              padding: "10px 20px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--bg-3)",
              color: "var(--text-2)",
              fontSize: 13,
              fontWeight: 600,
              cursor: loading === "portal" ? "wait" : "pointer",
              fontFamily: "inherit",
              opacity: loading === "portal" ? 0.7 : 1,
            }}
          >
            {loading === "portal" ? "Loading..." : "Manage Subscription"}
          </button>
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 20,
        }}
      >
        {plans.map((plan) => (
          <div
            key={plan.id}
            style={{
              background: plan.highlighted ? "var(--bg-2)" : "var(--bg-1)",
              border: plan.highlighted
                ? "2px solid var(--accent)"
                : "1px solid var(--border)",
              borderRadius: 14,
              padding: "28px 24px",
              display: "flex",
              flexDirection: "column",
              position: "relative",
            }}
          >
            {plan.highlighted && (
              <div
                style={{
                  position: "absolute",
                  top: -12,
                  left: "50%",
                  transform: "translateX(-50%)",
                  background: "var(--accent)",
                  color: "#fff",
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "4px 14px",
                  borderRadius: 20,
                  letterSpacing: "0.04em",
                }}
              >
                POPULAR
              </div>
            )}

            <div style={{ marginBottom: 20 }}>
              <div
                style={{
                  color: "var(--text-1)",
                  fontSize: 18,
                  fontWeight: 700,
                  marginBottom: 8,
                }}
              >
                {plan.name}
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 2 }}>
                <span style={{ color: "var(--text-1)", fontSize: 32, fontWeight: 800 }}>
                  {plan.price}
                </span>
                <span style={{ color: "var(--text-3)", fontSize: 14 }}>
                  {plan.period}
                </span>
              </div>
            </div>

            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: "0 0 24px",
                flex: 1,
              }}
            >
              {plan.features.map((feature) => (
                <li
                  key={feature}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "7px 0",
                    color: "var(--text-2)",
                    fontSize: 13,
                  }}
                >
                  <Check
                    size={15}
                    style={{ color: plan.highlighted ? "var(--accent)" : "#238636", flexShrink: 0 }}
                  />
                  {feature}
                </li>
              ))}
            </ul>

            <button
              onClick={() => subscribe(plan.priceId)}
              disabled={loading === plan.priceId}
              style={{
                width: "100%",
                padding: "12px 0",
                borderRadius: 10,
                border: 0,
                background: plan.highlighted ? "var(--accent)" : "var(--bg-3)",
                color: plan.highlighted ? "#fff" : "var(--text-1)",
                fontSize: 14,
                fontWeight: 700,
                cursor: loading === plan.priceId ? "wait" : "pointer",
                fontFamily: "inherit",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                opacity: loading === plan.priceId ? 0.7 : 1,
              }}
            >
              {loading === plan.priceId ? (
                "Redirecting..."
              ) : (
                <>
                  <Zap size={15} />
                  Subscribe
                </>
              )}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
