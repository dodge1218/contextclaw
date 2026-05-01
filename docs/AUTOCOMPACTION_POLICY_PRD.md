# ContextClaw Autocompaction Policy PRD

Date: 2026-05-01
Status: Draft, execution-ready
Owner: Ryan / Conductor

## One-line thesis

Most of ContextClaw can be expressed as an OpenClaw-native custom autocompaction policy that labels context on ingress, then reevaluates labels before every pass and assembles only the current working set.

The core is not “summarize old messages.” The core is:

> label first, compact by label, re-label when task reality changes.

## Problem

OpenClaw sessions run hot because huge tool outputs, file reads, browser snapshots, schemas, logs, and stale task branches remain in the active model window after their useful life ends. Recency-based compaction fails because the expensive item is often a single giant tool result, not a long tail of small chat messages.

Recent live failure mode:

- Session had shifted back to the Manayunk/Roxborough website money sprint.
- Bounty context was still semantically available and got treated as current.
- Ryan corrected: “no. we were actually doing websites.”
- Correct behavior should have been immediate relabeling: bounty lane = stale/off-task, website sprint = hot.

## Design goal

Create a policy layer that can run inside OpenClaw’s compaction/assembly path and make context lifecycle decisions using stable metadata, not vibes.

## Architecture

```text
incoming item
  -> ingress classifier
  -> sticker/label record
  -> cold-storage pointer if bulky
  -> active ledger

before each model pass
  -> task-state resolver
  -> per-item reevaluator
  -> policy action planner
  -> assemble active window
  -> optional rehydrate pointers
```

## Ingress labels

Every context item receives a compact metadata envelope as it enters the conversation.

Required labels:

```ts
type ContextLabel = {
  id: string;
  createdAt: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  project?: string;       // e.g. contextclaw, dsb, bounty, kairos
  task?: string;          // e.g. instant-cash-demo, autocompaction-prd
  lane?: string;          // e.g. websites, security-research, lead-gen
  contentType: ContentType;
  source?: string;        // file path, tool name, session key, URL
  tokenEstimate: number;
  importance: 0 | 1 | 2 | 3 | 4 | 5;
  lifespan: 'turn' | 'task' | 'session' | 'pinned' | 'forever';
  privacy: 'normal' | 'secret-risk' | 'credential' | 'user-private';
  costRisk: 'low' | 'medium' | 'high' | 'extreme';
  stale: boolean;
  summary?: string;
  coldPointer?: string;
};
```

Content types:

- `system-prompt`
- `user-message`
- `assistant-reply`
- `tool-file-read`
- `tool-command-output`
- `tool-search-result`
- `browser-snapshot`
- `image-media`
- `config-dump`
- `error-trace`
- `json-schema`
- `code-diff`
- `artifact-pointer`
- `status-ledger`
- `conversation-correction`

## Per-pass reevaluation

Before every model call, the policy reevaluates each active item against the current task state.

Questions:

1. Is this item in the current lane/project/task?
2. Did the user correct direction after this item was created?
3. Has this bulky item already been captured in a durable artifact?
4. Is the raw form still required, or is a summary/pointer enough?
5. Is this item an unresolved blocker/error that must stay hot?
6. Is this item a secret or credential risk that should be stripped regardless of relevance?

## Policy actions

```ts
type PolicyAction =
  | 'KEEP_RAW'
  | 'KEEP_SUMMARY'
  | 'PIN'
  | 'COLD_STORE'
  | 'DROP_FROM_WINDOW'
  | 'REHYDRATE_IF_ASKED'
  | 'REHYDRATE_NOW';
```

Action rules:

- `system-prompt`: PIN, but allow admin-defined trimming of repeated injected project context.
- latest user correction: PIN for at least 3 turns.
- current task status ledger: KEEP_SUMMARY or PIN.
- file reads over threshold: KEEP_RAW for one turn, then KEEP_SUMMARY + cold pointer.
- command output: keep exit code, command, last useful lines, artifact path.
- browser snapshots: never keep full DOM/screenshot payload hot unless the next action requires visual inspection.
- resolved error traces: COLD_STORE.
- stale lane after correction: DROP_FROM_WINDOW unless explicitly pinned.
- credentials/secrets: redact immediately, keep only existence + source pointer.

## Correction-aware relabeling

A user correction is a first-class context event.

Examples:

- “no, we were actually doing websites”
- “bruh”
- “stop, wrong direction”
- “that’s not the task”

On correction:

1. Create `conversation-correction` item.
2. Infer new lane/project/task from the correction and recent known state.
3. Mark conflicting lane items `stale = true`.
4. Boost matching lane items `importance += 2`.
5. Assemble next pass with a short correction banner:

```text
CURRENT TASK CORRECTION: User corrected active lane to websites / Manayunk money sprint. Treat security research context as stale unless explicitly requested.
```

## Working-set assembly

Default active window order:

1. Sacred system/developer instructions.
2. Current correction banner if present.
3. Current task capsule, 200-600 tokens.
4. Pins/blockers/acceptance criteria.
5. Recent user turns.
6. Current-lane evidence summaries.
7. Raw tool outputs only if produced in the last turn or explicitly needed.
8. Cold pointers for everything else.

## Cold storage format

Every dropped/truncated bulky item should remain recoverable.

```json
{
  "id": "ctx_...",
  "label": { "project": "dsb", "task": "instant-cash-demo", "contentType": "tool-file-read" },
  "summary": "SPRINT_STATUS says Instant Cash is open pawn shop; next action build one-page mock inventory demo.",
  "rawPath": "memory/context-cold/2026-05-01/ctx_....json",
  "hash": "sha256:...",
  "createdAt": "2026-05-01T19:22:00Z"
}
```

## Minimal MVP

MVP should not require knowledge graphs or embeddings.

1. Add label envelope around messages/tool results.
2. Implement deterministic content-type classifier.
3. Implement current-lane resolver using recent user turns + explicit correction events.
4. Add per-pass policy actions.
5. Store raw bulky items to JSONL and replace with summary + pointer.
6. Add tests for correction relabeling and bulky tool-output trimming.

## Acceptance tests

### Test 1, wrong-lane correction

Input context contains:

- current bounty filing queue
- Manayunk SPRINT_STATUS
- user says: “no. we were actually doing websites”

Expected next assembled window:

- includes correction banner
- includes Manayunk/Instant Cash status
- excludes raw bounty queue
- may include only one-line stale pointer: “security research queue exists, currently stale”

### Test 2, bulky file read lifecycle

Input:

- 30K line file read used for one answer
- 3 turns later, same task continues but file details not needed

Expected:

- raw file read cold-stored
- active context keeps summary, file path, hash, and retrieval instruction

### Test 3, unresolved error stays hot

Input:

- failing command output from current task
- no successful rerun yet

Expected:

- error trace remains hot as summarized stack + exact failing command
- raw full output cold-stored

### Test 4, secret risk

Input:

- env/config dump includes key-shaped strings

Expected:

- raw content never retained hot
- redacted summary says secret-risk content was seen and where
- no secret value appears in assembled prompt

## Relationship to existing ContextClaw

Existing ContextClaw v1 already has the right lower layer:

- classifier
- policy engine
- plugin assembly hook
- cold storage concept

This PRD promotes the missing upper layer:

- task/lane stickers
- correction-aware relabeling
- per-pass reevaluation
- OpenClaw-native autocompaction semantics

## Non-goals

- No provider-specific prompt-cache magic.
- No semantic embedding retrieval in MVP.
- No full knowledge graph in MVP.
- No automatic deletion of history, only removal from active window.
- No OpenClaw config mutation until Ryan explicitly approves.

## Next implementation ticket

Implement the MVP inside ContextClaw as a pure policy module first, with no OpenClaw plugin re-enable:

- `plugin/autocompaction-policy.js`
- `plugin/__tests__/autocompaction-policy.test.js`
- Export pure functions:
  - `labelContextItem(item, state)`
  - `resolveCurrentTaskState(items)`
  - `reevaluateLabels(labels, state)`
  - `planCompactionActions(labels, state)`
  - `assembleWorkingSet(items, actions, options)`

Only after tests pass should this be wired into the OpenClaw plugin assembly path.
