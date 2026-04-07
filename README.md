# 🧠 ContextClaw

![CI](https://github.com/dodge1218/contextclaw/actions/workflows/ci.yml/badge.svg)

**Stop sending Dockerfiles to the LLM 30 turns after you read them.**

Context management plugin for [OpenClaw](https://github.com/openclaw/openclaw). Classifies every item in your context window by content type and applies retention policies. Files get truncated. Command output gets tailed. Your actual conversation stays intact.

## The Problem

A typical 50-turn agent session accumulates:

| Source | Tokens | After ContextClaw |
|--------|--------|-------------------|
| 10 file reads | ~50,000 | ~3,000 |
| 15 command outputs | ~25,000 | ~2,000 |
| 5 config dumps | ~8,000 | ~500 |
| 4 error traces | ~6,000 | ~400 |
| 30 metadata envelopes | ~9,000 | 0 |
| **Total** | **~98,000** | **~5,900 (94% reduction)** |

Your user messages and conversation? ~8,000 tokens. That was never the problem.

## How It Works

```
message arrives → classify type → check turn age → apply policy → assemble
```

### Content Types & Policies

| Type | Tag | Policy |
|------|-----|--------|
| System prompt | 🟣 | Never touch |
| User message | 🔵 | Keep last 5 verbatim, strip older metadata |
| Assistant reply | 🟢 | Keep last 3, trim older |
| File read | 🟠 | Full for 1 turn, then first+last 100 chars |
| Command output | 🟠 | Full for 1 turn, then last 20 lines |
| Image/media | 🔴 | Pointer only ("screenshot.jpg"), drop binary |
| Config dump | 🔴 | Full for 1 turn, then key fields only |
| Error trace | 🟡 | Keep 2 turns, then error line only |
| JSON/schema blob | 🔴 | Full for 1 turn, then truncate to 500 chars |

### What It Doesn't Do

- No relevance scoring (wrong problem — bulk content types are the waste, not message relevance)
- No embeddings (overkill for type-based truncation)
- No model calls (zero latency, zero cost)
- No summarization (pure pattern matching + truncation)
- Doesn't fight native compaction (`ownsCompaction: false`)

## Install

```bash
cd ~/.openclaw/plugins
git clone https://github.com/dodge1218/contextclaw.git
cd contextclaw/plugin && npm install
```

Add to `openclaw.yaml`:

```yaml
plugins:
  load:
    paths:
      - ~/.openclaw/plugins/contextclaw/plugin
  slots:
    contextEngine: contextclaw
  entries:
    contextclaw:
      enabled: true
      config:
        coldStorageDir: ~/.openclaw/workspace/memory/cold
        wsPort: 41234
        enableTelemetry: true
```

Restart OpenClaw.

## Configuration

Override per-type policies:

```yaml
contextclaw:
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
├── classifier.js     # Content type detection (pattern matching)
├── policy.js         # Per-type retention rules + truncation extractors
├── index.js          # Engine: classify → policy → assemble
└── __tests__/        # 36 tests
```

**675 lines of source. 373 lines of tests. Zero dependencies beyond `ws`.**

Cold storage lives at `~/.openclaw/workspace/memory/cold/` as `.jsonl` files — truncated content with metadata for potential rehydration.

## vs. Prompt Caching

| | Raw Context | Anthropic Prompt Cache | ContextClaw | Both |
|---|---|---|---|---|
| Static prefix (system prompt) | Full price | **90% savings** | No change | **90% savings** |
| File read from 20 turns ago | Full price | Full price (not prefix) | **Evicted** | **Evicted** |
| 35K config dump (turn 2 of 50) | 35K tokens all 50 turns | 35K cached but still in context | **~200 chars after turn 3** | **~200 chars** |
| Context overflow → compaction | Lossy, loses decisions | **Prevents overflow** | **Prevents overflow** | **Prevents overflow** |
| Works on non-Anthropic providers | N/A | ❌ | ✅ | N/A |

**They're complementary.** Prompt caching saves money on tokens you *should* send. ContextClaw saves money on tokens you *shouldn't* send.

## Tests

```
47 tests passing
├── src/__tests__/   11 vitest tests (budget, circuit-breaker)
└── plugin/__tests__/ 36 node:test tests (classifier, policy, engine)
```

## Roadmap

- **v2:** Task/project stickers — tag context by project+task, load only relevant history
- **v2:** Intent extractor as standalone plugin
- **v2:** Auto-rehydration from cold storage
- **v3:** Cross-framework `@contextclaw/core` extraction

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
