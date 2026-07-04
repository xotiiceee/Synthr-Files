import { describe, it, expect } from 'vitest';
import { mapSeverity, computeAgentSurface, normalizeEcosystem } from '../src/services/intel';

describe('normalizeEcosystem', () => {
  it('maps common ecosystem names to OSV format', () => {
    expect(normalizeEcosystem('npm')).toBe('npm');
    expect(normalizeEcosystem('pypi')).toBe('PyPI');
    expect(normalizeEcosystem('python')).toBe('PyPI');
    expect(normalizeEcosystem('maven')).toBe('Maven');
    expect(normalizeEcosystem('go')).toBe('Go');
    expect(normalizeEcosystem('crates')).toBe('crates.io');
    expect(normalizeEcosystem('crates.io')).toBe('crates.io');
    expect(normalizeEcosystem('nuget')).toBe('NuGet');
    expect(normalizeEcosystem('packagist')).toBe('Packagist');
  });

  it('is case-insensitive', () => {
    expect(normalizeEcosystem('NPM')).toBe('npm');
    expect(normalizeEcosystem('PyPI')).toBe('PyPI');
    expect(normalizeEcosystem('GO')).toBe('Go');
  });

  it('defaults to npm when undefined', () => {
    expect(normalizeEcosystem(undefined)).toBe('npm');
  });

  it('passes through unknown ecosystems', () => {
    expect(normalizeEcosystem('swift')).toBe('swift');
    expect(normalizeEcosystem('composer')).toBe('composer');
  });
});

describe('mapSeverity', () => {
  it('reads database_specific.severity string (GHSA-style)', () => {
    expect(mapSeverity({ database_specific: { severity: 'CRITICAL' } })).toBe('CRITICAL');
    expect(mapSeverity({ database_specific: { severity: 'HIGH' } })).toBe('HIGH');
    expect(mapSeverity({ database_specific: { severity: 'MEDIUM' } })).toBe('MEDIUM');
    expect(mapSeverity({ database_specific: { severity: 'LOW' } })).toBe('LOW');
    expect(mapSeverity({ database_specific: { severity: 'NONE' } })).toBe('LOW');
  });

  it('reads database_specific.cvss.baseScore when numeric', () => {
    expect(mapSeverity({ database_specific: { cvss: { baseScore: 9.5 } } })).toBe('CRITICAL');
    expect(mapSeverity({ database_specific: { cvss: { baseScore: 7.2 } } })).toBe('HIGH');
    expect(mapSeverity({ database_specific: { cvss: { baseScore: 5.0 } } })).toBe('MEDIUM');
    expect(mapSeverity({ database_specific: { cvss: { baseScore: 2.0 } } })).toBe('LOW');
  });

  it('parses CVSS vector string from severity[] array', () => {
    const vuln = {
      severity: [
        { type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' },
      ],
    };
    const result = mapSeverity(vuln);
    expect(['CRITICAL', 'HIGH']).toContain(result);
  });

  it('returns LOW when no severity data is present', () => {
    expect(mapSeverity({})).toBe('LOW');
    expect(mapSeverity({ id: 'GHSA-xxx' })).toBe('LOW');
  });

  it('does NOT read severity[].score as a number (the old bug)', () => {
    // Old code did: vuln.severity?.[0]?.score — which was a vector string,
    // not a number. The comparison `cvss >= 9` was always false for strings.
    const vuln = {
      severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H' }],
    };
    const result = mapSeverity(vuln);
    expect(result).not.toBe('LOW'); // should not fall through
  });
});

describe('computeAgentSurface', () => {
  it('returns HIGH for known high-risk packages (exact match)', () => {
    expect(computeAgentSurface('jsonwebtoken', '', '')).toBe('HIGH');
    expect(computeAgentSurface('express', '', '')).toBe('HIGH');
    expect(computeAgentSurface('fastapi', '', '')).toBe('HIGH');
    expect(computeAgentSurface('langchain', '', '')).toBe('HIGH');
    expect(computeAgentSurface('openai', '', '')).toBe('HIGH');
    expect(computeAgentSurface('@modelcontextprotocol/sdk', '', '')).toBe('HIGH');
  });

  it('returns MEDIUM for known medium-risk packages', () => {
    expect(computeAgentSurface('lodash', '', '')).toBe('MEDIUM');
    expect(computeAgentSurface('react', '', '')).toBe('MEDIUM');
    expect(computeAgentSurface('zod', '', '')).toBe('MEDIUM');
  });

  it('returns HIGH when summary describes a high-impact exploit type', () => {
    expect(computeAgentSurface('some-unknown-pkg', 'Remote code execution vulnerability', '')).toBe('HIGH');
    expect(computeAgentSurface('some-unknown-pkg', 'SQL injection in query parser', '')).toBe('HIGH');
    expect(computeAgentSurface('some-unknown-pkg', 'Prototype pollution in deep merge', '')).toBe('HIGH');
    expect(computeAgentSurface('some-unknown-pkg', 'SSRF in URL fetcher', '')).toBe('HIGH');
  });

  it('returns HIGH when context mentions multiple agent-surface keywords', () => {
    expect(computeAgentSurface('some-pkg', '', 'agent harness with auth tools')).toBe('HIGH');
    expect(computeAgentSurface('some-pkg', '', 'building LLM tool with MCP')).toBe('HIGH');
  });

  it('returns MEDIUM when context mentions one agent-surface keyword', () => {
    expect(computeAgentSurface('some-pkg', '', 'agent setup')).toBe('MEDIUM');
    expect(computeAgentSurface('some-pkg', '', 'auth flow')).toBe('MEDIUM');
    expect(computeAgentSurface('some-pkg', '', 'using sdk')).toBe('MEDIUM');
  });

  it('returns LOW for unrelated packages with benign summaries', () => {
    expect(computeAgentSurface('left-pad', 'Simple string padding utility', '')).toBe('LOW');
    expect(computeAgentSurface('is-odd', 'Check if a number is odd', '')).toBe('LOW');
    expect(computeAgentSurface('colors', 'Terminal color library', '')).toBe('LOW');
  });

  it('does NOT flag packages as HIGH just because summary contains "api" or "fetch" (the old bug)', () => {
    // Old code substring-matched 'api' and 'fetch' against the combined string,
    // flagging virtually every modern package as HIGH.
    expect(computeAgentSurface('emoji-api', 'Fun emoji api for chat apps', '')).toBe('LOW');
    expect(computeAgentSurface('weather-fetch', 'Fetch weather data from public api', '')).toBe('LOW');
  });

  it('returns MEDIUM for packages with auth/jwt/token in the name (not HIGH)', () => {
    // These are weaker signals — not in the curated high-risk set, but name-based
    // indicators suggest elevated relevance.
    expect(computeAgentSurface('custom-auth-lib', '', '')).toBe('MEDIUM');
    expect(computeAgentSurface('my-jwt-utils', '', '')).toBe('MEDIUM');
    expect(computeAgentSurface('token-store', '', '')).toBe('MEDIUM');
  });

  it('handles empty/undefined inputs gracefully', () => {
    expect(computeAgentSurface('', '', '')).toBe('LOW');
    expect(computeAgentSurface('', '', undefined)).toBe('LOW');
  });
});
