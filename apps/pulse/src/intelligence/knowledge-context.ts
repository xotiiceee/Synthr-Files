/**
 * Knowledge Context — injects user's knowledge notes into LLM prompts.
 *
 * Priority notes (priority > 0) are ALWAYS included.
 * Normal notes are included when their title/tags match the topic/query.
 */

import { loadState } from '../core/state.js';
import { currentRuntimeAgentId as currentAgentId } from '../core/runtime-agent-state.js';

interface KnowledgeNote {
  id: string;
  title: string;
  content: string;
  tags: string[];
  priority: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Get relevant knowledge notes for a given topic/context.
 * Always includes priority notes. Matches normal notes by keyword overlap.
 * Returns formatted string ready to inject into prompts.
 */
export function getKnowledgeContext(topic?: string, maxNotes: number = 10): string {
  // Load from per-agent key first, fall back to shared key
  const agentId = currentAgentId();
  let notes = loadState<KnowledgeNote[]>(`knowledge-notes-${agentId}`, []);
  if (notes.length === 0) {
    // Fall back to shared key (legacy / pre-migration)
    notes = loadState<KnowledgeNote[]>('knowledge-notes', []);
  }
  if (notes.length === 0) return '';

  // Always include priority notes
  const priority = notes.filter(n => n.priority > 0);

  // Match normal notes by topic keywords
  let matched: KnowledgeNote[] = [];
  if (topic) {
    const words = topic.toLowerCase().split(/\s+/);
    matched = notes
      .filter(n => n.priority === 0)
      .filter(n => {
        const haystack = (n.title + ' ' + n.content + ' ' + n.tags.join(' ')).toLowerCase();
        return words.some(w => w.length > 3 && haystack.includes(w));
      })
      .slice(0, maxNotes - priority.length);
  }

  const relevant = [...priority, ...matched];
  if (relevant.length === 0) return '';

  const formatted = relevant.map(n => {
    const label = n.priority > 0 ? ' [ALWAYS INCLUDE]' : '';
    return `### ${n.title}${label}\n${n.content}`;
  }).join('\n\n');

  return `\n\n## Creator Knowledge\nThe following notes are from the creator. Use this knowledge naturally when relevant — don't force it, but weave it in when the topic connects:\n\n${formatted}\n`;
}
