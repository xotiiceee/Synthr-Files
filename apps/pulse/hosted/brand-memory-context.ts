import { resolveHostedBrandRuntimeContext } from "./brand-runtime-context.js";
import {
  createBrandKnowledgeNotesRepository,
  type BrandMemoryScope,
} from "./repositories/brand-memory.js";

export interface ChatKnowledgeNoteContext {
  title: string;
  content: string;
  priority: number;
}

export function resolveHostedBrandMemoryScope(input: {
  tenantId: string;
  agentId?: string | null;
}): BrandMemoryScope | null {
  const context = resolveHostedBrandRuntimeContext(input);
  if (!context) return null;

  return {
    tenantId: context.tenantId,
    orgId: context.orgId,
    workspaceId: context.workspaceId,
    brandId: context.brandId,
    agentId: context.selectedAgentId,
  };
}

export function getHostedChatMemoryContext(input: {
  tenantId: string;
  agentId?: string | null;
  query?: string;
  limit?: number;
}): ChatKnowledgeNoteContext[] {
  const scope = resolveHostedBrandMemoryScope(input);
  if (!scope) return [];

  const records = createBrandKnowledgeNotesRepository().listMemoryRecords(
    scope,
    {
      layers: [
        "locked_rules",
        "identity",
        "knowledge",
        "preferences",
        "operational",
      ],
      query: input.query,
      includeLockedKnowledge: true,
      limit: input.limit ?? 10,
    },
  );

  return records.map((record) => ({
    title: record.title,
    content: record.content,
    priority: record.locked ? 3 : Math.max(0, Math.min(3, Math.round(record.relevanceScore / 5))),
  }));
}
