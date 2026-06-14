import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  reply: vi.fn(),
  like: vi.fn(),
  uploadMedia: vi.fn(),
  setMediaAltText: vi.fn(),
  xFollow: vi.fn(),
  xUnfollow: vi.fn(),
  isConfigured: vi.fn(),
}))

vi.mock('../../src/platforms/x.js', () => ({
  x: {
    isConfigured: mocks.isConfigured,
    post: mocks.post,
    reply: mocks.reply,
    like: mocks.like,
  },
  uploadMedia: mocks.uploadMedia,
  setMediaAltText: mocks.setMediaAltText,
}))

vi.mock('../../src/platforms/x-follow.js', () => ({
  xFollow: mocks.xFollow,
  xUnfollow: mocks.xUnfollow,
}))

import {
  getXWriteClient,
  setXWriteIdempotencyHook,
  setXWriteSafetyFailureHook,
  setXWriteSafetyHook,
  setXWriteUsageHook,
  withXWriteUsage,
} from '../../src/platforms/x-write-client.js'
import type { Conversation, PostContent } from '../../src/platforms/base.js'

describe('XWriteClient default facade', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setXWriteUsageHook(null)
    setXWriteSafetyHook(null)
    setXWriteSafetyFailureHook(null)
    setXWriteIdempotencyHook(null)
  })

  it('delegates original posts to the existing X platform implementation', async () => {
    const content: PostContent = { text: 'hello', type: 'post' }
    mocks.post.mockResolvedValue({ ok: true, postId: '123' })

    await expect(getXWriteClient().post(content)).resolves.toEqual({
      ok: true,
      postId: '123',
    })
    expect(mocks.post).toHaveBeenCalledWith(content)
  })

  it('emits post usage only when an explicit operationId is attached', async () => {
    const usageHook = vi.fn()
    setXWriteUsageHook(usageHook)
    mocks.post.mockResolvedValue({ ok: true, postId: '123' })

    await getXWriteClient().post({ text: 'hello', type: 'post' })
    expect(usageHook).not.toHaveBeenCalled()

    await getXWriteClient().post(
      withXWriteUsage(
        { text: 'hello', type: 'post' },
        {
          operationId: 'xwrite_req_1',
          metadata: { route: 'composer' },
        },
      ),
    )

    expect(usageHook).toHaveBeenCalledOnce()
    expect(usageHook).toHaveBeenCalledWith({
      action: 'post',
      provider: 'x',
      operationId: 'xwrite_req_1',
      postType: 'post',
      postId: '123',
      replyToPostId: undefined,
      metadata: { route: 'composer' },
    })
  })

  it('blocks posts before calling X when the safety hook denies the write', async () => {
    setXWriteSafetyHook(() => ({
      allowed: false,
      reason: 'brand paused',
    }))

    await expect(
      getXWriteClient().post({ text: 'hello', type: 'post' }),
    ).resolves.toEqual({
      ok: false,
      error: 'brand paused',
    })
    expect(mocks.post).not.toHaveBeenCalled()
  })

  it('checks idempotency before external posts and completes before usage emission', async () => {
    const calls: string[] = []
    const usageHook = vi.fn(() => calls.push('usage'))
    const idempotencyHook = {
      begin: vi.fn(() => {
        calls.push('begin')
        return { status: 'started' as const }
      }),
      succeed: vi.fn(() => {
        calls.push('succeed')
      }),
      fail: vi.fn(),
    }
    setXWriteUsageHook(usageHook)
    setXWriteIdempotencyHook(idempotencyHook)
    mocks.post.mockImplementation(async () => {
      calls.push('post')
      return { ok: true, postId: 'post_idem_1' }
    })

    await expect(
      getXWriteClient().post(
        withXWriteUsage(
          { text: 'hello', type: 'post' },
          { operationId: 'xwrite_idem_1', metadata: { source: 'autopost' } },
        ),
      ),
    ).resolves.toEqual({ ok: true, postId: 'post_idem_1' })

    expect(calls).toEqual(['begin', 'post', 'succeed', 'usage'])
    expect(idempotencyHook.begin).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'post',
        provider: 'x',
        operationId: 'xwrite_idem_1',
        postType: 'post',
        metadata: { source: 'autopost' },
      }),
    )
    expect(idempotencyHook.succeed).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: 'xwrite_idem_1',
        postId: 'post_idem_1',
      }),
    )
  })

  it('short-circuits posts when idempotency has an existing success', async () => {
    setXWriteIdempotencyHook({
      begin: vi.fn(() => ({ status: 'succeeded', postId: 'existing_post' })),
      succeed: vi.fn(),
      fail: vi.fn(),
    })

    await expect(
      getXWriteClient().post(
        withXWriteUsage(
          { text: 'hello', type: 'post' },
          { operationId: 'xwrite_existing_1' },
        ),
      ),
    ).resolves.toEqual({ ok: true, postId: 'existing_post' })

    expect(mocks.post).not.toHaveBeenCalled()
  })

  it('blocks posts when idempotency reports an ambiguous operation', async () => {
    setXWriteIdempotencyHook({
      begin: vi.fn(() => ({
        status: 'blocked',
        reason: 'reconciliation required',
      })),
      succeed: vi.fn(),
      fail: vi.fn(),
    })

    await expect(
      getXWriteClient().post(
        withXWriteUsage(
          { text: 'hello', type: 'post' },
          { operationId: 'xwrite_ambiguous_1' },
        ),
      ),
    ).resolves.toEqual({
      ok: false,
      error: 'reconciliation required',
    })
    expect(mocks.post).not.toHaveBeenCalled()
  })

  it('records idempotency failures for failed external posts', async () => {
    const idempotencyHook = {
      begin: vi.fn(() => ({ status: 'started' as const })),
      succeed: vi.fn(),
      fail: vi.fn(),
    }
    setXWriteIdempotencyHook(idempotencyHook)
    mocks.post.mockResolvedValue({ ok: false, error: 'X API failed' })

    await getXWriteClient().post(
      withXWriteUsage(
        { text: 'hello', type: 'post' },
        { operationId: 'xwrite_fail_idem_1' },
      ),
    )

    expect(idempotencyHook.fail).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'post',
        operationId: 'xwrite_fail_idem_1',
        error: 'X API failed',
      }),
    )
  })

  it('reports failed X writes to the safety failure hook', async () => {
    const safetyFailureHook = vi.fn()
    setXWriteSafetyFailureHook(safetyFailureHook)
    mocks.post.mockResolvedValue({
      ok: false,
      error: 'X API 429: too many requests',
    })

    await getXWriteClient().post(
      withXWriteUsage(
        { text: 'hello', type: 'post' },
        { operationId: 'xwrite_fail_1', metadata: { brandId: 'brand_a' } },
      ),
    )

    expect(safetyFailureHook).toHaveBeenCalledWith({
      action: 'post',
      provider: 'x',
      operationId: 'xwrite_fail_1',
      postType: 'post',
      replyToPostId: undefined,
      metadata: { brandId: 'brand_a' },
      error: 'X API 429: too many requests',
    })
  })

  it('delegates connection checks to the existing X platform implementation', () => {
    mocks.isConfigured.mockReturnValue(true)

    expect(getXWriteClient().isConfigured()).toBe(true)
    expect(mocks.isConfigured).toHaveBeenCalled()
  })

  it('delegates replies to the existing X platform implementation', async () => {
    const conversation: Conversation = {
      id: 'root',
      platform: 'x',
      url: 'https://x.com/i/status/root',
      text: 'root post',
      author: 'founder',
      topicId: 't1',
      createdAt: '2026-05-26T00:00:00.000Z',
      engagement: { likes: 0, replies: 0, reposts: 0 },
    }
    mocks.reply.mockResolvedValue({ ok: true, postId: 'reply' })

    await expect(
      getXWriteClient().reply(conversation, 'useful reply'),
    ).resolves.toEqual({
      ok: true,
      postId: 'reply',
    })
    expect(mocks.reply).toHaveBeenCalledWith(conversation, 'useful reply')
  })

  it('emits reply usage from explicitly tagged conversations', async () => {
    const usageHook = vi.fn()
    setXWriteUsageHook(usageHook)
    const conversation: Conversation = withXWriteUsage(
      {
        id: 'root',
        platform: 'x',
        url: 'https://x.com/i/status/root',
        text: 'root post',
        author: 'founder',
        topicId: 't1',
        createdAt: '2026-05-26T00:00:00.000Z',
        engagement: { likes: 0, replies: 0, reposts: 0 },
      },
      {
        operationId: 'reply_req_1',
        metadata: { route: 'mentions' },
      },
    )
    mocks.reply.mockResolvedValue({ ok: true, postId: 'reply' })

    await getXWriteClient().reply(conversation, 'useful reply')

    expect(usageHook).toHaveBeenCalledWith({
      action: 'reply',
      provider: 'x',
      operationId: 'reply_req_1',
      postType: 'comment',
      postId: 'reply',
      replyToPostId: 'root',
      metadata: { route: 'mentions' },
    })
  })

  it('routes likes through safety and usage hooks when operation metadata is present', async () => {
    const usageHook = vi.fn()
    const safetyHook = vi.fn(() => ({ allowed: true }))
    setXWriteUsageHook(usageHook)
    setXWriteSafetyHook(safetyHook)
    mocks.like.mockResolvedValue(true)

    await expect(
      getXWriteClient().like('post-1', {
        operationId: 'like_req_1',
        metadata: { route: 'outreach' },
      }),
    ).resolves.toBe(true)

    expect(safetyHook).toHaveBeenCalledWith({
      action: 'like',
      provider: 'x',
      operationId: 'like_req_1',
      postType: 'like',
      replyToPostId: 'post-1',
      metadata: { route: 'outreach' },
    })
    expect(usageHook).toHaveBeenCalledWith({
      action: 'like',
      provider: 'x',
      operationId: 'like_req_1',
      postType: 'like',
      postId: 'post-1',
      replyToPostId: 'post-1',
      metadata: { route: 'outreach' },
    })
  })

  it('blocks likes before calling X when the safety hook denies the write', async () => {
    setXWriteSafetyHook(() => ({
      allowed: false,
      reason: 'brand paused',
    }))

    await expect(
      getXWriteClient().like('post-1', { operationId: 'like_req_2' }),
    ).resolves.toBe(false)
    expect(mocks.like).not.toHaveBeenCalled()
  })

  it('delegates like, media, alt text, follow, and unfollow actions', async () => {
    const image = Buffer.from('image')
    mocks.like.mockResolvedValue(true)
    mocks.uploadMedia.mockResolvedValue('media-1')
    mocks.setMediaAltText.mockResolvedValue(true)
    mocks.xFollow.mockResolvedValue({ ok: true })
    mocks.xUnfollow.mockResolvedValue({ ok: true })

    await expect(getXWriteClient().like('post-1')).resolves.toBe(true)
    await expect(
      getXWriteClient().uploadMedia(image, 'image/png'),
    ).resolves.toBe('media-1')
    await expect(
      getXWriteClient().setMediaAltText('media-1', 'Alt text'),
    ).resolves.toBe(true)
    await expect(getXWriteClient().follow('user-1')).resolves.toEqual({
      ok: true,
    })
    await expect(getXWriteClient().unfollow('user-1')).resolves.toEqual({
      ok: true,
    })

    expect(mocks.like).toHaveBeenCalledWith('post-1')
    expect(mocks.uploadMedia).toHaveBeenCalledWith(image, 'image/png')
    expect(mocks.setMediaAltText).toHaveBeenCalledWith('media-1', 'Alt text')
    expect(mocks.xFollow).toHaveBeenCalledWith('user-1')
    expect(mocks.xUnfollow).toHaveBeenCalledWith('user-1')
  })
})
