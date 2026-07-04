# Privacy Export And Delete Foundation

This runbook covers the current hosted Pulse GDPR foundation. It is intentionally narrow.

## What exists now

- Structured privacy export for `tenant`, `org`, or `user` scope from hosted SQL data.
- Existing agent profile export is included when a tenant-scoped runtime profile is available.
- Hosted brand-memory repository rows are included in structured privacy export:
  `brand_profiles` and `brand_knowledge_notes` preserve source, actor,
  lock-state, version, confidence, decay, and timestamps.
- Hosted runtime SQL state is included in structured privacy export:
  approval queue, content queue, action logs, schedule state, outreach dedup,
  X rate counters, and X write operation receipts are scoped to the exported
  tenant/org/brand set with JSON metadata decoded.
- Hosted privacy export payloads can be imported through `/api/profile/import`
  for matching hosted brand rows. The importer restores brand-memory rows plus
  runtime action logs, approval queue, content queue, schedule state, outreach
  dedup, and X rate counters. X write operation receipts remain export-only
  audit evidence.
- Secret material is excluded:
  - tenant API keys
  - encrypted tenant secret values, IVs, and auth tags
  - user password hashes
- Privacy requests are recorded in `privacy_requests` with status, mode, actor, and metadata.
- Admin-only endpoints exist under `/admin/privacy/*` and still require normal Pulse auth plus `X-Admin-Key`.

## Delete/anonymize behavior now

- Automatic execution is limited to a tenant soft-delete foundation:
  - `tenants.status` is set to `deleted`
  - an audit event is recorded
  - no tenant rows are hard-deleted
- Org and user delete/anonymize requests are recorded and marked `manual_review_required`.

## What is not deleted yet

- tenant notes
- usage and audit history
- safety events
- feedback
- preference signals and profiles
- GitHub connection metadata and repo link metadata
- tenant secret rows
- tenant config files and agent state on disk
- cross-table brand/workspace/org records

This is deliberate. The current foundation avoids destructive deletion until each data class has scope-proof tests and a rollback story.

## Operator notes

- Use export before any manual deletion follow-up.
- Treat `manual_review_required` as a queue for a later scoped deletion pass.
- Do not claim full GDPR erase coverage from this foundation alone.
