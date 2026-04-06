# ContextClaw — Context Type Classification for OpenClaw

**Stop sending Dockerfiles to the LLM 30 turns after you read them.**

ContextClaw classifies every item in your context window by content type and applies retention policies. Files get truncated. Command output gets tailed. Your actual conversation stays intact.

## The Problem

A typical 50-turn agent session accumulates:

| Source | Tokens | Still relevant? |
|--------|--------|-----------------|
| 10 file reads | 50,000 | After 1 turn, rarely |
| 15 command outputs | 25,000 | Exit code matters, rest doesn't |
| 5 config dumps | 8,000 | One field mattered |
| 4 error traces | 6,000 | Fixed 20 turns ago |
| 30 metadata envelopes | 9,000 | Never relevant |
| **Total waste** | **~98,000** | |

ContextClaw cuts this to ~11K by classifying and truncating by type.

## How It Works

```
message arrives → classify type → apply retention policy → assemble
```

### Content Types

| Type | Policy |
|------|--------|
| 🟣 system-prompt | Never touch |
| 🔵 user-message | Keep last 5 verbatim, strip older metadata |
| 🟢 assistant-reply | Keep last 3, trim older |
| 🟠 tool-file-read | Full for 1 turn, then first+last 100 chars |
| 🟠 tool-cmd-output | Full for 1 turn, then last 20 lines |
| 🔴 image/media | Pointer only ("screenshot.jpg"), drop binary |
| 🔴 config-dump | Full for 1 turn, then key fields only |
| 🟡 error-trace | Keep 2 turns, then error line only |
| 🔴 json/schema blob | Full for 1 turn, then truncate to 500 chars |

### What It Doesn't Do

- No relevance scoring (wrong problem)
- No embeddings (overkill)
- No model calls (zero latency added)
- No summarization (v2)
- Doesn't fight native compaction (`ownsCompaction: false`)

## Install

```yaml
plugins:
  - id: contextclaw
    config:
      coldStorageDir: ~/.openclaw/workspace/memory/cold
      wsPort: 41234
      enableTelemetry: true
```

## Configuration

Override per-type policies:

```yaml
plugins:
  - id: contextclaw
    config:
      policies:
        tool-file-read:
          keepTurns: 2          # keep files for 2 turns instead of 1
          maxCharsAfter: 500    # bigger bookends
        tool-cmd-output:
          tailLines: 30         # keep last 30 lines instead of 20
```

## Architecture

```
plugin/
├── index.js          # Engine: classify → policy → assemble
├── classifier.js     # Content type detection (pattern matching)
├── policy.js         # Per-type retention rules + truncation extractors
├── openclaw.plugin.json
├── package.json
├── README.md
└── __tests__/
    ├── classifier.test.js
    ├── policy.test.js
    └── engine.test.js
```

## Limitations

- Classification is pattern-based, not semantic. Edge cases exist (a tool result containing a file containing JSON containing an error).
- Truncation is lossy. If the model needs the middle of a file 5 turns later, it will need to re-read it.
- Still client-side pruning. If providers ship server-side context management, this becomes unnecessary.
- No auto-rehydration from cold storage yet.

## License
MIT