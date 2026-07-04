/**
 * Minimal MCP planning stub.
 *
 * This keeps the repo honest: MCP is part of the roadmap, but the paid MCP
 * transport is not implemented yet. Callers can introspect the intended tool
 * surface without requiring the SDK at install time.
 */

export type CyberMcpToolStub = {
  name: string;
  description: string;
  status: 'planned';
  restEquivalent: string;
};

export type CyberMcpServerStub = {
  name: string;
  version: string;
  status: 'stub';
  notes: string[];
  tools: CyberMcpToolStub[];
};

export function createCyberMcpServer(): CyberMcpServerStub {
  return {
    name: 'synthr-cyber',
    version: '0.1.0',
    status: 'stub',
    notes: [
      'Paid MCP transport is not implemented yet.',
      'Use the x402 REST endpoints today; mirror them into MCP when the transport layer is ready.',
    ],
    tools: [
      {
        name: 'cyber_stack_brief',
        description: 'Get an EPSS-prioritized security brief for a tech stack.',
        status: 'planned',
        restEquivalent: 'POST /v1/cyber/stack-brief',
      },
      {
        name: 'cyber_audit_deps',
        description: 'Audit dependencies for vulnerabilities and malicious packages.',
        status: 'planned',
        restEquivalent: 'POST /v1/cyber/audit-deps',
      },
      {
        name: 'cyber_advice',
        description: 'Get grounded security guidance for an implementation or design question.',
        status: 'planned',
        restEquivalent: 'POST /v1/cyber/advice',
      },
      {
        name: 'cyber_vulns',
        description: 'Search vulnerabilities with EPSS and KEV filters.',
        status: 'planned',
        restEquivalent: 'POST /v1/cyber/vulns',
      },
      {
        name: 'cyber_breaking',
        description: 'Track recent actively exploited vulnerabilities relevant to agent builders.',
        status: 'planned',
        restEquivalent: 'GET /v1/cyber/breaking',
      },
    ],
  };
}
