Status: archived
See instead: docs/overview.md

# GitHub Context for Pulse

Status: archived


Pulse can connect to public or private GitHub repos to improve product-aware posting.

For private repos, the recommended setup is:

1. Connect GitHub in Pulse.
2. Choose the repo.
3. Set trust mode to `docs`.
4. Add one of these files in the repo:
   - `.pulse/marketing-context.md`
   - `.github/pulse-context.md`
   - `marketing-context.md`

## Why this is recommended

Private commit messages and PR titles can still reveal internal strategy or implementation details.
A dedicated context file gives Pulse a safe, intentional narrative layer instead:

- what shipped
- why it matters
- what is public vs not public
- preferred language
- claims to avoid
- launch timing

## Suggested file format

```md
# Pulse Marketing Context

## Product
- One sentence description of the product.
- Who it is for.
- What problem it solves.

## Safe To Mention
- Features that are public.
- Metrics that are approved for external use.
- Links that can be shared.

## Not Safe To Mention
- Internal architecture details.
- Unreleased features.
- Customer names under NDA.
- Performance numbers that are not public.

## Recent Shipped Updates
- What changed.
- Why users should care.
- Migration notes or rollout notes.

## Current Narrative
- The angle Pulse should emphasize this week.
- The tone to use.
- Keywords or phrases to prefer.

## Launch Rules
- Only mention updates after release tags.
- Only talk about merged PRs if they are already public.
- Never quote source code.
```

## Trust Modes

### `metadata`
Best for public repos.
Reads high-level repo activity only.

### `docs`
Best default for private repos.
Reads safe context files and docs you explicitly allow.

### `full`
Only for teams that explicitly want deeper internal awareness.
Should be used carefully.

## Best Practice

Treat GitHub as one signal, not the only signal.
The smartest setup is:

- GitHub for shipping context
- Pulse knowledge notes for positioning and voice
- brand settings for style and guardrails
