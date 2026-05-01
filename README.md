# 🧠 ContextClaw

[![CI](https://github.com/dodge1218/contextclaw/actions/workflows/ci.yml/badge.svg)](https://github.com/dodge1218/contextclaw/actions/workflows/ci.yml)

**The seatbelt for agentic coding.** ContextClaw is an OpenClaw-first preflight, context, and spend control plane for expensive model calls. It answers the pain every power user eventually hits: “Why did 4 prompts eat $25?”

ContextClaw makes agent work auditable: what context was sent, which model priced it, what price snapshot was active, whether it was main or subagent work, and how cost accumulates over time without repricing history against today’s API prices.

ContextClaw is **not** an agent runtime, Claude Code clone, or LangChain roadmap. OpenClaw remains the runtime. ContextClaw is the governor, not the muzzle: compression, request ledgers, budget gates, receipts, and TUI status without crippling the model’s useful output.

See the current product definition: [`PRD-CONTROL-PLANE.md`](PRD-CONTROL-PLANE.md). Serious changes follow [`docs/PRD-STANDARD.md`](docs/PRD-STANDARD.md) and [`docs/GITHUB-SUBMISSION-STANDARD.md`](docs/GITHUB-SUBMISSION-STANDARD.md).

## Why this exists

Vibe coders should not have to learn the hard way how wrappers, retries, context windows, prompt caching, and provider pricing interact. If you have multi-model routing, raw human prompting should not blindly hit your most expensive model with the whole hot session attached. A cheaper deterministic policy should preflight the prompt first.

Agent systems hide spend in mutable prompts and subagent trees. A single “total tokens × current price” counter is not auditable because model prices change, cache tiers differ, and subagents run on different providers.

ContextClaw records each call boundary with its own pricing snapshot:

```json
{
  "sessionKind": "subagent",
  "parentSessionKey": "main-session",
  "providerModel": "anthropic/claude-sonnet-4-6",
  "estimatedInputTokens": 32000,
  "estimatedOutputTokens": 2048,
  "pricingSnapshot": {
    "source": "openclaw-runtime",
    "unit": "per_1m_tokens",
    "input": 3.0,
    "output": 15.0,
    "capturedAt": "2026-04-30T...Z"
  }
}
```

Historical summaries sum the captured per-entry costs. They do **not** multiply lifetime tokens by whatever the model costs today.

## Product shape

```text
OpenClaw runtime
  ├─ main session calls
  ├─ subagent calls
  └─ background/cron calls
        ↓
ContextClaw control plane
  ├─ context classification + compression
  ├─ append-only request ledger
  ├─ pricing snapshots per call
  ├─ budget gates before provider execution
  ├─ post-call receipts when usage is exposed
  └─ TUI status provider
```

## What is in scope now

- OpenClaw plugin adapter.
- Main/subagent spend accounting.
- Per-call price snapshots.
- Context compression and saved-token accounting.
- Budget gates before expensive calls.
- CLI audit/admin commands and demos.

## Deferred / community welcome

LangChain, CrewAI, AutoGen, Cline, and standalone runtime wrappers are intentionally not the MVP. If others want those adapters, great. This repo is OpenClaw-first until the control plane is boring, auditable, and trusted.

## Local audit commands

```bash
npm test
npm run test:plugin
npm run ledger
npm run demo:control-plane
```

`demo:control-plane` creates a deterministic ledger with a main session, a premium subagent, a later main call after a price change, and an actual-usage receipt. The rollup proves ContextClaw sums entry-level price snapshots instead of repricing lifetime tokens against one current model price.

Audit an OpenClaw ledger:

```bash
cc ledger-summary --today
cc ledger-session <sessionKey>
cc ledger-subagents <parentSessionKey>
cc ledger-explain <entryId>
cc ledger-receipt <entryId> --tokens-in 12000 --tokens-out 800 --source manual
```

The CLI is an audit/admin surface, not the product identity. The product is the ledger + budget control plane inside OpenClaw.

## Live Dogfooding Results

Running on our own OpenClaw instance (11,300 items across 6 real sessions):

| Content Type | Items | Original | Stored | Reduction |
|---|---|---|---|---|
| JSON schema blobs | 1,192 | 17.6M chars | 0.8M | **95.5%** |
| File reads | 2,471 | 8.8M | 0.7M | **91.8%** |
| Assistant replies | 4,000 | 8.6M | 2.4M | **71.4%** |
| Generic tool output | 1,158 | 4.5M | 0.7M | **84.2%** |
| Config dumps | 1,647 | 3.2M | 0.5M | **84.4%** |
| Error traces | 326 | 1.9M | 0.1M | **93.6%** |
| **Total** | **11,300** | **45.5M** | **5.5M** | **87.9%** |

![ContextClaw saving 956K tokens in OpenClaw TUI](assets/tui-tokens-saved.png)
*Live savings counter running in the OpenClaw TUI footer*

The key insight: **JSON schemas and file reads are 55% of all context waste**, and they compress at 92-95% with zero information loss.

### Controlled Eval (4 real sessions, .reset files)

| Session | Messages | Original | Output | Reduction | Truncated |
|---------|----------|----------|--------|-----------|----------|
| Session A | 681 | 870K | 186K | **78.7%** | 166 |
| Session B | 253 | 465K | 108K | **76.8%** | 37 |
| Session C | 190 | 323K | 206K | **36.2%** | 29 |
| Session D | 688 | 1.2M | 227K | **81.2%** | 153 |
| **Total** | **1,812** | **2.9M** | **727K** | **74.6%** | **385** |

Methodology: `ContextClawEngine.assemble()` against uncompacted `.reset` session backups. No synthetic data.

## How It Works

```
Message arrives → Classify content type → Check retention policy → Truncate or keep
```

11 content types, each with its own retention rule:

| Type | Rule |
|------|------|
| `system-prompt` | Never touch |
| `user-message` | Keep last 5 turns full, metadata-strip older |
| `assistant-reply` | Keep last 3 turns, trim narration |
| `tool-file-read` | Keep 1 turn, then truncate to bookends (first/last lines) |
| `tool-cmd-output` | Exit code + last 20 lines after 1 turn |
| `image/media` | Pointer only, drop base64 immediately |
| `config-dump` | Truncate to 500 chars |
| `error-trace` | Keep 2 turns, then discard |
| `json/schema` | Truncate to 500 chars |
| `tool-search-result` | Summary after 1 turn |
| `tool-generic` | Tail after 2 turns |

No LLM calls. No embeddings. Pure pattern matching + byte counting. Zero latency, zero cost.

## Install

```bash
npm install contextclaw
```

### Quick Start — Try on Your Session

```bash
# Check your current session's context health
npx cc status

# Watch and auto-alert when context is bloated
npx cc watch

# Analyze token usage across all sessions
npx cc analyze
```

### As an OpenClaw Plugin

```bash
cd ~/.openclaw/workspace/contextclaw/plugin && npm install
# Enable only after verifying your OpenClaw version supports the context-engine plugin registration path.
# Historical config shape: plugins.slots.contextEngine: "contextclaw"
```

> **Current safety note:** keep the plugin disabled in critical workspaces until the context-engine registration compatibility issue is fixed. The mission-ledger CLI is safe to run standalone because it does not hook provider execution.
>
> **v1 is an OpenClaw plugin.** Standalone adapters for LangChain, Cline, etc. are on the roadmap. The classification and policy engine in `packages/core/` is framework-agnostic TypeScript.

## Project Structure

```
plugin/           # Production OpenClaw plugin (~700 lines, 36 tests)
├── classifier.js # Content type classification (11 types)
├── policy.js     # Retention rules + truncation engine
├── index.js      # OpenClaw context engine integration
└── __tests__/    # node:test suite

packages/core/    # Framework-agnostic core (TypeScript, 30 tests)
├── src/          # Budget, eviction, memory, orchestrator, watcher
└── __tests__/    # vitest suite

eval/             # Benchmarks + real-world eval on production sessions
docs/             # Multi-agent shared context protocol RFC
```

## Why Not Just Use Prompt Caching?

| | Anthropic Caching | ContextClaw |
|---|---|---|
| What it does | Caches static prefix (system prompt, tools) | Removes stale content from the dynamic portion |
| Conversation history | Still re-sent in full every turn | Truncated by content type + age |
| Token reduction | 0% on conversation | 55-88% on real sessions |
| Works with | Anthropic only | Any provider (via plugin adapter) |

They're complementary. Caching reduces cost on the static prefix. ContextClaw reduces what's in the dynamic payload. Use both.

## Limitations (Honest)

- **v1 is OpenClaw-only.** The plugin API is OpenClaw's `contextEngine` interface. Standalone use requires `packages/core/`.
- **Eval is context-sufficiency judged, not full A/B.** Our LLM-judged eval scores whether compressed context preserves enough information for equivalent responses. At 80% budget: 44% equivalence rate. We're iterating.
- **No rehydration yet.** Truncated content goes to cold storage but there's no auto-rehydration path when the agent needs it again.
- **Aggressive on long sessions.** The 87.9% number is from very long sessions. Short sessions (<20 turns) see 10-30% savings.

## Roadmap

- [x] Content-type classification (11 types)
- [x] Per-type retention policies with age decay
- [x] Real-world eval on production sessions
- [x] CI pipeline (66 tests across plugin + core)
- [x] Live dogfooding with telemetry
- [x] Cold storage for evicted content
- [x] npm publish (`contextclaw` on npm) ✅ v1.0.1
- [x] Local mission-ledger prototype (`prototypes/contextclaw_mvp.py`)
- [x] Review-feed demo cards (`docs/MVP_REVIEW_FEED_DEMO.md`)
- [x] Content-addressable artifact dedup in the MVP ledger
- [x] Minimal TypeScript `MissionLedger` core scaffold + tests
- [x] Copilot-style premium unit estimates for predictable spend with unknown context
- [x] Manual usage receipts + estimate-vs-actual variance in TypeScript ledger
- [ ] Wire provider/gateway receipts into the ledger automatically
- [ ] Port persisted mission ledger/governor from prototype into the TypeScript core
- [ ] Fix OpenClaw context-engine registration compatibility before re-enabling plugin dogfood
- [ ] Auto-rehydration from cold storage
- [ ] Sticker system — task-scoped context retrieval (v2)
- [ ] Studio dashboard (real-time token visualization + review feed)
- [ ] Multi-agent shared context protocol ([RFC](docs/MULTI_AGENT_PROTOCOL.md))

### 🤝 Wanted: Framework Adapter Maintainers

The core engine (`packages/core/`) is framework-agnostic TypeScript. We'd love community-maintained adapters for:

- **LangChain** / LangGraph
- **Cline**
- **CrewAI**
- **AutoGen**

If you use one of these and want to help, open an issue or PR. The adapter interface is ~50 lines.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
