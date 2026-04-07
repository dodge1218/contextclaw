# @contextclaw/core

Framework-agnostic context budget engine. **v2 — in development.**

The production plugin is in [`plugin/`](../plugin/). This package will become the standalone `@contextclaw/core` npm module for use outside OpenClaw (LangChain, CrewAI, custom agents).

## Modules
- `budget.ts` — Token counting (tiktoken) + block tracking
- `circuit-breaker.ts` — Model fallback with per-model failure tracking + cooldown
- `eviction.ts` — LRU-scored, FIFO, and manual eviction strategies
- `orchestrator.ts` — Ingestion pipeline with score decay + concurrent lock
- `memory.ts` — Cold storage flush + keyword search

## Tests
```bash
npm install
npx vitest run
```
