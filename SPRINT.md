# ContextClaw Sprint — Fix Tests & Build Eval

## Context
ContextClaw is an OpenClaw context management plugin at `/home/yin/.openclaw/workspace/contextclaw/`.
Read `memory/active/contextclaw-distilled.md` for full architecture context.

## Task 1: Fix src/ Tests (11 failing)
The `src/` directory has a TypeScript core library. All 11 vitest tests fail.

Root causes (from session analysis):
1. `countTokens` is not exported from `src/budget.ts` — tests import it but it's missing
2. `CircuitBreaker` constructor export mismatch — tests try `new CircuitBreaker()` but it's not exported properly
3. Other export alignment issues between test imports and actual module exports

Steps:
1. `cd /home/yin/.openclaw/workspace/contextclaw`
2. Read `src/__tests__/budget.test.ts` and `src/__tests__/circuit-breaker.test.ts`
3. Read corresponding source files to see what's actually exported
4. Fix exports OR fix test imports to match
5. Run `npx vitest run` until all 11 tests pass
6. Write results to `/home/yin/.openclaw/workspace/outputs/contextclaw-test-fix.md`

## Task 2: Build Eval Pipeline  
The `eval/` directory has a basic harness but no semantic judge.

Steps:
1. Read `eval/run-eval.js` to understand current eval flow
2. Read existing transcripts in `eval/transcripts/`
3. Create a simple eval judge that scores: was important context preserved? was bloat removed?
4. Run eval against at least 2 transcripts
5. Write scored results to `eval/results/`
6. Write summary to `/home/yin/.openclaw/workspace/outputs/contextclaw-eval-results.md`

## Priority
Fix tests FIRST. Eval second if time permits.

## DO NOT
- Modify `plugin/` directory (production code, working)
- Change any git remotes or push
- Install new global dependencies
