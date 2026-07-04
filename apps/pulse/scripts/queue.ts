/**
 * Content Queue CLI for PULSE.
 * Usage:
 *   npx tsx scripts/queue.ts generate        Generate a week of content
 *   npx tsx scripts/queue.ts list            Show queue with status
 *   npx tsx scripts/queue.ts approve [id|all]  Approve items
 *   npx tsx scripts/queue.ts edit <id>       Edit item content
 *   npx tsx scripts/queue.ts skip <id>       Skip item
 *   npx tsx scripts/queue.ts publish         Publish all due items
 *   npx tsx scripts/queue.ts stats           Show queue stats
 */

import { config } from 'dotenv';
config();

import { showHelpIfNeeded } from '../src/core/help.js';
if (showHelpIfNeeded(process.argv.slice(2), 'queue')) process.exit(0);

import readline from 'readline';
import {
  generateWeekContent,
  getQueue,
  approveItem,
  approveAll,
  editItem,
  skipItem,
  publishDueItems,
  getQueueStats,
  type QueueItem,
} from '../src/intelligence/content-queue.js';

// ─── Formatting Helpers ─────────────────────────────────────────────────────

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const MAGENTA = '\x1b[35m';

function formatDate(iso: string): string {
  const d = new Date(iso);
  const dayName = DAY_NAMES[d.getDay()];
  const month = MONTH_NAMES[d.getMonth()];
  const day = d.getDate();
  return `${dayName}, ${month} ${day}`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  let hours = d.getHours();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  const mins = d.getMinutes().toString().padStart(2, '0');
  return `${hours}:${mins} ${ampm}`;
}

function platformLabel(platform: string): string {
  const labels: Record<string, string> = {
    x: 'X',
    reddit: 'Reddit',
    hackernews: 'HN',
    producthunt: 'PH',
    linkedin: 'LinkedIn',
    discord: 'Discord',
  };
  return labels[platform] || platform;
}

function statusBadge(status: string): string {
  switch (status) {
    case 'draft':     return `${YELLOW}DRAFT${RESET}`;
    case 'approved':  return `${CYAN}APPROVED${RESET}`;
    case 'scheduled': return `${CYAN}SCHEDULED${RESET}`;
    case 'published': return `${GREEN}PUBLISHED \u2713${RESET}`;
    case 'failed':    return `${RED}FAILED${RESET}`;
    case 'skipped':   return `${DIM}SKIPPED${RESET}`;
    default:          return status.toUpperCase();
  }
}

function truncate(text: string, max: number): string {
  const oneLine = text.replace(/\n/g, ' ').trim();
  if (oneLine.length <= max) return oneLine;
  return oneLine.slice(0, max - 3) + '...';
}

// ─── Commands ───────────────────────────────────────────────────────────────

async function cmdGenerate(): Promise<void> {
  console.log('\n  Generating a week of content...\n');
  const items = await generateWeekContent();

  if (items.length === 0) {
    console.log('  No content generated. Check your pulse.yaml config.\n');
    return;
  }

  console.log(`\n  Generated ${items.length} content items.`);
  console.log(`  Run ${BOLD}npx tsx scripts/queue.ts list${RESET} to review.`);
  console.log(`  Run ${BOLD}npx tsx scripts/queue.ts approve all${RESET} to approve all.\n`);
}

function cmdList(): void {
  const items = getQueue();

  if (items.length === 0) {
    console.log('\n  Queue is empty. Run `npx tsx scripts/queue.ts generate` first.\n');
    return;
  }

  // Group by day
  const byDay = new Map<string, QueueItem[]>();
  for (const item of items) {
    const dayKey = item.scheduledAt.slice(0, 10);
    if (!byDay.has(dayKey)) byDay.set(dayKey, []);
    byDay.get(dayKey)!.push(item);
  }

  console.log('');
  console.log('\u2550'.repeat(42));
  console.log(`  ${BOLD}PULSE Content Queue${RESET}`);
  console.log('\u2550'.repeat(42));

  for (const [dayKey, dayItems] of byDay) {
    console.log(`\n  ${BOLD}${formatDate(dayKey + 'T00:00:00Z')}${RESET}`);

    for (const item of dayItems) {
      const badge = statusBadge(item.status);
      const plat = platformLabel(item.platform);
      const time = formatTime(item.scheduledAt);
      const preview = truncate(item.content, 50);

      console.log(`\n  #${item.id} [${badge}] ${plat} \u2014 ${time}`);
      console.log(`  ${DIM}"${preview}"${RESET}`);

      if (item.theme) {
        console.log(`  ${DIM}Theme: ${item.theme}${RESET}`);
      }

      if (item.postUrl) {
        console.log(`  ${GREEN}\u2192 ${item.postUrl}${RESET}`);
      }
    }
  }

  console.log('');
}

function cmdApprove(args: string[]): void {
  const target = args[0];

  if (!target) {
    console.log('\n  Usage: npx tsx scripts/queue.ts approve [id|all]\n');
    return;
  }

  if (target === 'all') {
    const count = approveAll();
    console.log(`\n  Approved ${count} item(s). They will be auto-published when due.\n`);
  } else {
    const id = parseInt(target, 10);
    if (isNaN(id)) {
      console.error('  Invalid ID. Provide a number or "all".');
      process.exit(1);
    }
    approveItem(id);
    console.log(`\n  Approved item #${id}.\n`);
  }
}

async function cmdEdit(args: string[]): Promise<void> {
  const idStr = args[0];
  if (!idStr) {
    console.log('\n  Usage: npx tsx scripts/queue.ts edit <id>\n');
    return;
  }

  const id = parseInt(idStr, 10);
  if (isNaN(id)) {
    console.error('  Invalid ID.');
    process.exit(1);
  }

  // Find the item
  const items = getQueue();
  const item = items.find(i => i.id === id);
  if (!item) {
    console.log(`\n  Item #${id} not found.\n`);
    return;
  }

  console.log(`\n  Editing item #${id} (${platformLabel(item.platform)})`);
  console.log(`  Current content:\n`);
  console.log(`  ${DIM}${item.content}${RESET}\n`);
  console.log('  Enter new content (press Enter twice to finish, Ctrl+C to cancel):\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const lines: string[] = [];
  let emptyCount = 0;

  const result = await new Promise<string>((resolve) => {
    rl.on('line', (line) => {
      if (line === '') {
        emptyCount++;
        if (emptyCount >= 2) {
          rl.close();
          resolve(lines.join('\n').trim());
          return;
        }
      } else {
        // If there was one empty line before, add it back
        if (emptyCount === 1) lines.push('');
        emptyCount = 0;
      }
      lines.push(line);
    });

    rl.on('close', () => {
      resolve(lines.join('\n').trim());
    });
  });

  if (result) {
    editItem(id, result);
    console.log(`\n  Updated item #${id}.\n`);
  } else {
    console.log('\n  No changes made.\n');
  }
}

function cmdSkip(args: string[]): void {
  const idStr = args[0];
  if (!idStr) {
    console.log('\n  Usage: npx tsx scripts/queue.ts skip <id>\n');
    return;
  }

  const id = parseInt(idStr, 10);
  if (isNaN(id)) {
    console.error('  Invalid ID.');
    process.exit(1);
  }

  skipItem(id);
  console.log(`\n  Skipped item #${id}.\n`);
}

async function cmdPublish(): Promise<void> {
  console.log('\n  Publishing due items...\n');
  const results = await publishDueItems();

  if (results.length === 0) {
    console.log('  No items due for publishing.\n');
    return;
  }

  const ok = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;

  for (const r of results) {
    if (r.ok) {
      console.log(`  ${GREEN}\u2713${RESET} #${r.itemId} (${r.platform})${r.postUrl ? ` -> ${r.postUrl}` : ''}`);
    } else {
      console.log(`  ${RED}\u2717${RESET} #${r.itemId} (${r.platform}): ${r.error}`);
    }
  }

  console.log(`\n  Published: ${ok}, Failed: ${failed}\n`);
}

function cmdStats(): void {
  const stats = getQueueStats();

  console.log(`\n  ${BOLD}QUEUE STATS${RESET}`);
  console.log('  ' + '-'.repeat(30));
  console.log(`  Total:     ${stats.total}`);
  console.log(`  Drafts:    ${YELLOW}${stats.drafts}${RESET}`);
  console.log(`  Scheduled: ${CYAN}${stats.scheduled}${RESET}`);
  console.log(`  Published: ${GREEN}${stats.published}${RESET}`);
  console.log(`  Failed:    ${RED}${stats.failed}${RESET}`);
  console.log('');
}

// ─── Main ───────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const command = args[0];

async function main(): Promise<void> {
  switch (command) {
    case 'generate':
      await cmdGenerate();
      break;
    case 'list':
      cmdList();
      break;
    case 'approve':
      cmdApprove(args.slice(1));
      break;
    case 'edit':
      await cmdEdit(args.slice(1));
      break;
    case 'skip':
      cmdSkip(args.slice(1));
      break;
    case 'publish':
      await cmdPublish();
      break;
    case 'stats':
      cmdStats();
      break;
    default:
      console.log(`
  ${BOLD}PULSE Content Queue CLI${RESET}

  Commands:
    generate             Generate a week of content
    list                 Show queue with status
    approve [id|all]     Approve items for publishing
    edit <id>            Edit item content
    skip <id>            Skip an item
    publish              Publish all due items
    stats                Show queue stats
`);
      break;
  }
}

main().catch((err) => {
  console.error('Queue error:', err.message || err);
  process.exit(1);
});
