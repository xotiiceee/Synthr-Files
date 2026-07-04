/**
 * Local test for Synthr Cyber intelligence (no server, no payment needed).
 * Run with: npx tsx server/test-local.ts   (or bun)
 *
 * This proves the core is smart: live data from OSV + EPSS.
 */

import { synthesizeStackBrief, synthesizeDepsAudit } from './src/services/intel.js';

async function main() {
  console.log('=== Testing real stack-brief ===');

  const sampleInput = {
    stack: {
      dependencies: [
        { name: 'express', version: '4.18.2', ecosystem: 'npm' },
        { name: 'jsonwebtoken', version: '9.0.0', ecosystem: 'npm' },
        { name: 'axios', version: '1.6.0', ecosystem: 'npm' },
      ],
    },
    context: 'Agent harness building web tools with auth',
  };

  try {
    const result = await synthesizeStackBrief(sampleInput as any);
    console.log('Success! Packages analyzed:', result.stackSummary.packagesAnalyzed);
    console.log('Top risks (first 2):');
    console.dir(result.prioritizedRisks.slice(0, 2), { depth: 1 });
    console.log('Confidence:', result.confidence);
    console.log('Sources used:', result.sources.map((s: any) => s.title));
  } catch (e) {
    console.error('Test failed:', e);
  }

  console.log('\n=== Testing audit-deps ===');
  const auditResult = await synthesizeDepsAudit({ dependencies: sampleInput.stack.dependencies } as any);
  console.log('Audit findings count:', auditResult.findings.length);
  console.log('Malicious detected:', auditResult.maliciousPackagesDetected);
}

main();
