/**
 * CRM management CLI for PULSE.
 * Usage:
 *   npx tsx scripts/crm.ts leads [--hot] [--status=warm]
 *   npx tsx scripts/crm.ts lead <id>
 *   npx tsx scripts/crm.ts follow-ups
 *   npx tsx scripts/crm.ts stats
 *   npx tsx scripts/crm.ts roi
 *   npx tsx scripts/crm.ts export
 */

import { config } from 'dotenv';
config();

import { showHelpIfNeeded } from '../src/core/help.js';
if (showHelpIfNeeded(process.argv.slice(2), 'crm')) process.exit(0);

import fs from 'fs';
import path from 'path';
import { getLeadStats, listLeads, getHotLeads, getLeadById } from '../src/crm/leads.js';
import { getPendingFollowUps, getInteractionsForLead } from '../src/crm/interactions.js';
import { getROIStats, getConversionsByPlatform, getTrackedLinks } from '../src/analytics/roi.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function pad(s: string, n: number): string { return s.padEnd(n); }
function rpad(s: string, n: number): string { return s.padStart(n); }
const SEP = '-'.repeat(90);

function scoreBadge(score: number): string {
  if (score >= 60) return `\x1b[32m${score}\x1b[0m`;  // green
  if (score >= 30) return `\x1b[33m${score}\x1b[0m`;  // yellow
  return `\x1b[31m${score}\x1b[0m`;                     // red
}

// ─── Commands ───────────────────────────────────────────────────────────────

function cmdLeads(args: string[]): void {
  const hot = args.includes('--hot');
  const statusArg = args.find(a => a.startsWith('--status='));
  const status = statusArg ? statusArg.split('=')[1] : undefined;

  let leads;
  if (hot) {
    leads = getHotLeads(50);
    console.log('\n  HOT LEADS (score >= 60)\n');
  } else {
    leads = listLeads({ status, limit: 100, sortBy: 'score' });
    console.log(status ? `\n  LEADS (status: ${status})\n` : '\n  ALL LEADS\n');
  }

  if (leads.length === 0) {
    console.log('  No leads found.\n');
    return;
  }

  console.log(`  ${pad('ID', 6)}${pad('Username', 22)}${pad('Platform', 12)}${pad('Score', 8)}${pad('Status', 10)}${pad('Count', 8)}${'Last Active'}`);
  console.log(`  ${SEP}`);

  for (const l of leads) {
    console.log(`  ${pad(String(l.id), 6)}${pad(l.username, 22)}${pad(l.platform, 12)}${rpad(scoreBadge(l.score), 17)}${pad(l.status, 10)}${pad(String(l.interactionCount), 8)}${l.lastInteractionAt.slice(0, 10)}`);
  }

  console.log(`\n  ${leads.length} lead(s) shown.\n`);
}

function cmdLeadDetail(id: number): void {
  const lead = getLeadById(id);
  if (!lead) {
    console.log(`\n  Lead #${id} not found.\n`);
    return;
  }

  console.log(`\n  LEAD #${lead.id}`);
  console.log(`  ${SEP}`);
  console.log(`  Username:      ${lead.username}`);
  console.log(`  Platform:      ${lead.platform}`);
  console.log(`  Profile:       ${lead.profileUrl || '-'}`);
  console.log(`  Score:         ${scoreBadge(lead.score)}`);
  console.log(`  Status:        ${lead.status}`);
  console.log(`  Interactions:  ${lead.interactionCount}`);
  console.log(`  First Seen:    ${lead.firstSeenAt.slice(0, 10)}`);
  console.log(`  Last Active:   ${lead.lastInteractionAt.slice(0, 10)}`);
  console.log(`  Tags:          ${lead.tags.length > 0 ? lead.tags.join(', ') : '-'}`);
  console.log(`  Notes:         ${lead.notes || '-'}`);

  const interactions = getInteractionsForLead(lead.id, 20);
  if (interactions.length > 0) {
    console.log(`\n  INTERACTION HISTORY (last ${interactions.length})`);
    console.log(`  ${SEP}`);
    for (const i of interactions) {
      const content = (i.ourContent || i.theirContent || '').slice(0, 70);
      console.log(`  ${i.createdAt.slice(0, 16).replace('T', ' ')}  [${pad(i.type, 16)}] ${content}${content.length >= 70 ? '...' : ''}`);
    }
  }

  console.log('');
}

function cmdFollowUps(): void {
  const followUps = getPendingFollowUps(30);

  console.log('\n  PENDING FOLLOW-UPS\n');

  if (followUps.length === 0) {
    console.log('  No pending follow-ups.\n');
    return;
  }

  for (const f of followUps) {
    const name = f.lead ? `@${f.lead.username}` : `Lead #${f.leadId}`;
    const score = f.lead ? ` [${scoreBadge(f.lead.score)}]` : '';
    console.log(`  #${f.id}  ${name}${score} on ${f.platform}`);
    console.log(`      Action: ${f.action}  |  Due: ${f.dueAt.slice(0, 10)}`);
    if (f.message) console.log(`      ${f.message}`);
    console.log('');
  }

  console.log(`  ${followUps.length} pending follow-up(s).\n`);
}

function cmdStats(): void {
  const s = getLeadStats();
  console.log('\n  CRM STATS');
  console.log(`  ${SEP}`);
  console.log(`  Total leads:     ${s.total}`);
  console.log(`  New:             ${s.new}`);
  console.log(`  Warm:            ${s.warm}`);
  console.log(`  Hot:             ${s.hot}`);
  console.log(`  Customer:        ${s.customer}`);
  console.log(`  Lost:            ${s.lost}`);
  console.log(`  Avg Score:       ${s.avgScore}`);
  console.log('');
}

function cmdROI(): void {
  const week = getROIStats('week');
  const month = getROIStats('month');
  const byPlatform = getConversionsByPlatform();
  const links = getTrackedLinks(10);

  console.log('\n  ROI STATS');
  console.log(`  ${SEP}`);
  console.log(`  ${''.padEnd(20)}${'Week'.padStart(10)}${'Month'.padStart(10)}`);
  console.log(`  ${pad('Clicks', 20)}${rpad(String(week.totalClicks), 10)}${rpad(String(month.totalClicks), 10)}`);
  console.log(`  ${pad('Conversions', 20)}${rpad(String(week.totalConversions), 10)}${rpad(String(month.totalConversions), 10)}`);
  console.log(`  ${pad('Conv. Rate', 20)}${rpad(week.conversionRate + '%', 10)}${rpad(month.conversionRate + '%', 10)}`);
  console.log(`  ${pad('Revenue', 20)}${rpad('$' + week.totalRevenue.toFixed(2), 10)}${rpad('$' + month.totalRevenue.toFixed(2), 10)}`);
  console.log(`  ${pad('Top Platform', 20)}${rpad(month.topPlatform, 10)}`);
  console.log(`  ${pad('Top Campaign', 20)}${rpad(month.topCampaign, 10)}`);

  if (Object.keys(byPlatform).length > 0) {
    console.log(`\n  BY PLATFORM`);
    console.log(`  ${pad('Platform', 14)}${rpad('Clicks', 10)}${rpad('Conv', 10)}${rpad('Rate', 10)}${rpad('Revenue', 10)}`);
    console.log(`  ${SEP}`);
    for (const [p, d] of Object.entries(byPlatform)) {
      console.log(`  ${pad(p, 14)}${rpad(String(d.clicks), 10)}${rpad(String(d.conversions), 10)}${rpad(d.rate + '%', 10)}${rpad('$' + d.revenue.toFixed(2), 10)}`);
    }
  }

  if (links.length > 0) {
    console.log(`\n  RECENT TRACKED LINKS`);
    console.log(`  ${pad('Code', 10)}${pad('Platform', 12)}${pad('Campaign', 18)}${rpad('Clicks', 8)}  URL`);
    console.log(`  ${SEP}`);
    for (const l of links) {
      console.log(`  ${pad(l.shortCode, 10)}${pad(l.platform, 12)}${pad(l.campaign || '-', 18)}${rpad(String(l.clickCount), 8)}  ${l.originalUrl.slice(0, 40)}`);
    }
  }

  console.log('');
}

function cmdExport(): void {
  const leads = listLeads({ limit: 10000, sortBy: 'score' });

  const header = 'id,username,platform,score,status,interaction_count,first_seen,last_active,tags,notes';
  const rows = leads.map(l => {
    const tags = l.tags.join(';');
    const notes = l.notes.replace(/"/g, '""');
    return `${l.id},"${l.username}","${l.platform}",${l.score},"${l.status}",${l.interactionCount},"${l.firstSeenAt}","${l.lastInteractionAt}","${tags}","${notes}"`;
  });

  const csv = [header, ...rows].join('\n');

  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const outPath = path.join(dataDir, 'leads-export.csv');
  fs.writeFileSync(outPath, csv);

  console.log(`\n  Exported ${leads.length} leads to ${outPath}\n`);
}

// ─── Main ───────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const command = args[0];

switch (command) {
  case 'leads':
    cmdLeads(args.slice(1));
    break;
  case 'lead': {
    const id = parseInt(args[1], 10);
    if (isNaN(id)) {
      console.error('Usage: npx tsx scripts/crm.ts lead <id>');
      process.exit(1);
    }
    cmdLeadDetail(id);
    break;
  }
  case 'follow-ups':
    cmdFollowUps();
    break;
  case 'stats':
    cmdStats();
    break;
  case 'roi':
    cmdROI();
    break;
  case 'export':
    cmdExport();
    break;
  default:
    console.log(`
  PULSE CRM CLI

  Commands:
    leads [--hot] [--status=STATUS]   List leads
    lead <id>                         Show lead details
    follow-ups                        Show pending follow-ups
    stats                             Show CRM stats
    roi                               Show ROI stats
    export                            Export leads to CSV
`);
    break;
}
