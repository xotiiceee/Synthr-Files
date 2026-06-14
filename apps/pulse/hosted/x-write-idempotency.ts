import {
  setXWriteIdempotencyHook,
  type XWriteIdempotencyHook,
  type XWriteIdempotencyInput,
} from '../src/platforms/x-write-client.js'
import { getContextTenantId } from './context.js'
import {
  createXWriteOperationRepository,
  type XWriteOperationRepository,
} from './x-write-operations.js'

function metadataString(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function isSchedulerWrite(input: XWriteIdempotencyInput): boolean {
  const source = metadataString(input.metadata, 'source')
  return (
    input.operationId.startsWith('scheduler:') ||
    source === 'autopost' ||
    source === 'outreach' ||
    source === 'scheduler_mentions'
  )
}

function resolveScope(input: XWriteIdempotencyInput): {
  tenantId?: string
  orgId?: string
  workspaceId?: string
  brandId?: string
  agentId?: string
} {
  const tenantId =
    metadataString(input.metadata, 'tenantId') ?? getContextTenantId()
  const brandId =
    metadataString(input.metadata, 'brandId') ||
    metadataString(input.metadata, 'xAccountId') ||
    tenantId
  return {
    tenantId,
    orgId: metadataString(input.metadata, 'orgId'),
    workspaceId: metadataString(input.metadata, 'workspaceId'),
    brandId,
    agentId: metadataString(input.metadata, 'agentId'),
  }
}

function buildIdempotencyKey(input: XWriteIdempotencyInput): string {
  const tenantId = resolveScope(input).tenantId ?? '_'
  return [
    'x-write-client',
    tenantId,
    input.operationId,
    input.provider,
    input.action,
  ].join(':')
}

export function createHostedXWriteIdempotencyHook(
  repository: XWriteOperationRepository = createXWriteOperationRepository(),
): XWriteIdempotencyHook {
  return {
    begin(input) {
      if (!input.operationId || !isSchedulerWrite(input)) {
        return { status: 'started' }
      }

      const idempotencyKey = buildIdempotencyKey(input)
      const existing = repository.getByIdempotencyKey(idempotencyKey)
      if (existing) {
        if (existing.content_hash !== input.contentHash) {
          return {
            status: 'blocked',
            reason:
              'X write operation idempotency conflict: content hash changed',
          }
        }
        if (existing.status === 'succeeded') {
          return {
            status: 'succeeded',
            postId: existing.external_post_id || existing.target_post_id,
            url: existing.external_url || undefined,
          }
        }
        if (
          existing.status === 'in_flight' ||
          existing.status === 'ambiguous'
        ) {
          return {
            status: 'blocked',
            reason:
              'X write operation is already in-flight or ambiguous; reconciliation required',
          }
        }
        if (existing.status === 'failed') {
          return {
            status: 'blocked',
            reason:
              'X write operation previously failed; manual retry/reconciliation required',
          }
        }
      }

      repository.begin({
        ...resolveScope(input),
        idempotencyKey,
        action: input.action,
        provider: input.provider,
        operationId: input.operationId,
        contentHash: input.contentHash,
        targetPostId: input.replyToPostId,
        postType: input.postType,
        metadata: input.metadata,
      })
      return { status: 'started' }
    },

    succeed(input) {
      if (!input.operationId || !isSchedulerWrite(input)) return
      repository.complete({
        idempotencyKey: buildIdempotencyKey(input),
        externalPostId: input.postId,
        externalUrl: input.url,
        metadata: input.metadata,
      })
    },

    fail(input) {
      if (!input.operationId || !isSchedulerWrite(input)) return
      repository.fail({
        idempotencyKey: buildIdempotencyKey(input),
        error: input.error,
        ambiguous: input.ambiguous,
        metadata: input.metadata,
      })
    },
  }
}

export function installHostedXWriteIdempotencyHooks(): () => void {
  setXWriteIdempotencyHook(createHostedXWriteIdempotencyHook())
  return () => setXWriteIdempotencyHook(null)
}
