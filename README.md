# ContextClaw

**Context orchestration for OpenClaw agents.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Problem

OpenClaw agents accumulate context linearly. Every tool result, file read, and exec output stays in the conversation until compaction runs — a blunt summarizer that replaces history with a lossy summary. There's no eviction policy, no priority scoring, and no circuit breaker on API retries.

This leads to:
- Sessions that start at 30K tokens and reach 200K+ within a few turns
- 429 retry loops where each retry sends the full bloated context, burning quota faster
- Subagents inheriting unnecessary context from the parent session

We built ContextClaw to fix this in our own production setup (an agency running multi-agent workflows on OpenClaw). The problems are real — we accumulated 150M tokens in wasted context over one week.

## What It Does

ContextClaw manages what goes into an agent's context window and what gets evicted to searchable persistent memory.

```
┌─────────────┐     ┌──────────────┐     ┌─────────┐
│   OpenClaw   │────▶│ ContextClaw  │────▶│   LLM   │
│   Runtime    │◀────│  Orchestrator│◀────│  (any)  │
└─────────────┘     └──────────────┘     └─────────┘
                           │
                    ┌──────┴──────┐
                    │  Memory     │
                    │  Store      │
                    └─────────────┘
```

### Core Features

- **Context Budget** — Enforce a token ceiling. When exceeded, the lowest-scored blocks are evicted (not truncated).
- **LRU-Scored Eviction** — Each context block has a relevance score. User messages score high; large tool outputs score low. Referenced blocks get promoted. Stale blocks get evicted to persistent memory.
- **Retry Circuit Breaker** — On 429, stop after N attempts and switch to a fallback model. Prevents retry spirals.
- **Subagent Isolation** — Spawn workers with only the files and instructions they need. Enforces a 2K-token task description limit.
- **Pre-Eviction Flush** — Valuable evicted blocks are written to disk as searchable markdown files.

## Install

```bash
npm install contextclaw
```

## Usage

```typescript
import { ContextClaw } from 'contextclaw';

const claw = new ContextClaw({
  maxContextTokens: 60_000,
  evictionStrategy: 'lru-scored',
  memoryStore: './memory',
  retryCircuitBreaker: {
    maxRetries: 2,
    cooldownMs: 60_000,
    fallbackModels: [
      'groq/llama-3.3-70b-versatile',
      'cerebras/llama-3.3-70b',
    ],
  },
  subagentDefaults: {
    maxContextTokens: 30_000,
    injectOnly: ['task', 'files'],
    raiseHandAfter: 2,
  },
});
```

### Ingesting Context

```typescript
await claw.ingest({
  type: 'tool-result',
  content: execOutput,
  tokens: 5000,
  source: 'exec:git-log',
});
// If over budget, lowest-scored blocks are automatically evicted
```

### Spawning Subagents

```typescript
const prompt = claw.subagents.buildTaskPrompt({
  role: 'coder',
  task: 'Add sitemap.ts to the Next.js app at /workspace/mysite/',
  files: ['/workspace/mysite/package.json', '/workspace/mysite/src/app/'],
  exitCriteria: 'sitemap.ts exists and npm run build passes',
  raiseHand: true,
});
// Returns a scoped prompt under 2K tokens with raise-hand instructions
```

### Circuit Breaker

```typescript
claw.circuitBreaker.recordFailure('claude-opus-4.6', 429);
const next = claw.circuitBreaker.getNextModel('claude-opus-4.6');
// Returns 'groq/llama-3.3-70b-versatile' after max retries exhausted
```

### Inspecting State

```typescript
const state = claw.inspect();
// { blocks, totalTokens, budgetTokens, utilizationPercent, evictionHistory }
```

## Architecture

```
src/
├── index.ts           # Exports
├── types.ts           # All type definitions
├── orchestrator.ts    # Main ContextClaw class
├── budget.ts          # Token counting and ceiling enforcement
├── eviction.ts        # LRU-scored eviction engine
├── memory.ts          # Persistent memory store (flush + search)
├── circuit-breaker.ts # 429 retry prevention + model fallback
└── subagent.ts        # Subagent task builder + validator
```

## Roadmap

- [x] Context budget enforcement
- [x] LRU-scored eviction with memory flush
- [x] Retry circuit breaker with model fallback
- [x] Subagent isolation with task validation
- [ ] Visual inspector (web UI)
- [ ] OpenClaw hook integration
- [ ] Token counting via tiktoken (currently using estimates)
- [ ] Embedding-based memory search (currently keyword)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
