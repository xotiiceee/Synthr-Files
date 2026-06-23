import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Coins,
  RefreshCw,
  Server,
  ShieldAlert,
} from "lucide-react";
import {
  buildUiProductionReadiness,
  loadUiProductionSurfaceRemote,
  type Projection,
  type UiProductionReadinessCheck,
  type UiProductionSurfaceRemote,
  type UiUsageSnapshot,
} from "../lib/api";

interface ProductionReadinessPanelProps extends UiUsageSnapshot {
  projection: Projection | null;
}

const cardStyle: React.CSSProperties = {
  background: "var(--card-bg)",
  border: "1px solid var(--card-border)",
  borderRadius: 12,
  padding: 24,
};

function statusColors(status: UiProductionReadinessCheck["status"]) {
  switch (status) {
    case "ready":
      return {
        border: "rgba(16,185,129,0.2)",
        background: "rgba(16,185,129,0.08)",
        color: "#10b981",
      };
    case "critical":
      return {
        border: "rgba(239,68,68,0.22)",
        background: "rgba(239,68,68,0.08)",
        color: "var(--danger)",
      };
    case "warning":
      return {
        border: "rgba(245,158,11,0.22)",
        background: "rgba(245,158,11,0.08)",
        color: "#f59e0b",
      };
    default:
      return {
        border: "var(--border)",
        background: "var(--bg-2)",
        color: "var(--text-3)",
      };
  }
}

function statusIcon(status: UiProductionReadinessCheck["status"]) {
  if (status === "ready") return <CheckCircle2 size={14} />;
  if (status === "critical") return <AlertTriangle size={14} />;
  if (status === "warning") return <ShieldAlert size={14} />;
  return <Server size={14} />;
}

export default function ProductionReadinessPanel(
  props: ProductionReadinessPanelProps,
) {
  const [remote, setRemote] = useState<UiProductionSurfaceRemote | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const next = await loadUiProductionSurfaceRemote();
      setRemote(next);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const fallbackRemote = useMemo<UiProductionSurfaceRemote>(
    () => ({
      checkedAt: new Date().toISOString(),
      deployInfo: null,
      health: null,
      agents: [],
      githubConnected: null,
    }),
    [],
  );

  const checks = useMemo(
    () => buildUiProductionReadiness(props, remote ?? fallbackRemote),
    [fallbackRemote, props, remote],
  );

  const counts = useMemo(
    () =>
      checks.reduce(
        (acc, check) => {
          acc[check.status] += 1;
          return acc;
        },
        { ready: 0, info: 0, warning: 0, critical: 0 },
      ),
    [checks],
  );

  return (
    <div style={cardStyle}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
          marginBottom: 18,
        }}
      >
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 6,
            }}
          >
            <Coins size={16} style={{ color: "var(--accent)" }} />
            <span
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: "var(--text-1)",
              }}
            >
              Production Surface
            </span>
          </div>
          <p
            style={{
              fontSize: 12,
              color: "var(--text-3)",
              margin: 0,
              lineHeight: 1.5,
            }}
          >
            Operational snapshot for deploy state, spend visibility, brand
            connections, and current workspace gaps.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            void refresh();
          }}
          disabled={refreshing}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--bg-2)",
            color: "var(--text-2)",
            fontSize: 12,
            fontWeight: 500,
            cursor: refreshing ? "wait" : "pointer",
            opacity: refreshing ? 0.7 : 1,
            flexShrink: 0,
          }}
        >
          <RefreshCw
            size={13}
            style={refreshing ? { animation: "spin 1s linear infinite" } : {}}
          />
          Refresh
        </button>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          marginBottom: 16,
        }}
      >
        <StatusPill label="Ready" value={counts.ready} tone="ready" />
        <StatusPill label="Info" value={counts.info} tone="info" />
        <StatusPill label="Warnings" value={counts.warning} tone="warning" />
        <StatusPill label="Critical" value={counts.critical} tone="critical" />
      </div>

      {loading ? (
        <div style={{ fontSize: 12, color: "var(--text-3)" }}>
          Loading production surface snapshot...
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 12,
          }}
        >
          {checks.map((check) => {
            const colors = statusColors(check.status);
            return (
              <div
                key={check.key}
                style={{
                  border: `1px solid ${colors.border}`,
                  background: colors.background,
                  borderRadius: 10,
                  padding: "14px 16px",
                  minHeight: 110,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 10,
                    color: colors.color,
                  }}
                >
                  {statusIcon(check.status)}
                  <span style={{ fontSize: 13, fontWeight: 600 }}>
                    {check.label}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--text-2)",
                    lineHeight: 1.5,
                  }}
                >
                  {check.detail}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div
        style={{
          marginTop: 14,
          fontSize: 11,
          color: "var(--text-4)",
        }}
      >
        Last checked {remote?.checkedAt ? new Date(remote.checkedAt).toLocaleString() : "just now"}
      </div>
    </div>
  );
}

function StatusPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: UiProductionReadinessCheck["status"];
}) {
  const colors = statusColors(tone);
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 10px",
        borderRadius: 999,
        border: `1px solid ${colors.border}`,
        background: colors.background,
        color: colors.color,
        fontSize: 11,
        fontWeight: 600,
      }}
    >
      {label} {value}
    </div>
  );
}
