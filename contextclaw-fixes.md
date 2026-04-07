# ContextClaw Fixes

## Changes
- Security: plugin truncation markers include `[ContextClaw:<nonce> ...]` for bookends, tails, and pointer extractions with regex-based tests covering the new format.
- Performance: eviction candidates are sorted once per cycle and consumed sequentially to avoid repeated sorts.
- Freshness: the orchestrator exposes `decayScores(turnsElapsed)` and `ingest()` accepts an optional `turnsElapsed` hint so block scores decay before each ingest; regression tests cover both manual and automatic decay.
- Reliability: the first heuristic token-count fallback logs `[ContextClaw] tiktoken unavailable...` so operators know when `tiktoken` cannot be used.

## Tests
- `npx vitest run`
- `cd plugin && node --test`
