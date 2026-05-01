# PRD: Premium Model Preflight Seatbelt

Status: Active scope PRD
Date: 2026-05-01

## One-line build order

Add a ContextClaw premium-model preflight layer that warns or blocks expensive non-final model calls when stale/bulky/off-topic context or high token/cost risk would otherwise hit the most expensive model ungoverned.

## Doctrine link

- Workspace memory: `memory/permanent/contextclaw-seatbelt-doctrine.md`
- ContextClaw policy spec: `docs/AUTOCOMPACTION_POLICY_PRD.md`
- Maintainer proposal: `docs/MAINTAINER_PROPOSAL.md`

## User pain

Ryan’s hook:

> “Why did 4 prompts eat $25?”

The user is not trying to optimize tokens for fun. The user is surprised that a few prompts can silently carry huge stale context into premium models, retry loops, or rate limits.

For 3 million vibe coders, the felt pain is:

- the agent got expensive without warning
- the agent dragged old/wrong-topic context forward
- the model got rate-limited despite “only a few prompts”
- the system hid what was sent, dropped, or paid for

## Scope in

- Pure policy helpers for premium preflight decisions.
- Budget/ledger integration that can warn or block based on:
  - premium model detection
  - non-final/exploratory pass detection
  - estimated input token risk
  - estimated cost risk
  - duplicate/retry context risk where available
- Human-readable reasons suitable for receipt/TUI display.
- Tests proving warning and blocking behavior.
- Documentation that frames this as a seatbelt/governor.

## Scope out

- No OpenClaw config mutation.
- No automatic plugin re-enable.
- No provider API changes.
- No LLM-in-the-hot-path summarizer.
- No forced minimal output style.
- No hard ban on premium models.
- No hidden silent dropping of task-critical context.

## Resolved decisions

1. **Identity:** ContextClaw is a seatbelt/preflight layer, not merely a money saver.
2. **Default stance:** raw human prompts should not blindly hit the most expensive model with full hot context attached.
3. **Strictness:** warn first, block only when enforcement is explicitly configured.
4. **UX:** if blocked/warned, show exact reasons.
5. **Model quality:** the preflight must not hamstring the premium model’s useful reasoning/output.
6. **Topic switching:** off-topic context can decay aggressively after 1 grace pass because Ryan expects to self-correct the rare case where old context is needed.

## Deferred decisions

1. **OpenClaw equip path:** deferred until plugin compatibility is verified.
2. **Cheap model prompt-preparer:** deferred. MVP stays deterministic.
3. **TUI interaction design:** deferred until status provider support lands or equivalent API is available.
4. **Exact defaults for public release:** needs dogfood data across more sessions.

## Acceptance criteria

- `getPremiumPreflightDecision()` exists as a pure function.
- It returns `warn=true` for expensive non-final premium calls when enforcement is off.
- It returns `block=true` when explicit preflight enforcement is on.
- Reasons include actionable flags such as:
  - `premium-needs-preflight`
  - `premium-input-token-risk`
  - `premium-cost-risk`
- Existing budget gate behavior remains backward compatible unless enforcement is explicitly enabled.
- Unit tests pass.
- Maintainer docs explain governor-not-muzzle doctrine.

## Failure modes

Bad implementation would:

- block premium models so often users disable ContextClaw
- compress away the evidence the premium model needs
- force extremely minimal output style and make users blind
- make decisions silently without a receipt
- treat all premium calls as bad instead of distinguishing exploratory vs final/synthesis calls

## Verification plan

Run:

```bash
npm run test:plugin
```

Required test coverage:

- premium preflight warn path
- premium preflight enforced block path
- existing budget gate compatibility
- autocompaction topic-switch behavior
- secret-risk redaction
- tool-use structural safety

## Rollback plan

- Disable `enforcePremiumPreflight` / do not set it.
- Revert the pure helper and tests without touching plugin registration.
- Since OpenClaw config is not mutated, rollback is repo-only.
