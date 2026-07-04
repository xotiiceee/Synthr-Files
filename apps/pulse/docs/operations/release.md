# Pulse Secure Release Workflow

Status: active migration guide

This documents the release path that is partly shipped in-repo today and the
gates that are still unresolved for production truth.

## Shipped In Repo

- CI, Dependency Review, CodeQL, and Dependabot workflow files exist in this
  repo.
- A `Deploy Production` GitHub Actions workflow exists at
  `.github/workflows/deploy-production.yml`.
- That workflow joins the tailnet, SSHes to the private host, runs
  `scripts/deploy.sh`, and verifies `/api/deploy-info`.
- The job targets the GitHub `production` environment.
- This workspace uses `master` and `origin=https://github.com/hey-vera/pulse.git`
  as the repo-visible release truth.

## What Is Not Resolved Yet

- The deploy workflow still accepts a manual `branch` input and passes
  `GIT_BRANCH='${{ inputs.branch }}' AUTO_SWITCH_BRANCH=1` into the server-side
  deploy script. This workspace attempted again to remove that input and pin the
  workflow to the repository default branch, but GitHub rejected the push because
  the current OAuth token lacks `workflow` scope.
- Git confirms `origin=https://github.com/hey-vera/pulse.git`, local `master`
  tracks `origin/master`, and `git ls-remote --symref origin HEAD` reports
  `refs/heads/master` as the remote default branch.
- This workspace is not logged into `gh`, so it cannot verify current GitHub
  branch-protection settings, required reviewers on the `production`
  environment, or the meaning of prior GitHub "rule bypass" notices on pushes
  to `hey-vera/pulse`.
- Because of that, "No production deploy until remote/branch truth is resolved"
  should remain unchecked in the execution checklist with an explicit note.
- `npm run check:production` now also fails with
  `UNSAFE_PRODUCTION_DEPLOY_BRANCH_INPUT` while the checked-in production deploy
  workflow can deploy arbitrary branches.
- `scripts/deploy.sh` also rejects branch switching from `AUTO_SWITCH_BRANCH=1`
  unless `ALLOW_DEPLOY_BRANCH_SWITCH=1` is set for a reviewed manual deploy.
  It now also validates the deploy branch name and allows only `master` or
  `main` by default unless `DEPLOY_BRANCH_ALLOWLIST` is extended or
  `ALLOW_UNLISTED_DEPLOY_BRANCH=1` is set for a reviewed manual deploy. This
  reduces server-side blast radius but does not replace pinning the checked-in
  workflow.
- `scripts/deploy.sh` fails before restarting the service if the external
  production env file is missing; the checked-in systemd unit requires
  `/etc/pulse/pulse.env`.

## Current Release Discipline

Treat this as the current minimum until the GitHub-side policy is confirmed:

1. Treat `origin` on `https://github.com/hey-vera/pulse.git` and
   `origin/master` as the repo truth visible from this workspace.
2. Keep production deploys blocked for customer launch until the remote/branch
   policy and production-environment reviewers are explicitly verified outside
   this repo.
3. Run CI, `npm run audit:all`, and `npm run check:production` against the real deployment
   environment before any launch-facing deploy.
4. If the GitHub Actions deploy workflow is used, verify `/api/deploy-info`
   after deploy and record the branch and commit actually served. The server-side
   deploy script also fails if `/api/deploy-info` does not report the just
   deployed branch and commit.

## Required Workflow Pinning Change

When a maintainer has a token with GitHub `workflow` scope, update
`.github/workflows/deploy-production.yml` so production deploys cannot choose an
arbitrary branch:

- remove `workflow_dispatch.inputs.branch`
- change `actions/checkout` from `ref: ${{ inputs.branch }}` to the protected
  default branch or omit `ref`
- remove `GIT_BRANCH='${{ inputs.branch }}' AUTO_SWITCH_BRANCH=1` from the SSH
  deploy command
- pin the server-side deploy to the protected default branch without
  `AUTO_SWITCH_BRANCH=1`; this makes the deploy fail closed if the VPS is not
  already on the expected branch
- keep the `production` environment gate enabled
- run `npm run check:production` with the real production environment and
  confirm the `UNSAFE_PRODUCTION_DEPLOY_BRANCH_INPUT` error is gone

The ready-to-apply patch is checked in at
[`deploy-production-pin.patch`](deploy-production-pin.patch). Apply it only with
a GitHub token that has `workflow` scope:

```bash
git apply docs/operations/deploy-production-pin.patch
git diff --check
npm run check:production-deploy-patch
npm run check:production
git add .github/workflows/deploy-production.yml
git commit -m "chore: pin production deploy branch"
git push origin master
```

This patch has been verified locally with
`npm run check:production-deploy-patch`; when applied temporarily, strict
customer-launch readiness passes with production-shaped environment values. It
is not applied to the checked-in workflow yet because pushing workflow changes
requires GitHub `workflow` scope.

Before final customer cutover, run `npm run check:customer-launch` against the
real deployed environment. `npm run check:production` is still useful during
migration, but it does not force strict customer-launch gates unless
`PULSE_CUSTOMER_LAUNCH=true` is set.

The intended command shape is:

```yaml
- uses: actions/checkout@93cb6efe18208431cddfb8368fd83d5badbf9bfd

- name: Deploy Pulse
  env:
    DEPLOY_USER: ${{ vars.DEPLOY_USER || 'deploy' }}
    TAILSCALE_HOST: ${{ vars.TAILSCALE_HOST }}
  run: |
    test -n "$TAILSCALE_HOST"
    ssh -o StrictHostKeyChecking=accept-new "${DEPLOY_USER}@${TAILSCALE_HOST}" \
      "cd /home/${DEPLOY_USER}/pulse && GIT_BRANCH=master bash scripts/deploy.sh"
```

## Production Environment Inputs

The checked-in deploy workflow expects these GitHub `production` environment
values:

Secrets:

- `TS_OAUTH_CLIENT_ID`
- `TS_OAUTH_SECRET`

Variables:

- `TAILSCALE_HOST`
- `DEPLOY_USER`
- `PUBLIC_APP_URL`

Recommended values remain:

- `DEPLOY_USER=deploy`
- `PUBLIC_APP_URL=https://<standalone-pulse-domain>`

The deployed app environment also needs the customer-launch secrets documented
in `docs/reference/config.md`, including X OAuth credentials, Stripe webhook
secret, Resend email delivery, first-party auth, durable scheduler writes, and
the final standalone `PULSE_URL`.
