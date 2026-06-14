/**
 * Generate email marketing sequences.
 *
 * Usage:
 *   npx tsx scripts/email-sequences.ts                    # Generate all 5 sequences
 *   npx tsx scripts/email-sequences.ts --type=welcome     # Just welcome sequence
 *   npx tsx scripts/email-sequences.ts --type=nurture     # Just nurture sequence
 *   npx tsx scripts/email-sequences.ts --type=convert     # Just conversion sequence
 *   npx tsx scripts/email-sequences.ts --save             # Save to files
 *
 * Sequence types: welcome, nurture, convert, reactivation, onboarding
 */

import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';
config();

import { showHelpIfNeeded } from '../src/core/help.js';
if (showHelpIfNeeded(process.argv.slice(2), 'emails')) process.exit(0);

import { loadConfig } from '../src/core/persona.js';
import {
  generateEmailSequence,
  generateAllSequences,
  formatEmailSequence,
  type EmailSequence,
} from '../src/intelligence/email-generator.js';

async function main(): Promise<void> {
  loadConfig();

  const args = process.argv.slice(2);
  const typeArg = args.find(a => a.startsWith('--type='));
  const save = args.includes('--save');

  const typeFilter = typeArg?.split('=')[1] as EmailSequence['type'] | undefined;

  console.log('');
  console.log('═'.repeat(50));
  console.log('  PULSE Email Sequence Generator');
  console.log('═'.repeat(50));
  console.log('');

  let sequences: EmailSequence[];

  if (typeFilter) {
    console.log(`  Generating ${typeFilter} sequence...\n`);
    const seq = await generateEmailSequence(typeFilter);
    sequences = seq ? [seq] : [];
  } else {
    console.log('  Generating all 5 email sequences...\n');
    console.log('  Types: welcome, nurture, convert, reactivation, onboarding');
    console.log('  This takes about 60 seconds...\n');
    sequences = await generateAllSequences();
  }

  if (sequences.length === 0) {
    console.log('  No sequences generated. Check your GROQ_API_KEY and config.\n');
    return;
  }

  // Display
  for (const seq of sequences) {
    console.log(formatEmailSequence(seq));
  }

  // Save
  if (save) {
    const outDir = path.join(process.cwd(), 'data', 'email-sequences');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    for (const seq of sequences) {
      const filename = `${seq.type}-sequence.json`;
      const outPath = path.join(outDir, filename);
      fs.writeFileSync(outPath, JSON.stringify(seq, null, 2));
      console.log(`  Saved: ${outPath}`);
    }

    // Also save as readable markdown
    const mdPath = path.join(outDir, `all-sequences-${new Date().toISOString().slice(0, 10)}.md`);
    let md = `# Email Sequences\nGenerated: ${new Date().toISOString()}\n\n`;
    for (const seq of sequences) {
      md += `## ${seq.name}\n${seq.description}\n\n`;
      for (const email of seq.emails) {
        md += `### ${email.sendDelay}\n`;
        md += `**Subject:** ${email.subject}\n`;
        md += `**Preview:** ${email.previewText}\n\n`;
        md += `${email.body}\n\n`;
        md += `**CTA:** ${email.cta}\n\n---\n\n`;
      }
    }
    fs.writeFileSync(mdPath, md);
    console.log(`  Saved readable version: ${mdPath}`);
  }

  // Summary
  const totalEmails = sequences.reduce((sum, s) => sum + s.emails.length, 0);
  console.log(`\n  Generated ${sequences.length} sequences with ${totalEmails} total emails.\n`);
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
