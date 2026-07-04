# Pulse Development Workflow

Status: canonical


This document captures the stable project guidance in a repo-native format that works with Codex, VS Code, and any other assistant or contributor.

## Overview

Pulse is a standalone AI marketing automation product. It supports hosted and
development/self-hosted flows, manages X-focused marketing actions, and keeps
provider keys on the server side. ClawNet may remain a transitional provider for
selected capabilities, but it is not the canonical product home for Pulse auth,
billing, deployment, or runtime decisions.

## Core Commands

```bash
npm run hosted
npm run panel
npm start
npm run dry-run
npm run setup
npm run lint
npm run format:check
```

## Product Rules

- Keep the customer setup flow minimal.
- Treat the brand profile as the main source of truth for identity and voice.
- Keep auto-research asynchronous.
- Keep draft mode as the safe default unless a feature explicitly opts into autonomous publishing.

## Stack Constraints

- Use Hono for hosted and panel server code.
- Use `better-sqlite3` for CRM and persisted app data.
- Keep runtime state behind the existing repository/tenant seams. JSON/YAML
  compatibility remains for local development, migration, backup, and rollback.
- Keep billing changes behind the billing provider and billing-operation layers;
  do not call raw provider deduction paths directly from product routes.

## Environment And Secrets

- Keep local examples in [.env.example](../../.env.example).
- Do not commit real platform credentials, tenant encryption keys, or provider API keys.
- Treat `TENANT_ENCRYPTION_KEY`, platform tokens, and provider keys as sensitive server-side values.
- Prefer production secrets in `/etc/pulse/pulse.env` instead of a repo-local `.env` on the VPS.
- Use [scripts/deploy.sh](../../scripts/deploy.sh) for deploys so service updates and health checks stay consistent.
- The deploy script uses the branch currently checked out on the VPS by default.
  Check out the intended branch before deploying. It allows only `master` or
  `main` unless `DEPLOY_BRANCH_ALLOWLIST` is extended or
  `ALLOW_UNLISTED_DEPLOY_BRANCH=1` is set for a reviewed manual deploy. For a
  reviewed manual branch switch, pass both `AUTO_SWITCH_BRANCH=1` and
  `ALLOW_DEPLOY_BRANCH_SWITCH=1`; `AUTO_SWITCH_BRANCH=1` alone fails closed.
- After deploy, verify the running service metadata at `/api/deploy-info` or `/health` to confirm the live branch, commit, and built UI bundle.

## Related Docs

- [docs/architecture/product-model.md](../architecture/product-model.md)
- [docs/architecture/adaptive-engine.md](../architecture/adaptive-engine.md)
- [docs/reference/config.md](../reference/config.md)
- [docs/operations/hardening.md](../operations/hardening.md)
