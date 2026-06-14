import { getMembership } from './db.js'
import { resolveHostedTenantRuntimeContext } from './brand-runtime-context.js'
import {
  getSessionByToken,
  SESSION_COOKIE,
  type AuthProviderName,
} from './sessions.js'
import { roleCan, type StandaloneRole } from './rbac.js'

export interface AccountPermissions {
  role: StandaloneRole
  authProvider: AuthProviderName
  permissions: {
    orgAdmin: boolean
    billingManage: boolean
    brandManage: boolean
    automationConfigure: boolean
    draftApprove: boolean
    draftCreate: boolean
    analyticsRead: boolean
  }
}

function readCookieValue(
  cookieHeader: string | undefined,
  cookieName: string,
): string | null {
  if (!cookieHeader) return null
  for (const cookie of cookieHeader.split(';')) {
    const [name, ...valueParts] = cookie.trim().split('=')
    if (name !== cookieName) continue
    const rawValue = valueParts.join('=')
    if (!rawValue) return null
    try {
      return decodeURIComponent(rawValue)
    } catch {
      return rawValue
    }
  }
  return null
}

export function resolveAccountPermissions(input: {
  authProvider: AuthProviderName
  cookieHeader?: string
  tenantId?: string
}): AccountPermissions {
  let role: StandaloneRole = 'owner'

  if (input.authProvider === 'firstparty') {
    role = 'viewer'
    const tenantOrgId = input.tenantId
      ? resolveHostedTenantRuntimeContext({ tenantId: input.tenantId }).orgId
      : null
    const token = readCookieValue(input.cookieHeader, SESSION_COOKIE.name)
    const session = token ? getSessionByToken(token) : null
    const membership =
      tenantOrgId && session?.org_id === tenantOrgId && session.user_id
        ? getMembership(session.org_id, session.user_id)
        : null
    if (membership) role = membership.role
  }

  return {
    role,
    authProvider: input.authProvider,
    permissions: {
      orgAdmin: roleCan(role, 'org:admin'),
      billingManage: roleCan(role, 'billing:manage'),
      brandManage: roleCan(role, 'brand:manage'),
      automationConfigure: roleCan(role, 'automation:configure'),
      draftApprove: roleCan(role, 'draft:approve'),
      draftCreate: roleCan(role, 'draft:create'),
      analyticsRead: roleCan(role, 'analytics:read'),
    },
  }
}
