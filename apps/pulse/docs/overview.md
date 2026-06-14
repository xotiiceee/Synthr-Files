# Pulse Overview

Status: canonical

## Purpose

Pulse is the X.com marketing agent product in this system.

It is intentionally narrower than its earlier positioning. Pulse now owns
X-specific marketing-agent behavior and hosted product concerns. It should not
pretend to be a generic six-platform framework if that is not the real product.

Pulse is moving to a standalone premium product model. ClawNet can remain a
transitional provider for selected capabilities, but Pulse auth, billing,
deployment, and hosted runtime doctrine now live in this repo.

That ownership change does not mean customer-facing cutover is complete.
Standalone launch still depends on real-environment validation, Stripe webhook
delivery, X safety soak, and explicit acceptance of the current legacy-runner
posture for content/outreach work.

## This Repo Owns

- X.com posting, reply, and engagement behavior
- Brand/profile and operator-facing product logic
- Hosted runtime and product-specific scheduling
- Product-specific configuration and troubleshooting
- First-party Pulse auth, billing, deployment, and runtime doctrine
- The way Pulse uses any remaining ClawNet provider capability

## This Repo Does Not Own

- ClawNet provider internals
- Soma protocol truth
- Broad multi-platform positioning that is not currently real

## Related Repos

- `claw-net`: provider capabilities Pulse may use during migration
- `Soma`: protocol and trust primitives upstream of ClawNet

## Doc Map

- `docs/architecture/`: current product and runtime structure
- `docs/reference/`: config, dependencies, and integration contracts
- `docs/how-to/`: task-based operating guides
- `docs/operations/`: deploy and troubleshooting docs
- `docs/proposals/`: future ideas and designs not yet adopted
- `docs/archive/`: preserved older material that should not steer current work
