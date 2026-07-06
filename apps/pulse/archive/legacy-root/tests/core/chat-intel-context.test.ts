/**
 * Direct tests for the extracted assembleChatIntelContext.
 * Drives SHIPPED push + assembler (no mocks of core under test, no LLM).
 * Asserts real blocks, numeric meta, and the note string (AC3).
 */
import { describe, it, expect } from 'vitest';
import { pushGitHubToIntelGateway } from '../../hosted/github.js';
import { assembleChatIntelContext } from '../../src/intelligence/chat-intel-context.js';

describe('chat intel context (extracted assembler) - real shipped', () => {
  it('after tenant push returns non-empty knowledgeBlock + numeric meta + intelNote', async () => {
    const tenantId = 'tenant-chat-intel-test-101';
    const snap: any = {
      repoId: 'ci101',
      fullName: 'verif/chat-intel',
      trustMode: 'full',
      generatedAt: new Date().toISOString(),
      summary: 'Chat intel test repo. GitHub sync populates the unified gateway for assembler retrieval.',
      readme: '# Chat Intel Test\nUses assembleChatIntelContext after push to produce blocks and note.',
      files: [{ path: 'src/intel.ts', content: 'export const fromGitHub = "retrieved by assembler";' }],
      metadata: { description: 'test' },
    };

    await pushGitHubToIntelGateway(tenantId, snap);

    const ctx = await assembleChatIntelContext(tenantId, 'tell me about the github sync in chat');

    expect(ctx.knowledgeBlock).toContain('Chat intel test repo');
    expect(ctx.knowledgeMeta).toBeTruthy();
    expect(typeof ctx.knowledgeMeta!.data_cost_usdc).toBe('number');
    expect(ctx.knowledgeMeta!.data_cost_usdc).toBe(0);
    expect(ctx.intelNote).toContain('[used X + GitHub intel, cost $0 (saved $');
    expect(ctx.fullSystemSuffix).toContain('Relevant GitHub/Knowledge context');
  });

  it('empty brand yields empty blocks but defined note (zero cost)', async () => {
    const ctx = await assembleChatIntelContext('no-such-tenant-ever', 'irrelevant query');
    expect(ctx.knowledgeBlock).toBe('');
    expect(ctx.knowledgeMeta).toBeNull();
    // note may be empty when no metas, but object shape is present
    expect(typeof ctx.intelNote).toBe('string');
  });
});
