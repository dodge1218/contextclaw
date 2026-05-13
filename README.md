# ContextClaw

[![CI](https://github.com/dodge1218/contextclaw/actions/workflows/ci.yml/badge.svg)](https://github.com/dodge1218/contextclaw/actions/workflows/ci.yml)

ContextClaw is an OpenClaw-first context and spend control plane for long-running agent sessions.

The user pain is simple:

> Why did four prompts eat $25?

The answer is usually not just "the model is expensive." It is stale context, retries, provider failover, repeated tool output, hidden subagent spend, and a runtime that cannot explain what it was about to send before the expensive call.

ContextClaw is the seatbelt for that path. It trims stale dynamic context before the model call, preserves the full removed content in cold storage, and writes auditable receipts for what happened.

## What It Is

ContextClaw plugs into OpenClaw's `contextEngine` slot.

```text
OpenClaw messages
  -> classify by content type
  -> apply deterministic retention policy
  -> cold-store removed bulky content
  -> write request ledger / pricing snapshot
  -> return leaner context to OpenClaw
```

It is not a new agent runtime. OpenClaw remains the runtime. ContextClaw is the governor, not the muzzle.

It does not replace native compaction. Native compaction handles late-session pressure. ContextClaw targets the dynamic middle before each model call: stale file reads, command output, config dumps, JSON/schema blobs, error traces, media payloads, and repeated tool envelopes.

## What Is Proven Right Now

The clean current evidence is an OpenClaw-native dogfood batch captured on 2026-05-12 after enabling ContextClaw as the context engine and restarting the gateway.

One repeated OpenClaw `proceed` workflow, same session:

- 10 post-baseline ContextClaw assemblies
- 436,460 estimated input tokens after compression
- 3,854,677 chars saved
- 749 ledger-recorded truncations
- $1.6166 estimated compressed-prompt spend
- $2.89 estimated savings

These are estimate/receipt metrics, not provider-billed before/after measurements.

Evidence:

- [Dogfood packet](docs/openclaw-dogfood-2026-05-12.md)
- [Measurement definitions](docs/MEASUREMENT.md)
- [Dogfood run files](dogfood-runs/2026-05-12-proceed-loop/)
- [Maintainer triage](docs/MAINTAINER_TRIAGE_2026-05-12.md)

## Why This Is Different From Autocompact

Autocompact says:

> The context got too full. Summarize it.

ContextClaw says:

> Before the expensive call, trim stale bulky context, keep the real conversation, cold-store the original, and write down what changed.

Autocompact is a cliff. ContextClaw is preflight.

## Content Types

ContextClaw's current plugin classifies and applies policy to:

- `system-prompt`
- `user-message`
- `assistant-reply`
- `tool-file-read`
- `tool-cmd-output`
- `tool-search-result`
- `tool-generic`
- `config-dump`
- `json/schema`
- `error-trace`
- `image/media`

Representative policies:

- system prompts are pinned;
- recent user/assistant turns stay hot;
- old file reads become bookends;
- old command output becomes exit signal plus tail;
- config/schema blobs get aggressively shortened;
- media payloads become pointers;
- truncated originals are written to cold storage.

No LLM call. No embedding lookup. No semantic magic.

## Request Ledger

ContextClaw records a local JSONL estimate at the context-assembly boundary:

```bash
~/.openclaw/contextclaw/ledger.jsonl
```

Each entry can include:

- session kind and session key;
- provider/model/auth profile;
- prompt hash and context hash;
- estimated input/output tokens;
- captured pricing snapshot;
- estimated compressed-prompt spend;
- compression chars saved;
- truncation count;
- duplicate-context / budget flags.

Actual provider-billed usage is only reconciled where OpenClaw exposes usage receipts. Until then, cost savings are estimates derived from chars removed, token heuristic, and captured model input pricing.

## OpenClaw Setup

Path-based plugin setup:

```bash
cd ~/.openclaw/workspace/contextclaw/plugin
npm ci
```

Use `npm ci` when the lockfile is present so local setup matches CI.

Representative OpenClaw config shape:

```json
{
  "plugins": {
    "entries": {
      "contextclaw": {
        "enabled": true,
        "config": {
          "enableTelemetry": false,
          "ledger": {
            "enabled": true,
            "path": "~/.openclaw/contextclaw/ledger.jsonl",
            "printReceipt": true
          },
          "coldStorageDir": "~/.openclaw/workspace/memory/cold"
        }
      }
    },
    "load": {
      "paths": ["/absolute/path/to/contextclaw/plugin"]
    },
    "slots": {
      "contextEngine": "contextclaw"
    }
  }
}
```

Restart the OpenClaw gateway after changing plugin registration or slot config.

## Local Checks

```bash
npm test
npm run test:plugin
git diff --check
```

Current local result from this checkout:

- core tests: 51 passed
- plugin tests: 54 passed
- whitespace diff check: clean

## Doctrine

The broader doctrine is that modern agent loops are economic systems, not just reasoning loops. One human prompt can trigger provider routing, retries, sibling failover, replayed session context, subagents, and multiple billing surfaces.

Relevant docs:

- [Agent loop economics](docs/DOCTRINE_AGENT_LOOP_ECONOMICS.md)
- [Founder vision](docs/FOUNDER_VISION_CONTEXTCLAW.md)
- [Control-plane PRD](PRD-CONTROL-PLANE.md)
- [Autocompaction policy PRD](docs/AUTOCOMPACTION_POLICY_PRD.md)

External validation signal: Eric Milgram, PhD (`ScientificProgrammer`) described a real OpenClaw quota cascade on `openclaw/openclaw#64127`. That validates the control-plane/circuit-breaker problem, not ContextClaw compression metrics.

## Future Work

These are intentionally not the first maintainer-review claim:

- task bucket / sticker retrieval;
- auto-rehydration from cold storage;
- multi-agent shared context;
- framework adapters for Claude Code, Codex, Cline, CrewAI, AutoGen, LangChain;
- quality A/B runs against uncompressed baselines;
- provider-billed before/after savings reconciliation.

The first maintainer ask is smaller:

> Does this deterministic `contextEngine` plugin shape fit OpenClaw, and what API or loader changes would make it safer?

## License

MIT
