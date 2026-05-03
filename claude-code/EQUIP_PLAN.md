# Claude Code ContextClaw Equip Plan

Goal: make Claude Code dogfood ContextClaw this week, write receipts for every compaction/savings event, and end the week with a real article/case study.

## Thesis
Claude Code should not blindly carry massive stale transcript/tool-output context forever. ContextClaw should act as a seatbelt: watch Claude Code sessions, classify high-bloat content, cold-store/compact safely, and emit receipts that prove savings without hiding what happened.

Ryan’s live proof point to preserve:
- Current OpenClaw dogfood receipt: **~$553 saved** claimed by savings ledger.
- Recent compaction receipt: **83% reduction**, 1,466 items, 7,235,957 chars processed.
- Claude Code is not yet wired, so this plan is how to create the Claude-specific proof.

## What to tell Claude Code

```text
You are equipping yourself with ContextClaw for Claude Code dogfooding.

Objective:
Create a local Claude Code adapter that watches Claude Code conversation/transcript files, detects oversized context/tool-output bloat, estimates token and dollar savings, writes auditable compaction receipts, and prepares an end-of-week case study.

Do not claim Claude Code is already protected until the adapter is verified against real Claude Code transcript files.

Implementation constraints:
- Do not modify Anthropic/Claude Code internals.
- Prefer a safe sidecar watcher first.
- Read-only transcript analysis before any destructive or mutating behavior.
- No secrets in logs.
- Receipts must be human-readable and machine-readable.
- Preserve rehydration references for anything compacted/cold-stored.

Expected artifacts:
1. `contextclaw/claude-code/adapter-spec.md`
2. `contextclaw/claude-code/claude-code-contextclaw-watch.sh` or equivalent runner
3. `contextclaw/logs/claude-code-savings-ledger.jsonl`
4. `contextclaw/logs/claude-code-weekly-summary.md`
5. `contextclaw/articles/contextclaw-claude-code-case-study-draft.md`
```

## Adapter design

### Phase 1, read-only watcher
Watch likely Claude Code transcript locations:
- `~/.claude/projects/**/**/*.jsonl`
- `~/.claude/projects/**/**/*.json`
- any workspace-local Claude transcript/output directories if present

For each new/changed transcript:
1. parse messages/items
2. classify by content type
3. identify high-bloat items
4. estimate original tokens
5. estimate compacted tokens under ContextClaw policy
6. estimate dollars saved using configurable model pricing
7. append a receipt to JSONL
8. update weekly markdown summary

No transcript mutation in Phase 1.

### Phase 2, prompt-prep shim
If Phase 1 proves useful, create an explicit command that Claude Code can run before expensive turns:

```bash
contextclaw-claude prepare --session <path> --budget 120000 --model claude-opus-4-1
```

Output:
- compacted prompt/context file
- cold-storage references
- savings receipt
- rehydrate instructions

### Phase 3, native/hook integration proposal
After dogfood evidence exists, write Anthropic-facing integration proposal:
- PreCompact hook
- PostCompact receipt hook
- context budget API
- native “saved $X this session” panel

## Classification rules

High-bloat classes:
- raw tool output over 10k chars
- full file reads over 20k chars
- logs/build output over 8k chars
- browser DOM/page dumps
- binary/base64/blob-like text
- repeated stack traces
- repeated package lock/config dumps
- previous assistant plans that are now stale

Keep classes:
- latest user intent
- unresolved TODOs/blockers
- file paths and commit hashes
- decisions and requirements
- errors from latest failing command
- rehydration pointers

## Receipt schema

Append one JSON object per analyzed/compacted session to:
`contextclaw/logs/claude-code-savings-ledger.jsonl`

```json
{
  "ts": "2026-05-03T18:50:00Z",
  "source": "claude-code",
  "mode": "read_only_estimate|prepared_context|applied_compaction",
  "session_path": "~/.claude/projects/.../session.jsonl",
  "receipt_id": "short-hash",
  "items_seen": 0,
  "items_compactable": 0,
  "raw_chars": 0,
  "kept_chars": 0,
  "chars_saved": 0,
  "estimated_raw_tokens": 0,
  "estimated_kept_tokens": 0,
  "estimated_tokens_saved": 0,
  "model": "claude-opus-4-1",
  "input_price_per_million": 15.0,
  "estimated_dollars_saved": 0.0,
  "top_savings_sources": [
    {"class": "tool_output", "chars_saved": 0, "example": "truncated safe snippet or file ref"}
  ],
  "cold_storage_refs": [],
  "notes": "No secrets. Read-only estimate."
}
```

## Dollar math

Use conservative estimates and label them clearly.

Default token estimate:
- `estimated_tokens = ceil(chars / 4)`

Default Claude Opus input estimate:
- `$15 / 1M input tokens` unless updated.

Formula:
- `tokens_saved = raw_tokens - kept_tokens`
- `dollars_saved = tokens_saved / 1_000_000 * input_price_per_million`

Important: distinguish:
- estimated per-pass savings
- repeated retry savings
- weekly cumulative savings
- actual billed savings if billing data is available

## Weekly article outline

Working title:
**I saved $553 by making my AI agent show me what context it was wasting**

Sections:
1. The shock: “I can barely believe I’m saving $553.”
2. The failure mode: stale tool output and giant context payloads silently ride along.
3. The fix: classify content types, compact/cold-store, preserve rehydration.
4. The receipt: what got saved, what stayed, what it would have cost.
5. The Claude Code experiment: sidecar watcher first, native integration later.
6. Why this matters for Anthropic/Claude Code users.
7. CTA: help test ContextClaw / Anthropic maintainer path.

## Done criteria for this week

- At least 3 Claude Code sessions analyzed.
- At least 1 savings receipt that is compelling and manually verified.
- Weekly ledger totals tokens saved and dollars saved.
- Article draft has screenshots/snippets from receipts.
- Claims are precise: OpenClaw proven, Claude Code analyzed/equipped only after adapter works.
