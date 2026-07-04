/**
 * Validate PULSE configuration and connectivity.
 * Checks config file, API keys, and platform readiness.
 */

import { config } from 'dotenv';
config();

import { showHelpIfNeeded } from '../src/core/help.js';
if (showHelpIfNeeded(process.argv.slice(2), 'test-config')) process.exit(0);

import { loadConfig, type PulseConfig } from '../src/core/persona.js';
import { isLLMAvailable } from '../src/core/llm.js';
import { search } from '../src/core/search.js';

// ─── Types ───────────────────────────────────────────────────────────────────

type CheckStatus = 'pass' | 'fail' | 'skip';

interface CheckResult {
  label: string;
  status: CheckStatus;
  detail: string;
}

const LLM_PROVIDER_KEYS: Record<string, string | null> = {
  groq: 'GROQ_API_KEY',
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  ollama: null,
};

const SEARCH_PROVIDER_KEYS: Record<string, string> = {
  serper: 'SERPER_API_KEY',
  brave: 'BRAVE_API_KEY',
  serpapi: 'SERPAPI_API_KEY',
};

// ─── Platform env var requirements ───────────────────────────────────────────

const PLATFORM_CHECKS: Record<string, { envVars: string[]; authNote: string }> = {
  x: {
    envVars: ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_TOKEN_SECRET'],
    authNote: 'OAuth 1.0a',
  },
  reddit: {
    envVars: ['REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET', 'REDDIT_USERNAME', 'REDDIT_PASSWORD'],
    authNote: 'OAuth2',
  },
  hackernews: {
    envVars: [],
    authNote: 'no auth needed',
  },
  producthunt: {
    envVars: [],
    authNote: 'discovery only',
  },
  linkedin: {
    envVars: ['LINKEDIN_ACCESS_TOKEN'],
    authNote: 'manual-assist mode',
  },
  discord: {
    envVars: ['DISCORD_BOT_TOKEN'],
    authNote: 'Bot token',
  },
};

// ─── Checks ──────────────────────────────────────────────────────────────────

async function checkConfig(): Promise<CheckResult> {
  try {
    const cfg = loadConfig();
    const topicCount = cfg.topics?.length ?? 0;
    const platformCount = Object.values(cfg.platforms).filter((p) => p.enabled).length;
    return {
      label: 'pulse.yaml',
      status: 'pass',
      detail: `loaded (${topicCount} topics, ${platformCount} platforms)`,
    };
  } catch {
    return {
      label: 'pulse.yaml',
      status: 'fail',
      detail: 'file not found or invalid YAML -- run `npm run setup`',
    };
  }
}

async function checkLlmProvider(): Promise<CheckResult> {
  const provider = (process.env.LLM_PROVIDER ?? 'groq').toLowerCase();
  const providerKey = LLM_PROVIDER_KEYS[provider];
  if (providerKey === undefined) {
    return {
      label: 'LLM Provider',
      status: 'fail',
      detail: `unsupported LLM_PROVIDER=${provider}`,
    };
  }
  if (providerKey && !process.env[providerKey]) {
    const fallback = Object.values(LLM_PROVIDER_KEYS).find(
      (key): key is string => Boolean(key && process.env[key]),
    );
    if (!fallback) {
      return {
        label: 'LLM Provider',
        status: 'fail',
        detail: `missing ${providerKey}`,
      };
    }
  }
  try {
    const available = await isLLMAvailable();
    if (available) {
      return { label: 'LLM Provider', status: 'pass', detail: `${provider} online` };
    }
    return { label: 'LLM Provider', status: 'fail', detail: 'API returned error' };
  } catch {
    return { label: 'LLM Provider', status: 'fail', detail: 'connection failed' };
  }
}

async function checkSearchProvider(): Promise<CheckResult> {
  const provider = (process.env.SEARCH_PROVIDER ?? 'serper').toLowerCase();
  const providerKey = SEARCH_PROVIDER_KEYS[provider];
  if (!providerKey) {
    return {
      label: 'Search Provider',
      status: 'fail',
      detail: `unsupported SEARCH_PROVIDER=${provider}`,
    };
  }
  if (!process.env[providerKey]) {
    return { label: 'Search Provider', status: 'fail', detail: `missing ${providerKey}` };
  }
  try {
    await search('test', { num: 1 });
    return {
      label: 'Search Provider',
      status: 'pass',
      detail: `${provider} working`,
    };
  } catch {
    return { label: 'Search Provider', status: 'fail', detail: 'API request failed' };
  }
}

function checkPlatform(key: string, enabled: boolean): CheckResult {
  const check = PLATFORM_CHECKS[key];
  if (!check) {
    return { label: key, status: 'skip', detail: 'unknown platform' };
  }

  // Platforms with no env vars needed
  if (check.envVars.length === 0) {
    return { label: platformDisplayName(key), status: 'skip', detail: check.authNote };
  }

  if (!enabled) {
    return { label: platformDisplayName(key), status: 'skip', detail: 'not enabled' };
  }

  const missing = check.envVars.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    return {
      label: platformDisplayName(key),
      status: 'fail',
      detail: `missing: ${missing.join(', ')}`,
    };
  }

  return {
    label: platformDisplayName(key),
    status: 'pass',
    detail: `configured (${check.authNote})`,
  };
}

function platformDisplayName(key: string): string {
  const names: Record<string, string> = {
    x: 'X/Twitter',
    reddit: 'Reddit',
    hackernews: 'Hacker News',
    producthunt: 'Product Hunt',
    linkedin: 'LinkedIn',
    discord: 'Discord',
  };
  return names[key] || key;
}

// ─── Printer ─────────────────────────────────────────────────────────────────

function printResult(result: CheckResult): void {
  const icon = result.status === 'pass' ? '\u2713' : result.status === 'fail' ? '\u2717' : '\u2500';
  const padded = result.label.padEnd(20);
  console.log(`  ${icon} ${padded} -- ${result.detail}`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('');
  console.log('='.repeat(45));
  console.log('  PULSE Config Validator');
  console.log('='.repeat(45));
  console.log('');

  const results: CheckResult[] = [];

  // 1. Config file
  const configResult = await checkConfig();
  results.push(configResult);

  // 2. LLM provider
  const llmResult = await checkLlmProvider();
  results.push(llmResult);

  // 3. Search provider
  const searchResult = await checkSearchProvider();
  results.push(searchResult);

  // 4. Platforms
  let cfg: PulseConfig | null = null;
  try {
    cfg = loadConfig();
  } catch {
    // Already reported above
  }

  const platformOrder = ['x', 'reddit', 'hackernews', 'producthunt', 'linkedin', 'discord'];
  for (const key of platformOrder) {
    const enabled = cfg?.platforms?.[key]?.enabled ?? false;
    results.push(checkPlatform(key, enabled));
  }

  // Print all results
  for (const r of results) {
    printResult(r);
  }

  const failures = results.filter((r) => r.status === 'fail');
  console.log('');

  if (failures.length === 0) {
    console.log('  Ready to run: npm run dry-run');
  } else {
    console.log(`  ${failures.length} issue(s) found. Fix the above and re-run.`);
  }
  console.log('');
}

main().catch((err) => {
  console.error('Config check error:', err.message || err);
  process.exit(1);
});
