# ContextClaw -> OpenClaw Push: Next Tickets

Date: 2026-05-12
Status: pre-push planning

## Current Evidence Boundary

The current dogfood batch is an OpenClaw-native, repeated single-codebase `proceed` workflow. It is not a multi-topic, multi-agent, adapter, or sticker-system proof.

Current batch folder:

- `dogfood-runs/2026-05-12-proceed-loop/`

Current batch summary:

- 10 post-baseline ContextClaw assemblies
- 436,460 estimated input tokens after compression
- 3,854,677 chars saved
- 749 ledger-recorded truncations
- $1.6166 estimated compressed-prompt spend
- $2.89 estimated savings

These are estimate/receipt metrics, not provider-billed before/after measurements.

## Ticket 1: Finish Dogfood Batch — DONE

Goal: reach a boring, repeatable sample from the same OpenClaw workflow.

Human action completed:

- Ran normal OpenClaw `proceed` turns on the same codebase workflow.
- Stayed in one session/workflow.
- Stopped at 10 total valid post-baseline assemblies.

Rationale:

- 10 valid assemblies is enough for the first maintainer-facing mini-batch.
- More dogfood is not the next bottleneck.
- 20+ runs is not needed before the first maintainer review; it increases noise and the chance of mixed-task evidence.

## Ticket 2: Evidence Packet

Create `docs/openclaw-dogfood-2026-05-12.md` with:

- setup/config
- restart note
- hashed/redacted session identifier(s), never raw session keys
  - Use SHA-256 over the raw session key plus a local, unpublished evidence pepper.
  - Publish as `session:sha256:<first12>`; keep the pepper local so outside readers can compare entries inside one packet without recovering the original session key.
  - Document the command or script used to derive the redacted ID in the evidence packet.
- per-call ledger rows
- chars saved
- truncation counts
- estimated spend/savings caveat
- cold-storage path evidence
- known limitations

Keep the language factual and auditable.

## Ticket 3: Measurement Definitions

Create `docs/MEASUREMENT.md` defining:

- raw chars saved
- ledger compression chars saved
- truncation count
- estimated tokens saved
- estimated dollars saved
- compressed-prompt spend
- OpenClaw-native evidence vs adapter-only evidence

Lead with chars and receipts. Keep dollar savings secondary.

## Ticket 4: Public Framing Rewrite

Update public docs so the first impression is:

- OpenClaw context-engine plugin
- deterministic dynamic-context trimming
- cold storage
- auditable receipts
- complementary to native compaction, not a replacement

Move these to future-work sections:

- stickers/task labels
- multi-agent shared context
- adapters
- auto-rehydration
- broad benchmark claims

## Ticket 5: CI/Public Repo Cleanup

Fix the public CI failure before asking a maintainer to review:

- GitHub Actions currently lacks the `openclaw` runtime package used by plugin tests.
- Either mock/stub the OpenClaw dependency in tests or pin a real install path.
- Keep the reviewed branch narrow.

## Ticket 6: Maintainer Packet

Draft a short note for OpenClaw maintainers:

- one ask: does this `contextEngine` plugin shape fit OpenClaw?
- one proof packet: the dogfood batch
- one caveat: token/dollar savings are estimates
- no request to evaluate the whole future roadmap

## Hold For Later

Do not lead with these in the first maintainer review:

- multi-topic sticker routing
- cross-agent shared context
- Claude Code/Codex adapter evidence
- old HN launch claims
- large universal context-engine vision

## PR #7 Scope Guardrail

Do not add new product scope to PR #7 while it is waiting for maintainer review.

Keep PR #7 limited to:

- OpenClaw `contextEngine` plugin shape;
- deterministic preflight trimming;
- cold storage;
- receipts/request ledger;
- one OpenClaw-native dogfood packet;
- measurement caveats;
- safety hardening and tests.

Do not add:

- Claude Code adapter work;
- Codex CLI streaming toggles;
- `/on`, `/off`, `/stream-on`, or `/stream-off` controls;
- sticker/task routing;
- multi-agent shared context;
- auto-rehydration;
- broad benchmark claims;
- founder-market framing such as platform-scale savings.

Those belong in separate future branches after PR #7 gets human feedback. The maintainer ask should stay one concrete question: does this `contextEngine` preflight shape fit OpenClaw, and what runtime/API changes would make it safer?

## Deferred Integration Idea: Manual Claude Code / Codex Surfaces

Do not mix this into the first OpenClaw maintainer packet.

Idea:

- Build a Claude Code-specific ContextClaw plugin that is never default-loaded.
- Build a Codex CLI streaming toggle after Codex CLI is updated and the streaming hook is verified independently.
- Use explicit manual controls only:
  - Claude Code: `/on` and `/off`
  - Codex CLI: `/stream-on` and `/stream-off`
- Prove the streaming/tracking function works by itself before integrating ContextClaw trimming.
- Only then measure cross-surface estimated savings and receipts.

Safety requirements:

- Test in a disposable sandbox profile, not the daily working profile.
- Never auto-register into global config during development.
- Keep a one-command rollback and config backup before every test.
- Verify that disabling the toggle fully restores the original runtime behavior.
- Capture receipts separately by surface so Claude Code, Codex CLI, and OpenClaw savings are not blended.

Reason:

- If ContextClaw can provably track avoided spend across OpenClaw, Claude Code, and Codex CLI, the product story gets much larger.
- Prior Claude Code integration attempts broke the working setup for days, so this must be treated as a sandboxed adapter project, not a quick plugin experiment.
