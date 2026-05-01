# NEXT_TICKET: Implement pure autocompaction policy MVP

## Category
🔴 CRITICAL, ContextClaw core direction.

## Why
Ryan identified the distilled ContextClaw primitive: a custom autocompaction policy that labels context as it enters, then reevaluates labels before every pass. This should replace ad hoc relevance scoring and prevent wrong-lane drift, e.g. stale bounty context staying hot after Ryan corrected back to websites.

## Spec
Read first:

- `docs/PRD-STANDARD.md`
- `docs/PRD-PREMIUM-PREFLIGHT-SEATBELT.md`
- `docs/AUTOCOMPACTION_POLICY_PRD.md`

## Scope
Implement pure policy code first, with no OpenClaw plugin re-enable and no OpenClaw config mutation.

Add:

- `plugin/autocompaction-policy.js`
- `plugin/__tests__/autocompaction-policy.test.js`

Export pure functions:

- `labelContextItem(item, state)`
- `resolveCurrentTaskState(items)`
- `reevaluateLabels(labels, state)`
- `planCompactionActions(labels, state)`
- `assembleWorkingSet(items, actions, options)`

## Required behaviors

1. Ingress labels include: project, task, lane, contentType, source, tokenEstimate, importance, lifespan, privacy, costRisk, stale, summary, coldPointer.
2. Detect correction events like:
   - “no, we were actually doing websites”
   - “bruh”
   - “stop, wrong direction”
3. On correction, mark conflicting lane labels stale and boost matching lane labels.
4. Bulky file/tool/browser outputs become summary + cold pointer after their first useful turn.
5. Secrets/config dumps are redacted from active working set.
6. Current task status ledgers stay hot as summaries.

## Acceptance tests

- Wrong-lane correction test: bounty context becomes stale, website/Instant Cash context stays hot.
- Bulky file lifecycle test: raw large file drops to summary + cold pointer.
- Unresolved error test: failing current-task command stays hot as summarized error.
- Secret-risk test: key-shaped values never appear in assembled output.

## Constraints

- No OpenClaw config edits.
- No plugin registration changes.
- No provider calls or embeddings for MVP.
- Deterministic, fast, unit-testable.
- Keep existing classifier/policy behavior intact unless explicitly replacing with tests.
