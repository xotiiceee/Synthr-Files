import type { Tenant } from "./db.js";
import { getMembership } from "./db.js";
import { resolveHostedTenantRuntimeContext } from "./brand-runtime-context.js";
import type { ExecuteToolActionsOptions } from "./pages/chat-setup.js";
import {
  getAuthProviderName,
  getSessionByToken,
  isFirstPartyAuthEnabled,
  SESSION_COOKIE,
  type AuthProviderName,
} from "./sessions.js";

export interface ResolveChatToolExecutionOptionsInput {
  tenant: Pick<Tenant, "id" | "clawnet_user_id">;
  agentId?: string;
  cookieHeader?: string;
  authProvider?: AuthProviderName;
  now?: Date;
}

function readCookieValue(
  cookieHeader: string | undefined,
  cookieName: string,
): string | null {
  if (!cookieHeader) return null;
  for (const cookie of cookieHeader.split(";")) {
    const [name, ...valueParts] = cookie.trim().split("=");
    if (name !== cookieName) continue;
    const rawValue = valueParts.join("=");
    if (!rawValue) return null;
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }
  return null;
}

export function resolveChatToolExecutionOptions(
  input: ResolveChatToolExecutionOptionsInput,
): ExecuteToolActionsOptions {
  const scope = resolveHostedTenantRuntimeContext({
    tenantId: input.tenant.id,
    agentId: input.agentId,
  });
  const authProvider = input.authProvider ?? getAuthProviderName();

  if (isFirstPartyAuthEnabled(authProvider)) {
    const token = readCookieValue(input.cookieHeader, SESSION_COOKIE.name);
    const session = token
      ? getSessionByToken(token, { now: input.now, touch: false })
      : null;
    const scopedOrgId = scope.orgId;
    const sessionOrgId = session?.org_id || undefined;
    const orgId = scopedOrgId || sessionOrgId;
    const sessionMatchesScope = !scopedOrgId || sessionOrgId === scopedOrgId;
    const membership =
      session && session.org_id && sessionMatchesScope
        ? getMembership(session.org_id, session.user_id)
        : null;

    return {
      policy: membership ? { membership } : { role: "viewer" },
      audit: {
        orgId,
        workspaceId: scope.workspaceId,
        brandId: scope.brandId,
        agentId: scope.selectedAgentId,
        actorId: session?.user_id,
      },
    };
  }

  return {
    policy: { role: "owner" },
    audit: {
      orgId: scope.orgId,
      workspaceId: scope.workspaceId,
      brandId: scope.brandId,
      agentId: scope.selectedAgentId,
      actorId: input.tenant.clawnet_user_id || input.tenant.id,
    },
  };
}
