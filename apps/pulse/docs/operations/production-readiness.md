# Pulse Production Readiness

Status: active gate

Run this before a customer-facing launch or domain cutover:

```bash
npm run check:launch-preflight
npm run audit:all
npm run check:production
npm run check:customer-launch
```

On the production host, point the readiness command at the same external env
file used by `systemd`:

```bash
ENV_FILE=/etc/pulse/pulse.env npm run check:production
ENV_FILE=/etc/pulse/pulse.env npm run check:customer-launch
```

`PULSE_ENV_FILE=/etc/pulse/pulse.env` is also accepted if you want a
readiness-specific env-file variable. Already-exported shell variables still
take precedence over values loaded from that file.

The check is intentionally stricter than local development. It fails on missing
hosted secrets, invalid runtime flags, non-HTTPS `PULSE_URL`, missing LLM/search
provider keys, disabled Stripe customer billing, unsafe production workflow
branch selection, missing GitHub production-environment and deploy-info gates,
and missing server-side deploy script safeguards. It warns when rollback defaults
are still active, such as ClawNet auth, ClawNet billing, legacy scheduler mode,
or a `claw-net.org` URL.

`npm run audit:all` audits both npm lockfiles: the server/root workspace and
`hosted/ui`. A clean root `npm audit` alone is not enough because the hosted UI
has a separate package lock.

`npm run check:launch-preflight` runs the repo-local launch evidence that does
not require production secrets or a workflow-scoped GitHub token: full audits,
lint, typecheck, tests, hosted UI build, and the production deploy pin patch
verifier. It does not replace `npm run check:production` or
`npm run check:customer-launch` against the real environment.

`npm run check:customer-launch` runs the same production readiness evaluator
with `PULSE_CUSTOMER_LAUNCH=true`, so warnings for rollback posture become hard
errors at final cutover.

This check is necessary, but it is not the whole launch gate. Passing
`npm run check:production` does not authorize a domain cutover by itself.

Expected standalone launch posture:

- `NODE_ENV=production`
- `AUTH_PROVIDER=firstparty`
- `BILLING_PROVIDER=stripe`
- `STRIPE_WEBHOOK_SECRET=whsec_<stripe-endpoint-secret>` when
  `BILLING_PROVIDER=stripe`
- `SCHEDULER_MODE=durable`
- `PULSE_DURABLE_SCHEDULER_WRITES=true` after the X-write ledger
  crash-replay tests are green
- `PULSE_ALLOW_FOLLOW_CHURN` is unset; hosted follow/unfollow churn is not part
  of the canonical customer-launch path
- `PULSE_URL=https://<standalone-domain>` as the app origin only on a public
  domain, not localhost, reserved example/test domains, `.local`, `.internal`,
  loopback, private network hosts, single-label hosts, IP literals, or a URL
  with credentials, a port, trailing slash, or a path/query/fragment
- `HOSTED_DB_PATH` and `PULSE_HEART_PATH` are explicit absolute production file
  paths that already exist as files, not relative paths, directories, or
  temporary directories
- `HOSTED_DB_PATH` opens read-only as SQLite and passes `quick_check`
- `PULSE_HEART_PATH` loads with the configured `PULSE_HEART_SECRET`
- `TENANT_ENCRYPTION_KEY` is a 64-character hex key
- `ADMIN_API_KEY` and `PULSE_HEART_SECRET` are random values with at least 32
  characters
- `RESEND_API_KEY`, `RESEND_FROM`, and `PULSE_SUPPORT_EMAIL` are set so account,
  security, and support emails work from public Pulse-controlled addresses, not
  placeholder example domains or local domains
- at least one hosted LLM provider key is configured
- the selected search provider has its matching API key
- provider credentials are real production values, not placeholder, sample, or
  test strings
- `X_OAUTH_CLIENT_ID` and `X_OAUTH_CLIENT_SECRET` are configured for the
  user-facing X connection flow
- `X_MONTHLY_POST_LIMIT` is set to the approved monthly write capacity for the
  configured X API tier
- `GITHUB_OAUTH_CLIENT_ID` and `GITHUB_OAUTH_CLIENT_SECRET` are configured when
  `GITHUB_CALLBACK_URL` is set
- configured OAuth callback URLs use the same origin as `PULSE_URL`, because the
  hosted runtime builds provider redirects from `PULSE_URL`
- Stripe webhook delivery to `POST /webhooks/stripe` is configured with the
  deployed endpoint secret
- the production deploy workflow targets the GitHub `production` environment and
  verifies the deployed `/api/deploy-info` endpoint after SSH deploy
- the server-side deploy script rejects dirty working trees, unsafe branch
  switching, unlisted deploy branches, missing external env files, and mismatched
  `/api/deploy-info` metadata

Current shipped caveats:

- `SCHEDULER_MODE=durable` runs monitor jobs through the durable worker by
  default. Content and outreach durable jobs require the explicit
  `PULSE_DURABLE_SCHEDULER_WRITES=true` gate, which depends on the X-write
  ledger preventing duplicate post/reply/like calls on worker replay.
- Hosted follow/unfollow churn is not part of the canonical production path.
  `PULSE_ALLOW_FOLLOW_CHURN` remains an explicit opt-in and the hosted scheduler
  skips follow/unfollow tasks by default.
- Stripe webhook support is shipped, but standalone billing still depends on a
  real deployed endpoint, a matching `STRIPE_WEBHOOK_SECRET`, and successful
  signed delivery to `POST /webhooks/stripe`.

Generate required server secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Use the hex value for `TENANT_ENCRYPTION_KEY`. Use separate base64url values for
`ADMIN_API_KEY` and `PULSE_HEART_SECRET`; strict customer launch fails if these
server secrets are missing or have obvious low-entropy shapes.

Before domain cutover:

- set `PULSE_URL` to the final canonical HTTPS Pulse app origin with no
  trailing slash, path, query string, fragment, credentials, or explicit port
- set `HOSTED_DB_PATH` and `PULSE_HEART_PATH` to existing explicit absolute
  file paths under the deployed data directory
- confirm the hosted DB opens read-only and passes SQLite `quick_check`
- confirm the Pulse heart file loads with the deployed `PULSE_HEART_SECRET`
- set OAuth callback URLs to `${PULSE_URL}/auth/x/callback` and
  `${PULSE_URL}/auth/github/callback` when those integrations are enabled
- ensure `PULSE_URL` and OAuth callback URLs use the public standalone domain,
  not localhost, private IPs, reserved example/test domains, `.local`, or
  `.internal` hosts, single-label hosts, or IP literals
- ensure configured OAuth callback URL origins exactly match `PULSE_URL`
- ensure configured OAuth callback URLs have no query string, fragment,
  embedded credentials, or explicit port
- remove any legacy callback env overrides that still point at ClawNet or
  placeholder domains
- run `npm run check:production` with the deployed environment
- run `npm run check:customer-launch` with the deployed environment
- run `npm run check:launch-preflight` from the repo root and resolve any local
  launch-preflight failures
- run `npm run audit:all` from the repo root and resolve any production or
  development advisories that affect the shipped hosted app
- verify the check is running against the real production environment rather
  than a local or placeholder `.env`
- confirm Stripe customer/subscription rows are populated from checkout/webhook
  processing before enabling customer traffic; the provider fails closed without
  an active or trialing entitlement
- confirm the deployed `STRIPE_WEBHOOK_SECRET` matches the Stripe endpoint
  secret and that signed deliveries are accepted
- complete cutover smoke tests against the deployed URL:
  - `GET /health`
  - `GET /api/deploy-info`
  - first-party login and session refresh
  - X OAuth authorize and callback on `${PULSE_URL}/auth/x/callback`
  - GitHub OAuth authorize and callback on `${PULSE_URL}/auth/github/callback`
    if the GitHub integration is enabled
  - signed Stripe webhook test event and resulting entitlement row
- complete a real X safety soak with account-health monitoring, pause/reversal
  controls, and webhook-backed billing active on the deployed stack
- keep the standalone domain dark until `npm run check:customer-launch` passes
  against the real deployed environment and the X safety soak is accepted
- capture a durable-job baseline with `npm run measure:durable-jobs -- --jobs
<n> --workers <n>` before revisiting the Rust worker-seam decision
  - Current local baseline from 2026-05-26:
    `npm run measure:durable-jobs -- --jobs 1000 --workers 8` completed 1,000
    jobs at 27.08 jobs/s with p95 tick latency 41.59ms, 0 dead-lettered jobs,
    8/8 duplicate enqueues suppressed, 8/8 brands receiving exactly 125
    completions each, and +9.99MB RSS.

Warnings are allowed during migration. Errors block customer launch.
