Status: proposed

# Pulse as a Soma Agent Tree

Status: proposed


Pulse becomes ClawNet's first production agent tree. Pulse runs a single Soma Heart. Brand agents are lightweight namespaced identities within that heart — not independent agents. The receipt chain flows unbroken from credit purchase through every action to on-chain proof.

## Architecture

```
ClawNet Platform Heart
  └── Customer DID (pulse tree on ClawNet — tracks purchases + API usage)
        └── Pulse Service Heart (one heart for all brand agents)
              ├── @acme-marketing [namespace tag]
              ├── @defi-protocol [namespace tag]
              └── @meme-coin-xyz [namespace tag]
```

| Level | What It Is | Heart? | Trust Source |
|-------|-----------|--------|-------------|
| ClawNet Platform | Root of all trust | Yes — platform heart | Self-bootstrapped, on-chain proofs |
| Customer | Credit buyer, API consumer | No — pulse tree on ClawNet | Purchase history, usage patterns |
| Pulse Service | Marketing engine | Yes — single service heart | Inherits ClawNet trust, earns its own |
| Brand Agent | Namespace within Pulse | No — tagged actions in Pulse's heart | Attribution label, no independent scoring |

**Why brand agents don't need hearts:** They're sandboxed dashboard entities. Pulse controls every action — the user picks topics, approves content, sets limits. A brand agent can't make independent decisions or act maliciously. The worst case is someone experimenting with X rate limits, which is a platform issue, not a trust issue. Hearts are for autonomous agents making independent decisions. Brand agents are just attribution labels.

## The Receipt Chain

The core insight: every dollar spent has an unbroken cryptographic trail from payment to outcome.

### Purchase Flow (ClawNet Side)

```
Customer buys $50 credits (Stripe or Solana)
  │
  ├─ ClawNet folds ECONOMIC leaf into customer's pulse tree
  │    └─ { action: 'deposit', amount: 50000, ref: 'stripe_pi_xxx' }
  │
  ├─ EAS attestation anchored on Base (on-chain receipt)
  │    └─ Schema: payment amount, customer DID, timestamp, tx hash
  │
  └─ Dashboard popup: "View your receipt"
       └─ Receipt page in ClawNet dashboard:
            ├─ Amount: $50.00 (50,000 credits)
            ├─ Method: Stripe / Solana
            ├─ Timestamp: 2026-04-09T16:30:00Z
            ├─ Pulse tree proof: leaf #127, heartbeat #4829
            ├─ EAS attestation: [View on Base] (link to basescan)
            └─ Verification: "This receipt is cryptographically verifiable"
```

### Usage Flow (Pulse Side)

```
Brand agent @acme uses credits to generate + post content
  │
  ├─ Pulse calls ClawNet x402 endpoint (tweet search for context)
  │    └─ ClawNet folds ACTION leaf into customer's pulse tree
  │    └─ Soma birth cert attached to response
  │
  ├─ Pulse heart folds action (tagged: namespace=@acme)
  │    └─ { endpoint: 'twitsh-search', credits: 2, brand: 'acme', cached: false }
  │
  ├─ LLM generates content → Pulse heart folds (tagged: @acme)
  │    └─ { action: 'content-gen', model: 'llama-3.3-70b', credits: 1 }
  │
  ├─ Posted to X → Pulse heart folds (tagged: @acme)
  │    └─ { action: 'x-post', tweetId: '...', success: true }
  │
  └─ Pulse dashboard receipt log:
       ├─ Action: "Posted tweet for @acme"
       ├─ Credits used: 3 (2 x402 + 1 LLM)
       ├─ Soma badge: "Verified" (birth cert valid for x402 data)
       ├─ Heartbeat: #583 in Pulse's heart
       └─ ClawNet receipt link: [View credit purchase] → ClawNet dashboard
```

### The Unbroken Chain

```
Stripe charge $50
  → ClawNet ECONOMIC leaf (customer pulse tree, on-chain EAS receipt)
  → Credits available (50,000)
  → Pulse x402 call: -2 credits (ACTION leaf, Soma birth cert)
  → Content generation: -1 credit (ACTION leaf in Pulse heart)
  → Posted to X (ACTION leaf in Pulse heart)
  → Engagement tracked 4-36h later (CHECKPOINT leaf)
  → Monthly rollup: Groth16 proof compressing all actions into 192 bytes
```

Every step verifiable. Two receipt logs that cross-reference:
- **ClawNet receipt log**: purchases, credit balance, API usage
- **Pulse receipt log**: per-brand-agent actions, content outcomes, engagement

## How It Works

### 1. Pulse Service Heart

On hosted server startup, Pulse registers itself as a ClawNet agent:

```typescript
// hosted/scheduler.ts — on boot
const pulseHeart = await initPulseHeart({
  clawnetApiKey: process.env.CLAWNET_API_KEY,
  serviceName: 'Pulse Marketing Engine',
  capabilities: ['content-generation', 'engagement-monitoring', 'x-posting', 'brand-profiling']
});
```

ClawNet registers a DID for Pulse. Every action Pulse takes gets folded into Pulse's pulse tree via `appendAction()`. One heart, all brand agent actions namespaced within it.

### 2. Brand Agent as Namespace

When a tenant creates a brand agent, it's a lightweight registration — not a full delegation:

```typescript
// POST /api/agents — create agent
async function createAgent(tenantId: string, preset: AgentPreset) {
  // 1. Save agent preset (existing flow)
  const agent = saveAgentPreset(preset);

  // 2. Register namespace in Pulse's heart
  const namespace = await pulseHeart.registerNamespace({
    label: preset.brandName,
    tenantId,
    xHandle: preset.xHandle
  });

  // 3. Store namespace ID (lightweight, no DID needed)
  agent.somaNamespace = namespace.id;
}
```

No delegation API call. No child DID. No trust inheritance. Just a tag that groups actions within Pulse's single heart.

### 3. Action Attribution

Every action gets tagged with the brand agent namespace:

```
Brand agent @acme posts a tweet
  → Pulse calls ClawNet x402 endpoint (Soma birth cert returned)
  → Pulse heart folds ACTION leaf: { namespace: '@acme', action: 'x402-call', ... }
  → Content generated via LLM
  → Pulse heart folds ACTION leaf: { namespace: '@acme', action: 'content-gen', ... }
  → Posted to X
  → Pulse heart folds ACTION leaf: { namespace: '@acme', action: 'x-post', ... }
```

All folded into Pulse's single pulse tree. Queryable by namespace for per-brand reporting.

### 4. Brand Agent Death (Soft)

When a customer deletes a brand agent from the dashboard:

```typescript
async function deleteAgent(tenantId: string, agentId: string) {
  // 1. Existing: remove agent preset
  removeAgentPreset(agentId);

  // 2. Seal namespace in Pulse's heart
  await pulseHeart.sealNamespace(agent.somaNamespace, {
    reason: 'customer-deleted',
    finalStats: {
      totalActions: agent.actionCount,
      totalCredits: agent.creditsUsed,
      activeDays: agent.daysSinceCreation
    }
  });
  // Folds a termination leaf tagged with the namespace
  // No full death certificate — just a clean record
}
```

The namespace is sealed. Historical actions remain in Pulse's heart (audit trail preserved). No complex death certificate protocol — brand agents are just labels.

### 5. Provenance Chain

Every piece of content has a full provenance trail:

```
Tweet: "DeFi yields are back..."
  ├── Namespace: @defi-protocol (brand agent within Pulse)
  ├── Pulse Heart: did:key:z... (heartbeat #583)
  ├── Platform: ClawNet (heartbeat #12847)
  ├── Data source: x402 endpoint call (Soma birth cert)
  ├── Credit chain: Stripe $50 → ClawNet ECONOMIC leaf → Pulse ACTION leaf
  └── Monthly proof: Groth16 (192 bytes, compresses 847 actions)
```

## Receipt System Design

### ClawNet Dashboard — Purchase Receipts

Every credit purchase gets a receipt page:

```
┌─────────────────────────────────────────────┐
│ Receipt #CR-2026-04-00127                   │
│                                             │
│ Amount:     $50.00 (50,000 credits)         │
│ Method:     Stripe (Visa ****4242)          │
│ Date:       April 9, 2026 4:30 PM UTC      │
│                                             │
│ ─── Verification ───                        │
│ Pulse tree leaf:  #127                      │
│ Heartbeat index:  #4829                     │
│ Tree root:        0x7a3f...                 │
│                                             │
│ [View on Base ↗] [Download PDF] [Share]     │
│                                             │
│ ✓ Verified by Soma                          │
│ This receipt is cryptographically anchored  │
│ on Base via EAS attestation.                │
└─────────────────────────────────────────────┘
```

### Pulse Dashboard — Usage Receipts

Per-brand-agent action log with provenance:

```
┌─────────────────────────────────────────────┐
│ @acme-marketing — Activity Log              │
│                                             │
│ Apr 9, 4:45 PM  Posted tweet               │
│   Credits: 3 (2 search + 1 gen)            │
│   ✓ Soma Verified  [View receipt ↗]        │
│                                             │
│ Apr 9, 3:12 PM  Generated thread draft      │
│   Credits: 4 (2 search + 2 gen)            │
│   ✓ Soma Verified  [View receipt ↗]        │
│                                             │
│ Apr 9, 1:00 PM  Engagement check            │
│   Credits: 0 (scheduled)                   │
│   ✓ Soma Verified                          │
│                                             │
│ ─── Monthly Summary ───                     │
│ Total actions: 847                          │
│ Credits used: 1,240                         │
│ Groth16 proof: [View on Base ↗]            │
│ "All 847 actions compressed into one        │
│  192-byte proof, verifiable on-chain."      │
└─────────────────────────────────────────────┘
```

### Receipt as Invoice

For B2B customers, on-chain receipts serve as immutable invoices:
- Timestamped, signed, anchored on Base
- No PDF needed (though one can be generated)
- Verifiable by any third party without trusting ClawNet
- Regulatory-ready for AI content labeling and spend auditing

### Receipts as Marketing

Every receipt page includes:
- "Verified by Soma" badge with explanation link
- "What is this?" → landing page explaining on-chain verification
- Share button → public receipt URL (no sensitive data exposed)
- Every receipt is organic marketing for the verification system

## Implementation Plan

### Phase 1: Pulse Heart Registration (Small)
- Add `initPulseHeart()` to hosted server startup
- Register Pulse as a ClawNet agent with its own DID
- Fold scheduler actions into Pulse's pulse tree
- Every x402 call already goes through `clawnet-client.ts` — add DID header

### Phase 2: Brand Agent Namespaces (Small)
- On agent create: register namespace in Pulse's heart (lightweight, no delegation)
- Tag all actions with brand agent namespace
- On agent delete: seal namespace, fold termination leaf
- Per-namespace action queries for dashboard reporting

### Phase 3: Receipt Pages (Medium)
- ClawNet dashboard: purchase receipt page with EAS link
- Popup on purchase: "View your receipt"
- Receipt log page: filterable history of all purchases
- Public receipt URLs (shareable, no sensitive data)

### Phase 4: Pulse Usage Receipts (Medium)
- Per-brand-agent action log in Pulse dashboard
- Soma verification badge on each action
- Cross-reference links to ClawNet purchase receipts
- Credit flow breakdown (which actions consumed which credits)

### Phase 5: Monthly Proof Rollup (Medium)
- Compress each customer's monthly Pulse actions into one Groth16 proof
- Display in both dashboards: "847 actions, $12.50 spent, one proof"
- On-chain anchor on Base (monthly, not per-action)
- Exportable for compliance/audit

### Phase 6: Provenance Display (Small)
- "Verified by Soma" badge on all posted content in Activity page
- Shareable provenance chain per tweet/post
- "What is this?" landing page for organic discovery

## Data Custody Protocol (Soma Primitive)

Soma now includes a Data Custody protocol — any agent (not just Pulse) can use it to prove honest data handling. Built into ClawNet as `POST /v1/soma/custody/*` endpoints.

### How Pulse Uses It

```
Customer creates brand agent
  → Pulse generates per-customer DEK (data encryption key)
  → Pulse encrypts brand profile, knowledge, CRM with DEK
  → Pulse calls ClawNet: POST /v1/soma/custody/accept
    { subjectId: tenantId, dekFingerprint: H(DEK), fieldsManifest: ['brand-profile', 'knowledge', 'crm'] }
  → CUSTODY_ACCEPT leaf folded into Pulse's heart
  → DEK fingerprint committed to pulse tree (on-chain via EAS + Groth16)

Scheduler runs brand agent tasks
  → Pulse decrypts brand profile to generate content
  → Pulse calls ClawNet: POST /v1/soma/custody/access
    { subjectId: tenantId, reason: 'scheduled-post', fieldsAccessed: ['brand-profile'] }
  → CUSTODY_ACCESS leaf folded into Pulse's heart
  → Tamper-evident record of every data access

Customer deletes brand agent
  → Pulse destroys DEK (crypto-shred)
  → Pulse calls ClawNet: POST /v1/soma/custody/release
    { subjectId: tenantId, destructionProof: H(dekFingerprint || 'destroyed' || timestamp) }
  → CUSTODY_RELEASE leaf folded into Pulse's heart
  → On-chain proof that DEK is destroyed — data irrecoverable even from backups
```

### What This Proves

| Trust Claim | Proof |
|-------------|-------|
| Pulse deleted my data when I asked | DEK destroyed, destruction proof on-chain (crypto-shredding) |
| Pulse only accessed data for my tasks | Every access logged as tamper-evident pulse tree leaf |
| Pulse didn't alter my data history | Merkle root on-chain — any change breaks the root |
| Pulse can't read my sensitive fields | Sensitive fields encrypted with user-session keys (not stored) |

### Customer Exit Experience

When a customer deletes their account:
1. All brand agents soft-terminated (namespaces sealed)
2. DEK destroyed, destruction proof published
3. Customer receives export: receipt log (JSON/PDF) + provenance chain + on-chain Groth16 proof link
4. "Your data is deleted. Here's your proof. Verify anytime on Base."

This is the exit experience that builds word-of-mouth. No other SaaS can prove deletion.

## Why This Matters

1. **Unbroken receipt chain** — payment to outcome, every step verifiable on-chain
2. **First real agent tree in production** — proves Soma works beyond theory
3. **Every tweet is provable** — unprecedented transparency for AI content
4. **Receipts as marketing** — every verification page is organic discovery
5. **B2B invoice replacement** — on-chain receipts eliminate PDF invoicing
6. **Competitive moat** — no other marketing agent has cryptographic provenance
7. **Regulatory readiness** — AI content labeling laws arrive, Pulse already has full audit trails
8. **Monthly rollup proofs** — 192 bytes proves an entire month of activity

## ClawNet API Dependencies

| Endpoint | Purpose |
|----------|---------|
| `GET /v1/trust/:did` | Query Pulse's trust score |
| `GET /v1/soma/platform` | Verify platform chain |
| `POST /v1/soma/verify` | Submit action for trust verification |
| `POST /v1/endpoints/:id/call` | x402 data calls (existing) |
| `GET /v1/receipts/:id` | Fetch purchase receipt (needs building) |
| `POST /v1/soma/custody/accept` | Commit to custodying user data |
| `POST /v1/soma/custody/access` | Log data access event |
| `POST /v1/soma/custody/release` | Crypto-shred: destroy DEK, publish proof |
| `GET /v1/soma/custody/:did/:subjectId` | Get verifiable custody chain |

Custody endpoints are live on ClawNet. Receipt retrieval endpoint needs building.

## Fee Spine Integration (Soma Primitive)

The Fee Spine (`src/core/fee-spine.ts`) is a Soma primitive — every credit that flows through ClawNet passes through ONE function that produces a transparent breakdown. That breakdown becomes an ECONOMIC leaf in the pulse tree. Even zero-fee events get recorded to prove ClawNet took nothing.

### How It Touches Pulse

Every Pulse action that costs credits flows through the fee spine:

```
Brand agent @acme calls x402 endpoint (2 credits)
  → ClawNet fee spine: computeInfrastructureFee('endpoint_call', 2, trustScore)
  → Breakdown: { amount: 2, providerShare: 1.90, platformFee: 0.10, rate: 5% }
  → ECONOMIC leaf folded into customer's pulse tree (breakdown hash)
  → Provider gets 1.90 credits, ClawNet keeps 0.10

Brand agent @acme triggers content gen (1 credit, ClawNet product)
  → Fee spine: computeProductFee('trust_query', 0.05, trustScore)
  → ECONOMIC leaf folded into Pulse's heart

Credits transferred between tenants (0 credits fee)
  → Fee spine: computeZeroFee('transfer', 500, trustScore)
  → ECONOMIC leaf proves ClawNet took nothing — on-chain proof of zero fee
```

### Trust-Scaled Rates

The fee spine uses trust scores to scale the infrastructure rate down:

| Trust Score | Multiplier | Effective Rate | Example: 100cr endpoint call |
|-------------|-----------|---------------|------------------------------|
| 0-19 (new)  | 1.00      | 5.0%          | Provider: 95cr, Platform: 5cr |
| 40-59       | 0.70      | 3.5%          | Provider: 96.5cr, Platform: 3.5cr |
| 90+ (sovereign) | 0.40  | 2.0%          | Provider: 98cr, Platform: 2cr |

As Pulse's trust score grows through consistent, verified behavior, the fee drops. This is the flywheel: use Soma → build trust → pay less → use more Soma.

### What Gets Proven in the Receipt Chain

Every receipt now includes the fee breakdown hash:

```
Receipt #CR-2026-04-00127
  ├── Amount: 2 credits
  ├── Provider share: 1.90 credits (95%)
  ├── Platform fee: 0.10 credits (5%)
  ├── Trust score at time: 45
  ├── Fee formula: v1 infrastructure (5% × 0.70 = 3.5%)
  ├── Breakdown hash: 0x8b2f... (ECONOMIC leaf in pulse tree)
  └── Verifiable: anyone can recompute and check the hash
```

The fee formula itself is public: `GET /v1/fees/formula` returns the complete schedule. No hidden fees. No trust-me pricing. Math you can verify.

## Cost Model

No additional cost to tenants. The Soma layer is invisible infrastructure:
- Namespace registration: free (just a tag in Pulse's heart)
- Pulse tree folding: happens inside Pulse on every action (no extra API call)
- Receipt pages: served from existing data (pulse tree + EAS attestations)
- Monthly Groth16 rollup: one proof per customer per month (minimal cost)
- Fee spine: zero-cost computation, breakdown becomes existing ECONOMIC leaf (no extra storage)

The value is in the receipt chain: customers get verifiable proof of every dollar spent, every fee taken, and every action taken. Enterprise clients pay for that transparency. The on-chain receipt — including proven fee breakdowns — becomes the selling point.
