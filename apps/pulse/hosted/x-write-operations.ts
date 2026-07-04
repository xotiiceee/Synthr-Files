import crypto from 'node:crypto'
import type Database from 'better-sqlite3'

import { getHostedDb } from './db.js'

export type XWriteOperationStatus =
  | 'in_flight'
  | 'succeeded'
  | 'failed'
  | 'ambiguous'

export type XWriteOperationAction = 'post' | 'reply' | 'like'

export interface XWriteOperation {
  id: string
  idempotency_key: string
  tenant_id: string
  org_id: string
  workspace_id: string
  brand_id: string
  agent_id: string
  action: XWriteOperationAction
  provider: string
  operation_id: string
  status: XWriteOperationStatus
  content_hash: string
  target_post_id: string
  post_type: string
  external_post_id: string
  external_url: string
  error: string
  metadata: string
  started_at: string
  completed_at: string | null
  updated_at: string
}

export interface XWriteOperationScope {
  tenantId?: string
  orgId?: string
  workspaceId?: string
  brandId?: string
  agentId?: string
}

export interface BeginXWriteOperationInput extends XWriteOperationScope {
  idempotencyKey: string
  action: XWriteOperationAction
  provider?: string
  operationId: string
  contentHash: string
  targetPostId?: string
  postType?: string
  metadata?: Record<string, unknown>
  now?: Date | string
}

export interface CompleteXWriteOperationInput {
  idempotencyKey: string
  externalPostId: string
  externalUrl?: string
  metadata?: Record<string, unknown>
  now?: Date | string
}

export interface FailXWriteOperationInput {
  idempotencyKey: string
  error: string
  ambiguous?: boolean
  metadata?: Record<string, unknown>
  now?: Date | string
}

export interface XWriteOperationRepository {
  begin(input: BeginXWriteOperationInput): XWriteOperation
  complete(input: CompleteXWriteOperationInput): XWriteOperation
  fail(input: FailXWriteOperationInput): XWriteOperation
  getByIdempotencyKey(idempotencyKey: string): XWriteOperation | null
  markStaleInFlightAmbiguous(input: {
    cutoffIso: string
    now?: Date | string
  }): number
}

function iso(value?: Date | string): string {
  if (!value) return new Date().toISOString()
  return value instanceof Date ? value.toISOString() : value
}

function requireNonBlank(value: string | undefined, field: string): string {
  const trimmed = value?.trim()
  if (!trimmed) throw new Error(`X write operation ${field} is required`)
  return trimmed
}

function optional(value: string | undefined): string {
  return value?.trim() || ''
}

function newOperationId(): string {
  return `xwo_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`
}

function encodeMetadata(metadata?: Record<string, unknown>): string {
  return JSON.stringify(metadata || {})
}

function mergeMetadata(
  current: string,
  next?: Record<string, unknown>,
): string {
  if (!next) return current
  return JSON.stringify({
    ...JSON.parse(current || '{}'),
    ...next,
  })
}

export function initXWriteOperationTables(
  db: Database.Database = getHostedDb(),
): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS x_write_operations (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT UNIQUE NOT NULL,
      tenant_id TEXT NOT NULL DEFAULT '',
      org_id TEXT NOT NULL DEFAULT '',
      workspace_id TEXT NOT NULL DEFAULT '',
      brand_id TEXT NOT NULL DEFAULT '',
      agent_id TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'x',
      operation_id TEXT NOT NULL,
      status TEXT NOT NULL,
      content_hash TEXT NOT NULL DEFAULT '',
      target_post_id TEXT NOT NULL DEFAULT '',
      post_type TEXT NOT NULL DEFAULT '',
      external_post_id TEXT NOT NULL DEFAULT '',
      external_url TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      metadata TEXT NOT NULL DEFAULT '{}',
      started_at TEXT NOT NULL,
      completed_at TEXT,
      updated_at TEXT NOT NULL,
      CHECK(action IN ('post', 'reply', 'like')),
      CHECK(status IN ('in_flight', 'succeeded', 'failed', 'ambiguous'))
    );

    CREATE INDEX IF NOT EXISTS idx_x_write_operations_status_updated
      ON x_write_operations(status, updated_at);

    CREATE INDEX IF NOT EXISTS idx_x_write_operations_scope_started
      ON x_write_operations(tenant_id, brand_id, agent_id, started_at DESC);
  `)
}

export function createXWriteOperationRepository(
  db: Database.Database = getHostedDb(),
): XWriteOperationRepository {
  initXWriteOperationTables(db)

  const getByIdempotencyKey = (
    idempotencyKey: string,
  ): XWriteOperation | null =>
    (db
      .prepare('SELECT * FROM x_write_operations WHERE idempotency_key = ?')
      .get(
        requireNonBlank(idempotencyKey, 'idempotencyKey'),
      ) as XWriteOperation | null) ?? null

  return {
    begin(input) {
      const idempotencyKey = requireNonBlank(
        input.idempotencyKey,
        'idempotencyKey',
      )
      const now = iso(input.now)
      db.prepare(
        `INSERT INTO x_write_operations (
           id, idempotency_key, tenant_id, org_id, workspace_id, brand_id,
           agent_id, action, provider, operation_id, status, content_hash,
           target_post_id, post_type, metadata, started_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'in_flight', ?, ?, ?, ?, ?, ?)
         ON CONFLICT(idempotency_key) DO NOTHING`,
      ).run(
        newOperationId(),
        idempotencyKey,
        optional(input.tenantId),
        optional(input.orgId),
        optional(input.workspaceId),
        optional(input.brandId),
        optional(input.agentId),
        input.action,
        optional(input.provider) || 'x',
        requireNonBlank(input.operationId, 'operationId'),
        requireNonBlank(input.contentHash, 'contentHash'),
        optional(input.targetPostId),
        optional(input.postType),
        encodeMetadata(input.metadata),
        now,
        now,
      )
      return getByIdempotencyKey(idempotencyKey)!
    },

    complete(input) {
      const idempotencyKey = requireNonBlank(
        input.idempotencyKey,
        'idempotencyKey',
      )
      const existing = getByIdempotencyKey(idempotencyKey)
      if (!existing) {
        throw new Error(`X write operation not found: ${idempotencyKey}`)
      }
      const now = iso(input.now)
      db.prepare(
        `UPDATE x_write_operations
            SET status = 'succeeded',
                external_post_id = ?,
                external_url = ?,
                error = '',
                metadata = ?,
                completed_at = ?,
                updated_at = ?
          WHERE idempotency_key = ?`,
      ).run(
        requireNonBlank(input.externalPostId, 'externalPostId'),
        optional(input.externalUrl),
        mergeMetadata(existing.metadata, input.metadata),
        now,
        now,
        idempotencyKey,
      )
      return getByIdempotencyKey(idempotencyKey)!
    },

    fail(input) {
      const idempotencyKey = requireNonBlank(
        input.idempotencyKey,
        'idempotencyKey',
      )
      const existing = getByIdempotencyKey(idempotencyKey)
      if (!existing) {
        throw new Error(`X write operation not found: ${idempotencyKey}`)
      }
      const now = iso(input.now)
      db.prepare(
        `UPDATE x_write_operations
            SET status = ?,
                error = ?,
                metadata = ?,
                completed_at = ?,
                updated_at = ?
          WHERE idempotency_key = ?`,
      ).run(
        input.ambiguous ? 'ambiguous' : 'failed',
        requireNonBlank(input.error, 'error'),
        mergeMetadata(existing.metadata, input.metadata),
        now,
        now,
        idempotencyKey,
      )
      return getByIdempotencyKey(idempotencyKey)!
    },

    getByIdempotencyKey,

    markStaleInFlightAmbiguous(input) {
      const now = iso(input.now)
      const result = db
        .prepare(
          `UPDATE x_write_operations
              SET status = 'ambiguous',
                  error = 'X write operation timed out before completion; reconciliation required',
                  updated_at = ?
            WHERE status = 'in_flight'
              AND updated_at < ?`,
        )
        .run(now, requireNonBlank(input.cutoffIso, 'cutoffIso'))
      return result.changes
    },
  }
}
