import { describe, it, expect, vi, beforeEach } from 'vitest';

// Test the sync + intel push contract: push failure should be observable (no silent success for intel)
import * as github from '../../hosted/github.js';

describe('github sync + intel push contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('pushGitHubToIntelGateway failure is not swallowed (rethrows for caller to observe)', async () => {
    const tenantId = 'test-tenant-intel';
    const snap: any = { repoId: 'r', fullName: 'o/r', trustMode: 'full', generatedAt: new Date().toISOString(), summary: 's', metadata: {} };

    // spy the internal upsert to throw (simulates gateway failure)
    const orig = await import('../../src/core/x-intel-gateway.js');
    const spy = vi.spyOn(orig, 'upsertKnowledgeToGateway').mockImplementation(() => { throw new Error('intel upsert fail'); });

    await expect(github.pushGitHubToIntelGateway(tenantId, snap)).rejects.toThrow('intel upsert fail');

    spy.mockRestore();
  });
});
