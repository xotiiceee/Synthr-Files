/**
 * PULSE — Brand Management CLI
 *
 * Manage multiple brands and white-label config from the command line.
 *
 * Usage:
 *   npx tsx scripts/brands.ts list
 *   npx tsx scripts/brands.ts create <slug>
 *   npx tsx scripts/brands.ts switch <slug>
 *   npx tsx scripts/brands.ts delete <slug>
 *   npx tsx scripts/brands.ts current
 *   npx tsx scripts/brands.ts whitelabel
 */

import readline from 'readline';
import { config } from 'dotenv';
config();

import { showHelpIfNeeded } from '../src/core/help.js';
if (showHelpIfNeeded(process.argv.slice(2), 'brands')) process.exit(0);

import {
  listBrands,
  createBrand,
  switchBrand,
  getCurrentBrand,
  deleteBrand,
} from '../src/core/brands.js';
import {
  getWhiteLabelConfig,
  setWhiteLabelConfig,
} from '../src/core/whitelabel.js';
import { askLLM } from '../src/core/llm.js';
import type { PulseConfig, PlatformSettings } from '../src/core/persona.js';

// ─── Readline helpers ────────────────────────────────────────────────────────

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

function banner(text: string) {
  console.log('');
  console.log('='.repeat(40));
  console.log(`  ${text}`);
  console.log('='.repeat(40));
  console.log('');
}

// ─── Commands ────────────────────────────────────────────────────────────────

async function cmdList(): Promise<void> {
  const brands = listBrands();
  const current = getCurrentBrand();

  banner('PULSE \u2014 Brand Manager');

  if (brands.length === 0) {
    console.log('  No brands configured.');
    console.log('  Run: npx tsx scripts/brands.ts create <slug>');
    console.log('');
    return;
  }

  console.log(`  Active brand: ${current ? `${current} \u25cf` : 'none (single-brand mode)'}`);
  console.log('');

  // Table header
  const slugW = Math.max(14, ...brands.map((b) => b.slug.length + (b.slug === current ? 2 : 0))) + 2;
  const nicheW = Math.max(13, ...brands.map((b) => b.niche.length)) + 2;
  const platW = Math.max(10, ...brands.map((b) => b.platforms.join(', ').length)) + 2;

  const hBorder = (l: string, m: string, r: string) =>
    `  ${l}${'─'.repeat(slugW)}${m}${'─'.repeat(nicheW)}${m}${'─'.repeat(platW)}${r}`;

  console.log(hBorder('┌', '┬', '┐'));
  console.log(
    `  │${'Brand'.padEnd(slugW)}│${'Niche'.padEnd(nicheW)}│${'Platforms'.padEnd(platW)}│`,
  );
  console.log(hBorder('├', '┼', '┤'));

  for (const b of brands) {
    const label = b.slug === current ? `${b.slug} \u25cf` : b.slug;
    const plats = b.platforms.join(', ');
    console.log(
      `  │${label.padEnd(slugW)}│${b.niche.padEnd(nicheW)}│${plats.padEnd(platW)}│`,
    );
  }

  console.log(hBorder('└', '┴', '┘'));
  console.log('');
}

async function cmdCreate(slug: string): Promise<void> {
  if (!slug) {
    console.error('Usage: npx tsx scripts/brands.ts create <slug>');
    process.exit(1);
  }

  banner(`PULSE \u2014 Create Brand: ${slug}`);

  console.log('  Describe your business in 2-3 sentences.');
  console.log('  Include: what you do, who you serve, what makes you different.\n');

  const description = await ask('  Your business: ');
  if (!description) {
    console.error('  Cancelled \u2014 no description provided.');
    process.exit(1);
  }

  const platformInput = await ask('  Platforms (x, reddit, linkedin \u2014 comma-separated): ');
  const platforms = platformInput
    .split(',')
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);

  if (platforms.length === 0) {
    console.error('  Cancelled \u2014 at least one platform required.');
    process.exit(1);
  }

  console.log('\n  Generating brand config with AI...\n');

  const prompt = `You are a marketing strategist. Given this business description, generate a JSON config for an AI marketing agent.

Business: ${description}
Platforms: ${platforms.join(', ')}

Return ONLY valid JSON (no markdown, no explanation) with this exact structure:
{
  "persona": {
    "name": "the agent persona name (a human-sounding first name)",
    "brandName": "the business/brand name",
    "website": "",
    "tagline": "one short tagline",
    "niche": "one word niche category",
    "idealCustomer": "who they serve",
    "problemSolved": "what problem they solve",
    "uniqueValue": "what makes them different",
    "tone": "casual",
    "neverSay": ["spam-sounding phrases to avoid"]
  },
  "contentThemes": ["3-5 content themes"],
  "competitors": ["2-3 competitor types"],
  "topics": [
    {
      "id": "topic-1",
      "query": "search query to find relevant conversations",
      "textMustMatch": ["keywords that must appear"],
      "replies": ["2-3 example reply angles (not full replies)"]
    }
  ]
}

Generate 4-6 topics. Tone should be one of: professional, casual, witty, technical, friendly, authoritative.`;

  const response = await askLLM(prompt);
  if (!response) {
    console.error('  LLM returned no response. Check your API key.');
    process.exit(1);
  }
  let parsed: any;
  try {
    // Strip markdown fences if present
    const cleaned = response.replace(/```json?\n?/g, '').replace(/```\n?/g, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    console.error('  Failed to parse AI response. Try again.');
    console.error('  Raw response:', response.slice(0, 500));
    process.exit(1);
  }

  // Build platform settings
  const allPlatforms: Record<string, PlatformSettings> = {
    x: { enabled: false, maxPerDay: 8, maxPerRun: 3 },
    reddit: { enabled: false, maxPerDay: 5, maxPerRun: 2 },
    hackernews: { enabled: false, maxPerDay: 3, maxPerRun: 1 },
    producthunt: { enabled: false, maxPerDay: 3, maxPerRun: 1 },
    linkedin: { enabled: false, maxPerDay: 3, maxPerRun: 2 },
    discord: { enabled: false, maxPerDay: 5, maxPerRun: 2 },
  };

  for (const p of platforms) {
    if (allPlatforms[p]) allPlatforms[p].enabled = true;
  }

  const pulseConfig: PulseConfig = {
    persona: parsed.persona,
    platforms: allPlatforms,
    topics: parsed.topics || [],
    contentThemes: parsed.contentThemes || [],
    competitors: parsed.competitors || [],
    schedule: {
      outreachIntervalHours: 3,
      contentPostsPerDay: 2,
      adaptationIntervalDays: 7,
    },
    aggressiveness: 'moderate',
  };

  createBrand(slug, pulseConfig);
  console.log(`  Brand "${slug}" created successfully.`);
  console.log(`  Data directory: data/brands/${slug}/`);
  console.log(`\n  To activate: npx tsx scripts/brands.ts switch ${slug}`);
  console.log('');
}

async function cmdSwitch(slug: string): Promise<void> {
  if (!slug) {
    console.error('Usage: npx tsx scripts/brands.ts switch <slug>');
    process.exit(1);
  }

  switchBrand(slug);
  console.log(`\n  Switched to brand: ${slug}\n`);
}

async function cmdDelete(slug: string): Promise<void> {
  if (!slug) {
    console.error('Usage: npx tsx scripts/brands.ts delete <slug>');
    process.exit(1);
  }

  const confirm = await ask(`  Delete brand "${slug}" and ALL its data? (type "yes" to confirm): `);
  if (confirm !== 'yes') {
    console.log('  Cancelled.');
    process.exit(0);
  }

  deleteBrand(slug);
  console.log(`\n  Brand "${slug}" deleted.\n`);
}

async function cmdCurrent(): Promise<void> {
  const current = getCurrentBrand();
  if (current) {
    console.log(`\n  Active brand: ${current}\n`);
  } else {
    console.log('\n  No brand selected (single-brand mode).\n');
  }
}

async function cmdWhitelabel(): Promise<void> {
  banner('PULSE \u2014 White-Label Configuration');

  const current = getWhiteLabelConfig();

  console.log('  Current config:');
  console.log(`    Agent name:   ${current.agentName}`);
  console.log(`    Company:      ${current.companyName}`);
  console.log(`    Company URL:  ${current.companyUrl || '(not set)'}`);
  console.log(`    Primary:      ${current.primaryColor}`);
  console.log(`    Accent:       ${current.accentColor}`);
  console.log(`    Logo URL:     ${current.logoUrl || '(not set)'}`);
  console.log(`    Footer:       ${current.footerText}`);
  console.log(`    Hide credits: ${current.hideCredits}`);
  console.log(`    Enabled:      ${current.enabled}`);
  console.log('');

  const agentName = await ask(`  Agent name [${current.agentName}]: `);
  const companyName = await ask(`  Company name [${current.companyName}]: `);
  const companyUrl = await ask(`  Company URL [${current.companyUrl}]: `);
  const primaryColor = await ask(`  Primary color hex [${current.primaryColor}]: `);
  const accentColor = await ask(`  Accent color hex [${current.accentColor}]: `);
  const logoUrl = await ask(`  Logo URL [${current.logoUrl}]: `);
  const footerText = await ask(`  Footer text [${current.footerText}]: `);
  const hideCredits = await ask(`  Hide "Powered by" credits? (yes/no) [${current.hideCredits ? 'yes' : 'no'}]: `);
  const enabled = await ask(`  Enable white-labeling? (yes/no) [${current.enabled ? 'yes' : 'no'}]: `);

  const updates: Partial<typeof current> = {};
  if (agentName) updates.agentName = agentName;
  if (companyName) updates.companyName = companyName;
  if (companyUrl) updates.companyUrl = companyUrl;
  if (primaryColor) updates.primaryColor = primaryColor;
  if (accentColor) updates.accentColor = accentColor;
  if (logoUrl) updates.logoUrl = logoUrl;
  if (footerText) updates.footerText = footerText;
  if (hideCredits) updates.hideCredits = hideCredits.toLowerCase() === 'yes';
  if (enabled) updates.enabled = enabled.toLowerCase() === 'yes';

  setWhiteLabelConfig(updates);
  console.log('\n  White-label config saved.\n');
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const [command, slug] = process.argv.slice(2);

  try {
    switch (command) {
      case 'list':
        await cmdList();
        break;
      case 'create':
        await cmdCreate(slug);
        break;
      case 'switch':
        await cmdSwitch(slug);
        break;
      case 'delete':
        await cmdDelete(slug);
        break;
      case 'current':
        await cmdCurrent();
        break;
      case 'whitelabel':
        await cmdWhitelabel();
        break;
      default:
        console.log('');
        console.log('  PULSE Brand Manager');
        console.log('');
        console.log('  Commands:');
        console.log('    list                  Show all brands');
        console.log('    create <slug>         Create a new brand (interactive)');
        console.log('    switch <slug>         Set active brand');
        console.log('    delete <slug>         Delete a brand');
        console.log('    current               Show current brand');
        console.log('    whitelabel            Configure white-label settings');
        console.log('');
        break;
    }
  } catch (err) {
    console.error(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  } finally {
    rl.close();
  }
}

main();
