# Claude Code ContextClaw Adapter — Phase 1 Spec

Status: Phase 1 (read-only) implementation. No transcript mutation. No prompt-prep shim. No Anthropic-side hooks.

## What the watcher does

1. Walks `~/.claude/projects/-home-yin/*.jsonl` (Claude Code session transcripts).
2. Streams each session line by line. Each line is one JSONL event (`type` in `user`, `assistant`, `attachment`, `system`, `permission-mode`, `file-history-snapshot`, `ai-title`, `last-prompt`, `queue-operation`).
3. For every `user` and `assistant` message, walks the `message.content` array and collects payloads:
   - `tool_result.content` strings (often the largest items — file reads, command output, telemetry dumps).
   - `tool_use.input.command` / file paths (small, classify by tool name).
   - assistant `text` blocks (classify stale plans).
4. Classifies each payload by content type per `EQUIP_PLAN.md`:
   - `tool_output` — raw tool output > 10,000 chars
   - `file_read` — Read tool result > 20,000 chars
   - `log_or_build` — log/build/test output > 8,000 chars
   - `browser_dom` — looks like rendered HTML / DOM dump
   - `base64_blob` — long base64-ish or binary-like text
   - `repeated_stack_trace` — same stack-trace fingerprint seen 2+ times in the session
   - `repeated_lock_dump` — same package-lock / config dump seen 2+ times
   - `stale_assistant_plan` — assistant plan/checkboxes superseded by later turn
5. Computes per-class `chars_saved` under a "compact to short reference + first/last 400 chars" policy. The kept stub is what ContextClaw would leave behind in-context.
6. Estimates tokens with `ceil(chars / 4)` and dollars with `tokens / 1_000_000 * input_price_per_million` (default `$15/M`, configurable via env var).
7. Appends one receipt object to `~/.openclaw/workspace/contextclaw/logs/claude-code-savings-ledger.jsonl` matching the schema in `EQUIP_PLAN.md`.

## Configuration

Environment variables (all optional):
- `CONTEXTCLAW_INPUT_PRICE_PER_M` — float, default `15.0` (Opus input).
- `CONTEXTCLAW_MODEL` — string, default `claude-opus-4-1`.
- `CONTEXTCLAW_LEDGER` — output path, default `~/.openclaw/workspace/contextclaw/logs/claude-code-savings-ledger.jsonl`.
- `CONTEXTCLAW_TRANSCRIPT_GLOB` — glob, default `~/.claude/projects/-home-yin/*.jsonl`.
- `CONTEXTCLAW_KEEP_HEAD_TAIL` — int, default `400` (chars retained from head + tail of compacted item).
- `CONTEXTCLAW_MAX_SESSIONS` — int, default `0` (0 = unlimited). CLI also accepts `--max N`.

## Safety invariants (HARD)

- **Read-only.** Watcher opens transcripts with `'r'`. Never writes back to `~/.claude/`.
- **No secrets in receipts.** Before writing any `top_savings_sources[].example`, the snippet is scrubbed against:
  `sk-ant-`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `password=`, `Bearer `, `AWS_SECRET`, `aws_secret_access_key`, `ghp_`, `github_pat_`, `xoxb-`, `xoxp-`, `AIza`, `-----BEGIN`, `PRIVATE KEY`, `client_secret`. If any pattern matches, the example is replaced with `"[REDACTED — secret pattern matched]"`.
- **Snippet truncation.** `example` is truncated to **200 chars max** with a literal `[truncated]` marker appended when truncation occurs.
- **Estimated label discipline.** Every dollar/token field is either prefixed `estimated_` in the schema, or carries `{"label": "estimated"}`. The watcher writes `notes: "Read-only estimate. Dollar/token figures are estimates under chars/4 + $X/M model."`.
- **No transcript mutation.** Watcher never opens a transcript in write mode and never re-emits transcripts.
- **Compaction is hypothetical.** Receipts only describe what *would* have been saved if ContextClaw policy had been applied — Claude Code itself is unmodified.

## Receipt schema (from EQUIP_PLAN.md)

One JSON object per session, appended to the ledger JSONL. See `EQUIP_PLAN.md § Receipt schema` for the exact field list. Mode is always `read_only_estimate` in Phase 1.

## Out of scope (Phase 1)

- Live tail / inotify (current implementation is one-shot sweep).
- Cold-storage pointer files (none generated; `cold_storage_refs: []`).
- Prompt-prep shim (Phase 2).
- Anthropic-side hook integration (Phase 3).
