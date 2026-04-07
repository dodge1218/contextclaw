# NEXT_TICKET: P0 Bug Fixes — ContextClaw Core

## Context
ContextClaw is a context budget engine. The plugin (plugin/*.js) runs inside OpenClaw. The core (packages/core/src/*.ts) is framework-agnostic TypeScript.

## Tasks (all P0)

### 1. Fix truncation marker spoofing
**File:** `plugin/policy.js`
**Problem:** Truncation markers like `[...truncated...]` are static strings. An LLM could be prompt-injected to fake them.
**Fix:** Generate a random nonce per session and include it in markers: `[...truncated:a7f3b2...]`. Validate nonce on rehydration. Add the nonce generator to policy.js and pass it through from index.js on init.

### 2. Stream JSONL parsing 
**Files:** `packages/core/src/watcher.ts`, `packages/core/src/analyzer.ts`
**Problem:** Both use `readFileSync` which OOMs on large session files (50MB+).
**Fix:** Replace with streaming line-by-line reader (readline + createReadStream). The watcher already has a file watcher loop — make it stream-append instead of re-read.

### 3. Score decay in orchestrator
**File:** `packages/core/src/orchestrator.ts`
**Problem:** Items are scored on ingest only. A tool-file-read scored 0.8 on turn 5 still shows 0.8 on turn 50.
**Fix:** Add age-based decay: `effective_score = base_score * decay_factor^(current_turn - ingest_turn)`. Use decay_factor=0.95 (configurable). Re-score on every eviction pass.

### 4. Eviction performance
**File:** `packages/core/src/eviction.ts`
**Problem:** `evictUntilBudget()` re-sorts the entire array every iteration.
**Fix:** Sort once, then pop from the end. Use a single sorted pass.

### 5. Fix content.flatMap crash
**File:** `plugin/index.js`
**Problem:** The assemble() hook returns messages in a format that breaks OpenClaw's content.flatMap. When the plugin is active, it can corrupt the session.
**Fix:** Ensure assemble() returns messages with `.content` as an array of content blocks (matching OpenClaw's expected format: `[{type: "text", text: "..."}]`). If content is a plain string, wrap it.

### 6. Token estimate accuracy
**Files:** `plugin/index.js`, `packages/core/src/budget.ts`
**Problem:** Using char/4 or char/2 heuristics. Real token counts differ by 2x.
**Fix:** Use tiktoken (already a dependency) for accurate counts. Fall back to char/4 heuristic with a logged warning if tiktoken fails to load.

## Verification
- `cd packages/core && npm test` — all tests pass
- `cd plugin && node --test` — all tests pass
- No `readFileSync` in watcher.ts or analyzer.ts
- Truncation markers contain nonces
- evictUntilBudget sorts exactly once
- assemble() output has .content as array of {type, text} blocks

## Constraints
- Do NOT touch anything browser/UI related
- Do NOT add new dependencies (tiktoken is already in package.json)
- Run tests after each fix
- Git commit with message: `fix: P0 bug fixes — markers, streaming, decay, eviction, flatMap, tokens`
- Push to origin master
