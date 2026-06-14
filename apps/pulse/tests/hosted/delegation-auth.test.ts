import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../hosted/db.js', () => ({
  getTenantByApiKey: vi.fn(),
  createTenant: vi.fn(),
  getTenantByEmail: vi.fn(),
}));

import { resolveAgentTenant, delegationAuth } from '../../hosted/delegation-auth.js';
import { getTenantByApiKey, createTenant, getTenantByEmail } from '../../hosted/db.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fakeTenant = {
  id: 'tn_test123',
  api_key: 'cn-test-key-123',
  clawnet_user_id: 'user_123',
  email: 'test@example.com',
  name: 'Test',
  plan: 'credits' as const,
  status: 'active' as const,
  created_at: '2025-01-01',
  updated_at: '2025-01-01',
};

function createMockContext(opts: {
  headers?: Record<string, string>;
  url?: string;
  method?: string;
}) {
  const vars: Record<string, any> = {};
  return {
    req: {
      header: (name: string) => opts.headers?.[name] ?? null,
      url: opts.url ?? 'http://localhost/v1/pulse/post',
      method: opts.method ?? 'POST',
    },
    set: (key: string, value: any) => { vars[key] = value; },
    get: (key: string) => vars[key],
    json: (body: any, status?: number) => ({ _body: body, _status: status }),
    _vars: vars,
  } as any;
}

const mockNext = vi.fn().mockResolvedValue(undefined);

// Minimal fetch response helpers
const okJson = (body: any) => ({ ok: true, json: async () => body });
const notOk = () => ({ ok: false });

// Set up a bearer context with a valid chain + fetchKeyInfo for success-path tests
function setupSuccessfulBearerPath(
  scopeEndpoints: string[] | undefined,
  url = 'http://localhost/v1/pulse/post',
) {
  const c = createMockContext({
    headers: { Authorization: 'Bearer soma-delegation-key' },
    url,
  });
  const chainBody: any = { valid: true };
  if (scopeEndpoints !== undefined) chainBody.scope = { endpoints: scopeEndpoints };
  mockFetch
    .mockResolvedValueOnce(okJson(chainBody))
    .mockResolvedValueOnce(okJson({ userId: 'u1', email: 'test@example.com', active: true }));
  vi.mocked(getTenantByEmail).mockReturnValue(fakeTenant as any);
  return c;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockReset();
  mockNext.mockResolvedValue(undefined);
});

// ─── resolveAgentTenant ───────────────────────────────────────────────────────

describe('resolveAgentTenant', () => {
  it('existing tenant in DB → returns it without fetching', async () => {
    vi.mocked(getTenantByApiKey).mockReturnValue(fakeTenant as any);

    const result = await resolveAgentTenant('cn-test-key');

    expect(result).toBe(fakeTenant);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('not in DB, valid active key → fetches, creates tenant, returns it', async () => {
    vi.mocked(getTenantByApiKey).mockReturnValue(null as any);
    mockFetch.mockResolvedValueOnce(
      okJson({ userId: 'u1', email: 'test@example.com', active: true }),
    );
    vi.mocked(createTenant).mockReturnValue(fakeTenant as any);

    const result = await resolveAgentTenant('cn-test-key');

    expect(result).toBe(fakeTenant);
    expect(mockFetch).toHaveBeenCalledOnce();
    expect(vi.mocked(createTenant)).toHaveBeenCalledWith('cn-test-key', 'u1', 'test@example.com');
  });

  it('not in DB, fetch returns !ok → returns null', async () => {
    vi.mocked(getTenantByApiKey).mockReturnValue(null as any);
    mockFetch.mockResolvedValueOnce(notOk());

    expect(await resolveAgentTenant('cn-bad-key')).toBeNull();
  });

  it('not in DB, inactive key → returns null', async () => {
    vi.mocked(getTenantByApiKey).mockReturnValue(null as any);
    mockFetch.mockResolvedValueOnce(
      okJson({ userId: 'u1', email: 'test@example.com', active: false }),
    );

    expect(await resolveAgentTenant('cn-inactive-key')).toBeNull();
  });

  it('not in DB, fetch throws → returns null', async () => {
    vi.mocked(getTenantByApiKey).mockReturnValue(null as any);
    mockFetch.mockRejectedValueOnce(new Error('network error'));

    expect(await resolveAgentTenant('cn-test-key')).toBeNull();
  });
});

// ─── delegationAuth — root key path ──────────────────────────────────────────

describe('delegationAuth — root key path (X-API-Key: cn-xxx)', () => {
  it('valid cn- key with existing tenant → calls next(), sets agentApiKey + agentTenant', async () => {
    const c = createMockContext({ headers: { 'X-API-Key': 'cn-test-key' } });
    vi.mocked(getTenantByApiKey).mockReturnValue(fakeTenant as any);

    await delegationAuth()(c, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(c._vars.agentApiKey).toBe('cn-test-key');
    expect(c._vars.agentTenant).toBe(fakeTenant);
  });

  it('valid cn- key, no tenant in DB → fetches, creates, calls next()', async () => {
    const c = createMockContext({ headers: { 'X-API-Key': 'cn-test-key' } });
    vi.mocked(getTenantByApiKey).mockReturnValue(null as any);
    mockFetch.mockResolvedValueOnce(
      okJson({ userId: 'u1', email: 'test@example.com', active: true }),
    );
    vi.mocked(createTenant).mockReturnValue(fakeTenant as any);

    await delegationAuth()(c, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(c._vars.agentTenant).toBe(fakeTenant);
  });

  it('invalid cn- key (resolves to null) → 401 INVALID_KEY', async () => {
    const c = createMockContext({ headers: { 'X-API-Key': 'cn-bad-key' } });
    vi.mocked(getTenantByApiKey).mockReturnValue(null as any);
    mockFetch.mockResolvedValueOnce(notOk());

    const result = await delegationAuth()(c, mockNext);

    expect(result).toMatchObject({ _body: { code: 'INVALID_KEY' }, _status: 401 });
    expect(mockNext).not.toHaveBeenCalled();
  });
});

// ─── delegationAuth — delegation key path ────────────────────────────────────

describe('delegationAuth — delegation key path (Authorization: Bearer)', () => {
  it('no auth headers → 401 UNAUTHENTICATED', async () => {
    const c = createMockContext({ headers: {} });
    const result = await delegationAuth()(c, mockNext);
    expect(result).toMatchObject({ _body: { code: 'UNAUTHENTICATED' }, _status: 401 });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('bearer key, chain fetch returns !ok → 401 REVOKED', async () => {
    const c = createMockContext({ headers: { Authorization: 'Bearer soma-key' } });
    mockFetch.mockResolvedValueOnce(notOk());
    const result = await delegationAuth()(c, mockNext);
    expect(result).toMatchObject({ _body: { code: 'REVOKED' }, _status: 401 });
  });

  it('bearer key, chain fetch throws → 502 AUTH_ERROR', async () => {
    const c = createMockContext({ headers: { Authorization: 'Bearer soma-key' } });
    mockFetch.mockRejectedValueOnce(new Error('network failure'));
    const result = await delegationAuth()(c, mockNext);
    expect(result).toMatchObject({ _body: { code: 'AUTH_ERROR' }, _status: 502 });
  });

  it('chain.valid === false, revoked → 401 REVOKED', async () => {
    const c = createMockContext({ headers: { Authorization: 'Bearer soma-key' } });
    mockFetch.mockResolvedValueOnce(okJson({ valid: false, revoked: true }));
    const result = await delegationAuth()(c, mockNext);
    expect(result).toMatchObject({ _body: { code: 'REVOKED' }, _status: 401 });
  });

  it('chain.valid === false, not revoked → 401 EXPIRED', async () => {
    const c = createMockContext({ headers: { Authorization: 'Bearer soma-key' } });
    mockFetch.mockResolvedValueOnce(okJson({ valid: false, revoked: false }));
    const result = await delegationAuth()(c, mockNext);
    expect(result).toMatchObject({ _body: { code: 'EXPIRED' }, _status: 401 });
  });

  it('valid chain but scope mismatch → 403 SCOPE_VIOLATION', async () => {
    const c = createMockContext({
      headers: { Authorization: 'Bearer soma-key' },
      url: 'http://localhost/v1/pulse/reply',
    });
    mockFetch.mockResolvedValueOnce(
      okJson({ valid: true, scope: { endpoints: ['pulse.post'] } }),
    );
    const result = await delegationAuth()(c, mockNext);
    expect(result).toMatchObject({ _body: { code: 'SCOPE_VIOLATION' }, _status: 403 });
  });

  it('valid chain, scope matches, fetchKeyInfo returns null → 401 ACCOUNT_INVALID', async () => {
    const c = createMockContext({ headers: { Authorization: 'Bearer soma-key' } });
    mockFetch
      .mockResolvedValueOnce(okJson({ valid: true, scope: { endpoints: ['pulse.post'] } }))
      .mockResolvedValueOnce(notOk()); // fetchKeyInfo → null
    const result = await delegationAuth()(c, mockNext);
    expect(result).toMatchObject({ _body: { code: 'ACCOUNT_INVALID' }, _status: 401 });
  });

  it('valid chain, key info valid, no root tenant found → 403 ACCOUNT_NOT_FOUND', async () => {
    const c = createMockContext({ headers: { Authorization: 'Bearer soma-key' } });
    mockFetch
      .mockResolvedValueOnce(okJson({ valid: true, scope: { endpoints: ['pulse.post'] } }))
      .mockResolvedValueOnce(okJson({ userId: 'u1', email: 'test@example.com', active: true }));
    vi.mocked(getTenantByEmail).mockReturnValue(null as any);

    const result = await delegationAuth()(c, mockNext);
    expect(result).toMatchObject({ _body: { code: 'ACCOUNT_NOT_FOUND' }, _status: 403 });
  });

  it('full success: valid chain, scope matches, valid info, tenant found → calls next()', async () => {
    const c = setupSuccessfulBearerPath(['pulse.post']);

    await delegationAuth()(c, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(c._vars.agentApiKey).toBe('soma-delegation-key');
    expect(c._vars.agentTenant).toBe(fakeTenant);
  });
});

// ─── Scope matching (tested indirectly via middleware) ────────────────────────

describe('scope matching via delegationAuth middleware', () => {
  it('exact match: ["pulse.post"] allows /v1/pulse/post', async () => {
    const c = setupSuccessfulBearerPath(['pulse.post'], 'http://localhost/v1/pulse/post');
    await delegationAuth()(c, mockNext);
    expect(mockNext).toHaveBeenCalled();
  });

  it('glob: ["pulse.*"] allows /v1/pulse/post', async () => {
    const c = setupSuccessfulBearerPath(['pulse.*'], 'http://localhost/v1/pulse/post');
    await delegationAuth()(c, mockNext);
    expect(mockNext).toHaveBeenCalled();
  });

  it('glob: ["pulse.*"] allows /v1/pulse/reply', async () => {
    const c = setupSuccessfulBearerPath(['pulse.*'], 'http://localhost/v1/pulse/reply');
    await delegationAuth()(c, mockNext);
    expect(mockNext).toHaveBeenCalled();
  });

  it('mismatch: ["pulse.post"] blocks /v1/pulse/reply → 403 SCOPE_VIOLATION', async () => {
    const c = createMockContext({
      headers: { Authorization: 'Bearer soma-delegation-key' },
      url: 'http://localhost/v1/pulse/reply',
    });
    mockFetch.mockResolvedValueOnce(okJson({ valid: true, scope: { endpoints: ['pulse.post'] } }));

    const result = await delegationAuth()(c, mockNext);
    expect(result).toMatchObject({ _body: { code: 'SCOPE_VIOLATION' }, _status: 403 });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('no scope restriction (undefined endpoints) → allows without checking', async () => {
    const c = setupSuccessfulBearerPath(undefined); // no scope in chain
    await delegationAuth()(c, mockNext);
    expect(mockNext).toHaveBeenCalled();
  });
});
