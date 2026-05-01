# ContextClaw Work In Progress

Updated: 2026-04-30 22:42 ET

## Current posture
ContextClaw is now defined as the **OpenClaw-first context + spend control plane**.

OpenClaw is the runtime. ContextClaw is the governor/auditor:
- context compression
- append-only request ledger
- per-call pricing snapshots
- budget gates
- main/subagent rollups
- receipts
- TUI status

Do **not** position it as a standalone agent runtime, Claude Code clone, or LangChain/CrewAI framework roadmap.

## Built in this push

### Product definition
- `PRD-CONTROL-PLANE.md`
- README repositioned around auditable spend accounting.
- LangChain/CrewAI/AutoGen/runtime-wrapper promises moved out of MVP positioning.

### Ledger core
- `plugin/ledger.js`
- Append-only JSONL estimate entries.
- Manual receipt entries that link to estimates without mutating them.
- Pricing snapshots captured per estimate.
- Historical summaries sum entry-level costs, not total tokens × current price.
- Main/subagent/session metadata fields:
  - `sessionKind`
  - `sessionKey`
  - `parentSessionKey`
  - `childSessionKey`
  - `agentId`
  - `runId`
  - `missionId`

### Plugin integration
- `plugin/index.js`
- Ledger records estimates at `assemble()` boundary.
- Budget gate can synthesize a tiny replacement message before provider execution.
- Status provider registered when OpenClaw exposes `registerStatusProvider`.
- Stats file now includes ledger spend and subagent spend.

### CLI audit commands
- `cc ledger-tail`
- `cc ledger-summary`
- `cc ledger-summary --today`
- `cc ledger-session <sessionKey>`
- `cc ledger-subagents <parentSessionKey>`
- `cc ledger-explain <entryId>`
- `cc ledger-receipt <entryId> --tokens-in N --tokens-out N --source manual`

### Proof demo
- `npm run demo:control-plane`
- Creates:
  - main session estimate
  - premium subagent estimate
  - later main estimate after price change
  - post-call receipt
- Demonstrates parent rollup and per-entry pricing snapshots.

## Verified
- `npm run build` ✅
- `npm run test:all` ✅
- `npm run demo:control-plane` ✅
- Manual CLI smoke:
  - `ledger-explain`
  - `ledger-receipt`
  - `ledger-summary`

## Blocked on OpenClaw

### 1. Status provider merge
OpenClaw PR #72557 must merge before ContextClaw footer status becomes first-class.

After merge:
- test ContextClaw against current OpenClaw plugin API
- ensure `registerStatusProvider({ id: 'contextclaw', getStatus })` renders in TUI
- remove/update any legacy status-extension assumptions

### 2. Post-call usage callback/API
ContextClaw cannot automatically reconcile actual provider usage until OpenClaw exposes a post-call usage event or plugin API.

Needed from OpenClaw:
- provider/model
- session/run/agent metadata
- input/output/cache tokens
- provider-reported cost if available
- stop/error status

Until then:
- use `cc ledger-receipt` for manual receipts
- keep `actualUsageStatus: unavailable` honest on estimates

### 3. Session metadata fidelity
Current ContextClaw infers subagent/main from available `sessionId` and config. Proper rollups need richer OpenClaw metadata passed into context-engine assemble or usage callbacks.

Needed fields:
- parent session key
- child session key
- agent id
- run id
- task/mission id when available

## Do not build yet
- Standalone runtime agent wrapper.
- LangChain/CrewAI/AutoGen adapters.
- Hosted analytics dashboard.
- Knowledge graph / sticker system.
- ICE/PIE bootloader integration.

These are roadmap/community-adapter items after OpenClaw control-plane MVP is trusted.

## Next best task
Once OpenClaw PR #72557 lands:
1. Install/use latest OpenClaw plugin API locally.
2. Run ContextClaw plugin in a safe test workspace.
3. Generate a real ledger entry from main session.
4. Generate or simulate subagent metadata.
5. Confirm TUI footer status.
6. File a small ContextClaw PR/release with the control-plane positioning and proof demo.

## Release notes draft
ContextClaw is now an OpenClaw-first control plane for context and spend:
- auditable JSONL request ledger
- per-call pricing snapshots
- main/subagent rollups
- manual actual-usage receipts
- budget gates before provider execution
- deterministic proof demo showing historical cost correctness
