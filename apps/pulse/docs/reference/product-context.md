# Product Context

Status: canonical

Use this file as the canonical product-context reference for Pulse chat and operator-facing product guidance.

If unsure, prefer checking current product behavior over guessing or inflating.

## Pulse

Pulse is currently the X.com marketing agent product in this system.

- Primary product surface: X
- Current active scope: hosted Pulse runtime, X-specific content and engagement behavior, and Pulse's product-specific dependency on ClawNet
- Not current canonical scope: generic multi-platform positioning presented as if it is already the shipped product

## Standalone Product Direction

Pulse is moving to standalone product ownership for auth, billing, deployment,
and hosted runtime doctrine.

- First-party Pulse product truth lives in this repo
- ClawNet can remain a transitional provider for selected capabilities
- ClawNet is not canonical for standalone Pulse auth, billing, deployment, or
  hosted runtime behavior

## Soma Relationship

Pulse does not define Soma protocol truth.

- Soma remains upstream protocol and reference truth
- Pulse should describe only how the product sits downstream of those protocol primitives

## Product Facts To Preserve

- Pulse uses brand/profile logic, content generation, operator workflows, and hosted runtime to support the X product
- Pulse pricing and billing assumptions should move toward standalone
  subscription plus durable usage metering
- Product docs should remain honest about present scope and not silently reintroduce broader historical positioning
