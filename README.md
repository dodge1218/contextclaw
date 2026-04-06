# 🧠 ContextClaw

Context budget engine for [OpenClaw](https://github.com/openclaw/openclaw). Treats your context window like RAM, not a logbook.

## The problem

AI agents silently accumulate garbage in their context window — old tool outputs, stale chat logs, compaction artifacts. You don't notice until you're rate-limited or paying for 200K token requests that should be 22K.

| | Without ContextClaw | With ContextClaw |
|---|---|---|
| Tokens/turn | 195,000 | 22,000 |
| Cache reads (52 turns) | 6.3M | ~760K |

## How it works

Every turn, before the API call:

1. **Extract topic** from last 3 user messages
2. **Score** every message: topic relevance + recency + role − size penalty
3. **Evict** lowest-scored items to cold storage on disk
4. **Target** 60% of budget — always leaves headroom

System messages are never evicted. Recent turns are preserved. Old tool outputs with zero topic overlap get flushed first.

## Install

```bash
cd ~/.openclaw/plugins
git clone https://github.com/dodge1218/contextclaw.git
cd contextclaw/plugin && npm install
```

Add to `openclaw.json`:

```json
{
  "plugins": {
    "load": { "paths": ["~/.openclaw/plugins/contextclaw/plugin"] },
    "slots": { "contextEngine": "contextclaw" },
    "entries": { "contextclaw": { "enabled": true } }
  }
}
```

Restart OpenClaw.

## Studio (optional)

ContextClaw broadcasts telemetry via WebSocket (port 41234). The `studio/` directory contains a React dashboard that shows real-time token usage, eviction events, and topic keywords.

```bash
cd studio && npm install && npm run dev
```

## Architecture

```
User prompt → OpenClaw gateway → ContextClaw.assemble()
                                    ├── extract topic keywords
                                    ├── score all messages
                                    ├── evict low-relevance → cold storage
                                    └── return pruned messages → API call
```

Cold storage lives at `~/.openclaw/workspace/memory/cold/` as `.jsonl` files. Content is truncated to 2K chars per message — enough for recall, not enough to bloat disk.

## Integrations

| Framework | Status | Maintainer |
|---|---|---|
| **OpenClaw** | ✅ Official | [@dodge1218](https://github.com/dodge1218) |
| **Cline** | 🟡 Seeking maintainer | [Open an issue](https://github.com/dodge1218/contextclaw/issues) |
| **LangChain** | 🟡 Seeking maintainer | [Open an issue](https://github.com/dodge1218/contextclaw/issues) |
| **CrewAI** | 🟡 Seeking maintainer | [Open an issue](https://github.com/dodge1218/contextclaw/issues) |
| **AutoGen** | 🟡 Seeking maintainer | [Open an issue](https://github.com/dodge1218/contextclaw/issues) |

The core scoring logic is framework-agnostic (~100 lines). Adapters welcome.

## License

MIT
