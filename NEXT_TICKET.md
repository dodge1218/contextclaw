# NEXT_TICKET: Provider receipts + cache-aware spend ledger

## Category
🔴 CRITICAL, but start after human review of the mission-ledger direction.

## Why
ContextClaw now has a working mission/pass/artifact ledger model with preflight dollar estimates, premium-unit estimates, approval/reject/revise workflows, JSON snapshots, and review cards.

The next step is to make the ledger auditable after execution. Predictable preflight spend is useful, but the product becomes much stronger when every pass can reconcile estimates against actual provider/gateway receipts, including cache behavior.

## Scope
Add actual usage receipts to the TypeScript mission ledger.

### Data model
Add optional receipt fields to passes:

```ts
actualTokensIn?: number
actualTokensOut?: number
actualCostUsd?: number
actualPremiumUnits?: number
cacheReadTokens?: number
cacheWriteTokens?: number
receiptSource?: 'provider' | 'gateway' | 'manual' | 'estimate-only'
receiptRaw?: unknown
```

### API
Add methods:

```ts
recordReceipt(passId, receipt)
variance(passId) // estimate vs actual
```

### CLI
Add:

```bash
cc mission-receipt --load ledger.json --pass PASS --actual-cost 0.014 --tokens-in 12000 --tokens-out 800 --cache-read 9000
cc mission-variance --load ledger.json --pass PASS
```

### Review card
Show:

- estimated spend / actual spend when available
- estimated premium units / actual premium units when available
- cache read/write tokens when available
- variance warning if actual exceeds estimate materially

## Acceptance criteria
- Unit tests cover receipt recording and variance.
- Saved ledger reload preserves receipts.
- CLI can record a manual receipt into a JSON snapshot.
- Review card displays estimated vs actual usage.
- No OpenClaw plugin re-enable.

## Constraints
- Do not claim provider receipt integration exists until wired to OpenClaw/gateway runtime data.
- Manual receipts are acceptable for this ticket.
- Keep implementation framework-agnostic.
