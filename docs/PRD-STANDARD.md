# ContextClaw PRD Standard

Status: Active standard
Date: 2026-05-01

## Purpose

Every serious ContextClaw build or doctrine-driven alteration must start from a scope-confining PRD before implementation.

A PRD is not a vibes memo. It is a build order that prevents scope creep, preserves product doctrine, and lets a future coding agent execute without rediscovery.

## When required

Write or update a PRD before work when the change does any of these:

- changes ContextClaw product identity or public positioning
- changes premium-model governance, budget gates, or safety behavior
- changes compaction/assembly behavior
- changes plugin/OpenClaw integration
- introduces a new module or public API
- touches security/privacy/secret handling
- changes what users see in receipts, TUI status, or warnings

Small typo fixes, test-only refactors, or internal cleanup do not need a PRD.

## Required PRD sections

Each PRD must include:

1. **One-line build order**
   - Concrete deliverable in one sentence.

2. **Doctrine link**
   - Which memory/doc doctrine this implements.
   - Example: `memory/permanent/contextclaw-seatbelt-doctrine.md`.

3. **User pain**
   - The emotional/practical problem.
   - Example quote: “Why did 4 prompts eat $25?”

4. **Scope in**
   - Exact behaviors/files/modules allowed.

5. **Scope out**
   - Explicitly forbidden expansions.

6. **Resolved decisions**
   - Decisions already made, with rationale.

7. **Deferred decisions**
   - Anything not decided, with the blocker or eval needed.

8. **Acceptance criteria**
   - Testable completion criteria.

9. **Failure modes**
   - How this could hurt users if implemented poorly.

10. **Verification plan**
    - Tests/commands/manual checks required before commit.

11. **Rollback plan**
    - How to disable/revert safely.

## Product guardrails

All PRDs must preserve these rules:

- ContextClaw is a **governor, not a muzzle**.
- Do not force premium models into opaque minimal-output style.
- Preserve task intent, evidence, blockers, constraints, and acceptance criteria.
- Compact stale/bulky/off-topic context aggressively, but keep cold pointers for rehydration.
- Make context/spend decisions auditable.
- Do not mutate OpenClaw config or re-enable plugins without explicit approval and compatibility verification.

## Template

```md
# PRD: <feature/change>

## One-line build order

## Doctrine link

## User pain

## Scope in

## Scope out

## Resolved decisions

## Deferred decisions

## Acceptance criteria

## Failure modes

## Verification plan

## Rollback plan
```
