import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'

import {
  createXWriteOperationRepository,
  type XWriteOperationRepository,
} from '../../hosted/x-write-operations.js'
import { cleanupSqliteFiles, createTempHostedDbPath } from './temp-db.js'

const dbPaths: string[] = []

afterEach(() => {
  while (dbPaths.length > 0) cleanupSqliteFiles(dbPaths.pop()!)
})

function createTempRepo(): {
  db: Database.Database
  repo: XWriteOperationRepository
} {
  const dbPath = createTempHostedDbPath('pulse-x-write-operations')
  dbPaths.push(dbPath)
  const db = new Database(dbPath)
  return { db, repo: createXWriteOperationRepository(db) }
}

describe('x write operation repository', () => {
  it('persists an in-flight operation before an external X write', () => {
    const { db, repo } = createTempRepo()
    try {
      const operation = repo.begin({
        tenantId: 'tn_xwrite',
        orgId: 'org_xwrite',
        workspaceId: 'ws_xwrite',
        brandId: 'br_xwrite',
        agentId: 'agent_xwrite',
        idempotencyKey: 'x-write-client:tn_xwrite:scheduler_1:x:post',
        action: 'post',
        provider: 'x',
        operationId: 'scheduler_1',
        contentHash: 'hash_post_1',
        postType: 'post',
        metadata: { source: 'autopost' },
        now: '2026-05-26T10:00:00.000Z',
      })

      expect(operation).toMatchObject({
        idempotency_key: 'x-write-client:tn_xwrite:scheduler_1:x:post',
        tenant_id: 'tn_xwrite',
        org_id: 'org_xwrite',
        workspace_id: 'ws_xwrite',
        brand_id: 'br_xwrite',
        agent_id: 'agent_xwrite',
        action: 'post',
        provider: 'x',
        operation_id: 'scheduler_1',
        status: 'in_flight',
        content_hash: 'hash_post_1',
        post_type: 'post',
        started_at: '2026-05-26T10:00:00.000Z',
        updated_at: '2026-05-26T10:00:00.000Z',
      })
      expect(JSON.parse(operation.metadata)).toEqual({ source: 'autopost' })
    } finally {
      db.close()
    }
  })

  it('returns an existing operation for duplicate begins without overwriting it', () => {
    const { db, repo } = createTempRepo()
    try {
      const first = repo.begin({
        idempotencyKey: 'x-write-client:tn_xwrite:scheduler_2:x:reply',
        action: 'reply',
        operationId: 'scheduler_2',
        contentHash: 'hash_reply_1',
        targetPostId: 'root_1',
        postType: 'comment',
        metadata: { source: 'outreach' },
        now: '2026-05-26T10:00:00.000Z',
      })
      const duplicate = repo.begin({
        idempotencyKey: 'x-write-client:tn_xwrite:scheduler_2:x:reply',
        action: 'reply',
        operationId: 'scheduler_2',
        contentHash: 'hash_reply_2',
        targetPostId: 'root_2',
        postType: 'comment',
        metadata: { source: 'changed' },
        now: '2026-05-26T11:00:00.000Z',
      })

      expect(duplicate).toEqual(first)
      expect(duplicate.content_hash).toBe('hash_reply_1')
      expect(duplicate.target_post_id).toBe('root_1')
      expect(JSON.parse(duplicate.metadata)).toEqual({ source: 'outreach' })
    } finally {
      db.close()
    }
  })

  it('records successful external results with merged metadata', () => {
    const { db, repo } = createTempRepo()
    try {
      repo.begin({
        idempotencyKey: 'x-write-client:tn_xwrite:scheduler_3:x:post',
        action: 'post',
        operationId: 'scheduler_3',
        contentHash: 'hash_post_3',
        metadata: { source: 'autopost' },
        now: '2026-05-26T10:00:00.000Z',
      })

      const completed = repo.complete({
        idempotencyKey: 'x-write-client:tn_xwrite:scheduler_3:x:post',
        externalPostId: 'post_3',
        externalUrl: 'https://x.com/i/status/post_3',
        metadata: { queueEntryId: 'entry_3' },
        now: '2026-05-26T10:00:05.000Z',
      })

      expect(completed).toMatchObject({
        status: 'succeeded',
        external_post_id: 'post_3',
        external_url: 'https://x.com/i/status/post_3',
        error: '',
        completed_at: '2026-05-26T10:00:05.000Z',
        updated_at: '2026-05-26T10:00:05.000Z',
      })
      expect(JSON.parse(completed.metadata)).toEqual({
        source: 'autopost',
        queueEntryId: 'entry_3',
      })
    } finally {
      db.close()
    }
  })

  it('records failed and ambiguous outcomes for reconciliation', () => {
    const { db, repo } = createTempRepo()
    try {
      repo.begin({
        idempotencyKey: 'x-write-client:tn_xwrite:scheduler_4:x:like',
        action: 'like',
        operationId: 'scheduler_4',
        contentHash: 'hash_like_4',
        targetPostId: 'target_4',
        now: '2026-05-26T10:00:00.000Z',
      })
      const failed = repo.fail({
        idempotencyKey: 'x-write-client:tn_xwrite:scheduler_4:x:like',
        error: 'X API 429',
        now: '2026-05-26T10:00:02.000Z',
      })

      expect(failed).toMatchObject({
        status: 'failed',
        error: 'X API 429',
        completed_at: '2026-05-26T10:00:02.000Z',
      })

      repo.begin({
        idempotencyKey: 'x-write-client:tn_xwrite:scheduler_5:x:post',
        action: 'post',
        operationId: 'scheduler_5',
        contentHash: 'hash_post_5',
        now: '2026-05-26T09:00:00.000Z',
      })

      expect(
        repo.markStaleInFlightAmbiguous({
          cutoffIso: '2026-05-26T09:30:00.000Z',
          now: '2026-05-26T10:00:00.000Z',
        }),
      ).toBe(1)
      expect(
        repo.getByIdempotencyKey('x-write-client:tn_xwrite:scheduler_5:x:post'),
      ).toMatchObject({
        status: 'ambiguous',
        error:
          'X write operation timed out before completion; reconciliation required',
        completed_at: null,
        updated_at: '2026-05-26T10:00:00.000Z',
      })
    } finally {
      db.close()
    }
  })
})
