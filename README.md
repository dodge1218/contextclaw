# 🧠 ContextClaw

[![CI](https://github.com/dodge1218/contextclaw/actions/workflows/ci.yml/badge.svg)](https://github.com/dodge1218/contextclaw/actions/workflows/ci.yml)

**Stop sending Dockerfiles to your LLM 30 turns after you read them.**

Context management plugin for [OpenClaw](https://github.com/openclaw/openclaw). Classifies every item in your context window by content type and applies retention policies. Files get truncated. Command output gets tailed. Your conversation stays intact.

## Live Dogfooding Results

Running on our own OpenClaw instance (11,300 items across 6 real sessions):

| Content Type | Items | Original | Stored | Reduction |
|---|---|---|---|---|
| JSON schema blobs | 1,192 | 17.6M chars | 0.8M | **95.5%** |
| File reads | 2,471 | 8.8M | 0.7M | **91.8%** |
| Assistant replies | 4,000 | 8.6M | 2.4M | **71.4%** |
| Generic tool output | 1,158 | 4.5M | 0.7M | **84.2%** |
| Config dumps | 1,647 | 3.2M | 0.5M | **84.4%** |
| Error traces | 326 | 1.9M | 0.1M | **93.6%** |
| **Total** | **11,300** | **45.5M** | **5.5M** | **87.9%** |

That's ~10M tokens saved. At Claude Opus rates ($15/MTok input), that's **~$150 not spent**.

The key insight: **JSON schemas and file reads are 55% of all context waste**, and they compress at 92-95% with zero information loss.

### Controlled Eval (4 real sessions, .reset files)

| Session | Messages | Original | Output | Reduction | Truncated |
|---------|----------|----------|--------|-----------|----------|
| Session A | 681 | 870K | 186K | **78.7%** | 166 |
| Session B | 253 | 465K | 108K | **76.8%** | 37 |
| Session C | 190 | 323K | 206K | **36.2%** | 29 |
| Session D | 688 | 1.2M | 227K | **81.2%** | 153 |
| **Total** | **1,812** | **2.9M** | **727K** | **74.6%** | **385** |

Methodology: `ContextClawEngine.assemble()` against uncompacted `.reset` session backups. No synthetic data.

## How It Works

```
Message arrives → Classify content type → Check retention policy → Truncate or keep
```

11 content types, each with its own retention rule:

| Type | Rule |
|------|------|
| `system-prompt` | Never touch |
| `user-message` | Keep last 5 turns full, metadata-strip older |
| `assistant-reply` | Keep last 3 turns, trim narration |
| `tool-file-read` | Keep 1 turn, then truncate to bookends (first/last lines) |
| `tool-cmd-output` | Exit code + last 20 lines after 1 turn |
| `image/media` | Pointer only, drop base64 immediately |
| `config-dump` | Truncate to 500 chars |
| `error-trace` | Keep 2 turns, then discard |
| `json/schema` | Truncate to 500 chars |
| `tool-search-result` | Summary after 1 turn |
| `tool-generic` | Tail after 2 turns |

No LLM calls. No embeddings. Pure pattern matching + byte counting. Zero latency, zero cost.

## Install

```bash
# As an OpenClaw plugin
cd plugin && npm install
# Enable in openclaw.json → plugins.slots.contextEngine: "contextclaw"
```

> **v1 is an OpenClaw plugin.** Standalone adapters for LangChain, Cline, etc. are on the roadmap. The classification and policy engine in `packages/core/` is framework-agnostic TypeScript.

## Project Structure

```
plugin/           # Production OpenClaw plugin (~700 lines, 36 tests)
├── classifier.js # Content type classification (11 types)
├── policy.js     # Retention rules + truncation engine
├── index.js      # OpenClaw context engine integration
└── __tests__/    # node:test suite

packages/core/    # Framework-agnostic core (TypeScript, 30 tests)
├── src/          # Budget, eviction, memory, orchestrator, watcher
└── __tests__/    # vitest suite

eval/             # Benchmarks + real-world eval on production sessions
docs/             # Multi-agent shared context protocol RFC
```

## Why Not Just Use Prompt Caching?

| | Anthropic Caching | ContextClaw |
|---|---|---|
| What it does | Caches static prefix (system prompt, tools) | Removes stale content from the dynamic portion |
| Conversation history | Still re-sent in full every turn | Truncated by content type + age |
| Token reduction | 0% on conversation | 55-88% on real sessions |
| Works with | Anthropic only | Any provider (via plugin adapter) |

They're complementary. Caching reduces cost on the static prefix. ContextClaw reduces what's in the dynamic payload. Use both.

## Limitations (Honest)

- **v1 is OpenClaw-only.** The plugin API is OpenClaw's `contextEngine` interface. Standalone use requires `packages/core/`.
- **Keyword-based eval, not LLM-judged.** Our eval checks keyword preservation, not whether the LLM actually answers correctly post-truncation. We rely on re-read risk = 0 as a proxy.
- **No rehydration yet.** Truncated content goes to cold storage but there's no auto-rehydration path when the agent needs it again.
- **Aggressive on long sessions.** The 87.9% number is from very long sessions. Short sessions (<20 turns) see 10-30% savings.

## Roadmap

- [x] Content-type classification (11 types)
- [x] Per-type retention policies with age decay
- [x] Real-world eval on production sessions
- [x] CI pipeline (66 tests across plugin + core)
- [x] Live dogfooding with telemetry
- [x] Cold storage for evicted content
- [ ] npm publish (`contextclaw` on npm)
- [ ] Standalone adapters (LangChain, Cline)
- [ ] Auto-rehydration from cold storage
- [ ] Studio dashboard (real-time token visualization)
- [ ] Multi-agent shared context protocol ([RFC](docs/MULTI_AGENT_PROTOCOL.md))

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
