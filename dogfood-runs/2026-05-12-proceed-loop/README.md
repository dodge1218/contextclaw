# ContextClaw OpenClaw Dogfood Run - 2026-05-12

Purpose: capture a narrow, reproducible OpenClaw proceed-loop dogfood batch after enabling ContextClaw as the OpenClaw context engine.

## Before Snapshot

Already captured:

- `stats-before.json` from `~/.openclaw/.contextclaw-stats.json`
- `efficiency-before.json` from `~/.openclaw/.contextclaw-efficiency.json`
- `ledger-before.jsonl` from `~/.openclaw/contextclaw/ledger.jsonl`
- `SHA256SUMS.before`
- `start.txt`

## Run Protocol

1. Enable `plugins.entries.contextclaw.enabled=true`.
2. Set `plugins.slots.contextEngine="contextclaw"`.
3. Restart the OpenClaw gateway/TUI so the plugin registry and slot assignment are reloaded.
4. Run one normal proceed-loop session in OpenClaw.
5. Do not mix this with Claude Code watcher estimates or adapter tests.
6. Capture after files:

```bash
cp ~/.openclaw/.contextclaw-stats.json dogfood-runs/2026-05-12-proceed-loop/stats-after.json
cp ~/.openclaw/.contextclaw-efficiency.json dogfood-runs/2026-05-12-proceed-loop/efficiency-after.json
cp ~/.openclaw/contextclaw/ledger.jsonl dogfood-runs/2026-05-12-proceed-loop/ledger-after.jsonl
date -Is > dogfood-runs/2026-05-12-proceed-loop/end.txt
sha256sum dogfood-runs/2026-05-12-proceed-loop/*after* > dogfood-runs/2026-05-12-proceed-loop/SHA256SUMS.after
```

Then run:

```bash
node dogfood-runs/2026-05-12-proceed-loop/summarize.mjs
```

## Interpretation Rules

- Treat this as OpenClaw-native evidence only.
- Keep adapter evidence separate unless the run explicitly exercised an adapter.
- Report deltas and caveats; do not reuse the old benchmark reduction claim unless the methodology is current and repeatable.
- If the active OpenClaw session started before the gateway restart, discard it for this batch.
