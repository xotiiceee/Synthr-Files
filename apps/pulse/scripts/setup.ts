/**
 * PULSE — Intelligent Setup Wizard
 *
 * 2-question freeform setup + guided API key configuration.
 * Describe your business in plain English → LLM generates everything.
 * Works for ANY niche, ANY business, ANY micro-niche.
 *
 * Usage: npx tsx scripts/setup.ts
 */

import readline from 'readline';
import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';
config();

import { showHelpIfNeeded } from '../src/core/help.js';
if (showHelpIfNeeded(process.argv.slice(2), 'setup')) process.exit(0);

import { askLLM } from '../src/core/llm.js';
import { search } from '../src/core/search.js';
import { saveConfig, type PulseConfig, type PlatformSettings } from '../src/core/persona.js';

// ─── Readline helpers ────────────────────────────────────────────────────────

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

function line() { console.log('─'.repeat(50)); }
function banner(text: string) {
  console.log('');
  console.log('═'.repeat(50));
  console.log(`  ${text}`);
  console.log('═'.repeat(50));
  console.log('');
}

// ─── API Key Setup Guide ────────────────────────────────────────────────────

async function setupApiKeys(): Promise<void> {
  banner('Step 1: AI Provider (powers replies + content)');

  console.log('  Which AI provider would you like to use?\n');
  console.log('    1. Groq (recommended) — usage-based hosted inference, Llama 3.3 70B');
  console.log('    2. OpenAI            — ~$0.15 per 1K requests, GPT-4o-mini');
  console.log('    3. Anthropic         — ~$0.25 per 1K requests, Claude (best conversational tone)');
  console.log('    4. OpenRouter        — Pay-per-use, access to 100+ models');
  console.log('    5. Ollama            — runs locally (requires GPU)\n');

  const providerChoice = await ask('  Pick 1-5 (default: 1 for Groq): ');
  const providerMap: Record<string, { name: string; envKey: string; envName: string; url: string; hint: string }> = {
    '1': { name: 'groq', envKey: 'GROQ_API_KEY', envName: 'Groq', url: 'https://console.groq.com', hint: 'starts with gsk_' },
    '2': { name: 'openai', envKey: 'OPENAI_API_KEY', envName: 'OpenAI', url: 'https://platform.openai.com/api-keys', hint: 'starts with sk-' },
    '3': { name: 'anthropic', envKey: 'ANTHROPIC_API_KEY', envName: 'Anthropic', url: 'https://console.anthropic.com/settings/keys', hint: 'starts with sk-ant-' },
    '4': { name: 'openrouter', envKey: 'OPENROUTER_API_KEY', envName: 'OpenRouter', url: 'https://openrouter.ai/keys', hint: 'starts with sk-or-' },
    '5': { name: 'ollama', envKey: '', envName: 'Ollama', url: 'https://ollama.com', hint: 'no key needed' },
  };
  const chosen = providerMap[providerChoice.trim()] || providerMap['1'];
  appendEnv('LLM_PROVIDER', chosen.name);
  process.env.LLM_PROVIDER = chosen.name;
  console.log(`\n  Selected: ${chosen.envName}\n`);

  if (chosen.name === 'ollama') {
    console.log('  Make sure Ollama is running: ollama serve\n');
  } else {
    console.log(`  How to get your ${chosen.envName} API key:`);
    console.log(`    1. Open: ${chosen.url}`);
    console.log(`    2. Create an API key (${chosen.hint})`);
    console.log('');
  }

  // ── Provider API Key ──
  console.log(`  ${chosen.envName.toUpperCase()} API KEY`);
  console.log('');

  let llmKey = chosen.envKey ? (process.env[chosen.envKey] ?? '') : 'ollama';
  if (chosen.name === 'ollama') {
    console.log('  ✓ Ollama — no API key needed\n');
  } else if (llmKey) {
    console.log(`  ✓ Already set in .env (${llmKey.slice(0, 8)}...)`);
  } else {
    llmKey = await ask(`  Paste your ${chosen.envName} API key: `);
    if (llmKey) {
      appendEnv(chosen.envKey, llmKey);
      process.env[chosen.envKey] = llmKey;
      process.stdout.write('  Testing connection');
      const interval = setInterval(() => process.stdout.write('.'), 500);
      const test = await askLLM('Reply with exactly: OK');
      clearInterval(interval);
      if (test) {
        console.log(` ✓ ${chosen.envName} connected!\n`);
      } else {
        console.log(` ✗ Could not connect — check the key.\n`);
      }
    } else {
      console.log('  ⚠ Skipped — PULSE needs this to generate smart replies.\n');
    }
  }

  line();

  // ── Serper ──
  console.log('\n  SERPER API KEY (required)');
  console.log('  Finds X conversations and news through search.');
  console.log('');
  console.log('  How to get it:');
  console.log('    1. Open: https://serper.dev');
  console.log('    2. Sign up and create an API key');
  console.log('    3. Your API key is on the dashboard');
  console.log('    4. Copy it');
  console.log('');

  let serperKey = process.env.SERPER_API_KEY ?? '';
  if (serperKey) {
    console.log(`  ✓ Already set in .env (${serperKey.slice(0, 8)}...)`);
  } else {
    serperKey = await ask('  Paste your Serper API key: ');
    if (serperKey) {
      appendEnv('SERPER_API_KEY', serperKey);
      process.env.SERPER_API_KEY = serperKey;
      const results = await search('test query', { num: 1 });
      if (results.length > 0) {
        console.log('  ✓ Serper connected! Search is working.\n');
      } else {
        console.log('  ✓ Key saved (could not verify — may be fine).\n');
      }
    } else {
      console.log('  ⚠ Skipped — PULSE needs this to find conversations.\n');
    }
  }

  line();

  // ── X/Twitter ──
  console.log('\n  X/TWITTER API KEYS (optional — needed to post on X)');
  console.log('  Set X_MONTHLY_POST_LIMIT to your approved API tier capacity.');
  console.log('');
  console.log('  How to get them:');
  console.log('    1. Open: https://developer.x.com');
  console.log('    2. Sign up for a developer account and choose the right tier');
  console.log('    3. Create a new app');
  console.log('    4. Set "User authentication" to Read+Write');
  console.log('    5. Go to "Keys and tokens" tab');
  console.log('    6. You need 4 values: API Key, API Secret,');
  console.log('       Access Token, Access Token Secret');
  console.log('');

  const hasX = !!(process.env.X_API_KEY && process.env.X_ACCESS_TOKEN);
  if (hasX) {
    console.log('  ✓ Already set in .env\n');
  } else {
    const wantX = await ask('  Set up X now? (y/n): ');
    if (wantX.toLowerCase() === 'y') {
      const xApiKey = await ask('  API Key: ');
      const xApiSecret = await ask('  API Secret: ');
      const xAccessToken = await ask('  Access Token: ');
      const xAccessTokenSecret = await ask('  Access Token Secret: ');
      if (xApiKey && xApiSecret && xAccessToken && xAccessTokenSecret) {
        appendEnv('X_API_KEY', xApiKey);
        appendEnv('X_API_SECRET', xApiSecret);
        appendEnv('X_ACCESS_TOKEN', xAccessToken);
        appendEnv('X_ACCESS_TOKEN_SECRET', xAccessTokenSecret);
        process.env.X_API_KEY = xApiKey;
        process.env.X_API_SECRET = xApiSecret;
        process.env.X_ACCESS_TOKEN = xAccessToken;
        process.env.X_ACCESS_TOKEN_SECRET = xAccessTokenSecret;
        console.log('  ✓ X credentials saved!\n');
      }
    } else {
      console.log('  Skipped X setup.\n');
    }
  }

  line();

  // ── Reddit ──
  console.log('\n  REDDIT API KEYS (optional — needed to post on Reddit)');
  console.log('  Free: 100 requests/minute. Skip if you don\'t want Reddit.');
  console.log('');
  console.log('  How to get them:');
  console.log('    1. Open: https://www.reddit.com/prefs/apps');
  console.log('    2. Click "create another app"');
  console.log('    3. Select "script" type');
  console.log('    4. Set redirect URI to: http://localhost:8080');
  console.log('    5. Note the app ID (under the app name) and secret');
  console.log('');

  const hasReddit = !!(process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET);
  if (hasReddit) {
    console.log('  ✓ Already set in .env\n');
  } else {
    const wantReddit = await ask('  Set up Reddit now? (y/n): ');
    if (wantReddit.toLowerCase() === 'y') {
      const redditId = await ask('  Client ID: ');
      const redditSecret = await ask('  Client Secret: ');
      const redditUser = await ask('  Reddit Username: ');
      const redditPass = await ask('  Reddit Password: ');
      if (redditId && redditSecret && redditUser && redditPass) {
        appendEnv('REDDIT_CLIENT_ID', redditId);
        appendEnv('REDDIT_CLIENT_SECRET', redditSecret);
        appendEnv('REDDIT_USERNAME', redditUser);
        appendEnv('REDDIT_PASSWORD', redditPass);
        console.log('  ✓ Reddit credentials saved!\n');
      }
    } else {
      console.log('  Skipped Reddit setup.\n');
    }
  }

  line();

  // ── Discord ──
  console.log('\n  DISCORD BOT TOKEN (optional — needed to post in Discord)');
  console.log('  Free and unlimited. Skip if you don\'t use Discord.');
  console.log('');
  console.log('  How to get it:');
  console.log('    1. Open: https://discord.com/developers/applications');
  console.log('    2. Click "New Application" → name it → Create');
  console.log('    3. Go to "Bot" in the sidebar → "Add Bot"');
  console.log('    4. Click "Reset Token" → copy the token');
  console.log('    5. Under "Privileged Gateway Intents", enable:');
  console.log('       Message Content Intent');
  console.log('    6. Go to OAuth2 → URL Generator:');
  console.log('       Scopes: bot');
  console.log('       Permissions: Send Messages, Read Messages');
  console.log('    7. Copy the URL and open it to invite bot to your server');
  console.log('');

  const hasDiscord = !!process.env.DISCORD_BOT_TOKEN;
  if (hasDiscord) {
    console.log('  ✓ Already set in .env\n');
  } else {
    const wantDiscord = await ask('  Set up Discord now? (y/n): ');
    if (wantDiscord.toLowerCase() === 'y') {
      const discordToken = await ask('  Bot Token: ');
      const discordChannels = await ask('  Channel IDs (comma-separated): ');
      if (discordToken) {
        appendEnv('DISCORD_BOT_TOKEN', discordToken);
        if (discordChannels) appendEnv('DISCORD_CHANNEL_IDS', discordChannels);
        console.log('  ✓ Discord credentials saved!\n');
      }
    } else {
      console.log('  Skipped Discord setup.\n');
    }
  }

  console.log('\n  Other platforms (HN, Product Hunt, LinkedIn) need no API keys —');
  console.log('  they use Serper for discovery and manual posting.\n');
}

// ─── Freeform Intelligent Setup ──────────────────────────────────────────────

async function setupBrand(): Promise<PulseConfig> {
  banner('Step 2: Tell PULSE about your business');

  console.log('  Describe your business in 2-3 sentences. Be specific.');
  console.log('  The more detail you give, the smarter PULSE gets.');
  console.log('');
  console.log('  Examples:');
  console.log('    "I teach busy moms how to meal prep healthy lunches');
  console.log('     in under 20 minutes. I sell a $27 recipe ebook on');
  console.log('     quicklunchkids.com"');
  console.log('');
  console.log('    "I run a Solana-based payment API for AI agents.');
  console.log('     Developers integrate it to let their agents spend');
  console.log('     USDC autonomously with budget caps."');
  console.log('');
  console.log('    "I\'m a freelance wedding photographer in Austin, TX.');
  console.log('     I specialize in small intimate ceremonies under 50 guests."');
  console.log('');

  const description = await ask('  Your business: ');
  if (!description) {
    console.log('  A description is required. Exiting.');
    process.exit(1);
  }

  console.log('');
  const website = await ask('  Website URL (optional, press enter to skip): ');

  console.log('');
  console.log('  Which platforms do you want PULSE active on?');
  console.log('    1. X/Twitter    (auto-reply to conversations)');
  console.log('    2. Reddit       (answer questions in subreddits)');
  console.log('    3. Hacker News  (find relevant tech discussions)');
  console.log('    4. Product Hunt (engage with product launches)');
  console.log('    5. LinkedIn     (generate posts — you post manually)');
  console.log('    6. Discord      (answer questions in servers)');
  console.log('    all = enable everything');
  console.log('');
  const platformInput = await ask('  Platforms (comma-separated numbers, or "all"): ');

  const ALL_PLATFORMS = ['x', 'reddit', 'hackernews', 'producthunt', 'linkedin', 'discord'];
  let enabledPlatforms: string[];
  if (platformInput.toLowerCase() === 'all') {
    enabledPlatforms = [...ALL_PLATFORMS];
  } else {
    const nums = platformInput.split(',').map(s => parseInt(s.trim(), 10)).filter(n => n >= 1 && n <= 6);
    enabledPlatforms = nums.map(n => ALL_PLATFORMS[n - 1]);
    if (enabledPlatforms.length === 0) {
      console.log('  Defaulting to X.');
      enabledPlatforms = ['x'];
    }
  }

  console.log('');
  console.log('  How active should PULSE be?');
  console.log('    1. Gentle   — 3-5 interactions/day (just starting out)');
  console.log('    2. Moderate — 8-12/day (growing steadily)');
  console.log('    3. Active   — 15-20/day (aggressive growth)');
  console.log('');
  const paceInput = await ask('  Pace (1/2/3): ');
  const pace = paceInput === '1' ? 'conservative' as const
    : paceInput === '3' ? 'active' as const
    : 'moderate' as const;

  console.log('');
  const xHandleRaw = await ask('  What\'s your X/Twitter handle? (e.g., @yourbrand, or press Enter to skip): ');
  const xHandle = xHandleRaw ? (xHandleRaw.startsWith('@') ? xHandleRaw : `@${xHandleRaw}`) : '';

  rl.close();

  // ─── LLM generates EVERYTHING from the description ──────────────────────

  banner('Generating your marketing strategy...');
  console.log('  PULSE is analyzing your business and building a');
  console.log('  custom strategy. This takes 10-20 seconds...\n');

  const llmPrompt = `You are an expert marketing strategist. A business owner described their company:

"${description}"
${website ? `Website: ${website}` : ''}
Active platforms: ${enabledPlatforms.join(', ')}

From this description, generate a COMPLETE marketing agent configuration. You must figure out:
- What niche/industry they're in
- Who their ideal customer is
- What problem they solve
- What makes them unique
- Who their competitors are
- What tone fits their brand
- What conversations they should join on social media

Return ONLY valid JSON (no markdown, no code fences, no explanation) with this exact structure:

{
  "brandName": "extracted or inferred brand name",
  "niche": "their niche/industry in 2-3 words",
  "tagline": "a one-line description of what they do",
  "idealCustomer": "who they serve, be specific",
  "problemSolved": "the core problem they solve",
  "uniqueValue": "what makes them different",
  "tone": "one of: professional, casual, witty, technical, friendly, authoritative",
  "neverSay": ["8-12 phrases that would sound inauthentic for this brand, e.g. 'game-changer', 'synergy', 'leverage'"],
  "competitors": ["5-10 competitor brands/products/tools in their space"],
  "topics": [
    {
      "id": "slug-id",
      "query": "Google search query to find relevant conversations (be specific, use quotes for exact phrases)",
      "textMustMatch": ["3-5 keywords that results must contain to be relevant"],
      "replies": [
        "Reply angle 1 — a brief description of how to respond (NOT a full reply, the AI generates those live)",
        "Reply angle 2"
      ]
    }
  ],
  "contentThemes": ["20 specific content themes for original posts, e.g. 'myth: you need expensive equipment to get fit'"],
  "subreddits": ["5-10 subreddits where their audience hangs out, e.g. 'r/fitness'"],
  "discordKeywords": ["keywords to search for in Discord servers"]
}

CRITICAL RULES:
- Generate exactly 15 topics with search queries optimized for finding real conversations
- Topics should cover: pain points, questions, alternatives-seeking, complaints, how-to, recommendations
- Queries should work with "site:x.com" or "site:reddit.com" prefix
- Reply angles should NOT be full replies — just describe the approach (the AI generates actual replies at runtime)
- Content themes should be diverse: educational, myths, tips, stories, comparisons, controversial takes
- Be specific to THEIR business, not generic marketing advice
- If you can't determine something, make your best inference from the description`;

  let llmOutput: Record<string, unknown> | null = null;

  try {
    const raw = await askLLM(llmPrompt, { maxTokens: 3000, temperature: 0.7 });
    if (raw) {
      // Strip any markdown fences the LLM might add despite instructions
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      llmOutput = JSON.parse(cleaned);
    }
  } catch (err) {
    console.log('  LLM parsing failed — using minimal config.');
    console.log(`  Error: ${err instanceof Error ? err.message : String(err)}\n`);
  }

  if (!llmOutput) {
    console.log('  Could not generate strategy. Check your GROQ_API_KEY.');
    console.log('  You can edit pulse.yaml manually or re-run setup.\n');
  }

  // ─── Build config ────────────────────────────────────────────────────────

  const PACE_LIMITS = {
    conservative: { maxPerDay: 5, maxPerRun: 2 },
    moderate: { maxPerDay: 12, maxPerRun: 4 },
    active: { maxPerDay: 20, maxPerRun: 6 },
  };

  const limits = PACE_LIMITS[pace];
  const platforms: Record<string, PlatformSettings> = {};
  for (const p of ALL_PLATFORMS) {
    platforms[p] = {
      enabled: enabledPlatforms.includes(p),
      maxPerDay: enabledPlatforms.includes(p) ? limits.maxPerDay : 0,
      maxPerRun: enabledPlatforms.includes(p) ? limits.maxPerRun : 0,
      ...(p === 'reddit' && llmOutput?.subreddits
        ? { subreddits: llmOutput.subreddits as string[] }
        : {}),
    };
  }

  const finalConfig: PulseConfig = {
    persona: {
      name: (llmOutput?.brandName as string) || description.split(/[.,!]/)[0].trim().slice(0, 30),
      brandName: (llmOutput?.brandName as string) || description.split(/[.,!]/)[0].trim().slice(0, 30),
      website: website || '',
      tagline: (llmOutput?.tagline as string) || description.slice(0, 100),
      niche: (llmOutput?.niche as string) || 'general',
      idealCustomer: (llmOutput?.idealCustomer as string) || '',
      problemSolved: (llmOutput?.problemSolved as string) || '',
      uniqueValue: (llmOutput?.uniqueValue as string) || '',
      tone: ((llmOutput?.tone as string) || 'casual') as PulseConfig['persona']['tone'],
      neverSay: (llmOutput?.neverSay as string[]) || [],
      ...(xHandle ? { xHandle } : {}),
    },
    platforms,
    topics: (llmOutput?.topics as PulseConfig['topics']) || [],
    contentThemes: (llmOutput?.contentThemes as string[]) || [],
    competitors: (llmOutput?.competitors as string[]) || [],
    schedule: {
      outreachIntervalHours: pace === 'active' ? 2 : pace === 'moderate' ? 3 : 4,
      contentPostsPerDay: pace === 'active' ? 4 : pace === 'moderate' ? 2 : 1,
      adaptationIntervalDays: 7,
    },
    aggressiveness: pace,
  };

  saveConfig(finalConfig);
  return finalConfig;
}

// ─── .env helper ────────────────────────────────────────────────────────────

function appendEnv(key: string, value: string): void {
  const envPath = path.join(process.cwd(), '.env');
  let content = '';
  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, 'utf-8');
    // Replace existing key if present
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (regex.test(content)) {
      content = content.replace(regex, `${key}=${value}`);
      fs.writeFileSync(envPath, content);
      return;
    }
  }
  // Append
  fs.appendFileSync(envPath, `${content && !content.endsWith('\n') ? '\n' : ''}${key}=${value}\n`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  banner('PULSE — AI Marketing Agent');
  console.log('  Set up your marketing agent in under 5 minutes.');
  console.log('  Add the provider keys required for your selected runtime.\n');

  // Step 1: API Keys (guided)
  await setupApiKeys();

  // Step 2: Business description (freeform → LLM)
  const config = await setupBrand();

  // ─── Summary ──────────────────────────────────────────────────────────────

  banner('Setup Complete!');
  console.log(`  Brand:        ${config.persona.brandName}`);
  console.log(`  Niche:        ${config.persona.niche}`);
  console.log(`  Tone:         ${config.persona.tone}`);
  console.log(`  Platforms:    ${Object.entries(config.platforms).filter(([, s]) => s.enabled).map(([k]) => k).join(', ')}`);
  console.log(`  Topics:       ${config.topics.length} search topics`);
  console.log(`  Themes:       ${config.contentThemes.length} content themes`);
  console.log(`  Competitors:  ${config.competitors.length} tracked`);
  console.log(`  Pace:         ${config.aggressiveness}`);
  console.log('');
  console.log('  Next steps:');
  console.log('    1. npm run test-config    — Verify all API keys work');
  console.log('    2. npm run dry-run        — Preview 5 replies without posting');
  console.log('    3. npm run panel          — Open the web dashboard');
  console.log('    4. npm start              — Start the agent (outreach + content)');
  console.log('');
  console.log('  IMPORTANT: Always run dry-run first to review reply quality!');
  console.log('');
  console.log('  More commands:');
  console.log('    npm run voice-calibrate   — Fine-tune your brand voice (5 samples)');
  console.log('    npm run calendar          — Generate a weekly content plan');
  console.log('    npm run emails            — Generate email sequences');
  console.log('    npm run landing-page      — Generate a landing page');
  console.log('');
  console.log('  Config saved to: pulse.yaml');
  console.log('  Edit it anytime, or use the web panel: npm run panel\n');
}

main().catch((err) => {
  console.error('Setup failed:', err);
  rl.close();
  process.exit(1);
});
