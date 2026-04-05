# 🧠 ContextClaw

**Stop burning 90% of your tokens. Context orchestration for OpenClaw agents.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## The Problem

Your OpenClaw agent sends 200K tokens per turn when it only needs 30K.

Every tool result, every file read, every exec output stays in the conversation forever — until the blunt compaction summarizer crushes it into a lossy summary. Meanwhile, your API bills explode and 429 rate limits cascade into retry spirals that burn thousands of dollars.

**We know because we burned 150M tokens learning this the hard way.**

## What ContextClaw Does

ContextClaw sits between your OpenClaw agent and the LLM, managing what goes in and what stays out — like a packet router for context windows.

```
┌─────────────┐     ┌──────────────┐     ┌─────────┐
│   OpenClaw   │────▶│ ContextClaw  │────▶│   LLM   │
│   Runtime    │◀────│  Orchestrator│◀────│  (any)  │
└─────────────┘     └──────────────┘     └─────────┘
                           │
                    ┌──────┴──────┐
                    │  Memory     │
                    │  Store      │
                    │  (searchable)│
                    └─────────────┘
```

### Features

| Feature | What it does |
|---|---|
| **Context Budget** | Set a token ceiling per session. ContextClaw enforces it by evicting stale context, not truncating. |
| **Rolling Priority** | Every context block has a relevance score. Referenced = stays. Stale = evicted to searchable memory. |
| **Subagent Isolation** | Spawn workers with surgical context — only the files and instructions they need. No 200K startup tax. |
| **Retry Circuit Breaker** | On 429, stop after N attempts. Switch provider. Never spiral. |
| **Pre-Compaction Flush** | Before OpenClaw's summarizer runs, flush decisions and outcomes to persistent memory files. |
| **Visual Inspector** | Web UI to see exactly what's in your context window, drag to keep/evict, and track token spend over time. |

## Quick Start

```bash
npm install contextclaw
```

```typescript
// openclaw.config.ts or your agent setup
import { ContextClaw } from 'contextclaw';

const claw = new ContextClaw({
  maxContextTokens: 60_000,      // hard ceiling
  evictionStrategy: 'lru-scored', // least-recently-referenced, weighted by importance
  memoryStore: './memory',        // where evicted context goes (searchable)
  retryCircuitBreaker: {
    maxRetries: 2,                // stop after 2 failures
    fallbackModels: [             // auto-switch on 429
      'groq/llama-3.3-70b-versatile',
      'cerebras/llama-3.3-70b',
    ],
  },
  subagentDefaults: {
    maxContextTokens: 30_000,     // subagents get less
    injectOnly: ['task', 'files'], // no history, no memory, just the job
  },
});
```

### Subagent Spawning

```typescript
// Instead of dumping everything into a subagent:
claw.spawn({
  role: 'coder',
  task: 'Add sitemap.ts to the Next.js app at /workspace/mysite/',
  files: ['/workspace/mysite/package.json', '/workspace/mysite/src/app/'],
  exitCriteria: 'sitemap.ts exists and npm run build passes',
  raiseHand: true, // if stuck after 2 attempts, report back instead of retrying
});
```

### Visual Inspector

```bash
npx contextclaw inspect
# Opens http://localhost:3333 — see your context window as draggable blocks
```

## Why This Exists

We run an AI-powered agency (DreamSiteBuilders.com) on OpenClaw. We spawned 39 subagents, ran 16 crons, built knowledge graphs, and automated outreach — all through a single OpenClaw instance.

Then we burned 150 million tokens in a week.

The root cause: OpenClaw's context window is a FIFO queue with a blunt summarizer. There's no eviction policy, no priority scoring, no circuit breaker on retries. Every tool result from 50 turns ago sits in context burning tokens until compaction crushes everything into a lossy summary.

ContextClaw is the fix we built for ourselves. Now it's yours.

## Architecture

```
contextclaw/
├── src/
│   ├── index.ts           # Main orchestrator
│   ├── budget.ts          # Token counting and ceiling enforcement
│   ├── eviction.ts        # LRU-scored eviction strategy
│   ├── memory.ts          # Persistent memory store (search + retrieve)
│   ├── circuit-breaker.ts # 429 retry prevention + model fallback
│   ├── subagent.ts        # Isolated subagent launcher
│   ├── inspector/         # Web UI for visual context inspection
│   │   ├── server.ts
│   │   └── ui/            # React dashboard
│   └── hooks/             # OpenClaw hook integration
│       ├── pre-compaction.ts
│       └── post-turn.ts
├── package.json
├── tsconfig.json
├── LICENSE
└── README.md
```

## Roadmap

- [x] Context budget enforcement
- [x] LRU-scored eviction
- [x] Retry circuit breaker
- [x] Subagent isolation
- [ ] Visual inspector (web UI)
- [ ] OpenClaw hook integration (pre-compaction flush)
- [ ] Metrics dashboard (token spend over time)
- [ ] Plugin for OpenClaw marketplace (ClawHub)

## Built With

- TypeScript
- OpenClaw SDK
- tiktoken (token counting)
- Fuse.js (memory search)
- React (inspector UI)

## Contributing

PRs welcome. If you've burned tokens on context bloat, you understand the problem. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT

---

*Built by [DreamSiteBuilders](https://dreamsitebuilders.com) — the agency that burned 150M tokens so you don't have to.*
