# ContextClaw

**Your AI agent's context budget.**

ContextClaw monitors your AI agent's context window and automatically removes what doesn't matter — so your agent is faster, cheaper, and smarter.

## The Problem

AI agents silently waste tokens. In a real OpenClaw session, we measured:

| Metric | Without ContextClaw | With ContextClaw |
|---|---|---|
| Tokens per turn | 195,000 | 22,000–24,000 |
| Cache reads (52 turns) | 6.3M | ~760K |
| Waste multiplier | **8–9x** | **1x (baseline)** |

Root causes: full conversation history re-sent every request, compaction summaries persisting across "fresh" sessions, and 429 retry loops re-sending the same oversized payload.

## How It Works

ContextClaw treats your context window like RAM, not a logbook.

1. **Budget** — Sets a hard token cap per session (default 60K)
2. **Score** — Rates each context item by relevance to the current task
3. **Evict** — Removes lowest-scoring items before they hit the API

That's it. Three operations, one primitive: the budget.

## Install

```bash
# From your OpenClaw workspace
cd ~/.openclaw/plugins
git clone https://github.com/dodge1218/contextclaw.git
```

Add to your OpenClaw config:
```yaml
plugins:
  - contextclaw
```

Restart OpenClaw. No other configuration needed.

## Architecture

```
THE BUDGET (core primitive)
  └── Every token has a cost, a source, and a relevance score
  └── Every session has a finite budget

AUTOMATIONS
  ├── Eviction: auto-remove lowest-relevance items when budget full
  ├── Progressive Loading: skills/tools load only when needed
  ├── Compaction: summarize old turns to reclaim budget
  └── Circuit Breaker: hard-truncate if compaction fails
```

## Why This Matters for Providers

Every oversized request that triggers a 429 wastes provider GPU compute — inference begins before rejection. ContextClaw reduces request sizes by ~85%, meaning fewer retries, less wasted infrastructure, and more users served on the same hardware.

## Roadmap

- [ ] Content-addressable context (hash-based dedup for LLM payloads)
- [ ] Visual context monitor (real-time token budget dashboard)
- [ ] Dynamic budgets per task type
- [ ] Context replay (scrub past sessions to find bloat)

## License

MIT

## Links

- [OpenClaw](https://github.com/openclaw/openclaw) — the AI agent framework ContextClaw plugs into
- Built by [DreamSiteBuilders](https://dreamsitebuilders.com)
