/**
 * Centralized Help System -- shared help for all CLI commands.
 *
 * Instead of every script having its own ad-hoc usage text, this module
 * provides consistent, formatted help for all commands.
 */

export interface CommandHelp {
  name: string;
  description: string;
  usage: string;
  flags?: Array<{ flag: string; description: string; default?: string }>;
  examples?: string[];
  tip?: string;
}

const COMMANDS: Record<string, CommandHelp> = {
  setup: {
    name: 'setup',
    description: 'Interactive setup wizard -- configure PULSE for your brand',
    usage: 'npm run setup',
    flags: [],
    examples: [
      'npm run setup',
    ],
    tip: 'Describe your business in plain English and the wizard generates everything.',
  },
  run: {
    name: 'run',
    description: 'Main entry point -- run outreach, content, and monitoring',
    usage: 'npm start [flags]',
    flags: [
      { flag: '--outreach', description: 'Outreach only (find + reply to conversations)' },
      { flag: '--content', description: 'Content creation only' },
      { flag: '--monitor', description: 'Monitor engagement only' },
      { flag: '--auto', description: 'Auto-post replies (default is draft mode)' },
      { flag: '--dry-run', description: 'Preview without posting anything' },
      { flag: '--full-auto', description: 'Run all modes: outreach + content + monitor' },
    ],
    examples: [
      'npm start                       # Full auto (draft mode)',
      'npm run dry-run                 # Preview without posting',
      'npm start -- --outreach         # Outreach only',
      'npm start -- --content          # Content only',
    ],
    tip: 'First time? Start with: npm run dry-run',
  },
  'dry-run': {
    name: 'dry-run',
    description: 'Preview outreach + content without posting anything',
    usage: 'npm run dry-run',
    flags: [],
    examples: [
      'npm run dry-run',
    ],
  },
  report: {
    name: 'report',
    description: 'Generate analytics report -- engagement, reach, conversions',
    usage: 'npm run report [flags]',
    flags: [
      { flag: '--period=day|week|month', description: 'Report period', default: 'day' },
      { flag: '--save', description: 'Save report as markdown file' },
    ],
    examples: [
      'npm run report',
      'npm run report -- --period=week --save',
    ],
  },
  calendar: {
    name: 'calendar',
    description: 'Generate a content calendar for the week',
    usage: 'npm run calendar [flags]',
    flags: [
      { flag: '--days=N', description: 'Number of days to plan', default: '7' },
    ],
    examples: [
      'npm run calendar',
      'npm run calendar -- --days=14',
    ],
  },
  'test-config': {
    name: 'test-config',
    description: 'Validate configuration and API key connectivity',
    usage: 'npm run test-config',
    flags: [],
    examples: [
      'npm run test-config',
    ],
  },
  dashboard: {
    name: 'dashboard',
    description: 'Launch web analytics dashboard',
    usage: 'npm run dashboard',
    flags: [],
    examples: [
      'npm run dashboard',
    ],
  },
  panel: {
    name: 'panel',
    description: 'Web control panel -- review posts, monitor mentions, analytics',
    usage: 'npm run panel',
    flags: [
      { flag: '--port=N', description: 'Custom port (default 3456)' },
    ],
    examples: [
      'npm run panel',
      'npm run panel -- --port=8080',
    ],
    tip: 'Access at http://localhost:3456. Works on mobile too — approve posts from your phone.',
  },
  crm: {
    name: 'crm',
    description: 'CRM -- manage leads, follow-ups, and conversions',
    usage: 'npm run crm <command> [flags]',
    flags: [
      { flag: 'leads [--hot] [--status=warm]', description: 'List leads with optional filters' },
      { flag: 'lead <id>', description: 'View lead details' },
      { flag: 'follow-ups', description: 'Show due follow-ups' },
      { flag: 'stats', description: 'CRM statistics' },
      { flag: 'roi', description: 'ROI breakdown' },
      { flag: 'export', description: 'Export leads as CSV' },
    ],
    examples: [
      'npm run crm leads -- --hot',
      'npm run crm stats',
      'npm run crm roi',
    ],
  },
  brands: {
    name: 'brands',
    description: 'Manage multiple brands / white-label configs',
    usage: 'npm run brands <command> [args]',
    flags: [
      { flag: 'list', description: 'Show all brands' },
      { flag: 'create <slug>', description: 'Create a new brand' },
      { flag: 'switch <slug>', description: 'Switch active brand' },
      { flag: 'delete <slug>', description: 'Delete a brand' },
    ],
    examples: [
      'npm run brands list',
      'npm run brands create my-brand',
      'npm run brands switch my-brand',
    ],
  },
  videos: {
    name: 'videos',
    description: 'Generate video scripts for YouTube, TikTok, Reels',
    usage: 'npm run videos [flags]',
    flags: [
      { flag: '--count=N', description: 'Number of scripts to generate', default: '5' },
      { flag: '--platform=youtube|tiktok|reels', description: 'Target platform' },
      { flag: '--save', description: 'Save scripts to file' },
    ],
    examples: [
      'npm run videos',
      'npm run videos -- --count=10 --platform=tiktok',
    ],
  },
  emails: {
    name: 'emails',
    description: 'Generate email marketing sequences',
    usage: 'npm run emails [flags]',
    flags: [
      { flag: '--type=welcome|nurture|convert|winback|launch', description: 'Sequence type' },
      { flag: '--save', description: 'Save to files' },
    ],
    examples: [
      'npm run emails',
      'npm run emails -- --type=welcome --save',
    ],
  },
  queue: {
    name: 'queue',
    description: 'Content queue -- generate, approve, and publish content',
    usage: 'npm run queue <command> [args]',
    flags: [
      { flag: 'generate', description: 'Generate a week of content' },
      { flag: 'list', description: 'Show queue with status' },
      { flag: 'approve [id|all]', description: 'Approve items' },
      { flag: 'edit <id>', description: 'Edit item content' },
      { flag: 'skip <id>', description: 'Skip item' },
      { flag: 'publish', description: 'Publish all due items' },
      { flag: 'stats', description: 'Show queue stats' },
    ],
    examples: [
      'npm run queue generate',
      'npm run queue list',
      'npm run queue approve all',
    ],
  },
  insights: {
    name: 'insights',
    description: 'Weekly intelligence brief -- trends, opportunities, competitor moves',
    usage: 'npm run insights [flags]',
    flags: [
      { flag: '--email=user@example.com', description: 'Send brief via email' },
      { flag: '--save', description: 'Save HTML report' },
    ],
    examples: [
      'npm run insights',
      'npm run insights -- --save',
    ],
  },
  research: {
    name: 'research',
    description: 'Research tools -- trending topics, hashtags, audience, swipe file',
    usage: 'npm run research <command> [args]',
    flags: [
      { flag: 'trending', description: 'Trending topics in your niche' },
      { flag: 'hashtags <topic>', description: 'Suggest hashtags for a topic' },
      { flag: 'audience', description: 'Analyze audience from CRM data' },
      { flag: 'swipe', description: 'Build/update swipe file from best content' },
      { flag: 'swipe-remix <id>', description: 'Generate new variation from swipe entry' },
    ],
    examples: [
      'npm run research trending',
      'npm run research hashtags "content marketing"',
    ],
  },
  repurpose: {
    name: 'repurpose',
    description: 'Draft platform-adapted versions of existing content',
    usage: 'npm run repurpose "content" [flags]',
    flags: [
      { flag: '--from=x|linkedin|reddit|blog', description: 'Source platform', default: 'x' },
      { flag: '--to=x|linkedin|reddit|...', description: 'Comma-separated draft targets' },
      { flag: '--file=path', description: 'Read content from file' },
    ],
    examples: [
      'npm run repurpose "Your content here" -- --from=x --to=linkedin',
      'npm run repurpose -- --file=content.txt --from=linkedin',
    ],
  },
  'landing-page': {
    name: 'landing-page',
    description: 'Generate a landing page with email capture',
    usage: 'npm run landing-page [flags]',
    flags: [
      { flag: '--style=bold|professional|minimal', description: 'Page style', default: 'professional' },
      { flag: '--preview', description: 'Save to temp and log path' },
      { flag: '--no-email', description: 'No email capture form' },
    ],
    examples: [
      'npm run landing-page',
      'npm run landing-page -- --style=bold --preview',
    ],
  },
  'lead-magnets': {
    name: 'lead-magnets',
    description: 'Generate lead magnets -- checklists, tips, guides, cheatsheets',
    usage: 'npm run lead-magnets [flags]',
    flags: [
      { flag: '--type=checklist|tips|guide|cheatsheet', description: 'Magnet type' },
      { flag: '--topic="custom topic"', description: 'Custom topic override' },
    ],
    examples: [
      'npm run lead-magnets',
      'npm run lead-magnets -- --type=checklist --topic="meal prep"',
    ],
  },
  competitors: {
    name: 'competitors',
    description: 'Competitor spy report -- analyze competitor content and strategy',
    usage: 'npm run competitors [flags]',
    flags: [
      { flag: '--save', description: 'Save report as markdown' },
      { flag: '--competitor=name', description: 'Analyze a single competitor' },
    ],
    examples: [
      'npm run competitors',
      'npm run competitors -- --save',
    ],
  },
  mentions: {
    name: 'mentions',
    description: 'Mention monitor -- detect brand mentions and auto-interact',
    usage: 'npm run mentions <command> [args]',
    flags: [
      { flag: 'watch', description: 'Scan for new brand mentions now' },
      { flag: 'review', description: 'Review pending mention replies' },
      { flag: 'list', description: 'List recent mentions with status' },
      { flag: 'stats', description: 'Show mention statistics' },
      { flag: 'block <user>', description: 'Block a user from auto-replies' },
      { flag: 'unblock <user>', description: 'Remove user from blocklist' },
      { flag: 'pause', description: 'Pause auto-replies' },
      { flag: 'resume', description: 'Resume auto-replies' },
      { flag: 'classify <id>', description: 'Test classification on a mention' },
    ],
    examples: [
      'npm run mentions watch',
      'npm run mentions review',
      'npm run mentions stats',
      'npm run mentions block @spam_bot',
    ],
    tip: 'Start with "watch" to scan for mentions, then "review" to approve replies.',
  },
  'voice-calibrate': {
    name: 'voice-calibrate',
    description: 'Calibrate voice fingerprint from sample posts',
    usage: 'npm run voice-calibrate [flags]',
    flags: [
      { flag: '--samples=N', description: 'Number of recent posts to use for calibration', default: '10' },
      { flag: '--manual', description: 'Enter sample posts manually (interactive)' },
      { flag: '--show', description: 'Show current voice fingerprint' },
      { flag: '--reset', description: 'Reset voice fingerprint to defaults' },
    ],
    examples: [
      'npm run voice-calibrate                  # Auto-calibrate from recent posts',
      'npm run voice-calibrate -- --samples=20  # Use last 20 posts',
      'npm run voice-calibrate -- --manual      # Paste sample posts interactively',
      'npm run voice-calibrate -- --show        # View current fingerprint',
      'npm run voice-calibrate -- --reset       # Reset to defaults',
    ],
    tip: 'Auto mode pulls from your post history. Use --manual if you have no post history yet.',
  },
  autopost: {
    name: 'autopost',
    description: 'Auto-posting -- generate, outreach, and publish content',
    usage: 'npm run autopost <command> [args]',
    flags: [
      { flag: 'generate', description: 'Generate content candidates for review' },
      { flag: 'generate --category=TYPE', description: 'Generate for specific category (news/tips/insights/engagement/reshares/milestones)' },
      { flag: 'outreach', description: 'Find conversations and draft replies for review' },
      { flag: 'outreach --auto', description: 'Find conversations and auto-post replies (use with caution)' },
      { flag: 'review', description: 'Review and approve/reject pending posts' },
      { flag: 'publish', description: 'Publish all approved posts' },
      { flag: 'history', description: 'Show post history with engagement metrics' },
      { flag: 'history --top', description: 'Show top performing posts only' },
      { flag: 'stats', description: 'Weekly engagement stats and recommendations' },
      { flag: 'pause [--hours=N]', description: 'Pause auto-posting (default 24h)' },
      { flag: 'resume', description: 'Resume auto-posting' },
      { flag: 'voice-check "text"', description: 'Score text against voice profile' },
      { flag: '--force', description: 'Bypass timing engine (generate/publish immediately)' },
    ],
    examples: [
      'npm run autopost generate',
      'npm run autopost generate -- --force',
      'npm run autopost outreach',
      'npm run autopost outreach -- --auto',
      'npm run autopost review',
      'npm run autopost stats',
      'npm run autopost voice-check "Your tweet here"',
    ],
    tip: 'Use "generate" for your own posts, "outreach" to reply to others, then "review" to approve.',
  },
};

/**
 * Get help for a specific command.
 */
export function getCommandHelp(command: string): CommandHelp | null {
  return COMMANDS[command] ?? null;
}

/**
 * Get all registered commands.
 */
export function getAllCommands(): CommandHelp[] {
  return Object.values(COMMANDS);
}

/**
 * Format a single command's help for terminal display.
 */
export function formatHelp(help: CommandHelp): string {
  const lines: string[] = [
    '',
    '  \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550',
    `  PULSE -- ${help.name}`,
    `  ${help.description}`,
    '  \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550',
    '',
    '  USAGE:',
    `    ${help.usage}`,
  ];

  if (help.flags && help.flags.length > 0) {
    lines.push('');
    lines.push('  FLAGS:');
    const maxFlagLen = Math.max(...help.flags.map(f => f.flag.length));
    for (const f of help.flags) {
      const defaultStr = f.default ? ` (default: ${f.default})` : '';
      lines.push(`    ${f.flag.padEnd(maxFlagLen + 2)} ${f.description}${defaultStr}`);
    }
  }

  if (help.examples && help.examples.length > 0) {
    lines.push('');
    lines.push('  EXAMPLES:');
    for (const ex of help.examples) {
      lines.push(`    ${ex}`);
    }
  }

  if (help.tip) {
    lines.push('');
    lines.push(`  Tip: ${help.tip}`);
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Format an overview of all commands for terminal display.
 */
export function formatAllCommands(): string {
  const lines: string[] = [
    '',
    '  PULSE -- All Commands',
    '  \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550',
    '',
  ];

  const maxNameLen = Math.max(...Object.values(COMMANDS).map(c => c.name.length));
  for (const cmd of Object.values(COMMANDS)) {
    lines.push(`    ${cmd.name.padEnd(maxNameLen + 2)} ${cmd.description}`);
  }

  lines.push('');
  lines.push('  Run any command with --help for details:');
  lines.push('    npm run report -- --help');
  lines.push('');

  return lines.join('\n');
}

/**
 * Check if --help was passed and print help if so.
 * Returns true if help was shown (caller should exit).
 *
 * Usage at top of every script:
 *   if (showHelpIfNeeded(process.argv.slice(2), 'report')) process.exit(0);
 */
export function showHelpIfNeeded(args: string[], commandName: string): boolean {
  if (!args.includes('--help') && !args.includes('-h')) {
    return false;
  }

  const help = getCommandHelp(commandName);
  if (help) {
    console.log(formatHelp(help));
  } else {
    console.log(`  No help available for "${commandName}".`);
    console.log(formatAllCommands());
  }

  return true;
}
