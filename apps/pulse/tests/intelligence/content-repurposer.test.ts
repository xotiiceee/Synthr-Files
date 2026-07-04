import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  askLLM: vi.fn(),
  getPersonaPrompt: vi.fn(),
  getEnabledPlatforms: vi.fn(),
}))

vi.mock('../../src/core/llm.js', () => ({
  askLLM: mocks.askLLM,
}))

vi.mock('../../src/core/persona.js', () => ({
  getPersonaPrompt: mocks.getPersonaPrompt,
  getEnabledPlatforms: mocks.getEnabledPlatforms,
}))

const { repurposeContent } = await import('../../src/intelligence/content-repurposer.js')

describe('content repurposer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getPersonaPrompt.mockReturnValue('Voice: direct')
    mocks.getEnabledPlatforms.mockReturnValue(['x', 'reddit', 'linkedin'])
  })

  it('limits drafts to explicit target platforms', async () => {
    mocks.askLLM.mockResolvedValue(
      JSON.stringify([
        {
          platform: 'linkedin',
          text: 'LinkedIn draft',
          hashtags: ['#Marketing'],
        },
      ]),
    )

    const result = await repurposeContent('Original post', 'x', {
      targetPlatforms: ['linkedin'],
    })

    expect(result?.versions.map((version) => version.platform)).toEqual(['linkedin'])
    const prompt = mocks.askLLM.mock.calls[0][0] as string
    expect(prompt).toContain('### LINKEDIN')
    expect(prompt).not.toContain('### REDDIT')
    expect(prompt).not.toContain('### X-THREAD')
  })

  it('adds an X thread draft by default when repurposing from X', async () => {
    mocks.getEnabledPlatforms.mockReturnValue(['x', 'linkedin'])
    mocks.askLLM.mockResolvedValue(
      JSON.stringify([
        { platform: 'linkedin', text: 'LinkedIn draft' },
        { platform: 'x-thread', text: '1/ Thread draft' },
      ]),
    )

    const result = await repurposeContent('Original post', 'x')

    expect(result?.versions.map((version) => version.platform)).toEqual(['linkedin', 'x-thread'])
    const prompt = mocks.askLLM.mock.calls[0][0] as string
    expect(prompt).toContain('### LINKEDIN')
    expect(prompt).toContain('### X-THREAD')
  })
})
