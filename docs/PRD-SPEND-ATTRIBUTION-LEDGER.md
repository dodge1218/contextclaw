# PRD: Spend Attribution Ledger MVP

Status: Active scope PRD
Date: 2026-05-01

## Problem

ContextClaw can already record model usage estimates/receipts, but Ryan's actual need is project-aware spend attribution: which project, auth/profile, model, parent session, and subagent path consumed usage, and whether that spend mapped to useful work.

## Scope in

- Add optional ledger attribution fields:
  - `projectId`
  - `taskId`
  - `authProfile`
  - `artifactId`
- Preserve fields across estimate and receipt events.
- Add summary rollups by:
  - project
  - auth profile
  - parent session/subagent path
- Add a pure report formatter suitable for local self-audit.
- Add tests proving project/model/subagent/auth rollups.

## Scope out

- No social leaderboard.
- No public metadata publishing.
- No OpenClaw config mutation.
- No new provider calls.
- No ranking/efficiency score yet.

## Acceptance criteria

- Ledger entries can be attributed by project, task, auth profile, subagent/tool, and artifact.
- `summarizeLedger()` exposes by-project and by-auth rollups without breaking existing summary shape.
- Local text report answers: entries, estimated/actual cost, tokens, top projects, top models, top auth profiles, top subagent/tool paths.
- `npm run test:plugin` passes.

## Verification

- Add focused unit tests in `plugin/__tests__/ledger.test.js`.
- Run `npm run test:plugin`.

## Rollback

Revert pure ledger/report helper changes. No config or runtime activation changes required.
