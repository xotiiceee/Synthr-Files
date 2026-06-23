import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Download,
  FileText,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import {
  get,
  loadOperations,
  type OperationsAuditEvent,
  type OperationsResponse,
  type OperationsSafetyEvent,
} from "../lib/api";

type Tab = "safety" | "audit";

const panelStyle: CSSProperties = {
  background: "var(--card-bg)",
  border: "1px solid var(--card-border)",
  borderRadius: 8,
};

const badgeBase: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  minHeight: 24,
  padding: "2px 8px",
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 600,
  textTransform: "capitalize",
  whiteSpace: "nowrap",
};

function formatTime(value?: string | null) {
  if (!value) return "No events";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function compactScope(...values: string[]) {
  return values.filter(Boolean).join(" / ") || "Workspace";
}

function metadataPreview(metadata: Record<string, unknown>) {
  const entries = Object.entries(metadata).filter(([, value]) => value != null);
  if (entries.length === 0) return null;
  return entries
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(" · ");
}

function severityBadge(severity: string) {
  const critical = severity === "critical";
  const warning = severity === "warning";
  return (
    <span
      style={{
        ...badgeBase,
        color: critical ? "var(--danger)" : warning ? "#f59e0b" : "var(--accent)",
        background: critical
          ? "rgba(239,68,68,0.1)"
          : warning
            ? "rgba(245,158,11,0.1)"
            : "var(--accent-dim)",
        border: critical
          ? "1px solid rgba(239,68,68,0.2)"
          : warning
            ? "1px solid rgba(245,158,11,0.2)"
            : "1px solid var(--accent-glow)",
      }}
    >
      {critical ? <ShieldAlert size={12} /> : <ShieldCheck size={12} />}
      {severity || "info"}
    </span>
  );
}

function StatPanel({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  tone?: CSSProperties;
}) {
  return (
    <div style={{ ...panelStyle, padding: 18, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ display: "inline-flex", color: tone?.color || "var(--accent)" }}>
          {icon}
        </span>
        <span style={{ fontSize: 12, color: "var(--text-3)", fontWeight: 600 }}>
          {label}
        </span>
      </div>
      <div
        style={{
          fontSize: typeof value === "number" ? 28 : 16,
          fontWeight: 700,
          color: tone?.color || "var(--text-1)",
          lineHeight: 1.1,
          overflowWrap: "anywhere",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function EmptyState({ tab }: { tab: Tab }) {
  return (
    <div
      style={{
        ...panelStyle,
        minHeight: 220,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--text-3)",
        fontSize: 13,
      }}
    >
      {tab === "safety" ? "No open safety events." : "No audit events recorded."}
    </div>
  );
}

function SafetyRow({ event }: { event: OperationsSafetyEvent }) {
  const metadata = metadataPreview(event.metadata);
  return (
    <div
      style={{
        ...panelStyle,
        padding: 16,
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto",
        gap: 16,
        alignItems: "start",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {severityBadge(event.severity)}
          <span style={{ fontSize: 12, color: "var(--text-3)" }}>
            {event.source || "system"} · {formatTime(event.createdAt)}
          </span>
        </div>
        <div
          style={{
            marginTop: 10,
            fontSize: 14,
            fontWeight: 600,
            color: "var(--text-1)",
            overflowWrap: "anywhere",
          }}
        >
          {event.message || event.eventType}
        </div>
        <div
          style={{
            marginTop: 6,
            fontSize: 12,
            color: "var(--text-3)",
            overflowWrap: "anywhere",
          }}
        >
          {compactScope(event.brandId, event.agentId)}
          {metadata ? ` · ${metadata}` : ""}
        </div>
      </div>
      <span
        style={{
          ...badgeBase,
          color: "var(--text-2)",
          background: "var(--bg-2)",
          border: "1px solid var(--border)",
        }}
      >
        {event.eventType}
      </span>
    </div>
  );
}

function AuditRow({ event }: { event: OperationsAuditEvent }) {
  const metadata = metadataPreview(event.metadata);
  return (
    <div
      style={{
        ...panelStyle,
        padding: 16,
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto",
        gap: 16,
        alignItems: "start",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span
            style={{
              ...badgeBase,
              color: "var(--accent)",
              background: "var(--accent-dim)",
              border: "1px solid var(--accent-glow)",
            }}
          >
            <FileText size={12} />
            {event.action}
          </span>
          <span style={{ fontSize: 12, color: "var(--text-3)" }}>
            {formatTime(event.createdAt)}
          </span>
        </div>
        <div
          style={{
            marginTop: 10,
            fontSize: 13,
            color: "var(--text-2)",
            overflowWrap: "anywhere",
          }}
        >
          {compactScope(event.brandId, event.agentId, event.actorId)}
        </div>
        <div
          style={{
            marginTop: 6,
            fontSize: 12,
            color: "var(--text-3)",
            overflowWrap: "anywhere",
          }}
        >
          {[event.targetType, event.targetId].filter(Boolean).join(": ") || "Workspace event"}
          {metadata ? ` · ${metadata}` : ""}
        </div>
      </div>
      <span style={{ fontSize: 11, color: "var(--text-3)", fontFamily: "monospace" }}>
        {event.id}
      </span>
    </div>
  );
}

export default function Operations() {
  const [data, setData] = useState<OperationsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exportingReport, setExportingReport] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("safety");

  const fetchOperations = async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      setData(await loadOperations(75));
    } catch (err: any) {
      setError(err?.message || "Unable to load operations data.");
      setData(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchOperations();
  }, []);

  const exportClientReport = async () => {
    setExportingReport(true);
    try {
      const [operations, usage, activity] = await Promise.all([
        loadOperations(100),
        get("/api/usage"),
        get("/api/activity?period=30d"),
      ]);
      const report = {
        $schema: "pulse-client-report",
        generatedAt: new Date().toISOString(),
        period: "30d",
        operations: {
          summary: operations.summary,
          openSafetyEvents: operations.safetyEvents,
          auditEvents: operations.auditEvents,
        },
        usage,
        activity: {
          stats: (activity as any).stats || null,
          recentActions: ((activity as any).actions || []).slice(0, 25),
        },
      };
      const blob = new Blob([JSON.stringify(report, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pulse-client-report-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setData(operations);
    } catch (err: any) {
      setError(err?.message || "Unable to export client report.");
    } finally {
      setExportingReport(false);
    }
  };

  const summary = data?.summary;
  const visibleEvents = useMemo(
    () => (tab === "safety" ? data?.safetyEvents || [] : data?.auditEvents || []),
    [data, tab],
  );

  return (
    <div
      style={{
        maxWidth: 1120,
        margin: "0 auto",
        padding: "0 24px 40px",
        minHeight: "100%",
        overflowX: "hidden",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          padding: "24px 0 20px",
          borderBottom: "1px solid var(--border-subtle)",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: 8,
              background: "var(--accent-dim)",
              border: "1px solid var(--accent-glow)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <ShieldCheck size={20} style={{ color: "var(--accent)" }} />
          </div>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ fontSize: 20, fontWeight: 600, color: "var(--text-1)", margin: 0 }}>
              Operations
            </h1>
            <p style={{ fontSize: 13, color: "var(--text-3)", margin: 0 }}>
              Audit trail and safety queue
            </p>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button
            onClick={exportClientReport}
            disabled={exportingReport}
            style={{
              height: 36,
              padding: "0 12px",
              borderRadius: 8,
              border: "1px solid var(--accent)",
              background: "var(--accent)",
              color: "#fff",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              cursor: exportingReport ? "default" : "pointer",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {exportingReport ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Download size={15} />
            )}
            Export
          </button>
          <button
            onClick={() => fetchOperations(true)}
            disabled={refreshing}
            style={{
              height: 36,
              padding: "0 12px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--bg-2)",
              color: "var(--text-2)",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              cursor: refreshing ? "default" : "pointer",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {refreshing ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <RefreshCw size={15} />
            )}
            Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ minHeight: 320, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Loader2 size={22} className="animate-spin" style={{ color: "var(--text-3)" }} />
        </div>
      ) : error ? (
        <div style={{ ...panelStyle, marginTop: 24, padding: 18, color: "var(--danger)", fontSize: 13 }}>
          {error}
        </div>
      ) : (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 12,
              marginTop: 24,
            }}
          >
            <StatPanel
              icon={<ShieldAlert size={16} />}
              label="Open Safety"
              value={summary?.openSafetyEventCount ?? 0}
              tone={(summary?.openSafetyEventCount ?? 0) > 0 ? { color: "#f59e0b" } : { color: "var(--accent)" }}
            />
            <StatPanel
              icon={<AlertTriangle size={16} />}
              label="Critical Safety"
              value={summary?.criticalSafetyEventCount ?? 0}
              tone={(summary?.criticalSafetyEventCount ?? 0) > 0 ? { color: "var(--danger)" } : { color: "var(--accent)" }}
            />
            <StatPanel
              icon={<ClipboardList size={16} />}
              label="Audit Events"
              value={summary?.auditEventCount ?? 0}
            />
            <StatPanel
              icon={<CheckCircle2 size={16} />}
              label="Last Audit"
              value={formatTime(summary?.lastAuditAt)}
            />
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              marginTop: 24,
              flexWrap: "wrap",
            }}
          >
            <div
              style={{
                display: "inline-flex",
                padding: 3,
                borderRadius: 8,
                background: "var(--bg-2)",
                border: "1px solid var(--border)",
              }}
            >
              {(["safety", "audit"] as const).map((item) => (
                <button
                  key={item}
                  onClick={() => setTab(item)}
                  style={{
                    height: 32,
                    padding: "0 12px",
                    border: 0,
                    borderRadius: 6,
                    background: tab === item ? "var(--bg-0)" : "transparent",
                    color: tab === item ? "var(--text-1)" : "var(--text-3)",
                    cursor: "pointer",
                    fontSize: 13,
                    fontWeight: 600,
                    textTransform: "capitalize",
                  }}
                >
                  {item}
                </button>
              ))}
            </div>
            <span style={{ fontSize: 12, color: "var(--text-3)" }}>
              Showing {visibleEvents.length} {tab === "safety" ? "open events" : "events"}
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
            {visibleEvents.length === 0 ? (
              <EmptyState tab={tab} />
            ) : tab === "safety" ? (
              (visibleEvents as OperationsSafetyEvent[]).map((event) => (
                <SafetyRow key={event.id} event={event} />
              ))
            ) : (
              (visibleEvents as OperationsAuditEvent[]).map((event) => (
                <AuditRow key={event.id} event={event} />
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
