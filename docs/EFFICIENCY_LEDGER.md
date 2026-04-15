# ContextClaw Efficiency Ledger

## What This Document Is

A structured record of ContextClaw's measurable impact on token consumption, cost avoidance, and request efficiency when running as the context engine for OpenClaw. This is Exhibit A for the maintainer proposal.

## What ContextClaw Measures

| Metric | Source | Description |
|---|---|---|
| `saved` (chars) | `.contextclaw-stats.json` | Total characters removed from context before model ingestion |
| `truncated` (count) | `.contextclaw-stats.json` | Number of individual messages truncated |
| `assembles` (count) | `.contextclaw-stats.json` | Number of `assemble()` calls (≈ model prompts processed) |
| `savingsUsd` | `.contextclaw-stats.json` | Estimated cost avoided (heuristic or real pricing) |
| `charsSaved` per assemble | `.contextclaw-efficiency.json` | Per-call chars removed |
| `tokensSaved` per assemble | `.contextclaw-efficiency.json` | Per-call tokens removed (chars ÷ 4) |
| `truncatedCount` per assemble | `.contextclaw-efficiency.json` | Messages truncated in that call |
| `messageCount` per assemble | `.contextclaw-efficiency.json` | Total messages in the context window |

## Data Sources

### `~/.openclaw/.contextclaw-stats.json` — Lifetime Counters
Persisted across restarts. Cumulative totals. Reset manually or on counter overflow.

### `~/.openclaw/.contextclaw-efficiency.json` — Per-Call Telemetry
Rolling window of last 1,000 `assemble()` data points. Includes session ID, model ID, and provider. Also stores dashboard snapshots for A/B comparison (ContextClaw vs. vanilla).

### `efficiency-tracker.js` — Code
Defines model multipliers (Copilot premium request cost per model), plan allowances, and correlation logic for comparing ContextClaw-managed sessions against unmanaged baselines.

## Current Snapshot — 2026-04-15

### Lifetime Stats (from `.contextclaw-stats.json`)

| Metric | Value |
|---|---|
| Characters saved | **4,364,744** |
| Estimated tokens saved | **~1,091,186** |
| Messages truncated | **1,536** |
| Assemble calls | **45** |
| Estimated cost avoided | **$3.27** |
| Pricing method | Heuristic ($3.00/M tokens) |
| Counter last updated | 2026-04-15T05:25:39Z |

### Per-Call Efficiency (from `.contextclaw-efficiency.json`)

| Metric | Value |
|---|---|
| Total prompts tracked | **49** |
| Avg chars saved / prompt | **100,602** |
| Avg tokens saved / prompt | **25,151** |
| Peak chars saved (single call) | **142,096** |
| Peak tokens saved (single call) | **35,524** |
| Peak messages in context | **188** |
| Peak truncated in single call | **56** |

### Session Timeline

The efficiency data covers two sessions from today:

1. **`89a40cf5-*`** (main session) — 40 data points, charsSaved ramped from 8.5K → 142K as context grew
2. **`codex-clean-*`** — 4 data points, consistent ~142K chars saved
3. **`recovered-main-*`** — 4 data points, fresh session with 0 chars saved (context was clean)
4. Earlier test sessions — 5 data points from unit/integration tests

### Compression Trajectory (Session `89a40cf5`)

The main session demonstrates ContextClaw's behavior as context accumulates:

```
Assemble #1:    8,577 chars saved  /  88 messages /  1 truncated
Assemble #5:  127,421 chars saved / 125 messages / 39 truncated
Assemble #10: 138,752 chars saved / 153 messages / 52 truncated
Assemble #20: 142,096 chars saved / 177 messages / 56 truncated
```

As the session grows, ContextClaw progressively truncates more stale tool output and file content while preserving conversation turns. The compression ratio stabilizes around **~140K chars saved per call** once the session matures.

## Cost Model

### Heuristic (Current)
When real model pricing is unavailable (subscription-based providers like GitHub Copilot), ContextClaw uses a heuristic of **$3.00 per million tokens** (approximately Sonnet-class API pricing). This understates savings for Opus-class models (~$15/M input) and overstates for GPT-4o-class (~$2.50/M input).

### Real Pricing (When Available)
ContextClaw calls `runtime.usage.resolveModelCostConfig()` to get actual per-token pricing from the gateway. When this returns a valid cost config, the `savingsUsd` field uses real pricing instead of the heuristic.

### Why Track Cost on a Subscription?
GitHub Copilot Pro+ has a **premium request allowance** (1,500/month). Each prompt consumes premium requests at model-dependent rates:

| Model | Premium Requests / Prompt |
|---|---|
| Claude Opus 4.6 | 3 |
| Claude Sonnet 4.6 | 1 |
| GPT-5.4 | 1 |
| GPT-4o | 0 (included) |
| o3-pro | 20 |
| Gemini 2.5 Pro | 1 |

Smaller context = faster inference = fewer timeout retries = fewer wasted premium requests. ContextClaw doesn't reduce the per-prompt multiplier, but it reduces the probability of failed/retried prompts and makes each prompt complete faster.

## What ContextClaw Does NOT Do

- **Does not alter message content.** Truncation removes tail bytes from oversized tool results and file reads. It does not summarize, rephrase, or rewrite.
- **Does not manage session history lifecycle.** OpenClaw controls session files, compaction, and message replay. ContextClaw only processes the context array passed to `assemble()`.
- **Does not cause tool_use/tool_result errors.** If a model rejects a prompt due to orphaned `tool_use_id` or mismatched `tool_result` blocks, the root cause is OpenClaw's session history replay, not ContextClaw's truncation. ContextClaw preserves message structure; it only shortens content strings.
- **Does not touch auth, routing, or provider selection.** The `config-patcher.js` module handles quota rotation, but this is a separate concern from context compression.

## Methodology Notes

1. **Token estimation:** `chars ÷ 4`. This is a standard approximation for English text with BPE tokenizers. Actual token count varies by tokenizer (cl100k for GPT, claude tokenizer for Anthropic). ContextClaw imports `tiktoken` but currently uses the char÷4 heuristic in the efficiency tracker for speed.

2. **Per-call vs. cumulative:** The `stats.json` file tracks cumulative totals. The `efficiency.json` file tracks per-call snapshots. These are independent counters — the cumulative total may be reset without affecting per-call history, and vice versa.

3. **Dashboard snapshots:** The efficiency tracker supports recording before/after premium-request percentages for A/B comparison. No dashboard snapshots have been recorded yet — this is the next data collection step.

4. **Correlation data:** The tracker can compute efficiency gain (% reduction, stretch multiplier, extra prompts/month) when both "openclaw" (ContextClaw-managed) and "vanilla" (unmanaged) data points exist. This comparison has not been populated yet.

## Ledger Updates

This ledger should be updated:
- After significant session milestones (e.g., 100+ assembles, new counter reset)
- When dashboard snapshot data is first collected
- When real pricing becomes available for the primary model
- Before submitting the maintainer proposal

---

*Last updated: 2026-04-15 02:32 EDT*
*ContextClaw v1.0.0 — installed 2026-04-05*
