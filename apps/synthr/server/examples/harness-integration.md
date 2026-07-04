# Harness Integration Notes

Use this service as a paid security-intel tool in an agent harness after the public endpoint is live.

## Public Base

- `https://synthr.online`
- Discovery:
  - `https://synthr.online/llms.txt`
  - `https://synthr.online/x402-catalog.json`
  - `https://synthr.online/openapi.json`

## Recommended Tool Flow

1. Call `POST /v1/cyber/stack-brief` at project start with the current dependency set.
2. Call `POST /v1/cyber/audit-deps` before dependency updates or deployment.
3. Call `POST /v1/cyber/advice` when the agent is implementing auth, prompt-tooling, or web-exposed flows.
4. Call `GET /v1/cyber/breaking` periodically for situational awareness on recently exploited issues.

## Minimal Agent Pattern

```ts
const tools = {
  stackBrief: {
    method: 'POST',
    url: 'https://synthr.online/v1/cyber/stack-brief',
  },
  auditDeps: {
    method: 'POST',
    url: 'https://synthr.online/v1/cyber/audit-deps',
  },
  advice: {
    method: 'POST',
    url: 'https://synthr.online/v1/cyber/advice',
  },
  breaking: {
    method: 'GET',
    url: 'https://synthr.online/v1/cyber/breaking?days=14&limit=5',
  },
};
```

## Operational Notes

- These endpoints are x402-paid. The caller needs an x402-aware client.
- Responses are JSON-first and intended for tool use, not just prose display.
- Re-run `stack-brief` after dependency changes.
- Treat results as grounded guidance, not a substitute for a full security review.
