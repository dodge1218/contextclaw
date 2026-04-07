# 🧠 ContextClaw

[![CI](https://github.com/dodge1218/contextclaw/actions/workflows/ci.yml/badge.svg)](https://github.com/dodge1218/contextclaw/actions/workflows/ci.yml)

**Stop sending Dockerfiles to your LLM 30 turns after you read them.**

Context management plugin for [OpenClaw](https://github.com/openclaw/openclaw). Classifies every item in your context window by content type and applies retention policies. Files get truncated. Command output gets tailed. Your conversation stays intact.

## Real-World Results

Tested on 5 production autonomous agent sessions (69-98 messages each):

| Metric | Value |
|--------|-------|
| Avg token reduction | **55.8%** |
| Best case (tool-heavy session) | **65.9%** |
| Items truncated prematurely (re-read risk) | **0** |
| Processing time | **<15ms** per session |

What gets cut: stale file reads, old command output, search results from 10 turns ago, error traces after they're resolved. What stays: your conversation, system prompt, recent tool results.

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
| `tool-file-read` | Keep 1 turn, then truncate to bookends |
| `tool-cmd-output` | Exit code + last 20 lines after 1 turn |
| `image/media` | Pointer only, drop base64 |
| `config-dump` | Truncate to 500 chars |
| `error-trace` | Keep 2 turns, then discard |
| `json/schema` | Truncate to 500 chars |
| `tool-search-result` | Summary after 1 turn |
| `tool-generic` | Tail after 2 turns |

No LLM calls. No embeddings. Pure pattern matching. Zero latency, zero cost.

## Install

```bash
# As an OpenClaw plugin
cd plugin && npm install
# Enable in openclaw.json → plugins
```

## Project Structure

```
plugin/           # Production plugin (~700 lines, 36 tests)
├── classifier.js # Content type classification
├── policy.js     # Retention rules + truncation
├── index.js      # OpenClaw engine integration
└── __tests__/    # node:test suite

packages/core/    # Framework-agnostic core (v2, in development)
├── src/          # TypeScript implementation
└── __tests__/    # vitest suite (28 tests)

eval/             # Benchmarks + real-world eval
studio/           # React dashboard (WIP)
docs/             # Multi-agent protocol RFC
```

## Why Not Just Use Prompt Caching?

| | Anthropic Caching | ContextClaw |
|---|---|---|
| What it does | Caches static prefix (system prompt, tools) | Removes stale content from the dynamic portion |
| Conversation history | Still re-sent in full every turn | Truncated by content type + age |
| Token reduction | 0% on conversation | 55-66% on real sessions |
| Works with | Anthropic only | Any provider |

They're complementary. Caching reduces cost on the static prefix. ContextClaw reduces what's in the dynamic payload. Use both.

## Roadmap

- [x] Content-type classification (11 types)
- [x] Per-type retention policies
- [x] Real-world eval on production sessions
- [x] CI pipeline
- [ ] npm publish (`@contextclaw/core` for framework-agnostic use)
- [ ] Sticker/tagging system (per-project context indexing)
- [ ] Auto-rehydration from cold storage
- [ ] Studio dashboard (real-time token visualization)
- [ ] Multi-agent shared context protocol ([RFC](docs/MULTI_AGENT_PROTOCOL.md))

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
