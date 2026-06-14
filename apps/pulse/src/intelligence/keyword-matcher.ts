/**
 * Smart keyword matching with stemming + synonym expansion.
 * Phase 1 of hybrid filter — fast, free, reduces false negatives.
 * Phase 2 is the existing LLM relevance scorer (safety net for false positives).
 */

/** Basic stemming: remove common English suffixes */
function stem(word: string): string {
  const w = word.toLowerCase();
  if (w.length < 4) return w; // Don't stem short words

  // Try suffix removal (longest first)
  let result = w;
  if (w.endsWith('ation')) result = w.slice(0, -5);
  else if (w.endsWith('ment')) result = w.slice(0, -4);
  else if (w.endsWith('ness')) result = w.slice(0, -4);
  else if (w.endsWith('tion')) result = w.slice(0, -4);
  else if (w.endsWith('sion')) result = w.slice(0, -4);
  else if (w.endsWith('ing') && w.length > 5) result = w.slice(0, -3);
  else if (w.endsWith('ity') && w.length > 5) result = w.slice(0, -3);
  else if (w.endsWith('ly') && w.length > 4) result = w.slice(0, -2);
  else if (w.endsWith('ed') && w.length > 4) result = w.slice(0, -2);
  else if (w.endsWith('er') && w.length > 4) result = w.slice(0, -2);
  else if (w.endsWith('es') && w.length > 4) result = w.slice(0, -2);
  else if (w.endsWith('s') && w.length > 3) result = w.slice(0, -1);

  // Reject stems shorter than 4 chars — too aggressive, causes false positives
  if (result.length < 4) return w;
  return result;
}

/**
 * Static synonym expansion dictionary — domain-specific to AI/agent/crypto ecosystem.
 * Keys are canonical terms, values are related words that should match.
 * No LLM calls needed — hardcoded at startup.
 */
const SYNONYM_DICT: Record<string, string[]> = {
  // Financial
  spend: ['spending', 'spent', 'purchase', 'buy', 'bought', 'transaction', 'cost', 'expense'],
  money: ['funds', 'balance', 'credits', 'usdc', 'capital', 'cash', 'currency', 'dollar'],
  wallet: ['account', 'address', 'vault', 'keypair', 'treasury'],
  budget: ['limit', 'allocation', 'quota', 'cap', 'threshold'],
  pay: ['payment', 'paying', 'paid', 'transfer', 'send', 'remit', 'settle', 'charge'],
  billing: ['invoice', 'charge', 'subscription', 'metered', 'usage'],
  cost: ['expense', 'price', 'fee', 'rate', 'pricing', 'cheap', 'expensive'],

  // Agent/AI
  agent: ['autonomous', 'bot', 'assistant', 'agentic', 'ai agent'],
  orchestrat: ['coordinate', 'pipeline', 'workflow', 'chain', 'routing'],
  infra: ['infrastructure', 'platform', 'framework', 'stack', 'deploy'],
  llm: ['model', 'gpt', 'claude', 'llama', 'gemini', 'anthropic', 'openai'],
  prompt: ['template', 'instruction', 'system message', 'context window'],

  // Reliability
  fail: ['failure', 'error', 'crash', 'incident', 'outage', 'downtime', 'broke'],
  reliab: ['uptime', 'available', 'sla', 'failover', 'redundant', 'resilient'],
  monitor: ['observ', 'logging', 'tracing', 'dashboard', 'alert', 'metric'],

  // Trust/Security
  trust: ['verify', 'verification', 'proof', 'validation', 'receipt', 'attest'],
  secur: ['permission', 'sandbox', 'guardrail', 'auth', 'credential'],

  // Commerce
  market: ['marketplace', 'catalog', 'listing', 'exchange', 'store', 'registry'],
  skill: ['tool', 'capability', 'function', 'plugin', 'action', 'service'],

  // Blockchain/Crypto
  onchain: ['blockchain', 'smart contract', 'defi', 'web3', 'solana', 'ethereum'],
  token: ['coin', 'crypto', 'nft', 'mint'],
  usdc: ['stablecoin', 'stable coin', 'circle'],

  // Protocol
  x402: ['402', 'payment required', 'micropayment', 'paywall'],
  mcp: ['model context protocol', 'tool server', 'tool use'],
  sdk: ['library', 'client', 'package', 'framework', 'integration'],

  // DevOps
  deploy: ['deployment', 'deploying', 'deployed', 'ship', 'shipping', 'release'],
  scale: ['scaling', 'scalable', 'scalability', 'growth', 'throughput'],
  observ: ['observability', 'monitoring', 'logging', 'tracing', 'dashboard'],
};

/** Build reverse lookup: stemmed synonym → set of stemmed canonical terms */
function buildReverseIndex(): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();

  for (const [canonical, synonyms] of Object.entries(SYNONYM_DICT)) {
    const canonStem = stem(canonical);
    const allTerms = [canonical, ...synonyms];

    for (const term of allTerms) {
      // For multi-word synonyms, index each word
      const words = term.split(/\s+/);
      for (const word of words) {
        const wordStem = stem(word);
        if (!index.has(wordStem)) index.set(wordStem, new Set());
        index.get(wordStem)!.add(canonStem);
      }
    }
  }

  return index;
}

const REVERSE_INDEX = buildReverseIndex();

/**
 * Check if text matches keywords using stemming + synonym expansion.
 * More permissive than exact substring — relies on LLM relevance scorer
 * as Phase 2 to filter false positives.
 *
 * @param text - The text to check (title + snippet from search result)
 * @param keywords - The textMustMatch array from topic config
 * @param minHits - Minimum keyword matches required (default 1)
 */
export function matchesKeywords(
  text: string,
  keywords: string[],
  minHits: number = 1,
): boolean {
  if (keywords.length === 0) return true;

  const words = text.toLowerCase().split(/\W+/).filter(Boolean);
  const stemmedWords = new Set(words.map(stem));

  const matchedKeywords = new Set<string>();

  for (const keyword of keywords) {
    const kwStem = stem(keyword);

    // Direct stemmed match
    if (stemmedWords.has(kwStem)) {
      matchedKeywords.add(keyword);
      continue;
    }

    // Check if any word in text is a synonym of this keyword
    for (const wordStem of stemmedWords) {
      const canonicals = REVERSE_INDEX.get(wordStem);
      if (canonicals?.has(kwStem)) {
        matchedKeywords.add(keyword);
        break;
      }
    }
  }

  return matchedKeywords.size >= minHits;
}

/**
 * Expand keywords with their synonyms (for debugging/UI display).
 */
export function expandKeywords(keywords: string[]): string[] {
  const expanded = new Set(keywords.map((k) => k.toLowerCase()));
  for (const kw of keywords) {
    const kwLower = kw.toLowerCase();
    const synonyms = SYNONYM_DICT[kwLower];
    if (synonyms) {
      for (const s of synonyms) expanded.add(s);
    }
    // Also check stemmed version
    const kwStem = stem(kwLower);
    const synonymsStemmed = SYNONYM_DICT[kwStem];
    if (synonymsStemmed) {
      for (const s of synonymsStemmed) expanded.add(s);
    }
  }
  return Array.from(expanded);
}
