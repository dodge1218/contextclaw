# GitHub Submission Standard

Status: Active standard
Date: 2026-05-01

## Purpose

Every serious ContextClaw GitHub push, PR, or maintainer-facing proposal should read like a polished professional submission: clear, scoped, attractive, technically honest, and easy for maintainers to review.

Security research taught the pattern: strong findings are not just correct, they are readable. They make the reviewer want to keep reading. ContextClaw/OpenClaw work needs the same discipline.

## Prime directive

> Make the work feel inevitable without making it feel bloated.

A maintainer should understand in 60 seconds:

1. what changed
2. why it matters
3. why it is safe
4. how to verify it
5. what is explicitly not included

## Submission shape

Every GitHub-facing serious change should have:

```text
PRD -> atomic implementation -> tests -> polished README/docs -> concise PR body
```

No “giant idea dump” PRs. The idea can be big. The PR must be small.

## Atomic file structure

Prefer one concept per file:

- `docs/PRD-<FEATURE>.md` for scoped build orders
- `docs/<FEATURE>-STANDARD.md` for durable process standards
- `plugin/<feature>.js` for pure implementation modules
- `plugin/__tests__/<feature>.test.js` for behavior tests
- `outputs/` only for generated/demo artifacts

Avoid mixing:

- product positioning + implementation + unrelated cleanup
- PRD standard updates + runtime behavior changes, unless the code directly implements that PRD
- OpenClaw integration changes + ContextClaw internal policy changes

## Professional PRD style

PRDs must be readable by a maintainer who has never seen Ryan’s original thread.

Good PRDs:

- start with the user pain
- quote the emotional hook if it matters
- clearly separate doctrine from implementation
- define scope in / scope out
- include failure modes
- include rollback
- include acceptance tests

Bad PRDs:

- dump every future idea
- leave open questions unresolved when a decision can be made now
- hide risk
- contain private Ryan/DSB-specific details not relevant to maintainers

## Maintainer-facing tone

Use:

- humble confidence
- concrete examples
- small asks
- clear test output
- “this is one plugin author’s real pain” framing

Avoid:

- grandiose claims
- “this changes everything” language
- arguing from personal urgency
- asking maintainers to absorb the entire ContextClaw vision in one PR
- implying OpenClaw is broken because ContextClaw exists

## PR body template

```md
## Summary
- <one sentence>
- <one sentence>

## Why
<2-4 sentences. Include user pain and plugin/API motivation.>

## What changed
- <atomic change 1>
- <atomic change 2>
- <tests/docs if included>

## What this does not do
- <scope-out 1>
- <scope-out 2>

## Verification
- [x] `npm run test:plugin`
- [x] <other command>

## Reviewer notes
<Anything that makes review easier: key files, compatibility, migration, risk.>
```

## ContextClaw positioning line

Use this when relevant:

> ContextClaw is a model-agnostic preflight and context-governance layer for expensive model calls: a governor, not a muzzle.

Shorter:

> ContextClaw is the seatbelt for agentic coding.

## Quality bar before pushing

Before pushing to GitHub:

- [ ] PRD exists or is intentionally not needed.
- [ ] Scope-out is explicit.
- [ ] Tests pass locally.
- [ ] Commit is atomic and named professionally.
- [ ] README/docs do not overclaim.
- [ ] No secrets, private DSB details, or raw internal session content.
- [ ] PR body can be read in under 90 seconds.
- [ ] Maintainer can review diff without understanding the whole roadmap.

## Beautiful but honest

Make it readable and compelling, but never fake maturity.

If a thing is not wired into OpenClaw yet, say so.
If a feature is pure policy only, say so.
If receipt ingestion is manual until OpenClaw exposes callback metadata, say so.

Professional polish is not hype. It is reduced reviewer effort.
