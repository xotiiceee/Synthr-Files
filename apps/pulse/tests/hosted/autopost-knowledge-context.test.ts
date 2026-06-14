import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { cleanupSqliteFiles, createTempHostedDbPath } from './temp-db.js'

const dbPath = createTempHostedDbPath('pulse-autopost-knowledge-context')
process.env.HOSTED_DB_PATH = dbPath

const { createOrg, createTenant, createWorkspace } =
  await import('../../hosted/db.js')
const { createBrandRepository } =
  await import('../../hosted/repositories/brands.js')
const { createBrandKnowledgeNotesRepository, createBrandProfileRepository } =
  await import('../../hosted/repositories/brand-memory.js')
const { getTenantDir, withTenantContext } =
  await import('../../hosted/tenant.js')
const { getAutopostKnowledgeContext, resetAutopostKnowledgeCacheForTests } =
  await import('../../src/modes/autopost.js')

const brands = createBrandRepository()
const tenantDirs = new Set<string>()

afterAll(() => {
  for (const dir of tenantDirs) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
  cleanupSqliteFiles(dbPath)
})

function createScope(label: string) {
  const tenant = createTenant(
    `autopost-knowledge-${label}-${crypto.randomUUID()}`,
    `claw-autopost-knowledge-${label}-${crypto.randomUUID()}`,
    `${label}-${crypto.randomUUID()}@example.test`,
    `Autopost Knowledge ${label}`,
  )
  const tenantDir = getTenantDir(tenant.id)
  tenantDirs.add(tenantDir)
  const org = createOrg({
    name: `Autopost Knowledge Org ${label}`,
    legacyTenantId: tenant.id,
  })
  const workspace = createWorkspace(org.id, 'Default')
  const agentId = `agent_${label}`
  const brand = brands.createBrand({
    orgId: org.id,
    workspaceId: workspace.id,
    name: `Autopost Knowledge Brand ${label}`,
    legacyTenantId: tenant.id,
    legacyAgentId: agentId,
  })

  return {
    tenantId: tenant.id,
    orgId: org.id,
    workspaceId: workspace.id,
    brandId: brand.id,
    agentId,
    tenantDir,
  }
}

function writeKnowledgeFile(dir: string, content: string): void {
  fs.writeFileSync(path.join(dir, 'knowledge.md'), content)
}

describe('hosted autopost knowledge context', () => {
  it('includes tenant/agent scoped hosted brand memory alongside file knowledge', async () => {
    const scope = createScope('memory')
    const profiles = createBrandProfileRepository()
    const notes = createBrandKnowledgeNotesRepository()

    profiles.upsertProfile({
      scope,
      profile: {
        identity: { keyFacts: ['Ships payment-aware agent infrastructure.'] },
      },
      source: 'chat',
      lockState: 'locked',
    })
    notes.saveNote({
      scope,
      title: 'Voice rule',
      content: 'Use operationally precise language and concrete trade-offs.',
      tags: ['layer:preferences'],
      locked: true,
    })
    writeKnowledgeFile(
      scope.tenantDir,
      'knowledge.md fallback: mention durable queues for technical accuracy.',
    )

    await withTenantContext(scope.tenantId, async () => {
      resetAutopostKnowledgeCacheForTests()

      const context = await getAutopostKnowledgeContext({
        query: 'voice for payment-aware agent infrastructure',
      })

      expect(context).toContain(
        'BRAND MEMORY (tenant/agent scoped durable context)',
      )
      expect(context).toContain('Ships payment-aware agent infrastructure.')
      expect(context).toContain(
        'Use operationally precise language and concrete trade-offs.',
      )
      expect(context).toContain('knowledge.md fallback: mention durable queues')
    })
  })

  it('falls back to file knowledge when hosted scoped memory is absent', async () => {
    const scope = createScope('fallback')
    writeKnowledgeFile(
      scope.tenantDir,
      'tenant knowledge fallback only: cite the local markdown context.',
    )

    await withTenantContext(scope.tenantId, async () => {
      resetAutopostKnowledgeCacheForTests()

      const context = await getAutopostKnowledgeContext({
        query: 'local fallback',
      })

      expect(context).not.toContain(
        'BRAND MEMORY (tenant/agent scoped durable context)',
      )
      expect(context).toContain('tenant knowledge fallback only')
      expect(context).toContain('PRODUCT KNOWLEDGE')
    })
  })
})
