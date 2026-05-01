# NEXT_TICKET: Implement spend attribution ledger MVP

## Category
🔴 CRITICAL, ContextClaw maintainer proof artifact.

## Why
ContextClaw's strongest value is not only compaction. It should tell a vibe coder exactly where usage went by project, model/provider/auth profile, and subagent path. This supports private self-audit now and future sanitized metadata export later.

## Spec
Read first:

- `docs/PRD-STANDARD.md`
- `docs/PRD-SPEND-ATTRIBUTION-LEDGER.md`
- `docs/MAINTAINER_PROPOSAL.md`

## Scope
Implement pure ledger/report helpers only.

Add/extend:

- `plugin/ledger.js`
- `plugin/__tests__/ledger.test.js`

## Required behaviors

1. Preserve optional attribution fields on estimate and receipt events:
   - `projectId`
   - `taskId`
   - `authProfile`
   - `artifactId`
2. Summaries roll up by project and auth profile.
3. Summaries expose parent/subagent/tool attribution.
4. Add a local human-readable usage report formatter.
5. Existing ledger tests keep passing.

## Constraints

- No social layer.
- No leaderboard.
- No OpenClaw config changes.
- No provider calls.
- No runtime plugin registration changes.
