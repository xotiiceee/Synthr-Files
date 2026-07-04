# ADR-0004: Retain Non-X Surfaces As Non-Canonical

Status: accepted

## Context

Pulse currently presents itself as an X-only product. At the same time, the repo still contains retained code and playbook material for additional platforms such as Reddit, Discord, LinkedIn, Product Hunt, and Hacker News.

Deleting those surfaces immediately would create churn and remove potentially useful future reference material. Treating them as current shipped scope would be dishonest and would weaken onboarding, planning, and AI-agent behavior.

## Decision

Keep the retained non-X surfaces in the repo for now, but treat them as non-canonical.

Current canonical product truth remains:

- Pulse is an X-first/X-only shipped product today
- product docs and README should describe X as the current active surface
- non-X material is preserved as legacy or future-facing context, not as proof of current product scope

If Pulse expands beyond X again, each platform should be reintroduced deliberately and one at a time through explicit product decisions, documentation updates, and implementation validation.

## Consequences

- the repo may contain more code than the current shipped scope
- docs stay honest even when future-facing material is preserved
- contributors and agents should not assume non-X surfaces are active just because files exist
- future platform expansion becomes a deliberate act instead of a silent drift back into broad scope
