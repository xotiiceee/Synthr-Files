/**
 * Auto-generates search topics from the persona config.
 * Uses LLM to create Google-search-optimized queries with reply templates.
 */

import { askLLM } from '../core/llm.js';
import { getConfig, type SearchTopic } from '../core/persona.js';

/**
 * Generate search topics based on the persona configuration.
 * Each topic includes a Google-optimized query, match keywords, and reply templates.
 */
export async function generateTopics(count: number = 15): Promise<SearchTopic[]> {
  const config = getConfig();
  const { persona, competitors } = config;

  const prompt = `You are a marketing strategist. Generate exactly ${count} search topics for finding conversations where someone could naturally mention "${persona.brandName}".

Context:
- Niche: ${persona.niche}
- Problem solved: ${persona.problemSolved}
- Ideal customer: ${persona.idealCustomer}
- Competitors: ${competitors.join(', ') || 'none specified'}
- Tone: ${persona.tone}

For each topic, return a JSON object with:
- "id": a short kebab-case identifier (e.g. "pricing-frustration")
- "query": a Google-search-optimized query string that would find relevant conversations (use natural language people would actually type)
- "textMustMatch": an array of 2-4 keywords that MUST appear in the search result text for it to be relevant
- "replies": an array of 2-3 short reply templates (use {brand} as placeholder for the brand name, keep them conversational and helpful, not salesy)

Return ONLY a valid JSON array. No markdown fences, no explanation, just the raw JSON array.

Example format:
[{"id":"slow-deploys","query":"frustrated with slow deployment times","textMustMatch":["deploy","slow","minutes"],"replies":["I had the same issue — switched to {brand} and deploys went from 10min to 30s. What stack are you on?","Deployment speed is so underrated. We cut ours down massively with {brand}, happy to share how if useful."]}]

Generate ${count} diverse topics covering: pain points, competitor complaints, how-to questions, recommendations requests, and general niche discussions.`;

  const response = await askLLM(prompt, { maxTokens: 3000, temperature: 0.8 });

  if (!response) {
    console.log('  [TopicGen] LLM unavailable — returning empty topics');
    return [];
  }

  try {
    // Try to extract JSON array from response (handle markdown fences if LLM ignores instruction)
    let jsonStr = response.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      jsonStr = fenceMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr) as SearchTopic[];

    if (!Array.isArray(parsed)) {
      console.log('  [TopicGen] LLM returned non-array — discarding');
      return [];
    }

    // Validate and sanitize each topic
    return parsed
      .filter((t) => t.id && t.query && Array.isArray(t.textMustMatch) && Array.isArray(t.replies))
      .map((t) => ({
        id: String(t.id),
        query: String(t.query),
        textMustMatch: t.textMustMatch.map(String),
        replies: t.replies.map(String),
      }));
  } catch (err) {
    console.log(`  [TopicGen] Failed to parse LLM response: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}
