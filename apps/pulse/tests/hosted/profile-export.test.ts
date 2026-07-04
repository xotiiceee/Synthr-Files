import { afterAll, describe, expect, it } from 'vitest'

import { cleanupSqliteFiles, createTempHostedDbPath } from './temp-db.js'

const dbPath = createTempHostedDbPath('pulse-profile-import')
process.env.HOSTED_DB_PATH = dbPath

const { createBrand, createOrg, createTenant, createWorkspace, getHostedDb } =
  await import('../../hosted/db.js')
const { exportPrivacyData } = await import('../../hosted/privacy-export.js')
const { importHostedBrandMemoryExport, validateProfileImport } =
  await import('../../hosted/profile-export.js')
const { createBrandKnowledgeNotesRepository, createBrandProfileRepository } =
  await import('../../hosted/repositories/brand-memory.js')

const profiles = createBrandProfileRepository()
const notes = createBrandKnowledgeNotesRepository()

function zeroRuntimeImportCounts() {
  return {
    runtimeActionLogsImported: 0,
    runtimeApprovalQueueImported: 0,
    runtimeContentQueueImported: 0,
    runtimeScheduleStateImported: 0,
    runtimeOutreachDedupImported: 0,
    runtimeXRateCountersImported: 0,
    runtimeRowsSkipped: 0,
  }
}

afterAll(() => {
  cleanupSqliteFiles(dbPath)
})

describe('profile import', () => {
  it('still accepts self-host pulse-agent-profile payloads', () => {
    const validation = validateProfileImport({
      $schema: 'pulse-agent-profile',
      version: 1,
      exportedAt: '2026-05-26T10:00:00.000Z',
      exportedBy: 'founder',
      poweredBy: 'Pulse',
      agent: {
        name: 'Marketing Agent',
        brandName: 'Pulse',
        website: 'https://pulse.example.test',
        tagline: 'Ship calm automation',
        niche: 'B2B SaaS',
        idealCustomer: 'Operators',
        problemSolved: 'Content throughput',
        uniqueValue: 'Brand-safe drafts',
        tone: 'direct',
        neverSay: [],
      },
      contentThemes: ['shipping'],
      competitors: [],
      topics: [],
      voice: {},
      schedule: {
        outreachIntervalHours: 4,
        contentPostsPerDay: 2,
      },
      aggressiveness: 'moderate',
      knowledgeNotes: [],
    })

    expect(validation.valid).toBe(true)
    expect(validation.kind).toBe('agent-profile')
    expect(validation.profile?.agent.brandName).toBe('Pulse')
  })

  it('restores hosted brand-memory rows from a structured privacy export payload', async () => {
    const tenant = createTenant(
      'cn-profile-import',
      'claw_profile_import',
      'profile-import@example.test',
      'Profile Import',
    )
    const org = createOrg({
      name: 'Profile Import Org',
      legacyTenantId: tenant.id,
    })
    const workspace = createWorkspace(org.id, 'Profile Import Workspace')
    const brand = createBrand({
      orgId: org.id,
      workspaceId: workspace.id,
      name: 'Profile Import Brand',
      legacyTenantId: tenant.id,
      legacyAgentId: 'agent_profile_import',
    })
    const scope = {
      tenantId: tenant.id,
      orgId: org.id,
      workspaceId: workspace.id,
      brandId: brand.id,
      agentId: 'agent_profile_import',
    }

    profiles.upsertProfile({
      scope,
      profile: {
        identity: { keyFacts: ['Restore this profile'] },
        preferences: { tone: 'direct' },
      },
      source: 'import',
      sourceLabel: 'Founder brief',
      sourceUrl: 'https://example.test/founder-brief',
      actorId: 'usr_founder',
      lockState: 'locked',
      version: 6,
      confidence: 0.93,
      decay: 'manual_only',
      createdAt: '2026-05-26T10:00:00.000Z',
      updatedAt: '2026-05-26T11:00:00.000Z',
    })
    const savedNote = notes.saveNote({
      scope,
      title: 'Restore this note',
      content: 'Keep the imported source metadata intact.',
      tags: ['layer:locked_rules', 'imported'],
      priority: 3,
      locked: true,
      source: 'import',
      sourceLabel: 'Setup import',
      sourceUrl: 'https://example.test/setup-import',
      actorId: 'usr_ops',
      version: 4,
      confidence: 0.88,
      decay: 'sticky',
      createdAt: '2026-05-26T12:00:00.000Z',
      updatedAt: '2026-05-26T13:00:00.000Z',
    })

    const payload = await exportPrivacyData({
      subjectType: 'tenant',
      subjectId: tenant.id,
      includeProfileExport: false,
    })
    const validation = validateProfileImport(payload)

    expect(validation.valid).toBe(true)
    expect(validation.kind).toBe('hosted-brand-memory')

    expect(profiles.deleteProfile(scope)).toBe(true)
    expect(notes.deleteNote(scope, { id: savedNote.id })).toBe(true)
    expect(profiles.getProfile(scope)).toBeNull()
    expect(notes.getNoteById(scope, savedNote.id)).toBeNull()

    const result = importHostedBrandMemoryExport(
      validation.hostedBrandMemory!,
      { tenantId: tenant.id },
    )

    expect(result).toEqual({
      kind: 'hosted-brand-memory',
      notesImported: 0,
      themesImported: 0,
      topicsImported: 0,
      brandProfilesImported: 1,
      brandKnowledgeNotesImported: 1,
      brandProfilesSkipped: 0,
      brandKnowledgeNotesSkipped: 0,
      ...zeroRuntimeImportCounts(),
    })

    expect(profiles.getProfile(scope)).toMatchObject({
      tenant_id: tenant.id,
      org_id: org.id,
      workspace_id: workspace.id,
      brand_id: brand.id,
      agent_id: scope.agentId,
      source: 'import',
      source_label: 'Founder brief',
      source_url: 'https://example.test/founder-brief',
      actor_id: 'usr_founder',
      lock_state: 'locked',
      version: 6,
      confidence: 0.93,
      decay: 'manual_only',
      created_at: '2026-05-26T10:00:00.000Z',
      updated_at: '2026-05-26T11:00:00.000Z',
    })
    expect(JSON.parse(profiles.getProfile(scope)!.profile_json)).toEqual({
      identity: { keyFacts: ['Restore this profile'] },
      preferences: { tone: 'direct' },
    })
    expect(notes.getNoteById(scope, savedNote.id)).toMatchObject({
      id: savedNote.id,
      tenant_id: tenant.id,
      org_id: org.id,
      workspace_id: workspace.id,
      brand_id: brand.id,
      agent_id: scope.agentId,
      title: 'Restore this note',
      content: 'Keep the imported source metadata intact.',
      locked: 1,
      priority: 3,
      source: 'import',
      source_label: 'Setup import',
      source_url: 'https://example.test/setup-import',
      actor_id: 'usr_ops',
      version: 4,
      confidence: 0.88,
      decay: 'sticky',
      created_at: '2026-05-26T12:00:00.000Z',
      updated_at: '2026-05-26T13:00:00.000Z',
    })
    expect(JSON.parse(notes.getNoteById(scope, savedNote.id)!.tags)).toEqual([
      'layer:locked_rules',
      'imported',
    ])
  })

  it('round-trips hosted brand-memory exports without letting note imports rewrite the brand profile', async () => {
    const tenant = createTenant(
      'cn-profile-parity',
      'claw_profile_parity',
      'profile-parity@example.test',
      'Profile Parity',
    )
    const org = createOrg({
      name: 'Profile Parity Org',
      legacyTenantId: tenant.id,
    })
    const workspace = createWorkspace(org.id, 'Profile Parity Workspace')
    const brand = createBrand({
      orgId: org.id,
      workspaceId: workspace.id,
      name: 'Profile Parity Brand',
      legacyTenantId: tenant.id,
      legacyAgentId: 'agent_profile_parity',
    })
    const scope = {
      tenantId: tenant.id,
      orgId: org.id,
      workspaceId: workspace.id,
      brandId: brand.id,
      agentId: 'agent_profile_parity',
    }

    profiles.upsertProfile({
      scope,
      profile: {
        identity: {
          name: 'Pulse Premium',
          keyFacts: ['Structured profile stays canonical'],
        },
        preferences: {
          tone: 'precise',
        },
      },
      source: 'import',
      sourceLabel: 'Founder brief',
      sourceUrl: 'https://example.test/founder-memory',
      actorId: 'usr_founder',
      lockState: 'locked',
      version: 9,
      confidence: 0.97,
      decay: 'manual_only',
      createdAt: '2026-05-26T15:00:00.000Z',
      updatedAt: '2026-05-26T16:00:00.000Z',
    })
    const importedNote = notes.saveNote({
      scope,
      title: 'Brand identity',
      content: 'A note can supplement identity context but cannot replace it.',
      tags: ['layer:identity', 'imported'],
      priority: 2,
      locked: false,
      source: 'import',
      sourceLabel: 'Migration note',
      sourceUrl: 'https://example.test/migration-note',
      actorId: 'usr_ops',
      version: 5,
      confidence: 0.41,
      decay: 'fast',
      createdAt: '2026-05-26T16:05:00.000Z',
      updatedAt: '2026-05-26T16:10:00.000Z',
    })
    getHostedDb()
      .prepare(
        `INSERT INTO runtime_approval_queue
           (id, tenant_id, org_id, workspace_id, brand_id, agent_id, item_type,
            platform, content, status, risk_flags, metadata, created_at,
            expires_at, reviewed_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'approval_profile_parity',
        tenant.id,
        org.id,
        workspace.id,
        brand.id,
        scope.agentId,
        'autopost',
        'x',
        'Approve profile parity post',
        'pending',
        JSON.stringify(['review']),
        JSON.stringify({ category: 'launch' }),
        '2026-05-26T17:00:00.000Z',
        '2026-05-28T17:00:00.000Z',
        '',
        '2026-05-26T17:00:00.000Z',
      )
    getHostedDb()
      .prepare(
        `INSERT INTO runtime_content_queue
           (tenant_id, org_id, workspace_id, brand_id, agent_id, item_id,
            platform, item_type, content, theme, scheduled_at, published_at,
            status, post_url, engagement_score, created_at, metadata, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        tenant.id,
        org.id,
        workspace.id,
        brand.id,
        scope.agentId,
        901,
        'x',
        'post',
        'Scheduled profile parity post',
        'launch',
        '2026-05-27T10:00:00.000Z',
        '',
        'draft',
        '',
        0,
        '2026-05-26T17:05:00.000Z',
        JSON.stringify({ source: 'restore-test' }),
        '2026-05-26T17:05:00.000Z',
      )
    getHostedDb()
      .prepare(
        `INSERT INTO runtime_action_logs
           (id, tenant_id, org_id, workspace_id, brand_id, agent_id, timestamp,
            platform, action_type, topic_id, content, target_text, target_url,
            theme, engagement, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'action_profile_parity',
        tenant.id,
        org.id,
        workspace.id,
        brand.id,
        scope.agentId,
        '2026-05-26T17:10:00.000Z',
        'x',
        'post',
        'topic_profile_parity',
        'Published profile parity post',
        '',
        '',
        'launch',
        JSON.stringify({ likes: 1, replies: 0, reposts: 0 }),
        '2026-05-26T17:10:00.000Z',
      )
    getHostedDb()
      .prepare(
        `INSERT INTO runtime_schedule_state
           (tenant_id, agent_id, task_type, last_run, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        tenant.id,
        scope.agentId,
        'content',
        '2026-05-26T17:30:00.000Z',
        '2026-05-26T17:30:00.000Z',
      )
    getHostedDb()
      .prepare(
        `INSERT INTO runtime_outreach_dedup
           (tenant_id, agent_id, platform, post_id, first_seen_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        tenant.id,
        scope.agentId,
        'x',
        'reply_profile_parity',
        '2026-05-26T17:35:00.000Z',
        '2026-05-26T17:35:00.000Z',
      )
    getHostedDb()
      .prepare(
        `INSERT INTO runtime_x_rate_counters
           (tenant_id, account_id, month_key, post_count, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        tenant.id,
        'acct_profile_parity',
        '2026-05',
        7,
        '2026-05-26T17:40:00.000Z',
      )

    const payload = await exportPrivacyData({
      subjectType: 'tenant',
      subjectId: tenant.id,
      includeProfileExport: false,
    })
    const validation = validateProfileImport(payload)

    expect(validation.valid).toBe(true)
    expect(validation.kind).toBe('hosted-brand-memory')

    expect(profiles.deleteProfile(scope)).toBe(true)
    expect(notes.deleteNote(scope, { id: importedNote.id })).toBe(true)
    for (const table of [
      'runtime_approval_queue',
      'runtime_content_queue',
      'runtime_action_logs',
      'runtime_schedule_state',
      'runtime_outreach_dedup',
      'runtime_x_rate_counters',
    ]) {
      getHostedDb().prepare(`DELETE FROM ${table} WHERE tenant_id = ?`).run(
        tenant.id,
      )
    }

    const result = importHostedBrandMemoryExport(
      validation.hostedBrandMemory!,
      { tenantId: tenant.id },
    )

    expect(result).toEqual({
      kind: 'hosted-brand-memory',
      notesImported: 0,
      themesImported: 0,
      topicsImported: 0,
      brandProfilesImported: 1,
      brandKnowledgeNotesImported: 1,
      brandProfilesSkipped: 0,
      brandKnowledgeNotesSkipped: 0,
      runtimeActionLogsImported: 1,
      runtimeApprovalQueueImported: 1,
      runtimeContentQueueImported: 1,
      runtimeScheduleStateImported: 1,
      runtimeOutreachDedupImported: 1,
      runtimeXRateCountersImported: 1,
      runtimeRowsSkipped: 0,
    })

    const restoredProfile = profiles.getProfile(scope)
    const restoredNote = notes.getNoteById(scope, importedNote.id)

    expect(restoredProfile).toMatchObject({
      source: 'import',
      source_label: 'Founder brief',
      source_url: 'https://example.test/founder-memory',
      actor_id: 'usr_founder',
      lock_state: 'locked',
      version: 9,
      confidence: 0.97,
      decay: 'manual_only',
      created_at: '2026-05-26T15:00:00.000Z',
      updated_at: '2026-05-26T16:00:00.000Z',
    })
    expect(JSON.parse(restoredProfile!.profile_json)).toEqual({
      identity: {
        name: 'Pulse Premium',
        keyFacts: ['Structured profile stays canonical'],
      },
      preferences: {
        tone: 'precise',
      },
    })
    expect(restoredNote).toMatchObject({
      id: importedNote.id,
      title: 'Brand identity',
      content: 'A note can supplement identity context but cannot replace it.',
      source: 'import',
      source_label: 'Migration note',
      source_url: 'https://example.test/migration-note',
      actor_id: 'usr_ops',
      version: 5,
      confidence: 0.41,
      decay: 'fast',
      created_at: '2026-05-26T16:05:00.000Z',
      updated_at: '2026-05-26T16:10:00.000Z',
    })
    expect(JSON.parse(restoredNote!.tags)).toEqual([
      'layer:identity',
      'imported',
    ])
    expect(
      getHostedDb()
        .prepare(
          `SELECT status, content
             FROM runtime_approval_queue
            WHERE id = ? AND tenant_id = ?`,
        )
        .get('approval_profile_parity', tenant.id),
    ).toEqual({
      status: 'pending',
      content: 'Approve profile parity post',
    })
    expect(
      getHostedDb()
        .prepare(
          `SELECT item_type, content
             FROM runtime_content_queue
            WHERE tenant_id = ? AND brand_id = ? AND item_id = ?`,
        )
        .get(tenant.id, brand.id, 901),
    ).toEqual({
      item_type: 'post',
      content: 'Scheduled profile parity post',
    })
    expect(
      getHostedDb()
        .prepare(
          `SELECT action_type, content
             FROM runtime_action_logs
            WHERE id = ? AND tenant_id = ?`,
        )
        .get('action_profile_parity', tenant.id),
    ).toEqual({
      action_type: 'post',
      content: 'Published profile parity post',
    })
    expect(
      getHostedDb()
        .prepare(
          `SELECT last_run
             FROM runtime_schedule_state
            WHERE tenant_id = ? AND agent_id = ? AND task_type = ?`,
        )
        .get(tenant.id, scope.agentId, 'content'),
    ).toEqual({ last_run: '2026-05-26T17:30:00.000Z' })
    expect(
      getHostedDb()
        .prepare(
          `SELECT post_id
             FROM runtime_outreach_dedup
            WHERE tenant_id = ? AND agent_id = ? AND platform = ?`,
        )
        .get(tenant.id, scope.agentId, 'x'),
    ).toEqual({ post_id: 'reply_profile_parity' })
    expect(
      getHostedDb()
        .prepare(
          `SELECT post_count
             FROM runtime_x_rate_counters
            WHERE tenant_id = ? AND account_id = ? AND month_key = ?`,
        )
        .get(tenant.id, 'acct_profile_parity', '2026-05'),
    ).toEqual({ post_count: 7 })
  })
})
