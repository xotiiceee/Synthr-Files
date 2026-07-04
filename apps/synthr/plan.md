# SYNTHR V1 Technical Plan

## Overview

`SYNTHR V1` is a read-optimized API that evaluates a `Node.js` dependency set, matches it against normalized security advisories, enriches findings with exploitability signals, and returns strict JSON for agent or CI consumption.

## 1. V1 Scope

In scope:
1. `npm` ecosystem
2. `Node.js` runtime metadata
3. Direct and transitive dependency risk detection
4. Advisory normalization and matching
5. Exploitability enrichment
6. Version-specific remediation guidance
7. Source citations
8. Freshness metadata
9. Signed or hashable response payloads

Out of scope:
1. Auto-generated code patches
2. Multi-ecosystem support
3. Repo memory/persistence
4. Natural-language-only outputs
5. Marketplace/discovery features
6. ZK proofs

## 2. Primary Endpoint

`POST /cyber/check-lockfile`

Purpose:
Evaluate a project dependency graph and return machine-actionable findings.

## 3. Request Contract

Content type:
`application/json`

Request schema:

```json
{
  "request_id": "optional-client-generated-id",
  "runtime": {
    "name": "node",
    "version": "20.11.0"
  },
  "ecosystem": "npm",
  "manifest": {
    "package_manager": "npm",
    "dependencies": {
      "express": "^4.19.2",
      "jose": "4.14.4"
    },
    "dev_dependencies": {
      "typescript": "^5.5.0"
    }
  },
  "lockfile": {
    "format": "package-lock.json",
    "content": "{...raw or minimized lockfile text...}"
  },
  "snippet_context": [
    "const payload = jose.decodeJwt(token);"
  ],
  "options": {
    "include_dev_dependencies": false,
    "include_transitive_dependencies": true,
    "max_findings": 25,
    "response_mode": "strict"
  }
}
```

Field rules:
1. `runtime.name` must be `node` in V1.
2. `runtime.version` must be semver-like.
3. `ecosystem` must be `npm`.
4. At least one of `manifest` or `lockfile` is required.
5. `snippet_context` is optional and only affects relevance scoring.
6. `response_mode` defaults to `strict`.

## 4. Response Contract

Success response:
`200 OK`

```json
{
  "request_id": "2e5d4b91-54c7-4b22-a0bb-7f8435d6cb9f",
  "generated_at": "2026-06-24T12:00:00Z",
  "schema_version": "v1",
  "freshness": {
    "indexed_at": "2026-06-24T11:42:00Z",
    "max_source_age_minutes": 240,
    "cache_status": "warm"
  },
  "summary": {
    "risk_level": "high",
    "findings_count": 1,
    "affected_packages_count": 1,
    "actively_exploited_count": 1
  },
  "findings": [
    {
      "finding_id": "f_01",
      "package": {
        "name": "jose",
        "installed_version": "4.14.4",
        "dependency_type": "direct",
        "paths": [
          "jose"
        ]
      },
      "advisories": [
        {
          "advisory_id": "CVE-2026-8841",
          "aliases": ["GHSA-xxxx-xxxx-xxxx"],
          "title": "Improper JWT decoding validation path",
          "severity": {
            "score": 9.3,
            "vector": "CVSS:3.1/AV:N/AC:L/..."
          },
          "affected_ranges": ["<4.14.6"],
          "fixed_versions": ["4.14.6"]
        }
      ],
      "confidence": {
        "existence": 0.99,
        "applicability": 0.97,
        "exploitability": 0.82,
        "overall": 0.92
      },
      "exploitability": {
        "status": "likely_active",
        "basis": [
          "trusted_exploit_feed",
          "recent_public_activity"
        ]
      },
      "context_relevance": {
        "snippet_match": true,
        "reason": "jwt decode path detected"
      },
      "remediation": {
        "recommended_action": "upgrade_now",
        "target_version": "4.14.6",
        "upgrade_type": "patch",
        "migration_risk": "low"
      },
      "sources": [
        {
          "source_type": "ghsa",
          "source_id": "GHSA-xxxx-xxxx-xxxx",
          "url": "https://example.com/advisory",
          "observed_at": "2026-06-24T08:10:00Z"
        }
      ]
    }
  ],
  "next_step": {
    "type": "upgrade_dependency",
    "package": "jose",
    "to_version": "4.14.6"
  },
  "signature": {
    "algorithm": "ed25519",
    "key_id": "synthr-k1",
    "value": "base64-signature"
  }
}
```

## 5. Error Contract

All errors return:

```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "runtime.version is required",
    "details": [
      {
        "field": "runtime.version",
        "issue": "missing"
      }
    ]
  }
}
```

Core error codes:
1. `INVALID_REQUEST`
2. `UNSUPPORTED_ECOSYSTEM`
3. `UNSUPPORTED_RUNTIME`
4. `LOCKFILE_PARSE_FAILED`
5. `DEPENDENCY_GRAPH_RESOLUTION_FAILED`
6. `UPSTREAM_DATA_STALE`
7. `RATE_LIMITED`
8. `INTERNAL_ERROR`

## 6. Normalized Internal Data Model

Each upstream record should normalize into one canonical record.

```json
{
  "record_id": "rec_123",
  "source": "osv",
  "source_record_id": "OSV-2026-1234",
  "claim_type": "vulnerability",
  "ecosystem": "npm",
  "package_name": "jose",
  "aliases": ["CVE-2026-8841", "GHSA-xxxx-xxxx-xxxx"],
  "affected_ranges": ["<4.14.6"],
  "fixed_versions": ["4.14.6"],
  "severity_score": 9.3,
  "severity_vector": "CVSS:3.1/...",
  "published_at": "2026-06-23T10:00:00Z",
  "observed_at": "2026-06-24T08:10:00Z",
  "indexed_at": "2026-06-24T08:12:00Z",
  "confidence": 0.98,
  "evidence_url": "https://...",
  "raw_hash": "sha256:..."
}
```

Separate record types:
1. `vulnerability`
2. `fix`
3. `exploit_signal`
4. `retraction`
5. `package_metadata`

## 7. Matching Rules

Package matching:
1. Exact ecosystem match required.
2. Package names normalized to canonical registry naming.
3. Alias packages not merged unless explicitly mapped.

Version matching:
1. Use semver range evaluation against installed version.
2. Prefer lockfile-resolved versions over manifest ranges.
3. If only manifest exists, lower applicability confidence.
4. If range syntax is invalid or ambiguous, mark as unresolved.

Dependency graph rules:
1. Direct dependency findings rank above transitive at equal severity.
2. Multiple vulnerable paths to same package collapse into one finding with all paths attached.
3. Dev dependencies excluded by default unless requested.

## 8. Source Hierarchy

Tier 1:
1. OSV
2. GitHub Security Advisories
3. Vendor advisories
4. NVD

Tier 2:
1. Curated exploit intelligence feeds
2. Trusted security research disclosures

Tier 3:
1. Social feeds
2. RSS and raw community reports

Resolution rules:
1. Vulnerability existence requires Tier 1 or equivalent trusted vendor evidence.
2. Tier 2 may elevate exploitability confidence.
3. Tier 3 may only add weak enrichment, never establish a vulnerability alone.
4. Retractions from authoritative sources override earlier claims.

## 9. Scoring Rules

Use four separate scores from `0.0` to `1.0`.

`existence_confidence`
Measures whether the vulnerability itself is real.

Suggested baseline:
1. Tier 1 authoritative advisory: `0.95-1.00`
2. Trusted researcher corroborated, no formal advisory yet: `0.60-0.85`
3. Social-only chatter: `<=0.40`

`applicability_confidence`
Measures whether the installed version and environment are actually affected.

Inputs:
1. Lockfile presence
2. Exact version resolution
3. Runtime compatibility
4. Advisory specificity
5. Package path match

Suggested baseline:
1. Exact lockfile match and explicit range hit: `0.95+`
2. Manifest-only inferred version: `0.60-0.85`
3. Ambiguous package/range: `<0.50`

`exploitability_confidence`
Measures likelihood of real-world exploitation pressure.

Inputs:
1. CISA KEV or equivalent inclusion
2. Trusted exploit feed mentions
3. Multiple recent corroborating reports
4. Public PoC availability
5. Recency of exploit discussion

Suggested baseline:
1. Confirmed active exploitation: `0.85-1.00`
2. Public PoC, no active exploitation confirmed: `0.60-0.80`
3. Rumor/unverified posts: `<0.50`

`overall_confidence`
Weighted composite.

Suggested weighting:
1. `existence`: 40%
2. `applicability`: 40%
3. `exploitability`: 20%

Example:
`overall = 0.4E + 0.4A + 0.2X`

## 10. Risk Classification Rules

Map risk level from severity plus exploitability plus applicability.

Example policy:
1. `critical`
   - severity `>=9.0`
   - applicability `>=0.8`
   - overall `>=0.85`
2. `high`
   - severity `>=7.0`
   - applicability `>=0.7`
3. `medium`
   - severity `>=4.0`
4. `low`
   - everything else
5. `unknown`
   - insufficient data

Exploitability may bump one level up if `>=0.85`.

## 11. Remediation Rules

V1 only recommends bounded, package-level actions.

Allowed remediation outputs:
1. `upgrade_now`
2. `schedule_upgrade`
3. `monitor_only`
4. `manual_review_required`
5. `no_action`

Recommendation policy:
1. Prefer minimal fixed version satisfying advisory.
2. Prefer patch upgrades over minor/major where safe.
3. If multiple fixes exist, choose lowest-risk supported fix.
4. If advisory is ambiguous, return `manual_review_required`.
5. Never generate code-level diffs in V1.

## 12. Freshness and Staleness

Freshness metadata required on every response.

Definitions:
1. `indexed_at`: latest local ingest timestamp used
2. `max_source_age_minutes`: age of oldest source contributing to answer
3. `cache_status`: `warm`, `cold`, or `partial`

Policy:
1. If source age exceeds threshold, degrade confidence.
2. If authoritative advisory feeds are stale beyond SLA, optionally return `UPSTREAM_DATA_STALE`.
3. Cached results are allowed if marked clearly.

Initial SLA target:
1. Tier 1 sources indexed within 60 minutes
2. Exploit enrichment indexed within 240 minutes

## 13. Response Determinism

"Deterministic" should mean:
1. Stable schema
2. Stable ranking policy for same input and same source snapshot
3. Stable score calculation
4. Explicit freshness boundaries

It should not mean:
1. perfect truth
2. immutable real-world facts
3. no uncertainty

## 14. Security and Integrity

API-level:
1. Auth required
2. Rate limiting per key
3. Request size caps
4. JSON schema validation

Payload integrity:
1. Include response hash or signature
2. Include schema version
3. Include key identifier for signature verification

Auditability:
1. Every finding must include sources
2. Every score must be explainable by rule inputs
3. Raw evidence should be traceable internally via `raw_hash`

## 15. Observability

Track:
1. request count
2. p50/p95 latency
3. parse failures
4. match failures
5. stale-source responses
6. finding counts by severity
7. confidence distribution
8. source conflict rate

Critical alerts:
1. authoritative source ingest stalled
2. spike in parse failures
3. response signature failures
4. abnormal confidence collapse
5. latency SLA breach

## 16. Evaluation Rubric

Build a fixed benchmark set of real projects and synthetic cases.

Core dimensions:

`A. Detection Accuracy`
1. Precision: of flagged vulnerable packages, how many are correct
2. Recall: of true vulnerable packages in the benchmark, how many are found

`B. Version Matching Accuracy`
1. Correct affected-range evaluation
2. Correct fixed-version recommendation
3. Correct direct vs transitive path attribution

`C. Exploitability Quality`
1. Precision of `likely_active` label
2. False urgency rate
3. Timeliness versus reference feed

`D. Actionability`
1. Does the response contain enough information for an agent or CI gate
2. Is the recommended next action valid and bounded
3. Are citations sufficient for audit

`E. Operational Quality`
1. p50 latency
2. p95 latency
3. stale response rate
4. parse success rate

## 17. Benchmark Test Set Design

Include at least these scenarios:
1. Vulnerable direct dependency with patch fix
2. Vulnerable transitive dependency only
3. Advisory exists but installed version unaffected
4. Multiple advisories on one package
5. Manifest-only input with no lockfile
6. Social chatter before official advisory
7. Official advisory retracted
8. Major-version-only fix with migration risk
9. Dev dependency issue with exclusion enabled
10. Malformed lockfile input

## 18. Acceptance Thresholds For V1

Suggested release gates:
1. vulnerability precision `>= 0.95`
2. vulnerability recall `>= 0.90` on curated benchmark
3. version-range correctness `>= 0.98`
4. false `likely_active` rate `<= 0.05`
5. p50 latency `<= 500ms` on warm cache
6. p95 latency `<= 2s`
7. lockfile parse success `>= 0.99` for supported formats

## 19. Minimal Implementation Sequence

1. Define JSON schema for request/response
2. Implement npm manifest and lockfile parser
3. Build normalized advisory store from Tier 1 sources
4. Implement semver range matcher
5. Implement finding/ranking engine
6. Add exploitability enrichment
7. Add freshness metadata and signatures
8. Build benchmark harness and scorecards
9. Pilot with a small number of real workflows

## 20. Open Product Decisions

These should be resolved before implementation:
1. Should dev dependencies be excluded by default in all modes?
2. Should snippet context affect ranking only, or also remediation urgency?
3. What exact authoritative exploit feeds are acceptable in Tier 2?
4. Should stale upstream data fail closed or return degraded responses?
5. Do you want signed responses in V1, or just response hashes?
