const BASE = "";

type AuthRedirectMode = "login" | "none";

export interface Projection {
  avgDailySpend: number;
  daysRemaining: number | null;
  burnRate: string;
}

interface ApiOptions extends RequestInit {
  authRedirect?: AuthRedirectMode;
}

interface FirstPartyUser {
  id: string;
  email: string;
  name: string;
}

interface FirstPartySession {
  id: string;
  orgId: string | null;
  expiresAt: string;
  lastSeenAt: string;
}

export interface FirstPartyCsrfBundle {
  token: string;
  hash: string;
}

export interface FirstPartySessionResponse {
  ok: true;
  authenticated: boolean;
  user?: FirstPartyUser;
  session?: FirstPartySession;
  csrf?: FirstPartyCsrfBundle;
}

export interface FirstPartyLoginResponse {
  ok: true;
  user: FirstPartyUser;
  session: FirstPartySession;
  csrf: FirstPartyCsrfBundle;
}

export interface DeployInfoResponse {
  service: string;
  spaReady: boolean;
  deploy: Record<string, unknown> | null;
}

export interface HealthResponse {
  status: string;
  service: string;
  uptime: number;
  timestamp: string;
  spaReady?: boolean;
  deploy?: Record<string, unknown> | null;
}

export interface UiAgentConnectionStatus {
  id: string;
  name: string;
  running: boolean;
  xConnected: boolean | null;
}

export interface UiProductionSurfaceRemote {
  checkedAt: string;
  deployInfo: DeployInfoResponse | null;
  health: HealthResponse | null;
  agents: UiAgentConnectionStatus[];
  githubConnected: boolean | null;
}

export interface UiUsageSnapshot {
  authProvider: "unknown" | "clawnet" | "firstparty";
  credits: number | null;
  spendToday: number;
  spendMonth: number;
  projection: Projection | null;
}

export interface UiProductionReadinessCheck {
  key: string;
  label: string;
  status: "ready" | "info" | "warning" | "critical";
  detail: string;
}

export interface OperationsAuditEvent {
  id: string;
  tenantId: string;
  orgId: string;
  workspaceId: string;
  brandId: string;
  agentId: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface OperationsSafetyEvent {
  id: string;
  tenantId: string;
  orgId: string;
  workspaceId: string;
  brandId: string;
  agentId: string;
  severity: string;
  source: string;
  eventType: string;
  message: string;
  metadata: Record<string, unknown>;
  resolvedAt: string | null;
  createdAt: string;
}

export interface OperationsSummary {
  auditEventCount: number;
  openSafetyEventCount: number;
  criticalSafetyEventCount: number;
  lastAuditAt: string | null;
}

export interface OperationsResponse {
  auditEvents: OperationsAuditEvent[];
  safetyEvents: OperationsSafetyEvent[];
  summary: OperationsSummary;
}

export interface AccountPermissionsResponse {
  role: "owner" | "admin" | "approver" | "operator" | "viewer";
  authProvider: "unknown" | "clawnet" | "firstparty";
  permissions: {
    orgAdmin: boolean;
    billingManage: boolean;
    brandManage: boolean;
    automationConfigure: boolean;
    draftApprove: boolean;
    draftCreate: boolean;
    analyticsRead: boolean;
  };
}

export class ApiError extends Error {
  status: number;
  body: any;

  constructor(status: number, message: string, body: any) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

function coerceDeployTimestamp(deploy: Record<string, unknown> | null): string | null {
  if (!deploy) return null;
  const candidates = [
    deploy.createdAt,
    deploy.updatedAt,
    deploy.timestamp,
    deploy.builtAt,
    deploy.deployedAt,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function coerceDeployLabel(deploy: Record<string, unknown> | null): string | null {
  if (!deploy) return null;
  const candidates = [deploy.version, deploy.commit, deploy.sha, deploy.id];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function shouldJsonEncodeBody(body: BodyInit | null | undefined) {
  return (
    body != null && !(body instanceof FormData) && typeof body !== "string"
  );
}

function isLoginRedirectResponse(res: Response) {
  if (!res.redirected) return false;
  try {
    return new URL(res.url).pathname === "/login";
  } catch {
    return false;
  }
}

async function readErrorBody(res: Response) {
  const text = await res.text().catch(() => "");
  if (!text) return { error: res.statusText };
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

async function request<T = any>(
  path: string,
  options?: ApiOptions,
): Promise<T> {
  const headers = new Headers(options?.headers);
  const body = options?.body;

  if (shouldJsonEncodeBody(body) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${BASE}${path}`, {
    ...options,
    body: shouldJsonEncodeBody(body) ? JSON.stringify(body) : body,
    credentials: "same-origin",
    headers,
  });

  const authRedirect = options?.authRedirect ?? "login";
  if (
    authRedirect === "login" &&
    (res.status === 401 || res.status === 302 || isLoginRedirectResponse(res))
  ) {
    window.location.href = "/login";
    throw new ApiError(res.status || 401, "Unauthorized", {
      error: "Unauthorized",
    });
  }

  if (res.status === 403) {
    const err = await readErrorBody(res);
    if (err.code === "PIN_REQUIRED" || err.code === "PIN_SETUP_REQUIRED") {
      window.location.href =
        err.code === "PIN_SETUP_REQUIRED" ? "/pin/setup" : "/pin";
      throw new ApiError(res.status, "PIN required", err);
    }
    if (!res.ok)
      throw new ApiError(res.status, err.error || res.statusText, err);
  }

  if (!res.ok) {
    const err = await readErrorBody(res);
    throw new ApiError(res.status, err.error || res.statusText, err);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export async function api<T = any>(
  path: string,
  options?: ApiOptions,
): Promise<T> {
  return request<T>(path, options);
}

export const get = <T = any>(path: string, options?: ApiOptions) =>
  api<T>(path, options);
export const post = <T = any>(path: string, body?: any, options?: ApiOptions) =>
  api<T>(path, { ...options, method: "POST", body });
export const patch = <T = any>(
  path: string,
  body?: any,
  options?: ApiOptions,
) => api<T>(path, { ...options, method: "PATCH", body });
export const del = <T = any>(path: string, options?: ApiOptions) =>
  api<T>(path, { ...options, method: "DELETE" });

export const getFirstPartySession = () =>
  get<FirstPartySessionResponse>("/auth/session", { authRedirect: "none" });

export const loginFirstParty = (email: string, password: string) =>
  post<FirstPartyLoginResponse>(
    "/auth/login",
    { email, password },
    { authRedirect: "none" },
  );

export const logoutFirstParty = () =>
  post<{ ok: true; revoked: boolean; sessionId: string | null }>(
    "/auth/logout",
    undefined,
    { authRedirect: "none" },
  );

export const verifyFirstPartyCsrf = (csrf: FirstPartyCsrfBundle) =>
  post<{ ok: true; valid: boolean }>(
    "/auth/csrf/verify",
    {
      csrfToken: csrf.token,
      csrfHash: csrf.hash,
    },
    { authRedirect: "none" },
  );

export const loadOperations = (limit = 50) =>
  get<OperationsResponse>(`/api/operations?limit=${encodeURIComponent(limit)}`);

export const loadAccountPermissions = () =>
  get<AccountPermissionsResponse>("/api/account/permissions");

export async function loadUiProductionSurfaceRemote(): Promise<UiProductionSurfaceRemote> {
  const checkedAt = new Date().toISOString();
  const deployInfoPromise = get<DeployInfoResponse>("/api/deploy-info", {
    authRedirect: "none",
  }).catch(() => null);
  const healthPromise = get<HealthResponse>("/health", {
    authRedirect: "none",
  }).catch(() => null);
  const githubPromise = get<{ connected: boolean }>("/api/integrations/github", {
    authRedirect: "none",
  })
    .then((data) => data.connected)
    .catch(() => null);
  const agentsData = await get<{
    agents?: Array<{ id: string; name: string; running?: boolean }>;
  }>("/api/brands", { authRedirect: "none" }).catch(() => ({ agents: [] }));
  const baseAgents = (agentsData.agents ?? []).map((agent) => ({
    id: agent.id,
    name: agent.name,
    running: Boolean(agent.running),
  }));
  const xStatuses = await Promise.all(
    baseAgents.map((agent) =>
      get<{ configured?: boolean }>(
        `/api/keys/x/status?agentId=${encodeURIComponent(agent.id)}`,
        {
          authRedirect: "none",
        },
      )
        .then((data) => data.configured ?? false)
        .catch(() => null),
    ),
  );
  const [deployInfo, health, githubConnected] = await Promise.all([
    deployInfoPromise,
    healthPromise,
    githubPromise,
  ]);

  return {
    checkedAt,
    deployInfo,
    health,
    githubConnected,
    agents: baseAgents.map((agent, index) => ({
      ...agent,
      xConnected: xStatuses[index] ?? null,
    })),
  };
}

export function buildUiProductionReadiness(
  usage: UiUsageSnapshot,
  remote: UiProductionSurfaceRemote,
): UiProductionReadinessCheck[] {
  const checks: UiProductionReadinessCheck[] = [];
  const credits = usage.credits;
  const projection = usage.projection;
  const connectedAgents = remote.agents.filter((agent) => agent.xConnected).length;
  const missingXAgents = remote.agents.filter((agent) => agent.xConnected === false).length;
  const deployLabel = coerceDeployLabel(remote.deployInfo?.deploy ?? remote.health?.deploy ?? null);
  const deployTimestamp = coerceDeployTimestamp(
    remote.deployInfo?.deploy ?? remote.health?.deploy ?? null,
  );

  if (usage.authProvider === "firstparty") {
    checks.push({
      key: "auth-provider",
      label: "Session Access",
      status: "ready",
      detail: "First-party customer auth is active for this workspace.",
    });
  } else if (usage.authProvider === "clawnet") {
    checks.push({
      key: "auth-provider",
      label: "Session Access",
      status: "info",
      detail: "Workspace is running on legacy ClawNet auth.",
    });
  } else {
    checks.push({
      key: "auth-provider",
      label: "Session Access",
      status: "warning",
      detail: "Auth provider is not yet resolved in the UI session.",
    });
  }

  if (credits == null) {
    checks.push({
      key: "credits",
      label: "Usage Balance",
      status: "warning",
      detail: "Usage balance is unavailable.",
    });
  } else if (credits <= 0) {
    checks.push({
      key: "credits",
      label: "Usage Balance",
      status: "critical",
      detail: `No usage allowance remaining. Spend today ${usage.spendToday}, month ${usage.spendMonth}.`,
    });
  } else if (credits < 10) {
    checks.push({
      key: "credits",
      label: "Usage Balance",
      status: "warning",
      detail: `${credits} usage units remaining. Spend today ${usage.spendToday}, month ${usage.spendMonth}.`,
    });
  } else {
    checks.push({
      key: "credits",
      label: "Usage Balance",
      status: "ready",
      detail: `${credits} usage units remaining. Spend today ${usage.spendToday}, month ${usage.spendMonth}.`,
    });
  }

  if (!projection || projection.daysRemaining == null) {
    checks.push({
      key: "projection",
      label: "Burn Projection",
      status: "info",
      detail: "Not enough spend history yet to project runway.",
    });
  } else if (projection.daysRemaining <= 1) {
    checks.push({
      key: "projection",
      label: "Burn Projection",
      status: "critical",
      detail: `Less than a day of runway at the current ${projection.burnRate} pace.`,
    });
  } else if (projection.daysRemaining <= 3) {
    checks.push({
      key: "projection",
      label: "Burn Projection",
      status: "warning",
      detail: `${projection.daysRemaining} days of runway at the current ${projection.burnRate} pace.`,
    });
  } else {
    checks.push({
      key: "projection",
      label: "Burn Projection",
      status: "ready",
      detail: `${projection.daysRemaining} days of runway at the current ${projection.burnRate} pace.`,
    });
  }

  if (remote.agents.length === 0) {
    checks.push({
      key: "agents",
      label: "Brand Connections",
      status: "warning",
      detail: "No brands are configured yet.",
    });
  } else if (connectedAgents === 0) {
    checks.push({
      key: "agents",
      label: "Brand Connections",
      status: "critical",
      detail: `No X connections are ready across ${remote.agents.length} brand${remote.agents.length === 1 ? "" : "s"}.`,
    });
  } else if (missingXAgents > 0) {
    checks.push({
      key: "agents",
      label: "Brand Connections",
      status: "warning",
      detail: `${connectedAgents}/${remote.agents.length} brand${remote.agents.length === 1 ? "" : "s"} have X connected.`,
    });
  } else {
    checks.push({
      key: "agents",
      label: "Brand Connections",
      status: "ready",
      detail: `All ${remote.agents.length} brand${remote.agents.length === 1 ? "" : "s"} have X connected.`,
    });
  }

  if (remote.agents.length > 1) {
    checks.push({
      key: "multi-brand-ui",
      label: "Multi-Brand Workspace",
      status: "ready",
      detail: `Workspace switcher and brand settings cover ${remote.agents.length} configured brands.`,
    });
  } else if (remote.agents.length === 1) {
    checks.push({
      key: "multi-brand-ui",
      label: "Multi-Brand Workspace",
      status: "info",
      detail: "Workspace switcher and brand settings are available; one brand is configured.",
    });
  } else {
    checks.push({
      key: "multi-brand-ui",
      label: "Multi-Brand Workspace",
      status: "warning",
      detail: "Workspace switcher and brand settings are available, but no brands are configured yet.",
    });
  }

  if (remote.githubConnected == null) {
    checks.push({
      key: "github",
      label: "GitHub Sync",
      status: "info",
      detail: "GitHub integration status is unavailable.",
    });
  } else if (remote.githubConnected) {
    checks.push({
      key: "github",
      label: "GitHub Sync",
      status: "ready",
      detail: "GitHub integration is connected.",
    });
  } else {
    checks.push({
      key: "github",
      label: "GitHub Sync",
      status: "info",
      detail: "GitHub integration is not connected.",
    });
  }

  const deployReady =
    remote.health?.status === "ok" && (remote.deployInfo?.spaReady ?? remote.health?.spaReady) !== false;
  if (deployReady) {
    const deployParts = [
      deployLabel ? `build ${deployLabel}` : null,
      deployTimestamp ? `updated ${new Date(deployTimestamp).toLocaleString()}` : null,
      remote.health?.uptime != null ? `uptime ${remote.health.uptime}s` : null,
    ].filter(Boolean);
    checks.push({
      key: "deploy",
      label: "Deploy Surface",
      status: "ready",
      detail: deployParts.length > 0 ? deployParts.join(" · ") : "Hosted UI bundle is serving normally.",
    });
  } else {
    checks.push({
      key: "deploy",
      label: "Deploy Surface",
      status: "critical",
      detail: "Hosted UI deploy metadata or SPA readiness is unhealthy.",
    });
  }

  checks.push({
    key: "operations-ui",
    label: "Operations Console",
    status: "ready",
    detail: "Tenant-scoped audit and open safety visibility are available in the hosted UI.",
  });

  checks.push({
    key: "client-reporting-ui",
    label: "Client Reporting",
    status: "ready",
    detail: "Client-ready usage, activity, audit, and safety report export is available in the hosted UI.",
  });

  checks.push({
    key: "approval-roles-ui",
    label: "Approval Roles",
    status: "ready",
    detail: "Hosted draft approval controls expose role permissions and fail closed for non-approver roles.",
  });

  return checks;
}
