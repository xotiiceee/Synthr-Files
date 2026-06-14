import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'

import { createHostedXWriteIdempotencyHook } from '../../hosted/x-write-idempotency.js'
import { createXWriteOperationRepository } from '../../hosted/x-write-operations.js'
import { cleanupSqliteFiles, createTempHostedDbPath } from './temp-db.js'

const dbPaths: string[] = []

afterEach(() => {
  while (dbPaths.length > 0) cleanupSqliteFiles(dbPaths.pop()!)
})

function createFixture() {
  const dbPath = createTempHostedDbPath('pulse-x-write-idempotency')
  dbPaths.push(dbPath)
  const db = new Database(dbPath)
  const repo = createXWriteOperationRepository(db)
  const hook = createHostedXWriteIdempotencyHook(repo)
  return { db, repo, hook }
}

describe('hosted x write idempotency hook', () => {
  it('records scheduler writes as in-flight and completes them', () => {
    const { db, repo, hook } = createFixture()
    try {
      expect(
        hook.begin({
          action: 'post',
          provider: 'x',
          operationId: 'scheduler:tn_idem:agent_a:content:bucket:entry_1',
          postType: 'post',
          contentHash: 'hash_1',
          metadata: {
            tenantId: 'tn_idem',
            brandId: 'br_idem',
            agentId: 'agent_a',
            source: 'autopost',
          },
        }),
      ).toEqual({ status: 'started' })

      const key =
        'x-write-client:tn_idem:scheduler:tn_idem:agent_a:content:bucket:entry_1:x:post'
      expect(repo.getByIdempotencyKey(key)).toMatchObject({
        status: 'in_flight',
        tenant_id: 'tn_idem',
        brand_id: 'br_idem',
        agent_id: 'agent_a',
        content_hash: 'hash_1',
      })

      hook.succeed({
        action: 'post',
        provider: 'x',
        operationId: 'scheduler:tn_idem:agent_a:content:bucket:entry_1',
        postType: 'post',
        contentHash: 'hash_1',
        postId: 'post_idem_1',
        metadata: {
          tenantId: 'tn_idem',
          brandId: 'br_idem',
          agentId: 'agent_a',
          source: 'autopost',
        },
      })

      expect(repo.getByIdempotencyKey(key)).toMatchObject({
        status: 'succeeded',
        external_post_id: 'post_idem_1',
      })
    } finally {
      db.close()
    }
  })

  it('reuses successful scheduler writes and blocks ambiguous retries', () => {
    const { db, hook } = createFixture()
    try {
      const input = {
        action: 'reply' as const,
        provider: 'x' as const,
        operationId: 'scheduler:tn_idem:agent_a:mentions:bucket:mention_1',
        postType: 'comment' as const,
        contentHash: 'hash_reply',
        replyToPostId: 'root_1',
        metadata: { tenantId: 'tn_idem', source: 'scheduler_mentions' },
      }

      expect(hook.begin(input)).toEqual({ status: 'started' })
      expect(hook.begin(input)).toEqual({
        status: 'blocked',
        reason:
          'X write operation is already in-flight or ambiguous; reconciliation required',
      })

      hook.succeed({ ...input, postId: 'reply_1' })
      expect(hook.begin(input)).toEqual({
        status: 'succeeded',
        postId: 'reply_1',
        url: undefined,
      })
    } finally {
      db.close()
    }
  })

  it('blocks idempotency conflicts and previous failures', () => {
    const { db, hook } = createFixture()
    try {
      const input = {
        action: 'like' as const,
        provider: 'x' as const,
        operationId: 'scheduler:tn_idem:agent_a:outreach:bucket:target_1:like',
        postType: 'like' as const,
        contentHash: 'hash_like',
        replyToPostId: 'target_1',
        metadata: { tenantId: 'tn_idem', source: 'outreach' },
      }

      expect(hook.begin(input)).toEqual({ status: 'started' })
      expect(
        hook.begin({
          ...input,
          contentHash: 'changed_hash',
        }),
      ).toEqual({
        status: 'blocked',
        reason: 'X write operation idempotency conflict: content hash changed',
      })

      hook.fail({ ...input, error: 'X API failed' })
      expect(hook.begin(input)).toEqual({
        status: 'blocked',
        reason:
          'X write operation previously failed; manual retry/reconciliation required',
      })
    } finally {
      db.close()
    }
  })

  it('does not persist non-scheduler manual writes', () => {
    const { db, repo, hook } = createFixture()
    try {
      expect(
        hook.begin({
          action: 'post',
          provider: 'x',
          operationId: 'manual_post_1',
          postType: 'post',
          contentHash: 'hash_manual',
          metadata: { tenantId: 'tn_idem', source: 'composer' },
        }),
      ).toEqual({ status: 'started' })

      expect(
        repo.getByIdempotencyKey('x-write-client:tn_idem:manual_post_1:x:post'),
      ).toBeNull()
    } finally {
      db.close()
    }
  })
})
