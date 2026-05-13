# ContextClaw Measurement Definitions

Date: 2026-05-12
Status: current measurement contract

## Rule 1: Separate Facts From Estimates

ContextClaw currently records exact local compression facts and estimated token/cost values.

Do not describe estimated values as provider-billed savings.

Use this language:

- "chars saved"
- "ledger-recorded truncations"
- "estimated input tokens"
- "estimated compressed-prompt spend"
- "estimated savings"

Avoid this language unless provider receipts prove it:

- "billed savings"
- "actual dollars saved"
- "provider-confirmed reduction"
- "saved X dollars on the invoice"

## Raw Chars Saved

Source:

- `~/.openclaw/.contextclaw-stats.json`
- key: `saved`

Meaning:

The cumulative number of characters removed from active model context by ContextClaw policy.

Formula per truncated item:

```text
originalChars - finalChars
```

This is the strongest primary metric because it is computed from local strings before and after policy application.

## Ledger Compression Chars Saved

Source:

- `~/.openclaw/contextclaw/ledger.jsonl`
- key: `compression.charsSaved`

Meaning:

The chars saved for one context assembly / model-call boundary.

Use this for dogfood packets because it is scoped to a specific session and prompt boundary.

## Truncation Count

Sources:

- aggregate: `~/.openclaw/.contextclaw-stats.json` key `truncated`
- per-call: `ledger.jsonl[].compression.truncatedCount`

Meaning:

Number of context items shortened or replaced by policy.

This is not a savings amount by itself. It explains how many context blocks contributed to saved chars.

## Estimated Tokens Saved

Source:

- derived from chars saved.

Current estimate:

```text
tokensSaved = ceil(charsSaved / 4)
```

Meaning:

Approximate input tokens avoided by removing characters from the dynamic prompt.

Limit:

This is not tokenizer-ground-truth unless a tokenizer-specific path is explicitly used for a given measurement. Treat it as a conservative public estimate, not a provider receipt.

## Estimated Savings USD

Source:

- aggregate: `~/.openclaw/.contextclaw-stats.json` key `savingsUsd`
- model/auth breakdowns: `savingsByModel`, `savingsByAuthProfile`

Current estimate:

```text
ceil(charsSaved / 4) * capturedInputPricePerMillion / 1_000_000
```

Meaning:

Estimated input-token cost avoided by compression, using the input price captured at assembly time.

Limit:

This does not account for provider cache behavior, provider-side tokenization differences, or actual billing records unless a separate provider receipt is attached.

## Estimated Compressed-Prompt Spend

Sources:

- aggregate: `~/.openclaw/.contextclaw-stats.json` key `ledgerSpendUsd`
- per-call: `ledger.jsonl[].costEstimateUsd`

Meaning:

Estimated cost of the prompt after ContextClaw assembled the compressed context.

This is spend, not savings.

Use it for ROI framing:

```text
estimated savings vs estimated compressed-prompt spend
```

## Estimated Input Tokens

Source:

- `ledger.jsonl[].estimatedInputTokens`

Meaning:

Estimated input tokens remaining after compression for that context assembly.

This answers:

> How large was the prompt ContextClaw handed back to OpenClaw?

It does not answer:

> How large would the provider have billed it without ContextClaw?

Use `compression.charsSaved` and derived token estimates for the avoided side.

## Cold Storage Evidence

Source:

- configured `coldStorageDir`
- current default: `~/.openclaw/workspace/memory/cold`

Meaning:

Cold-storage records prove removed content was preserved out-of-band. They are evidence of recoverability and auditability, not a numeric savings metric.

## OpenClaw-Native Evidence

OpenClaw-native evidence means:

- ContextClaw was enabled as OpenClaw's `contextEngine`;
- the gateway was restarted after config change;
- normal OpenClaw agent turns ran;
- `ledger.jsonl`, stats, and cold storage changed during those turns.

The 2026-05-12 dogfood batch is OpenClaw-native evidence.

## Adapter Evidence

Claude Code / Codex adapter evidence is separate.

Adapter receipts may include:

- `originalChars`
- `finalChars`
- `charsSaved`
- source event/tool names

Do not merge adapter savings into OpenClaw-native dogfood totals unless the run explicitly used that adapter path and the packet says so.

## What We Still Need For Stronger Claims

To claim provider-billed savings, we need:

- baseline uncompressed run or provider-side token count;
- compressed run under comparable task conditions;
- provider usage receipts;
- cache read/write token accounting where available;
- quality/completion comparison.

Until then, ContextClaw's strongest honest claims are:

- deterministic chars removed;
- ledger-recorded truncations;
- estimated prompt size/spend;
- cold-storage preservation;
- local tests.
