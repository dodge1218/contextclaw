# ContextClaw — Honest Assessment (Anthropic VP lens)

## Thesis: CORRECT
Context bloat is real, measurable, costly at scale. Every AI agent framework suffers from it.

## Implementation: INCOMPLETE
Current state is a heuristic keyword scorer. Not wrong, but not sufficient for the claim.

## Critical Gaps

### 1. No Eval
Zero evidence that eviction improves outcomes. "Saved 118K tokens" might mean "threw away 118K tokens of useful context." Need:
- 50-prompt eval suite: full context vs pruned context
- Response accuracy, instruction adherence, hallucination rate
- Publish results regardless of outcome

### 2. Keyword Scoring ≠ Semantic Understanding
Regex keywords can't detect causal relationships across messages. "Database schema change" has no keyword overlap with "login page broken" but may be the root cause. Need embedding-based scoring.

### 3. No Retrieval Loop
Eviction without automatic rehydration = deletion with logging. When model hits a knowledge gap, it should search cold storage automatically. Without this, Context Replay is a feature that nobody will use manually.

### 4. One API Parameter Away from Zero
If Anthropic/OpenAI ship server-side context pruning, client-side scoring becomes irrelevant. Defensibility requires:
- Cross-framework standard (not OpenClaw-only)
- Telemetry data that providers want (eviction patterns, reference frequency)
- The data is the moat, not the code

### 5. Tokenizer Mismatch
cl100k_base ≠ Claude ≠ Gemini tokenizer. 15% margin helps but doesn't solve. Need per-model tokenizer or API-reported token counts.

## What's Actually Valuable

1. **The eviction telemetry data.** Which messages are never referenced? Which are recalled? This dataset tells providers how to build server-side pruning.
2. **The cold storage format.** A standard for evicted context (JSONL with role/tokens/timestamp) that any framework can read.
3. **The proof that 60-80% of context is waste.** The 195K→22K stat. That's the viral screenshot, not the code.

## Build Priority (if I ran this team)

1. Eval harness (prove it works, or prove it doesn't — both are publishable)
2. Embedding scorer (replace keywords with `text-embedding-3-small`)
3. Auto-rehydration from cold storage (close the loop)
4. Cross-framework adapter (@contextclaw/core)
5. Telemetry API (the real product)

## Estimated effort: 2 senior engineers, 3 weeks to v1.0 that Anthropic would take seriously.
## Current state: clever hack by one person. Impressive for a weekend. Not production-grade.
