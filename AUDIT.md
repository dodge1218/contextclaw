# ContextClaw Code Audit

**Auditor:** Conductor (automated)  
**Date:** 2025-04-05  
**Scope:** All `src/` files + README.md  

---

## 1. What's Solid

- **Clean type definitions** (`types.ts`). Interfaces are well-named, minimal, and compose well. `ContextBlock` is a strong core abstraction.
- **Separation of concerns.** Budget, eviction, memory, circuit breaker, and subagent builder are genuinely independent modules. No circular dependencies.
- **README is excellent.** Problem statement is compelling and specific (150M wasted tokens). Usage examples cover all features. Architecture diagram is clear. Roadmap is honest about gaps. This is above-average OSS documentation.
- **Eviction → memory flush pipeline.** The idea that evicted blocks above a score threshold get persisted is smart and well-implemented.
- **Subagent prompt builder** with validation and raise-hand guard is pragmatic and useful standalone.
- **Circuit breaker** handles the common 429 spiral correctly with cooldown-based reset.

## 2. What's Missing or Broken

### Critical

1. **No actual token counting.** `ingest()` requires callers to pass `tokens` — there's no tokenizer. The README acknowledges this, but it means the budget is only as good as the caller's guess. A `countTokens(content: string): number` utility (even `Math.ceil(content.length / 4)`) should be built-in with an option to plug in tiktoken.

2. **`evictUntilBudget` only implements `lru-scored`.** The `strategy` field is stored but never branched on. `fifo` and `manual` strategies are dead config — passing them does nothing different. This is a contract violation.

3. **No tests.** Zero. Not one. A library claiming production use with no test suite won't be taken seriously. At minimum: budget add/remove/overBudget, eviction ordering, circuit breaker state transitions, subagent validation.

4. **No `package.json` or `tsconfig.json` visible.** Can't `npm install` or build. The README says `npm install contextclaw` but there's no package manifest.

### Significant

5. **`MemoryStore.search()` is O(n) full-file-scan keyword matching.** Fine for <100 files, breaks at scale. No index, no relevance ranking beyond word overlap. The `score` field name collides conceptually with `ContextBlock.score`.

6. **`scoreBlock` is hardcoded heuristic with no extension point.** Users can't customize scoring. Should accept an optional `scorer: (block) => number` in config.

7. **No error handling in `MemoryStore.flush()`.** If `writeFile` fails (permissions, disk full), the eviction pipeline silently loses content. Should catch and at minimum log.

8. **`ingest()` signature requires `Omit<ContextBlock, 'id' | 'createdAt' | 'lastReferencedAt' | 'score' | 'pinned'>` but `ContextBlock` has `tokens` as required.** If the caller gets token count wrong, the entire budget is wrong. No validation.

9. **`SubagentLauncher` builds prompts but never launches anything.** It's a prompt formatter, not a launcher. The name overpromises.

10. **No concurrency guards.** `ingest()` is async (because of eviction flush). Two concurrent `ingest()` calls could both trigger eviction on the same blocks. Needs a mutex or queue.

### Minor

11. **`currentModelIndex` in `CircuitBreaker` is unused** (line 6, circuit-breaker.ts). Dead code.
12. **`inspect()` return type isn't typed** — it returns an anonymous object, not `InspectorState`. The `InspectorState` interface exists in `types.ts` but is never used.
13. **`budgetTokens` in `inspect()` returns `remaining`, but the `InspectorState` type calls it `budgetTokens`.** Semantically confusing — "budget tokens" sounds like the max, not remaining.
14. **No `destroy()`/`close()` method.** If MemoryStore or other resources need cleanup, there's no lifecycle hook.

## 3. Specific Code Fixes

| # | File | Line(s) | Fix |
|---|------|---------|-----|
| 1 | `eviction.ts` | 11 | Branch on `this.strategy`: add `fifo` (sort by `createdAt`) and `manual` (no auto-evict) |
| 2 | `orchestrator.ts` | 31 | Add `if (block.tokens <= 0) throw new Error('tokens must be positive')` |
| 3 | `orchestrator.ts` | 28 | Accept optional `scorer?: (block) => number` in config, use it in `scoreBlock` |
| 4 | `orchestrator.ts` | 60 | Type the return as `: InspectorState` |
| 5 | `circuit-breaker.ts` | 6 | Remove unused `currentModelIndex` |
| 6 | `memory.ts` | 20-30 | Wrap `writeFile` in try/catch, log error, return `null` instead of crashing |
| 7 | `memory.ts` | 33-50 | Add early return if `files.length === 0` to avoid unnecessary iteration |
| 8 | `subagent.ts` | class name | Rename to `SubagentPromptBuilder` or add actual spawn logic |
| 9 | `orchestrator.ts` | 37-39 | Add a simple mutex: `private ingesting = Promise.resolve()` pattern to serialize `ingest()` |
| 10 | `budget.ts` | 9 | Cache `totalTokens` instead of recomputing on every access. Invalidate on add/remove. |

## 4. Production Readiness

**Is this ready for public GitHub?** Almost. The architecture and API design are genuinely good. The README alone would draw interest. But:

- **No tests = not credible.** A senior engineer will check for tests within 30 seconds of cloning. Finding none, they'll close the tab.
- **No package.json = can't install.** The README's install command is fictional until this exists.
- **Dead strategy branches** signal incomplete implementation.

**Would a senior engineer take it seriously?** They'd say: "Good design, solid README, but this is a prototype, not a library." The gap between the README's promises and the code's reality (no tests, no FIFO/manual, keyword-only search, no real tokenizer) would erode trust.

**Fix the top 3 (tests, package.json, strategy branches) and it crosses the line from prototype to credible OSS.**

## 5. Ratings

| Dimension | Score | Notes |
|-----------|-------|-------|
| **Code Quality** | 6/10 | Clean, readable, well-structured. Loses points for dead code, no error handling, no concurrency safety, no tests. |
| **API Design** | 7/10 | Good composability, clean interfaces. `ingest()` is elegant. Loses points for no extension points (scorer, tokenizer) and `SubagentLauncher` misnomer. |
| **Documentation** | 8/10 | README is strong — problem, solution, examples, architecture, honest roadmap. Missing: API reference, JSDoc on public methods, CONTRIBUTING.md (referenced but absent). |
| **Completeness** | 4/10 | Two of three eviction strategies are no-ops. No tests, no package manifest, no tokenizer, keyword-only search. Half the roadmap is unchecked. |

**Overall: 6/10** — Strong skeleton, needs flesh.
