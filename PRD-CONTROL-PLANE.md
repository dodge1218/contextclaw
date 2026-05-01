# ContextClaw Control Plane PRD

## One-line
ContextClaw is the OpenClaw-first context + spend control plane: it makes main-session and subagent model usage auditable, price-correct over time, and visible before/after calls.

## Positioning
ContextClaw is **not** an agent runtime, Claude Code clone, or LangChain adapter roadmap. OpenClaw remains the runtime. ContextClaw is the control plane that plugs into runtimes, starting with OpenClaw.

## Core job
Make agent work financially observable:

1. What context was sent?
2. Which model/provider priced it?
3. What price table was active at that moment?
4. Was it main session or subagent?
5. What mission/prompt/pass caused it?
6. How much was estimated before the call?
7. How much was actually charged/used after the call?
8. How much context was saved by compression/eviction?
9. How does this accumulate over time without repricing history incorrectly?

## Non-negotiable principle
**Never attribute one global token count to one current API price.**

Every ledger entry must snapshot pricing at the time of the call. Historical cost reports must sum per-entry captured prices, not multiply lifetime tokens by today’s model price.

## Product shape

### 1. OpenClaw plugin, first-class
- Runs as an OpenClaw plugin.
- Uses official OpenClaw plugin APIs only.
- After `registerStatusProvider` lands, reports status in the TUI footer.
- Does not monkeypatch OpenClaw core.

### 2. Main + subagent accounting
The ledger must distinguish:

- `sessionKind`: `main` | `subagent` | `background` | `cron` | `unknown`
- `parentSessionKey`
- `childSessionKey`, if applicable
- `agentId`
- `runId`, if available
- `missionId`, if user/delegation supplied
- `promptHash`
- `contextHash`

Subagent spend must roll up to the parent mission, but remain separately inspectable.

### 3. Pre-call estimate ledger
Before provider execution, ContextClaw records:

- timestamp
- provider
- model
- model API family
- estimated input tokens
- estimated output tokens
- estimated cache read/write tokens, if knowable
- context chars and hashes
- compression savings estimate
- current captured pricing snapshot
- estimated cost by component
- budget decision: allow / warn / block / require approval

### 4. Post-call receipt ledger
After provider execution, ContextClaw records actual usage when OpenClaw exposes it:

- actual input tokens
- actual output tokens
- cache read tokens
- cache write tokens
- provider-billed cost if available
- calculated cost from captured pricing if provider does not report dollars
- estimate-vs-actual variance
- completion status: success / error / aborted / retried

If actual usage is unavailable, the receipt remains `actualUsageStatus: unavailable`, not silently inferred as truth.

### 5. Price snapshot model
Each entry captures:

```json
{
  "pricingSnapshot": {
    "source": "openclaw-runtime|openclaw-config|provider-api|manual|heuristic",
    "provider": "anthropic",
    "model": "claude-sonnet-4-5",
    "currency": "USD",
    "unit": "per_1m_tokens",
    "input": 3.0,
    "output": 15.0,
    "cacheRead": 0.3,
    "cacheWrite": 3.75,
    "capturedAt": "2026-04-30T...Z",
    "configHash": "..."
  }
}
```

Historical reports must sum ledger entries using their own `pricingSnapshot`.

### 6. Immutable-ish append-only ledger
Default local paths:

- `~/.openclaw/contextclaw/ledger.jsonl`
- `~/.openclaw/contextclaw/pricing-snapshots.jsonl`
- `~/.openclaw/contextclaw/artifacts/`

Ledger should be append-only by default. Corrections are new entries with `correctsEntryId`, not destructive edits.

### 7. Audit commands
CLI is an audit/admin surface, not the product identity.

Required commands:

```bash
cc ledger tail
cc ledger summary --today
cc ledger summary --since 7d
cc ledger session <sessionKey>
cc ledger mission <missionId>
cc ledger subagents --parent <sessionKey>
cc ledger prices --model anthropic/claude-sonnet-4-5
cc ledger explain <entryId>
cc ledger export --format csv
```

### 8. TUI footer status
Once OpenClaw supports `registerStatusProvider`, ContextClaw footer should show compact status:

```text
ContextClaw: $0.42 today | $0.11 subagents | 1.2M toks saved | 2 blocked
```

Click/command drilldown can come later. Footer is status only.

### 9. Budget gates
Budgets can be scoped:

- per call
- per prompt
- per mission
- per session
- per day
- per provider/model
- subagent-only

Gate modes:

- `observe`: record only
- `warn`: record + status warning
- `block`: replace with tiny synthetic gate message before provider execution
- `approval`: require explicit approval for over-budget calls

### 10. Context compression remains Layer 1
Context classification/eviction is still part of ContextClaw, but now feeds the audit story:

- original context tokens
- assembled context tokens
- saved tokens
- saved cost under captured price snapshot
- cold-storage pointers for evicted artifacts

## MVP acceptance criteria

1. README says clearly: OpenClaw is runtime, ContextClaw is control plane.
2. Plugin loads on current OpenClaw without production-breaking hooks.
3. Ledger records pre-call context assembly estimates with pricing snapshots.
4. Ledger distinguishes main vs subagent runs when metadata is available.
5. Historical summary does not reprice old entries using current model price.
6. Status provider reports today spend, subagent spend, and tokens saved.
7. CLI can summarize spend by day, model, session, and parent/subagent tree.
8. Missing actual usage is represented honestly as unavailable.
9. No LangChain/CrewAI/AutoGen promises in primary README.
10. One demo shows: main call + subagent call + different model prices + correct rollup.

## Deferred

- LangChain/CrewAI/AutoGen adapters.
- Standalone runtime agent wrapper.
- Hosted dashboard.
- Enterprise analytics.
- Knowledge graph/sticker system.
- ICE/PIE bootloader integration.

## Work-in-progress table

| Work item | Status | Notes |
|---|---|---|
| README repositioning | TODO | Must remove runtime-wrapper ambiguity. |
| OpenClaw status provider integration | BLOCKED | Waiting on PR #72557 merge. |
| Pricing snapshot schema | TODO | Must support config/runtime/provider/manual/heuristic sources. |
| Main/subagent metadata mapping | TODO | Need inspect available OpenClaw session/run metadata. |
| Pre-call ledger | PARTIAL | Existing plugin ledger exists, needs schema hardening. |
| Post-call receipts | BLOCKED/PARTIAL | Needs OpenClaw usage callback/API exposure. |
| Historical summary CLI | TODO | Must sum entry-level price snapshots. |
| Budget gates | PARTIAL | Existing synthetic gate idea, needs session/mission scopes. |
| Demo proof | TODO | Main + subagent + different model prices + rollup. |

## Strategic reason
This is the maintainer-path artifact: OpenClaw gets a credible ecosystem plugin that makes agent cost transparent. ContextClaw becomes infrastructure for serious agent operations, not a vague wrapper.
