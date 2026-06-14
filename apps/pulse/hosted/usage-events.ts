import { recordUsageEvent, type UsageEvent } from "./db.js";
import {
  setLLMUsageHook,
  type LLMCallType,
  type LLMUsageEvent,
  type LLMUsageHook,
} from "../src/core/llm-provider.js";
import {
  setImageUsageHook,
  type ImageUsageEvent,
  type ImageUsageHook,
} from "../src/intelligence/image-provider.js";
import {
  setListeningUsageHook,
  type ListeningUsageAction,
  type ListeningUsageEvent,
  type ListeningUsageHook,
} from "../src/core/listening.js";
import {
  setXWriteUsageHook,
  type XWriteUsageAction,
  type XWriteUsageEvent,
  type XWriteUsageHook,
} from "../src/platforms/x-write-client.js";
import type { Job } from "./jobs.js";

export interface UsageEventScope {
  tenantId?: string;
  orgId?: string;
  workspaceId?: string;
  brandId?: string;
  agentId?: string;
  actorId?: string;
}

type Metadata = Record<string, unknown>;
type ValueOrFactory<T, V> = V | ((event: T) => V);

export interface RecordLLMUsageEventInput {
  scope: UsageEventScope;
  idempotencyKey: string;
  event: LLMUsageEvent;
  metadata?: Metadata;
}

export interface RecordImageUsageEventInput {
  scope: UsageEventScope;
  idempotencyKey: string;
  event: ImageUsageEvent;
  metadata?: Metadata;
}

export interface RecordListeningUsageEventInput {
  scope: UsageEventScope;
  idempotencyKey: string;
  event: ListeningUsageEvent;
  metadata?: Metadata;
}

export interface RecordXWriteUsageEventInput {
  scope: UsageEventScope;
  idempotencyKey: string;
  event: XWriteUsageEvent;
  metadata?: Metadata;
}

export interface SchedulerMonitorUsageCounts {
  mentions: number;
  competitorMentions: number;
  alerts: number;
}

export interface RecordSchedulerMonitorUsageEventInput {
  job: Pick<
    Job,
    | "idempotency_key"
    | "tenant_id"
    | "org_id"
    | "workspace_id"
    | "brand_id"
    | "agent_id"
  >;
  task: string;
  runAtBucket: string;
  counts: SchedulerMonitorUsageCounts;
  durationMs?: number;
}

export interface LLMUsageHookOptions {
  scope: ValueOrFactory<LLMUsageEvent, UsageEventScope>;
  idempotencyKey: ValueOrFactory<LLMUsageEvent, string>;
  metadata?: ValueOrFactory<LLMUsageEvent, Metadata | undefined>;
}

export interface ImageUsageHookOptions {
  scope: ValueOrFactory<ImageUsageEvent, UsageEventScope>;
  idempotencyKey: ValueOrFactory<ImageUsageEvent, string>;
  metadata?: ValueOrFactory<ImageUsageEvent, Metadata | undefined>;
}

export interface ListeningUsageHookOptions {
  scope: ValueOrFactory<ListeningUsageEvent, UsageEventScope>;
  idempotencyKey: ValueOrFactory<ListeningUsageEvent, string>;
  metadata?: ValueOrFactory<ListeningUsageEvent, Metadata | undefined>;
}

export interface XWriteUsageHookOptions {
  scope: ValueOrFactory<XWriteUsageEvent, UsageEventScope>;
  idempotencyKey: ValueOrFactory<XWriteUsageEvent, string>;
  metadata?: ValueOrFactory<XWriteUsageEvent, Metadata | undefined>;
}

export interface UsageHookInstallOptions {
  llm?: LLMUsageHookOptions;
  image?: ImageUsageHookOptions;
  listening?: ListeningUsageHookOptions;
  xWrite?: XWriteUsageHookOptions;
}

function resolveValue<T, V>(value: ValueOrFactory<T, V>, event: T): V {
  return typeof value === "function"
    ? (value as (event: T) => V)(event)
    : value;
}

function requireIdempotencyKey(idempotencyKey: string): string {
  if (!idempotencyKey.trim()) {
    throw new Error("Usage event idempotencyKey is required");
  }
  return idempotencyKey;
}

function warnUsageHookFailure(
  kind: "LLM" | "Image" | "Listening" | "XWrite",
  err: unknown,
): void {
  console.warn(
    `[UsageEvents] ${kind} usage hook failed: ${
      err instanceof Error ? err.message : String(err)
    }`,
  );
}

// --- Idempotency key helpers ---

export interface LLMIdempotencyKeyParams {
  scope: UsageEventScope;
  operationId: string;
  provider: string;
  model: string;
  callType: LLMCallType;
}

export interface ImageIdempotencyKeyParams {
  scope: UsageEventScope;
  operationId: string;
  provider: string;
  model: string;
}

export interface ListeningIdempotencyKeyParams {
  scope: UsageEventScope;
  operationId: string;
  provider: string;
  action: ListeningUsageAction;
}

export interface XWriteIdempotencyKeyParams {
  scope: UsageEventScope;
  operationId: string;
  provider: string;
  action: XWriteUsageAction;
}

export interface SchedulerMonitorUsageIdempotencyKeyParams {
  schedulerJobIdempotencyKey: string;
}

export interface SchedulerTaskUsageIdempotencyKeyParams {
  tenantId: string;
  agentId: string;
  task: string;
  runAtBucket: string;
}

export interface RecordSchedulerTaskUsageEventInput {
  scope: UsageEventScope;
  task: string;
  runAtBucket: string;
  quantity?: number;
  metadata?: Metadata;
}

/**
 * Builds a stable, human-readable idempotency key for an LLM usage event.
 * Format: llm-provider:{tenantId|_}:{operationId}:{provider}:{model}:{callType}
 */
export function buildLLMIdempotencyKey({
  scope,
  operationId,
  provider,
  model,
  callType,
}: LLMIdempotencyKeyParams): string {
  return [
    "llm-provider",
    scope.tenantId ?? "_",
    operationId,
    provider,
    model,
    callType,
  ].join(":");
}

/**
 * Builds a stable, human-readable idempotency key for an image usage event.
 * Format: image-provider:{tenantId|_}:{operationId}:{provider}:{model}
 */
export function buildImageIdempotencyKey({
  scope,
  operationId,
  provider,
  model,
}: ImageIdempotencyKeyParams): string {
  return [
    "image-provider",
    scope.tenantId ?? "_",
    operationId,
    provider,
    model,
  ].join(":");
}

export function buildListeningIdempotencyKey({
  scope,
  operationId,
  provider,
  action,
}: ListeningIdempotencyKeyParams): string {
  return [
    "listening-provider",
    scope.tenantId ?? "_",
    operationId,
    provider,
    action,
  ].join(":");
}

export function buildXWriteIdempotencyKey({
  scope,
  operationId,
  provider,
  action,
}: XWriteIdempotencyKeyParams): string {
  return [
    "x-write-client",
    scope.tenantId ?? "_",
    operationId,
    provider,
    action,
  ].join(":");
}

export function buildSchedulerMonitorUsageIdempotencyKey({
  schedulerJobIdempotencyKey,
}: SchedulerMonitorUsageIdempotencyKeyParams): string {
  return `scheduler-usage:${requireIdempotencyKey(schedulerJobIdempotencyKey)}`;
}

export function buildSchedulerTaskUsageIdempotencyKey({
  tenantId,
  agentId,
  task,
  runAtBucket,
}: SchedulerTaskUsageIdempotencyKeyParams): string {
  return [
    "scheduler-usage",
    "legacy",
    tenantId || "_",
    agentId || "_",
    task,
    runAtBucket,
  ].join(":");
}

// --- Metadata helpers ---

/**
 * Builds the standard metadata object for an LLM usage event, merging any
 * caller-supplied extra fields. Mirrors what recordLLMUsageEvent persists.
 */
export function buildLLMMetadata(
  event: LLMUsageEvent,
  extra?: Metadata,
): Metadata {
  return {
    callType: event.callType,
    inputTokens: event.usage.inputTokens,
    outputTokens: event.usage.outputTokens,
    ...extra,
  };
}

/**
 * Builds the standard metadata object for an image usage event, merging any
 * caller-supplied extra fields. Mirrors what recordImageUsageEvent persists.
 */
export function buildImageMetadata(
  event: ImageUsageEvent,
  extra?: Metadata,
): Metadata {
  return {
    creditsUsed: event.creditsUsed,
    ...extra,
  };
}

export function buildListeningMetadata(
  event: ListeningUsageEvent,
  extra?: Metadata,
): Metadata {
  return {
    action: event.action,
    operationId: event.operationId,
    creditsUsed: event.creditsUsed,
    resultCount: event.resultCount,
    ...(event.query ? { query: event.query } : {}),
    ...(event.username ? { username: event.username } : {}),
    ...(event.limit !== undefined ? { limit: event.limit } : {}),
    ...(event.metadata ?? {}),
    ...extra,
  };
}

export function buildXWriteMetadata(
  event: XWriteUsageEvent,
  extra?: Metadata,
): Metadata {
  return {
    action: event.action,
    operationId: event.operationId,
    postType: event.postType,
    postId: event.postId,
    ...(event.replyToPostId ? { replyToPostId: event.replyToPostId } : {}),
    ...(event.metadata ?? {}),
    ...extra,
  };
}

export function buildSchedulerMonitorMetadata(
  input: Pick<
    RecordSchedulerMonitorUsageEventInput,
    "task" | "runAtBucket" | "counts" | "durationMs"
  >,
): Metadata {
  return {
    task: input.task,
    runAtBucket: input.runAtBucket,
    counts: {
      mentions: input.counts.mentions,
      competitorMentions: input.counts.competitorMentions,
      alerts: input.counts.alerts,
    },
    ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
  };
}

export function recordLLMUsageEvent({
  scope,
  idempotencyKey,
  event,
  metadata,
}: RecordLLMUsageEventInput): UsageEvent {
  const usage = event.usage;
  return recordUsageEvent({
    ...scope,
    idempotencyKey: requireIdempotencyKey(idempotencyKey),
    source: "llm-provider",
    eventType: "llm.tokens",
    quantity: usage.inputTokens + usage.outputTokens,
    unit: "tokens",
    provider: usage.provider,
    model: usage.model,
    metadata: {
      callType: event.callType,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      ...metadata,
    },
  });
}

export function recordImageUsageEvent({
  scope,
  idempotencyKey,
  event,
  metadata,
}: RecordImageUsageEventInput): UsageEvent {
  return recordUsageEvent({
    ...scope,
    idempotencyKey: requireIdempotencyKey(idempotencyKey),
    source: "image-provider",
    eventType: "image.generated",
    quantity: 1,
    unit: "image",
    credits: event.creditsUsed,
    provider: event.provider,
    model: event.model,
    metadata: {
      creditsUsed: event.creditsUsed,
      ...metadata,
    },
  });
}

export function recordListeningUsageEvent({
  scope,
  idempotencyKey,
  event,
  metadata,
}: RecordListeningUsageEventInput): UsageEvent {
  return recordUsageEvent({
    ...scope,
    idempotencyKey: requireIdempotencyKey(idempotencyKey),
    source: "listening-provider",
    eventType: event.action,
    quantity: 1,
    unit: "request",
    credits: event.creditsUsed,
    provider: event.provider,
    metadata: buildListeningMetadata(event, metadata),
  });
}

export function recordXWriteUsageEvent({
  scope,
  idempotencyKey,
  event,
  metadata,
}: RecordXWriteUsageEventInput): UsageEvent {
  return recordUsageEvent({
    ...scope,
    idempotencyKey: requireIdempotencyKey(idempotencyKey),
    source: "x-write-client",
    eventType: `x.${event.action}`,
    quantity: 1,
    unit: event.action === "like" ? "action" : "post",
    provider: event.provider,
    metadata: buildXWriteMetadata(event, metadata),
  });
}

export function recordSchedulerMonitorUsageEvent({
  job,
  task,
  runAtBucket,
  counts,
  durationMs,
}: RecordSchedulerMonitorUsageEventInput): UsageEvent {
  return recordUsageEvent({
    tenantId: job.tenant_id || undefined,
    orgId: job.org_id || undefined,
    workspaceId: job.workspace_id || undefined,
    brandId: job.brand_id || undefined,
    agentId: job.agent_id || undefined,
    idempotencyKey: buildSchedulerMonitorUsageIdempotencyKey({
      schedulerJobIdempotencyKey: job.idempotency_key,
    }),
    source: "scheduler",
    eventType: `scheduler.${task}.completed`,
    quantity: 1,
    unit: "job",
    metadata: buildSchedulerMonitorMetadata({
      task,
      runAtBucket,
      counts,
      durationMs,
    }),
  });
}

export function recordSchedulerTaskUsageEvent({
  scope,
  task,
  runAtBucket,
  quantity,
  metadata,
}: RecordSchedulerTaskUsageEventInput): UsageEvent {
  return recordUsageEvent({
    ...scope,
    idempotencyKey: buildSchedulerTaskUsageIdempotencyKey({
      tenantId: scope.tenantId ?? "",
      agentId: scope.agentId ?? "",
      task,
      runAtBucket,
    }),
    source: "scheduler",
    eventType: `scheduler.${task}.completed`,
    quantity: quantity ?? 1,
    unit: "task",
    metadata: {
      task,
      runAtBucket,
      ...metadata,
    },
  });
}

export function createLLMUsageEventHook(
  options: LLMUsageHookOptions,
): LLMUsageHook {
  return async (event) => {
    try {
      recordLLMUsageEvent({
        scope: resolveValue(options.scope, event),
        idempotencyKey: resolveValue(options.idempotencyKey, event),
        event,
        metadata: options.metadata
          ? resolveValue(options.metadata, event)
          : undefined,
      });
    } catch (err) {
      warnUsageHookFailure("LLM", err);
    }
  };
}

export function createImageUsageEventHook(
  options: ImageUsageHookOptions,
): ImageUsageHook {
  return async (event) => {
    try {
      recordImageUsageEvent({
        scope: resolveValue(options.scope, event),
        idempotencyKey: resolveValue(options.idempotencyKey, event),
        event,
        metadata: options.metadata
          ? resolveValue(options.metadata, event)
          : undefined,
      });
    } catch (err) {
      warnUsageHookFailure("Image", err);
    }
  };
}

export function createListeningUsageEventHook(
  options: ListeningUsageHookOptions,
): ListeningUsageHook {
  return async (event) => {
    try {
      recordListeningUsageEvent({
        scope: resolveValue(options.scope, event),
        idempotencyKey: resolveValue(options.idempotencyKey, event),
        event,
        metadata: options.metadata
          ? resolveValue(options.metadata, event)
          : undefined,
      });
    } catch (err) {
      warnUsageHookFailure("Listening", err);
    }
  };
}

export function createXWriteUsageEventHook(
  options: XWriteUsageHookOptions,
): XWriteUsageHook {
  return async (event) => {
    try {
      recordXWriteUsageEvent({
        scope: resolveValue(options.scope, event),
        idempotencyKey: resolveValue(options.idempotencyKey, event),
        event,
        metadata: options.metadata
          ? resolveValue(options.metadata, event)
          : undefined,
      });
    } catch (err) {
      warnUsageHookFailure("XWrite", err);
    }
  };
}

export function installLLMUsageEventHook(
  options: LLMUsageHookOptions,
): () => void {
  setLLMUsageHook(createLLMUsageEventHook(options));
  return () => setLLMUsageHook(null);
}

export function installImageUsageEventHook(
  options: ImageUsageHookOptions,
): () => void {
  setImageUsageHook(createImageUsageEventHook(options));
  return () => setImageUsageHook(null);
}

export function installListeningUsageEventHook(
  options: ListeningUsageHookOptions,
): () => void {
  setListeningUsageHook(createListeningUsageEventHook(options));
  return () => setListeningUsageHook(null);
}

export function installXWriteUsageEventHook(
  options: XWriteUsageHookOptions,
): () => void {
  setXWriteUsageHook(createXWriteUsageEventHook(options));
  return () => setXWriteUsageHook(null);
}

export function installUsageEventHooks(
  options: UsageHookInstallOptions,
): () => void {
  const uninstallers: Array<() => void> = [];
  if (options.llm) uninstallers.push(installLLMUsageEventHook(options.llm));
  if (options.image)
    uninstallers.push(installImageUsageEventHook(options.image));
  if (options.listening)
    uninstallers.push(installListeningUsageEventHook(options.listening));
  if (options.xWrite)
    uninstallers.push(installXWriteUsageEventHook(options.xWrite));

  return () => {
    for (const uninstall of uninstallers.splice(0).reverse()) {
      uninstall();
    }
  };
}
