# ContextClaw Maintainer Triage

Date: 2026-05-12
Updated: 2026-05-13
Verdict: hold. Do not submit or push for maintainer review yet.

Status after local cleanup:

- README has been rewritten around the 2026-05-12 OpenClaw-native dogfood batch.
- Measurement definitions are split into `docs/MEASUREMENT.md`.
- Dogfood evidence is split into `docs/openclaw-dogfood-2026-05-12.md`.
- Plugin CI dependency gap is fixed locally by pinning `openclaw` and `tiktoken` in `plugin/package.json`.
- Local checks pass, including the exact plugin CI sequence: `cd plugin && npm ci && node --test`.
- Public CI will not reflect the fix until a clean branch is pushed.

## What Looks Real

- ContextClaw is currently enabled as the OpenClaw `contextEngine`.
- A restarted OpenClaw gateway accepted a normal TUI `proceed` workflow.
- The same OpenClaw session produced 10 post-baseline ContextClaw ledger entries.
- The batch stayed in one repeated single-codebase workflow, not a multitask/sticker demo.
- Adjacent external validation exists from Eric Milgram, PhD (`ScientificProgrammer`) on OpenClaw PR #64127: his real OpenClaw deployment hit a provider quota cascade that matched the control-plane/circuit-breaker framing.
- Local tests pass:
  - core: 51/51
  - plugin: 54/54
  - `git diff --check`: clean

## Current Dogfood Batch

Batch folder:

- `dogfood-runs/2026-05-12-proceed-loop/`

Fresh post-baseline ledger count:

- 10 assemblies
- 436,460 estimated input tokens after compression
- 3,854,677 chars saved
- 749 ledger-recorded truncations
- $1.6166 estimated compressed-prompt spend
- $2.89 estimated savings

These are estimate/receipt metrics. They are not provider-billed before/after measurements.

## External Validation Signal

Relevant artifact:

- GitHub notification from **Eric Milgram, PhD** on `openclaw/openclaw#64127`.
- Comment URL: `https://github.com/openclaw/openclaw/pull/64127#issuecomment-4416618274`

What it validates:

- The broader control-plane thesis is real: OpenClaw can repeat expensive failure loops when a provider/account condition is non-transient.
- His incident produced 26 runIds over about 7 days, repeating the same failover ladder and generating about 390 `RESOURCE_EXHAUSTED` events from one billing condition.
- He explicitly said the PR framing was "exactly the missing piece" for a real deployment he diagnosed.

What it does not validate:

- It does not validate ContextClaw compression quality.
- It does not validate chars-saved or dollars-saved claims.
- It does not prove the 2026-05-12 dogfood batch.

Use:

- Good as background credibility for the "OpenClaw needs context/spend control-plane guardrails" thesis.
- Do not use as direct proof that ContextClaw saves tokens.
- If mentioned publicly, keep it scoped to the quota/circuit-breaker/control-plane lane.

## What A Maintainer Would Likely Reject

### 1. Public CI Is Red Until the Fix Is Pushed

GitHub Actions has recent failures. A maintainer should not be asked to reason through a plugin proposal while the public repo advertises failing CI.

Known issue:

- The public CI environment does not have the OpenClaw runtime package/module shape available to plugin tests.
- Older local tests passed partly because the local OpenClaw environment existed.

Local fix:

- `plugin/package.json` now pins `openclaw` and `tiktoken`.
- `.github/workflows/ci.yml` now relies on `cd plugin && npm ci` instead of a separate ad hoc `npm install tiktoken`.
- `cd plugin && npm ci && node --test` passes locally.

Remaining gate:

- Push a clean branch and confirm public CI is green.

### 2. README Had Mixed Clean Evidence With Stale Launch Claims

The old README combined:

- sober OpenClaw-first control-plane framing;
- old "Live Dogfooding Results" reduction tables;
- old controlled eval tables;
- broad prompt-caching comparison claims;
- future roadmap items;
- stale safety warnings about the plugin registration issue.

This reads like several product eras pasted together. A strict maintainer will not know which claims are current.

Local fix:

- README now leads with the 2026-05-12 OpenClaw-native batch.
- Old 87.9% / 74.6% tables are no longer in the README.
- Stale disabled-plugin warning is removed.
- "What is proven right now" is separated from roadmap.

Remaining gate:

- Re-read the clean branch diff after carving it, because README language is review-sensitive.

### 3. The strongest proof is narrower than the repo narrative

What the batch proves:

- OpenClaw `contextEngine` integration works in a normal proceed loop.
- Dynamic context is deterministically trimmed before model calls.
- Receipts/ledger entries are emitted.
- Cold-storage/stat files move in the expected direction.

What it does not prove:

- provider-billed dollar savings;
- multi-agent shared context;
- task/sticker relabeling at scale;
- adapter behavior;
- auto-rehydration;
- quality equivalence against an uncompressed baseline.

Fix before outreach:

- Do not lead with stickers, multi-agent, adapters, or universal context-engine framing.
- Keep dollar savings secondary and caveated.
- Use chars saved, truncation counts, and ledger receipts as primary evidence.

### 4. The worktree is not review-shaped

The branch is ahead of origin and contains unrelated modified/untracked areas:

- Claude Code watcher/docs/logs
- adapter packages
- eval suite
- security tests/path safety
- outreach/prepared artifacts
- new dogfood artifacts

This is too much for a maintainer review.

Fix before outreach:

- Create a clean branch with only:
  - plugin/core changes needed for OpenClaw context-engine operation;
  - measurement docs;
  - one dogfood evidence packet;
  - CI fix.
- Leave adapter and outreach artifacts out.

### 5. Maintainer ask is currently too broad

The proposal asks for context governance, budget gates, plugin API feedback, preflight policy, spend attribution, and future analytics. The useful ask is smaller.

Fix before outreach:

- Ask one question:
  - "Does this deterministic `contextEngine` plugin shape fit OpenClaw, and what API/loader changes would make it safer?"
- Attach one proof packet:
  - the OpenClaw proceed-loop dogfood batch.

## Labeling / Sticker Feature

The local autocompaction policy code is real and tested:

- `plugin/autocompaction-policy.js`
- `plugin/__tests__/autocompaction-policy.test.js`

It supports:

- label-on-ingress;
- lane/project/task inference;
- correction-aware relabeling;
- off-topic grace passes;
- stale pointers;
- summary/cold-store action planning.

But it is not the current proof. Treat it as future-work evidence, not the first maintainer pitch.

## Recommended Next Tickets

1. Done locally: write `docs/openclaw-dogfood-2026-05-12.md`.
2. Done locally: write `docs/MEASUREMENT.md`.
3. Done locally: rewrite README to a current, narrow OpenClaw-first story.
4. Done locally, pending push verification: fix public CI.
5. Carve a clean branch.
6. Draft the maintainer note after 1-5 are done.

## Submission Gate

Do not send to OpenClaw maintainers until:

- public CI is green;
- README no longer overclaims;
- measurement definitions are explicit;
- dogfood evidence packet exists;
- branch diff is small enough to review;
- maintainer ask is one concrete API/plugin-shape question.
