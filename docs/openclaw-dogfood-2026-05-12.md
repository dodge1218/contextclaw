# OpenClaw Dogfood Packet: 2026-05-12 Proceed Loop

Date: 2026-05-12 to 2026-05-13 UTC
Status: captured

## Scope

This packet covers one OpenClaw-native dogfood batch.

It does not cover:

- Claude Code or Codex adapters;
- multi-agent shared context;
- sticker/task relabeling;
- provider-billed before/after savings;
- quality equivalence against an uncompressed baseline.

## Setup

ContextClaw was enabled in `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "contextclaw": {
        "enabled": true
      }
    },
    "slots": {
      "contextEngine": "contextclaw"
    }
  }
}
```

The plugin load path pointed at the local checkout:

```text
<OPENCLAW_WORKSPACE>/contextclaw/plugin
```

Backup created before config edit:

```text
~/.openclaw/openclaw.json.bak-contextclaw-dogfood-20260512T230153Z
```

The OpenClaw gateway was restarted after the config change. Runs before that restart are excluded from this packet.

## Evidence Directory

```text
dogfood-runs/2026-05-12-proceed-loop/
```

Important files:

- `stats-before.json`
- `stats-after.json`
- `efficiency-before.json`
- `efficiency-after.json`
- `ledger-before.jsonl`
- `ledger-after.jsonl`
- `SHA256SUMS.before`
- `SHA256SUMS.after`
- `summary.md`
- `summarize.mjs`

## Aggregate Result

From the final captured summary:

| Metric | Delta |
| --- | ---: |
| ContextClaw assemblies | 10 |
| Estimated input tokens after compression | 436,460 |
| Estimated compressed-prompt spend | $1.6166 |
| Chars saved | 3,854,677 |
| Ledger-recorded truncations | 749 |
| Estimated savings | $2.89 |

These are estimate/receipt metrics. They are not provider-billed before/after measurements.

## Session

All 10 post-baseline ledger entries came from one OpenClaw session:

```text
b521c204-5ad7-49cc-a8aa-474d411b30bd
```

The workflow was a repeated OpenClaw TUI `proceed` loop on one codebase.

## Per-Call Ledger Rows

| UTC timestamp | Estimated input tokens | Estimated spend | Chars saved | Truncations |
| --- | ---: | ---: | ---: | ---: |
| 2026-05-12T23:08:52.292Z | 37,312 | $0.142656 | 276,316 | 54 |
| 2026-05-12T23:10:56.813Z | 42,293 | $0.157599 | 303,575 | 59 |
| 2026-05-12T23:26:15.018Z | 40,325 | $0.151695 | 325,851 | 63 |
| 2026-05-12T23:28:11.338Z | 38,444 | $0.146052 | 359,672 | 68 |
| 2026-05-12T23:32:08.737Z | 41,848 | $0.156264 | 385,005 | 72 |
| 2026-05-12T23:35:09.846Z | 47,882 | $0.174366 | 392,896 | 78 |
| 2026-05-13T00:33:05.365Z | 43,866 | $0.162318 | 420,453 | 83 |
| 2026-05-13T00:44:21.179Z | 48,363 | $0.175809 | 439,334 | 86 |
| 2026-05-13T01:02:13.804Z | 49,779 | $0.180057 | 461,652 | 90 |
| 2026-05-13T01:09:16.900Z | 46,348 | $0.169764 | 489,923 | 96 |

All rows had:

- `duplicateContext: false`
- `overCallBudget: false`
- `premiumDeferred: false`

## Cold Storage

Cold-storage files were written for the session under:

```text
~/.openclaw/workspace/memory/cold/
```

Observed files for this batch/session include:

```text
b521c204-2026-05-12T23-08-52-490Z-bbc479f4.jsonl
b521c204-2026-05-12T23-10-56-940Z-85d0ccd9.jsonl
b521c204-2026-05-12T23-26-15-152Z-1e530967.jsonl
b521c204-2026-05-12T23-28-11-399Z-08408b2e.jsonl
b521c204-2026-05-12T23-32-08-867Z-f7b2acc7.jsonl
b521c204-2026-05-12T23-35-10-013Z-4db54f8c.jsonl
b521c204-2026-05-13T00-33-05-605Z-1896de4f.jsonl
b521c204-2026-05-13T00-44-21-661Z-00ab529e.jsonl
b521c204-2026-05-13T01-02-14-761Z-7854317b.jsonl
b521c204-2026-05-13T01-09-17-083Z-aba275b3.jsonl
```

Cold storage is recoverability evidence, not a savings metric.

## Reproduce The Summary

```bash
node dogfood-runs/2026-05-12-proceed-loop/summarize.mjs
```

The summary script compares `ledger-before.jsonl` / `stats-before.json` against the captured `after` files.

## Interpretation

This batch supports the narrow claim:

> ContextClaw can run as OpenClaw's context engine during a normal proceed-loop workflow, deterministically trim dynamic context, preserve removed content in cold storage, and emit auditable request receipts.

It does not support the stronger claim:

> ContextClaw saved a provider-confirmed dollar amount on the bill.

That stronger claim needs provider usage receipts or a controlled before/after run.
