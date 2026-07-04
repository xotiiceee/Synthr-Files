/**
 * Agent Profile Export/Import — shareable .pulse.json files.
 *
 * Export captures everything needed to recreate an agent: persona, voice,
 * topics, themes, competitors, knowledge notes. Never includes secrets.
 * Import creates a fresh config from the file.
 */

import crypto from 'node:crypto'
import { getConfig, saveConfig, resetConfigCache } from '../src/core/persona.js'
import { loadState, saveState } from '../src/core/state.js'
import { listHostedBrandRuntimeContexts } from './brand-runtime-context.js'
import { getHostedDb } from './db.js'
import {
  createBrandKnowledgeNotesRepository,
  createBrandProfileRepository,
} from './repositories/brand-memory.js'
import { currentHostedRuntimeAgentId } from './runtime-agent.js'

import type { PrivacyExportPayload } from './privacy-export.js'

/** Per-agent knowledge notes key */
function knowledgeKey(): string {
  const agentId = currentHostedRuntimeAgentId()
  return `knowledge-notes-${agentId}`
}

// ─── Schema ─────────────────────────────────────────────────────────────────

export interface PulseProfileExport {
  $schema: 'pulse-agent-profile'
  version: 1
  exportedAt: string
  exportedBy: string
  poweredBy: string
  agent: {
    name: string
    brandName: string
    website: string
    tagline: string
    niche: string
    idealCustomer: string
    problemSolved: string
    uniqueValue: string
    tone: string
    neverSay: string[]
    xHandle?: string
  }
  agentRole?: string
  contentThemes: string[]
  competitors: string[]
  topics: Array<{ id: string; query: string; replies: string[] }>
  voice: {
    catchphrases?: string[]
    emojiFrequency?: string
    capStyle?: string
    humorStyle?: string
    sentenceStyle?: string
    casualtyLevel?: number
    strongOpinions?: string[]
  }
  schedule: {
    outreachIntervalHours: number
    contentPostsPerDay: number
  }
  aggressiveness: string
  knowledgeNotes: Array<{
    title: string
    content: string
    priority: number
    tags?: string[]
  }>
}

type HostedBrandMemoryImportPayload = Pick<
  PrivacyExportPayload,
  | '$schema'
  | 'version'
  | 'scope'
  | 'brands'
  | 'brandProfiles'
  | 'brandKnowledgeNotes'
  | 'runtimeActionLogs'
  | 'runtimeApprovalQueue'
  | 'runtimeContentQueue'
  | 'runtimeScheduleState'
  | 'runtimeOutreachDedup'
  | 'runtimeXRateCounters'
>

type JsonRecord = Record<string, unknown>

export interface ProfileImportValidation {
  valid: boolean
  errors: string[]
  kind?: 'agent-profile' | 'hosted-brand-memory'
  profile?: PulseProfileExport
  hostedBrandMemory?: HostedBrandMemoryImportPayload
}

export interface HostedBrandMemoryImportResult {
  kind: 'hosted-brand-memory'
  notesImported: 0
  themesImported: 0
  topicsImported: 0
  brandProfilesImported: number
  brandKnowledgeNotesImported: number
  brandProfilesSkipped: number
  brandKnowledgeNotesSkipped: number
  runtimeActionLogsImported: number
  runtimeApprovalQueueImported: number
  runtimeContentQueueImported: number
  runtimeScheduleStateImported: number
  runtimeOutreachDedupImported: number
  runtimeXRateCountersImported: number
  runtimeRowsSkipped: number
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseJsonString(value: string, fallback: unknown): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function normalizeProfileJson(value: unknown): JsonRecord {
  if (isRecord(value)) return value
  if (typeof value === 'string') {
    const parsed = parseJsonString(value, {})
    return isRecord(parsed) ? parsed : {}
  }
  return {}
}

function normalizeTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((tag): tag is string => typeof tag === 'string')
  }
  if (typeof value === 'string') {
    const parsed = parseJsonString(value, [])
    return Array.isArray(parsed)
      ? parsed.filter((tag): tag is string => typeof tag === 'string')
      : []
  }
  return []
}

function normalizeJsonString(value: unknown, fallback: unknown): string {
  if (typeof value === 'string') {
    try {
      JSON.parse(value)
      return value
    } catch {
      return JSON.stringify(fallback)
    }
  }
  return JSON.stringify(value ?? fallback)
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function normalizeNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function validateHostedBrandMemoryImport(
  data: unknown,
): ProfileImportValidation {
  const errors: string[] = []

  if (!isRecord(data)) {
    return { valid: false, errors: ['Invalid file — not a JSON object'] }
  }

  if (data.$schema !== 'pulse-privacy-export') {
    errors.push('Not a Pulse privacy export file (missing $schema)')
  }

  if (!Array.isArray(data.brandProfiles)) {
    errors.push('Missing brandProfiles array')
  }

  if (!Array.isArray(data.brandKnowledgeNotes)) {
    errors.push('Missing brandKnowledgeNotes array')
  }

  return {
    valid: errors.length === 0,
    errors,
    kind: errors.length === 0 ? 'hosted-brand-memory' : undefined,
    hostedBrandMemory:
      errors.length === 0
        ? (data as HostedBrandMemoryImportPayload)
        : undefined,
  }
}

// ─── Export ──────────────────────────────────────────────────────────────────

export function exportAgentProfile(): PulseProfileExport {
  const config = getConfig()
  const notes = loadState<any[]>(knowledgeKey(), [])
  const voice = config.humanBehavior?.voice || {}

  return {
    $schema: 'pulse-agent-profile',
    version: 1,
    exportedAt: new Date().toISOString(),
    exportedBy:
      config.persona.xHandle || config.persona.brandName || 'anonymous',
    poweredBy: 'Pulse — Standalone X Marketing Automation',
    agent: {
      name: config.persona.name,
      brandName: config.persona.brandName,
      website: config.persona.website,
      tagline: config.persona.tagline,
      niche: config.persona.niche,
      idealCustomer: config.persona.idealCustomer,
      problemSolved: config.persona.problemSolved,
      uniqueValue: config.persona.uniqueValue,
      tone: config.persona.tone,
      neverSay: config.persona.neverSay || [],
      xHandle: config.persona.xHandle,
    },
    agentRole: (config as any).agentRole || undefined,
    contentThemes: config.contentThemes || [],
    competitors: config.competitors || [],
    topics: (config.topics || []).map((t) => ({
      id: t.id,
      query: t.query,
      replies: t.replies || [],
    })),
    voice: {
      catchphrases: voice.catchphrases,
      emojiFrequency: voice.emojiFrequency,
      capStyle: voice.capStyle,
      humorStyle: voice.humorStyle,
      sentenceStyle: voice.sentenceStyle,
      casualtyLevel: voice.casualtyLevel,
      strongOpinions: voice.strongOpinions,
    },
    schedule: {
      outreachIntervalHours: config.schedule.outreachIntervalHours,
      contentPostsPerDay: config.schedule.contentPostsPerDay,
    },
    aggressiveness: config.aggressiveness,
    knowledgeNotes: notes.map((n: any) => ({
      title: n.title,
      content: n.content,
      priority: typeof n.priority === 'number' ? n.priority : 1,
      tags: (n.tags || []).filter(
        (t: string) => t !== 'from-chat' && t !== 'imported',
      ),
    })),
  }
}

// ─── Validate ───────────────────────────────────────────────────────────────

export function validateProfileImport(data: unknown): ProfileImportValidation {
  const errors: string[] = []

  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Invalid file — not a JSON object'] }
  }

  const d = data as any

  if (d.$schema === 'pulse-privacy-export') {
    return validateHostedBrandMemoryImport(data)
  }

  if (d.$schema !== 'pulse-agent-profile') {
    errors.push('Not a Pulse profile file (missing $schema)')
  }

  if (!d.agent?.brandName) errors.push('Missing brand name')
  if (!d.agent?.niche) errors.push('Missing niche')

  if (d.knowledgeNotes?.length > 100)
    errors.push('Too many knowledge notes (max 100)')
  if (d.topics?.length > 50) errors.push('Too many topics (max 50)')
  if (d.contentThemes?.length > 50)
    errors.push('Too many content themes (max 50)')

  return {
    valid: errors.length === 0,
    errors,
    kind: errors.length === 0 ? 'agent-profile' : undefined,
    profile: errors.length === 0 ? (d as PulseProfileExport) : undefined,
  }
}

// ─── Import ─────────────────────────────────────────────────────────────────

export function importAgentProfile(profile: PulseProfileExport): {
  notesImported: number
  themesImported: number
  topicsImported: number
} {
  const config = getConfig()
  const a = profile.agent

  // Apply persona
  config.persona = {
    ...config.persona,
    name: a.name || config.persona.name,
    brandName: a.brandName,
    website: a.website || '',
    tagline: a.tagline || '',
    niche: a.niche,
    idealCustomer: a.idealCustomer || '',
    problemSolved: a.problemSolved || '',
    uniqueValue: a.uniqueValue || '',
    tone: (a.tone as any) || 'casual',
    neverSay: a.neverSay || [],
    xHandle: a.xHandle || config.persona.xHandle,
  }

  // Apply agentRole if present
  if (profile.agentRole) (config as any).agentRole = profile.agentRole

  // Apply content themes
  config.contentThemes = profile.contentThemes || []

  // Apply competitors
  config.competitors = profile.competitors || []

  // Apply topics
  if (profile.topics?.length) {
    config.topics = profile.topics.map((t) => ({
      id: t.id || `imported-${crypto.randomBytes(3).toString('hex')}`,
      query: t.query,
      textMustMatch: [],
      replies: t.replies || [],
    }))
  }

  // Apply voice
  if (profile.voice) {
    if (!config.humanBehavior) config.humanBehavior = {}
    config.humanBehavior.voice = {
      ...config.humanBehavior.voice,
      ...(profile.voice as any),
    }
  }

  // Apply schedule
  if (profile.schedule) {
    config.schedule = { ...config.schedule, ...profile.schedule }
  }

  // Apply aggressiveness
  if (profile.aggressiveness) {
    config.aggressiveness = profile.aggressiveness as any
  }

  saveConfig(config)
  resetConfigCache()

  // Import knowledge notes (deduplicate by title)
  let notesImported = 0
  if (profile.knowledgeNotes?.length) {
    const existing = loadState<any[]>(knowledgeKey(), [])
    const existingTitles = new Set(
      existing.map((n: any) => n.title.toLowerCase()),
    )

    for (const note of profile.knowledgeNotes) {
      if (existingTitles.has(note.title.toLowerCase())) continue
      if (existing.length >= 100) break

      existing.push({
        id: crypto.randomBytes(8).toString('hex'),
        title: note.title,
        content: note.content,
        priority: Math.min(3, Math.max(0, note.priority ?? 1)),
        tags: [...(note.tags || []), 'imported', `from:${profile.exportedBy}`],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        editedBy: 'user',
      })
      notesImported++
    }

    saveState(knowledgeKey(), existing)
  }

  return {
    notesImported,
    themesImported: profile.contentThemes?.length || 0,
    topicsImported: profile.topics?.length || 0,
  }
}

export function importHostedBrandMemoryExport(
  payload: HostedBrandMemoryImportPayload,
  input: { tenantId: string },
): HostedBrandMemoryImportResult {
  const profiles = createBrandProfileRepository()
  const notes = createBrandKnowledgeNotesRepository()
  const brandsById = new Map(
    listHostedBrandRuntimeContexts({ tenantId: input.tenantId }).map(
      (context) => [context.brandId, context],
    )
  )
  const exportedBrandIds = new Set(
    (payload.brands || [])
      .map((row) =>
        isRecord(row) && typeof row.id === 'string' ? row.id : null,
      )
      .filter((id): id is string => Boolean(id)),
  )

  let brandProfilesImported = 0
  let brandProfilesSkipped = 0
  for (const row of payload.brandProfiles || []) {
    if (!isRecord(row)) {
      brandProfilesSkipped += 1
      continue
    }
    if (row.tenant_id !== input.tenantId || typeof row.brand_id !== 'string') {
      brandProfilesSkipped += 1
      continue
    }
    if (exportedBrandIds.size > 0 && !exportedBrandIds.has(row.brand_id)) {
      brandProfilesSkipped += 1
      continue
    }
    const brand = brandsById.get(row.brand_id)
    if (!brand || typeof row.agent_id !== 'string') {
      brandProfilesSkipped += 1
      continue
    }
    profiles.upsertProfile({
      scope: {
        tenantId: input.tenantId,
        orgId: brand.orgId,
        workspaceId: brand.workspaceId,
        brandId: brand.brandId,
        agentId: row.agent_id,
      },
      profile: normalizeProfileJson(row.profile_json),
      source: typeof row.source === 'string' ? row.source : undefined,
      sourceLabel:
        typeof row.source_label === 'string' ? row.source_label : undefined,
      sourceUrl:
        typeof row.source_url === 'string' ? row.source_url : undefined,
      actorId: typeof row.actor_id === 'string' ? row.actor_id : undefined,
      lockState: row.lock_state === 'locked' ? 'locked' : 'editable',
      version: typeof row.version === 'number' ? row.version : undefined,
      confidence:
        typeof row.confidence === 'number' ? row.confidence : undefined,
      decay: typeof row.decay === 'string' ? row.decay : undefined,
      createdAt:
        typeof row.created_at === 'string' ? row.created_at : undefined,
      updatedAt:
        typeof row.updated_at === 'string' ? row.updated_at : undefined,
    })
    brandProfilesImported += 1
  }

  let brandKnowledgeNotesImported = 0
  let brandKnowledgeNotesSkipped = 0
  for (const row of payload.brandKnowledgeNotes || []) {
    if (!isRecord(row)) {
      brandKnowledgeNotesSkipped += 1
      continue
    }
    if (
      row.tenant_id !== input.tenantId ||
      typeof row.brand_id !== 'string' ||
      typeof row.agent_id !== 'string' ||
      typeof row.title !== 'string' ||
      typeof row.content !== 'string'
    ) {
      brandKnowledgeNotesSkipped += 1
      continue
    }
    if (exportedBrandIds.size > 0 && !exportedBrandIds.has(row.brand_id)) {
      brandKnowledgeNotesSkipped += 1
      continue
    }
    const brand = brandsById.get(row.brand_id)
    if (!brand) {
      brandKnowledgeNotesSkipped += 1
      continue
    }
    notes.saveNote({
      scope: {
        tenantId: input.tenantId,
        orgId: brand.orgId,
        workspaceId: brand.workspaceId,
        brandId: brand.brandId,
        agentId: row.agent_id,
      },
      id: typeof row.id === 'string' ? row.id : undefined,
      title: row.title,
      content: row.content,
      tags: normalizeTags(row.tags),
      priority: typeof row.priority === 'number' ? row.priority : undefined,
      locked: row.locked === 1 || row.locked === true,
      source: typeof row.source === 'string' ? row.source : undefined,
      sourceLabel:
        typeof row.source_label === 'string' ? row.source_label : undefined,
      sourceUrl:
        typeof row.source_url === 'string' ? row.source_url : undefined,
      actorId: typeof row.actor_id === 'string' ? row.actor_id : undefined,
      version: typeof row.version === 'number' ? row.version : undefined,
      confidence:
        typeof row.confidence === 'number' ? row.confidence : undefined,
      decay: typeof row.decay === 'string' ? row.decay : undefined,
      createdAt:
        typeof row.created_at === 'string' ? row.created_at : undefined,
      updatedAt:
        typeof row.updated_at === 'string' ? row.updated_at : undefined,
    })
    brandKnowledgeNotesImported += 1
  }

  let runtimeActionLogsImported = 0
  let runtimeApprovalQueueImported = 0
  let runtimeContentQueueImported = 0
  let runtimeScheduleStateImported = 0
  let runtimeOutreachDedupImported = 0
  let runtimeXRateCountersImported = 0
  let runtimeRowsSkipped = 0
  const db = getHostedDb()

  for (const row of payload.runtimeActionLogs || []) {
    if (
      !isRecord(row) ||
      row.tenant_id !== input.tenantId ||
      typeof row.id !== 'string' ||
      typeof row.brand_id !== 'string' ||
      typeof row.agent_id !== 'string' ||
      typeof row.timestamp !== 'string' ||
      typeof row.platform !== 'string' ||
      typeof row.action_type !== 'string' ||
      typeof row.topic_id !== 'string' ||
      typeof row.content !== 'string'
    ) {
      runtimeRowsSkipped += 1
      continue
    }
    const brand = brandsById.get(row.brand_id)
    if (!brand) {
      runtimeRowsSkipped += 1
      continue
    }
    const existing = db
      .prepare(
        `SELECT tenant_id, brand_id, agent_id FROM runtime_action_logs WHERE id = ?`,
      )
      .get(row.id) as
      | { tenant_id: string; brand_id: string; agent_id: string }
      | undefined
    if (
      existing &&
      (existing.tenant_id !== input.tenantId ||
        existing.brand_id !== brand.brandId ||
        existing.agent_id !== row.agent_id)
    ) {
      runtimeRowsSkipped += 1
      continue
    }
    db.prepare(
      `INSERT INTO runtime_action_logs (
         id, tenant_id, org_id, workspace_id, brand_id, agent_id, timestamp,
         platform, action_type, topic_id, content, target_text, target_url,
         theme, engagement, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         timestamp = excluded.timestamp,
         platform = excluded.platform,
         action_type = excluded.action_type,
         topic_id = excluded.topic_id,
         content = excluded.content,
         target_text = excluded.target_text,
         target_url = excluded.target_url,
         theme = excluded.theme,
         engagement = excluded.engagement,
         created_at = excluded.created_at`,
    ).run(
      row.id,
      input.tenantId,
      brand.orgId,
      brand.workspaceId,
      brand.brandId,
      row.agent_id,
      row.timestamp,
      row.platform,
      row.action_type,
      row.topic_id,
      row.content,
      normalizeString(row.target_text),
      normalizeString(row.target_url),
      normalizeString(row.theme),
      normalizeJsonString(row.engagement, ''),
      normalizeString(row.created_at) || new Date().toISOString(),
    )
    runtimeActionLogsImported += 1
  }

  for (const row of payload.runtimeApprovalQueue || []) {
    if (
      !isRecord(row) ||
      row.tenant_id !== input.tenantId ||
      typeof row.id !== 'string' ||
      typeof row.brand_id !== 'string' ||
      typeof row.agent_id !== 'string' ||
      typeof row.item_type !== 'string' ||
      typeof row.platform !== 'string' ||
      typeof row.content !== 'string' ||
      typeof row.status !== 'string' ||
      typeof row.created_at !== 'string' ||
      typeof row.expires_at !== 'string'
    ) {
      runtimeRowsSkipped += 1
      continue
    }
    const brand = brandsById.get(row.brand_id)
    if (!brand) {
      runtimeRowsSkipped += 1
      continue
    }
    const existing = db
      .prepare(
        `SELECT tenant_id, brand_id, agent_id FROM runtime_approval_queue WHERE id = ?`,
      )
      .get(row.id) as
      | { tenant_id: string; brand_id: string; agent_id: string }
      | undefined
    if (
      existing &&
      (existing.tenant_id !== input.tenantId ||
        existing.brand_id !== brand.brandId ||
        existing.agent_id !== row.agent_id)
    ) {
      runtimeRowsSkipped += 1
      continue
    }
    db.prepare(
      `INSERT INTO runtime_approval_queue (
         id, tenant_id, org_id, workspace_id, brand_id, agent_id, item_type,
         platform, content, status, risk_flags, metadata, created_at,
         expires_at, reviewed_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         item_type = excluded.item_type,
         platform = excluded.platform,
         content = excluded.content,
         status = excluded.status,
         risk_flags = excluded.risk_flags,
         metadata = excluded.metadata,
         created_at = excluded.created_at,
         expires_at = excluded.expires_at,
         reviewed_at = excluded.reviewed_at,
         updated_at = excluded.updated_at`,
    ).run(
      row.id,
      input.tenantId,
      brand.orgId,
      brand.workspaceId,
      brand.brandId,
      row.agent_id,
      row.item_type,
      row.platform,
      row.content,
      row.status,
      normalizeJsonString(row.risk_flags, []),
      normalizeJsonString(row.metadata, {}),
      row.created_at,
      row.expires_at,
      normalizeString(row.reviewed_at),
      normalizeString(row.updated_at) || new Date().toISOString(),
    )
    runtimeApprovalQueueImported += 1
  }

  for (const row of payload.runtimeContentQueue || []) {
    if (
      !isRecord(row) ||
      row.tenant_id !== input.tenantId ||
      typeof row.brand_id !== 'string' ||
      typeof row.agent_id !== 'string' ||
      typeof row.item_id !== 'number' ||
      typeof row.platform !== 'string' ||
      typeof row.item_type !== 'string' ||
      typeof row.content !== 'string' ||
      typeof row.scheduled_at !== 'string' ||
      typeof row.status !== 'string' ||
      typeof row.created_at !== 'string'
    ) {
      runtimeRowsSkipped += 1
      continue
    }
    const brand = brandsById.get(row.brand_id)
    if (!brand) {
      runtimeRowsSkipped += 1
      continue
    }
    db.prepare(
      `INSERT INTO runtime_content_queue (
         tenant_id, org_id, workspace_id, brand_id, agent_id, item_id,
         platform, item_type, content, theme, scheduled_at, published_at,
         status, post_url, engagement_score, created_at, metadata, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(tenant_id, org_id, workspace_id, brand_id, agent_id, item_id)
       DO UPDATE SET
         platform = excluded.platform,
         item_type = excluded.item_type,
         content = excluded.content,
         theme = excluded.theme,
         scheduled_at = excluded.scheduled_at,
         published_at = excluded.published_at,
         status = excluded.status,
         post_url = excluded.post_url,
         engagement_score = excluded.engagement_score,
         created_at = excluded.created_at,
         metadata = excluded.metadata,
         updated_at = excluded.updated_at`,
    ).run(
      input.tenantId,
      brand.orgId,
      brand.workspaceId,
      brand.brandId,
      row.agent_id,
      row.item_id,
      row.platform,
      row.item_type,
      row.content,
      normalizeString(row.theme),
      row.scheduled_at,
      normalizeString(row.published_at),
      row.status,
      normalizeString(row.post_url),
      normalizeNumber(row.engagement_score),
      row.created_at,
      normalizeJsonString(row.metadata, {}),
      normalizeString(row.updated_at) || new Date().toISOString(),
    )
    runtimeContentQueueImported += 1
  }

  for (const row of payload.runtimeScheduleState || []) {
    if (
      !isRecord(row) ||
      row.tenant_id !== input.tenantId ||
      typeof row.agent_id !== 'string' ||
      typeof row.task_type !== 'string' ||
      typeof row.last_run !== 'string' ||
      typeof row.updated_at !== 'string'
    ) {
      runtimeRowsSkipped += 1
      continue
    }
    db.prepare(
      `INSERT INTO runtime_schedule_state
         (tenant_id, agent_id, task_type, last_run, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(tenant_id, agent_id, task_type)
       DO UPDATE SET
         last_run = excluded.last_run,
         updated_at = excluded.updated_at`,
    ).run(input.tenantId, row.agent_id, row.task_type, row.last_run, row.updated_at)
    runtimeScheduleStateImported += 1
  }

  for (const row of payload.runtimeOutreachDedup || []) {
    if (
      !isRecord(row) ||
      row.tenant_id !== input.tenantId ||
      typeof row.agent_id !== 'string' ||
      typeof row.platform !== 'string' ||
      typeof row.post_id !== 'string' ||
      typeof row.first_seen_at !== 'string' ||
      typeof row.updated_at !== 'string'
    ) {
      runtimeRowsSkipped += 1
      continue
    }
    db.prepare(
      `INSERT INTO runtime_outreach_dedup
         (tenant_id, agent_id, platform, post_id, first_seen_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(tenant_id, agent_id, platform, post_id)
       DO UPDATE SET updated_at = excluded.updated_at`,
    ).run(
      input.tenantId,
      row.agent_id,
      row.platform,
      row.post_id,
      row.first_seen_at,
      row.updated_at,
    )
    runtimeOutreachDedupImported += 1
  }

  for (const row of payload.runtimeXRateCounters || []) {
    if (
      !isRecord(row) ||
      row.tenant_id !== input.tenantId ||
      typeof row.account_id !== 'string' ||
      typeof row.month_key !== 'string' ||
      typeof row.post_count !== 'number' ||
      typeof row.updated_at !== 'string'
    ) {
      runtimeRowsSkipped += 1
      continue
    }
    db.prepare(
      `INSERT INTO runtime_x_rate_counters
         (tenant_id, account_id, month_key, post_count, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(tenant_id, account_id, month_key)
       DO UPDATE SET
         post_count = excluded.post_count,
         updated_at = excluded.updated_at`,
    ).run(
      input.tenantId,
      row.account_id,
      row.month_key,
      row.post_count,
      row.updated_at,
    )
    runtimeXRateCountersImported += 1
  }

  return {
    kind: 'hosted-brand-memory',
    notesImported: 0,
    themesImported: 0,
    topicsImported: 0,
    brandProfilesImported,
    brandKnowledgeNotesImported,
    brandProfilesSkipped,
    brandKnowledgeNotesSkipped,
    runtimeActionLogsImported,
    runtimeApprovalQueueImported,
    runtimeContentQueueImported,
    runtimeScheduleStateImported,
    runtimeOutreachDedupImported,
    runtimeXRateCountersImported,
    runtimeRowsSkipped,
  }
}
