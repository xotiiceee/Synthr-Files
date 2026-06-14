# Pulse

Pulse is a standalone X.com marketing automation product.

This repo owns the Pulse product itself: brand/profile logic, content and engagement behavior, hosted runtime, operator-facing flows, and the X-specific execution model. It does not own the Soma protocol or the ClawNet platform.

## Repo Role

- Owns Pulse product behavior for X.com
- Owns hosted runtime and product-specific operations
- Uses ClawNet only as an optional/transitional provider where explicitly documented
- Owns standalone auth, billing, deployment, and runtime posture for Pulse
- Integrates with Soma only through upstream platform choices

## What Pulse Is Not

- Not a generic multi-platform marketing framework
- Not the canonical home for ClawNet architecture
- Not the canonical home for Soma specs or trust philosophy

## Quick Start

```bash
npm install
npm run hosted
```

Useful commands:

- `npm run hosted`
- `npm run panel`
- `npm start`
- `npm run dry-run`
- `npm run build:ui`

## Docs

- Repo overview: [docs/overview.md](docs/overview.md)
- Architecture context: [docs/architecture/context.md](docs/architecture/context.md)
- Product model: [docs/architecture/product-model.md](docs/architecture/product-model.md)
- Adaptive engine: [docs/architecture/adaptive-engine.md](docs/architecture/adaptive-engine.md)
- Config reference: [docs/reference/config.md](docs/reference/config.md)
- ClawNet dependency: [docs/reference/clawnet-dependency.md](docs/reference/clawnet-dependency.md)
- X integration: [docs/reference/x-integration.md](docs/reference/x-integration.md)
- Local development: [docs/how-to/local-dev.md](docs/how-to/local-dev.md)
- Troubleshooting: [docs/operations/troubleshooting.md](docs/operations/troubleshooting.md)
- Release workflow: [docs/operations/release.md](docs/operations/release.md)
- Proposals: [docs/proposals/README.md](docs/proposals/README.md)
- Archive: [docs/archive/README.md](docs/archive/README.md)
