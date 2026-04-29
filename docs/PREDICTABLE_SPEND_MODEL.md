# Predictable Spend With Unknown Context

ContextClaw's north star is not merely token reduction. It is **predictable spend with unknown incoming context**.

## The Copilot Pro+ lesson

GitHub Copilot Pro+ made expensive frontier models feel safe because usage was counted in coarse, predictable units.

The mental model was roughly:

```text
300 premium prompts per month
1 Opus prompt ≈ 0.3% usage
```

That mattered more than the exact provider-side token math. A user could think in prompts, not dollars-per-token. The system absorbed the messy details of context, caching, provider pricing, and model routing behind a simple quota meter.

For agentic work, that was psychologically huge:

- You could send a prompt without wondering if it was secretly a $4 call.
- The usage meter advanced predictably.
- Prior context felt stateful, not repeatedly re-billed in the user's face.
- A 300-token follow-up did not feel like it was resending the entire session.

That is likely where Copilot lost money on heavy agent workflows: the user-facing quota unit did not fully expose the real model-side context economics.

## What we can and cannot copy

We probably cannot replicate GitHub's exact usage accounting. Their pricing depends on negotiated provider contracts, cache behavior, IDE context plumbing, and product-level quota rules.

But we can replicate the **control experience**:

```text
Before the model call:
- What mission is this for?
- Which artifacts are being included?
- How many tokens are estimated uncached vs cache/read vs output?
- What budget unit will this consume?
- Is this pass allowed, blocked, approved once, rejected, or revised?
```

The product goal is not to hide cost. It is to make cost legible and bounded before execution.

## The ContextClaw equivalent

ContextClaw should translate unknown incoming context into explicit spend units:

```text
Mission budget: $0.50 or 20 premium units
Pass budget: $0.05 or 1 premium unit
Current pass estimate: 0.7 units
Decision: allowed
```

For free/local/cheap models, the unit may be request count or soft budget. For premium models, it should be stricter.

The key is that a pass manifest explains what is being spent on:

- artifact ids
- artifact stickers
- estimated input tokens
- estimated output tokens
- cache-read/cache-write assumptions when known
- estimated dollar cost
- quota units consumed
- reason allowed or blocked

## Why stateful context budgeting matters

The dangerous case is not a large prompt that the user knowingly sends.

The dangerous case is a small follow-up prompt attached to a giant invisible context tail.

The user types:

```text
proceed
```

Maybe that is 1 token of intent. But the provider might receive 80k tokens of accumulated logs, tool outputs, JSON schemas, file reads, screenshots, and old reasoning.

ContextClaw exists to prevent that mismatch.

The system should know:

- the user intent was small
- the retained context is large
- the selected artifacts are or are not justified
- the pass exceeds the budget unless explicitly approved

## Design principle

A good agent system should make a premium model feel like Copilot did at its best:

```text
Predictable enough to use casually.
Transparent enough to trust.
Strict enough not to bankrupt you.
```

That requires:

1. Stateful artifact ledgers instead of repeated mega-prompts.
2. Pass manifests before every model/tool invocation.
3. Budget gates that block invisible overspend.
4. Review cards that make approve/reject/revise cheap.
5. Actual/estimated usage receipts after execution.
6. Cache-aware accounting when provider data exists.

## Implemented in the TypeScript scaffold

The TypeScript `MissionLedger` now has a quota-unit layer:

```ts
premiumUnitBudget: number
premiumUnitsRemaining: number
estimatedPremiumUnits: number
unitCostBasis: 'fixed-prompt' | 'token-estimate' | 'provider-receipt'
```

This lets ContextClaw express both pricing modes:

- API mode: estimated dollars and tokens.
- Copilot-style mode: predictable prompt units.

The abstraction is the point. Users should be able to budget a mission in dollars, tokens, or premium units, then see every pass consume that budget before the call happens.

## Next implementation target

The next hard part is replacing estimates with receipts where providers expose them:

```ts
actualTokensIn?: number
actualTokensOut?: number
actualCostUsd?: number
actualPremiumUnits?: number
cacheReadTokens?: number
cacheWriteTokens?: number
receiptSource: 'provider' | 'gateway' | 'manual' | 'estimate-only'
```

That is the bridge from "preflight budget governor" to "auditable spend ledger." Until actual receipts exist, premium units remain an estimate/control abstraction, not proof of provider billing.
