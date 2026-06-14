/**
 * X write facade.
 *
 * Separates account-affecting X actions from listening/discovery so hosted
 * Pulse can add safety checks, metering, idempotency, and official-provider
 * policy without rewriting every caller at once.
 */

import crypto from 'node:crypto'

import type { Conversation, PostContent, PostResult } from './base.js'
import { setMediaAltText, uploadMedia, x } from './x.js'
import { xFollow, xUnfollow } from './x-follow.js'

const X_WRITE_USAGE_CONTEXT_KEY = '__pulseUsageEvent'

export interface XWriteUsageContext {
  operationId: string
  metadata?: Record<string, unknown>
}

export type XWriteUsageAction = 'post' | 'reply' | 'like'

export interface XWriteUsageEvent {
  action: XWriteUsageAction
  provider: 'x'
  operationId: string
  postType: PostContent['type'] | 'like'
  postId: string
  replyToPostId?: string
  metadata?: Record<string, unknown>
}

export type XWriteUsageHook = (event: XWriteUsageEvent) => void | Promise<void>

export interface XFollowResult {
  ok: boolean
  error?: string
}

export interface XWriteSafetyEvent {
  action: XWriteUsageAction
  provider: 'x'
  operationId?: string
  postType: PostContent['type'] | 'like'
  replyToPostId?: string
  metadata?: Record<string, unknown>
}

export interface XWriteSafetyFailureEvent extends XWriteSafetyEvent {
  error: string
}

export interface XWriteSafetyDecision {
  allowed: boolean
  reason?: string
}

export type XWriteSafetyHook = (
  event: XWriteSafetyEvent,
) => XWriteSafetyDecision | Promise<XWriteSafetyDecision>

export type XWriteSafetyFailureHook = (
  event: XWriteSafetyFailureEvent,
) => void | Promise<void>

export interface XWriteIdempotencyInput {
  action: XWriteUsageAction
  provider: 'x'
  operationId: string
  postType: PostContent['type'] | 'like'
  contentHash: string
  replyToPostId?: string
  metadata?: Record<string, unknown>
}

export interface XWriteIdempotencyStarted {
  status: 'started'
}

export interface XWriteIdempotencyExistingSuccess {
  status: 'succeeded'
  postId: string
  url?: string
}

export interface XWriteIdempotencyBlocked {
  status: 'blocked'
  reason: string
}

export type XWriteIdempotencyBeginResult =
  | XWriteIdempotencyStarted
  | XWriteIdempotencyExistingSuccess
  | XWriteIdempotencyBlocked

export interface XWriteIdempotencyHook {
  begin(
    input: XWriteIdempotencyInput,
  ): XWriteIdempotencyBeginResult | Promise<XWriteIdempotencyBeginResult>
  succeed(
    input: XWriteIdempotencyInput & { postId: string; url?: string },
  ): void | Promise<void>
  fail(
    input: XWriteIdempotencyInput & { error: string; ambiguous?: boolean },
  ): void | Promise<void>
}

export interface XWriteClient {
  isConfigured(): boolean
  post(content: PostContent): Promise<PostResult>
  reply(conversation: Conversation, text: string): Promise<PostResult>
  like(postId: string, usage?: XWriteUsageContext): Promise<boolean>
  uploadMedia(imageBuffer: Buffer, mimeType?: string): Promise<string | null>
  setMediaAltText(mediaId: string, altText: string): Promise<boolean>
  follow(targetUserId: string): Promise<XFollowResult>
  unfollow(targetUserId: string): Promise<XFollowResult>
}

let usageHook: XWriteUsageHook | null = null
let safetyHook: XWriteSafetyHook | null = null
let safetyFailureHook: XWriteSafetyFailureHook | null = null
let idempotencyHook: XWriteIdempotencyHook | null = null

function readUsageContext(
  metadata: Record<string, unknown> | undefined,
): XWriteUsageContext | null {
  const value = metadata?.[X_WRITE_USAGE_CONTEXT_KEY]
  if (!value || typeof value !== 'object') return null
  const operationId =
    'operationId' in value && typeof value.operationId === 'string'
      ? value.operationId.trim()
      : ''
  if (!operationId) return null
  const contextMetadata =
    'metadata' in value &&
    value.metadata &&
    typeof value.metadata === 'object' &&
    !Array.isArray(value.metadata)
      ? (value.metadata as Record<string, unknown>)
      : undefined
  return { operationId, metadata: contextMetadata }
}

async function emitUsage(event: XWriteUsageEvent): Promise<void> {
  if (!usageHook) return
  try {
    await usageHook(event)
  } catch (err) {
    console.warn(
      `[XWriteClient] Usage hook failed: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

async function checkSafety(
  event: XWriteSafetyEvent,
): Promise<XWriteSafetyDecision> {
  if (!safetyHook) return { allowed: true }
  try {
    return await safetyHook(event)
  } catch (err) {
    return {
      allowed: false,
      reason: `X write safety check failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

async function emitSafetyFailure(
  event: XWriteSafetyFailureEvent,
): Promise<void> {
  if (!safetyFailureHook) return
  try {
    await safetyFailureHook(event)
  } catch (err) {
    console.warn(
      `[XWriteClient] Safety failure hook failed: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

export function setXWriteUsageHook(hook: XWriteUsageHook | null): void {
  usageHook = hook
}

export function setXWriteSafetyHook(hook: XWriteSafetyHook | null): void {
  safetyHook = hook
}

export function setXWriteSafetyFailureHook(
  hook: XWriteSafetyFailureHook | null,
): void {
  safetyFailureHook = hook
}

export function setXWriteIdempotencyHook(
  hook: XWriteIdempotencyHook | null,
): void {
  idempotencyHook = hook
}

export function withXWriteUsage<T extends PostContent | Conversation>(
  value: T,
  usage: XWriteUsageContext,
): T {
  return {
    ...value,
    metadata: {
      ...(value.metadata ?? {}),
      [X_WRITE_USAGE_CONTEXT_KEY]: usage,
    },
  }
}

function stableContentHash(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function buildPostContentHash(content: PostContent): string {
  return stableContentHash({
    type: content.type,
    text: content.text,
    replyTo: content.replyTo,
    mediaIds: content.mediaIds,
  })
}

function buildReplyContentHash(
  conversation: Conversation,
  text: string,
): string {
  return stableContentHash({
    type: 'comment',
    replyTo: conversation.id,
    text,
  })
}

function buildLikeContentHash(postId: string): string {
  return stableContentHash({
    type: 'like',
    target: postId,
  })
}

async function beginIdempotentWrite(
  input: XWriteIdempotencyInput,
): Promise<XWriteIdempotencyBeginResult> {
  if (!idempotencyHook) return { status: 'started' }
  try {
    return await idempotencyHook.begin(input)
  } catch (err) {
    return {
      status: 'blocked',
      reason: `X write idempotency check failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

async function completeIdempotentWrite(
  input: XWriteIdempotencyInput & { postId: string; url?: string },
): Promise<XWriteIdempotencyBlocked | null> {
  if (!idempotencyHook) return null
  try {
    await idempotencyHook.succeed(input)
    return null
  } catch (err) {
    return {
      status: 'blocked',
      reason: `X write idempotency completion failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

async function failIdempotentWrite(
  input: XWriteIdempotencyInput & { error: string; ambiguous?: boolean },
): Promise<void> {
  if (!idempotencyHook) return
  try {
    await idempotencyHook.fail(input)
  } catch (err) {
    console.warn(
      `[XWriteClient] Idempotency failure hook failed: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

class DefaultXWriteClient implements XWriteClient {
  isConfigured(): boolean {
    return x.isConfigured()
  }

  async post(content: PostContent): Promise<PostResult> {
    const usage = readUsageContext(content.metadata)
    const safetyEvent: XWriteSafetyEvent = {
      action: 'post',
      provider: 'x',
      operationId: usage?.operationId,
      postType: content.type,
      replyToPostId: content.replyTo,
      metadata: usage?.metadata ?? content.metadata,
    }
    const safety = await checkSafety(safetyEvent)
    if (!safety.allowed) {
      return {
        ok: false,
        error: safety.reason || 'X write blocked by account safety controls',
      }
    }

    const idempotencyInput: XWriteIdempotencyInput | null = usage
      ? {
          action: 'post',
          provider: 'x',
          operationId: usage.operationId,
          postType: content.type,
          contentHash: buildPostContentHash(content),
          replyToPostId: content.replyTo,
          metadata: usage.metadata ?? content.metadata,
        }
      : null
    if (idempotencyInput) {
      const begin = await beginIdempotentWrite(idempotencyInput)
      if (begin.status === 'succeeded') {
        return { ok: true, postId: begin.postId }
      }
      if (begin.status === 'blocked') {
        return { ok: false, error: begin.reason }
      }
    }

    const result = await x.post(content)
    if (result.ok && result.postId && usage) {
      if (idempotencyInput) {
        const completionFailure = await completeIdempotentWrite({
          ...idempotencyInput,
          postId: result.postId,
        })
        if (completionFailure) {
          return { ok: false, error: completionFailure.reason }
        }
      }
      await emitUsage({
        action: 'post',
        provider: 'x',
        operationId: usage.operationId,
        postType: content.type,
        postId: result.postId,
        replyToPostId: content.replyTo,
        metadata: usage.metadata,
      })
    } else if (!result.ok) {
      if (idempotencyInput) {
        await failIdempotentWrite({
          ...idempotencyInput,
          error: result.error || 'X post failed',
        })
      }
      await emitSafetyFailure({
        ...safetyEvent,
        error: result.error || 'X post failed',
      })
    }
    return result
  }

  async reply(conversation: Conversation, text: string): Promise<PostResult> {
    const usage = readUsageContext(conversation.metadata)
    const safetyEvent: XWriteSafetyEvent = {
      action: 'reply',
      provider: 'x',
      operationId: usage?.operationId,
      postType: 'comment',
      replyToPostId: conversation.id,
      metadata: usage?.metadata ?? conversation.metadata,
    }
    const safety = await checkSafety(safetyEvent)
    if (!safety.allowed) {
      return {
        ok: false,
        error: safety.reason || 'X write blocked by account safety controls',
      }
    }

    const idempotencyInput: XWriteIdempotencyInput | null = usage
      ? {
          action: 'reply',
          provider: 'x',
          operationId: usage.operationId,
          postType: 'comment',
          contentHash: buildReplyContentHash(conversation, text),
          replyToPostId: conversation.id,
          metadata: usage.metadata ?? conversation.metadata,
        }
      : null
    if (idempotencyInput) {
      const begin = await beginIdempotentWrite(idempotencyInput)
      if (begin.status === 'succeeded') {
        return { ok: true, postId: begin.postId }
      }
      if (begin.status === 'blocked') {
        return { ok: false, error: begin.reason }
      }
    }

    const result = await x.reply(conversation, text)
    if (result.ok && result.postId && usage) {
      if (idempotencyInput) {
        const completionFailure = await completeIdempotentWrite({
          ...idempotencyInput,
          postId: result.postId,
        })
        if (completionFailure) {
          return { ok: false, error: completionFailure.reason }
        }
      }
      await emitUsage({
        action: 'reply',
        provider: 'x',
        operationId: usage.operationId,
        postType: 'comment',
        postId: result.postId,
        replyToPostId: conversation.id,
        metadata: usage.metadata,
      })
    } else if (!result.ok) {
      if (idempotencyInput) {
        await failIdempotentWrite({
          ...idempotencyInput,
          error: result.error || 'X reply failed',
        })
      }
      await emitSafetyFailure({
        ...safetyEvent,
        error: result.error || 'X reply failed',
      })
    }
    return result
  }

  async like(postId: string, usage?: XWriteUsageContext): Promise<boolean> {
    const operationId = usage?.operationId.trim()
    const normalizedUsage = operationId
      ? { operationId, metadata: usage?.metadata }
      : null
    const safetyEvent: XWriteSafetyEvent = {
      action: 'like',
      provider: 'x',
      operationId: normalizedUsage?.operationId,
      postType: 'like',
      replyToPostId: postId,
      metadata: normalizedUsage?.metadata,
    }
    const safety = await checkSafety(safetyEvent)
    if (!safety.allowed) return false

    const idempotencyInput: XWriteIdempotencyInput | null = normalizedUsage
      ? {
          action: 'like',
          provider: 'x',
          operationId: normalizedUsage.operationId,
          postType: 'like',
          contentHash: buildLikeContentHash(postId),
          replyToPostId: postId,
          metadata: normalizedUsage.metadata,
        }
      : null
    if (idempotencyInput) {
      const begin = await beginIdempotentWrite(idempotencyInput)
      if (begin.status === 'succeeded') return true
      if (begin.status === 'blocked') return false
    }

    const ok = await x.like(postId)
    if (ok && normalizedUsage) {
      if (idempotencyInput) {
        const completionFailure = await completeIdempotentWrite({
          ...idempotencyInput,
          postId,
        })
        if (completionFailure) return false
      }
      await emitUsage({
        action: 'like',
        provider: 'x',
        operationId: normalizedUsage.operationId,
        postType: 'like',
        postId,
        replyToPostId: postId,
        metadata: normalizedUsage.metadata,
      })
    } else if (!ok) {
      if (idempotencyInput) {
        await failIdempotentWrite({
          ...idempotencyInput,
          error: 'X like failed',
        })
      }
      await emitSafetyFailure({
        ...safetyEvent,
        error: 'X like failed',
      })
    }
    return ok
  }

  uploadMedia(imageBuffer: Buffer, mimeType?: string): Promise<string | null> {
    return uploadMedia(imageBuffer, mimeType)
  }

  setMediaAltText(mediaId: string, altText: string): Promise<boolean> {
    return setMediaAltText(mediaId, altText)
  }

  follow(targetUserId: string): Promise<XFollowResult> {
    return xFollow(targetUserId)
  }

  unfollow(targetUserId: string): Promise<XFollowResult> {
    return xUnfollow(targetUserId)
  }
}

const defaultXWriteClient = new DefaultXWriteClient()

export function getXWriteClient(): XWriteClient {
  return defaultXWriteClient
}
