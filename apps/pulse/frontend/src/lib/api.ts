const BASE = ''

type AuthRedirectMode = 'login' | 'none'
type AuthTokenProvider = () => Promise<string | null>
type BrandProvider = () => string | null
type UserEmailProvider = () => string | null

let authTokenProvider: AuthTokenProvider | null = null
let brandProvider: BrandProvider | null = null
let userEmailProvider: UserEmailProvider | null = null

export function setAuthTokenProvider(provider: AuthTokenProvider | null) {
  authTokenProvider = provider
}

export function setBrandProvider(provider: BrandProvider | null) {
  brandProvider = provider
}

export function setUserEmailProvider(provider: UserEmailProvider | null) {
  userEmailProvider = provider
}

interface ApiOptions extends RequestInit {
  authRedirect?: AuthRedirectMode
}

export class ApiError extends Error {
  status: number
  body: any

  constructor(status: number, message: string, body: any) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

function shouldJsonEncodeBody(body: BodyInit | null | undefined) {
  return body != null && !(body instanceof FormData) && typeof body !== 'string'
}

function isLoginRedirectResponse(res: Response) {
  if (!res.redirected) return false
  try {
    return new URL(res.url).pathname === '/login'
  } catch {
    return false
  }
}

async function readErrorBody(res: Response) {
  const text = await res.text().catch(() => '')
  if (!text) return { error: res.statusText }
  try {
    return JSON.parse(text)
  } catch {
    return { error: text }
  }
}

async function request<T = any>(path: string, options?: ApiOptions): Promise<T> {
  const headers = new Headers(options?.headers)
  const body = options?.body

  if (!headers.has('Authorization') && authTokenProvider) {
    const token = await authTokenProvider().catch(() => null)
    if (token) headers.set('Authorization', `Bearer ${token}`)
  }
  if (!headers.has('X-Pulse-Workspace') && brandProvider) {
    const brandId = brandProvider()
    if (brandId) headers.set('X-Pulse-Workspace', brandId)
  }
  if (!headers.has('X-Pulse-User-Email') && userEmailProvider) {
    const userEmail = userEmailProvider()
    if (userEmail) headers.set('X-Pulse-User-Email', userEmail)
  }

  if (shouldJsonEncodeBody(body) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const res = await fetch(`${BASE}${path}`, {
    ...options,
    body: shouldJsonEncodeBody(body) ? JSON.stringify(body) : body,
    credentials: 'same-origin',
    headers,
  })

  const authRedirect = options?.authRedirect ?? 'login'
  if (
    authRedirect === 'login' &&
    (res.status === 401 || res.status === 302 || isLoginRedirectResponse(res))
  ) {
    window.location.href = '/'
    throw new ApiError(res.status || 401, 'Unauthorized', {
      error: 'Unauthorized',
    })
  }

  if (!res.ok) {
    const err = await readErrorBody(res)
    throw new ApiError(res.status, err.error || res.statusText, err)
  }

  if (res.status === 204) return undefined as T
  return res.json()
}

export async function api<T = any>(path: string, options?: ApiOptions): Promise<T> {
  return request<T>(path, options)
}

export const get = <T = any>(path: string, options?: ApiOptions) => api<T>(path, options)
export const post = <T = any>(path: string, body?: any, options?: ApiOptions) =>
  api<T>(path, { ...options, method: 'POST', body })
export const patch = <T = any>(path: string, body?: any, options?: ApiOptions) =>
  api<T>(path, { ...options, method: 'PATCH', body })
export const del = <T = any>(path: string, options?: ApiOptions) =>
  api<T>(path, { ...options, method: 'DELETE' })
