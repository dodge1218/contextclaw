# ContextClaw Maintainer Proposal

## Executive Summary

ContextClaw is the seatbelt for agentic coding: a model-agnostic preflight and context-governance layer for expensive model calls.

The user-facing pain is simple: **“Why did 4 prompts eat $25?”** That happens when a long-running agent blindly sends stale file reads, giant command logs, browser snapshots, schemas, wrong-topic branches, and retry payloads to premium models. Most vibe coders do not know provider wrappers, retries, context windows, prompt caching, and pricing internals. They learn the hard way.

ContextClaw’s rule is: **do not let raw human prompting hit the most expensive model ungoverned.** Let a cheap deterministic policy, and eventually a cheap model, prepare the prompt for the premium model first.

It is a governor, not a muzzle. ContextClaw must reduce stale/bulky/off-topic context without forcing the premium model into a crippled minimal-output style or hiding what is going on. The goal is to preserve task intent, current evidence, blockers, constraints, and acceptance criteria while removing yesterday’s blast radius.

Technically, ContextClaw is an OpenClaw context-engine plugin that classifies transcript and tool-result content by type, then applies deterministic retention policies before the model call. It keeps recent conversation intact while truncating stale file reads, command output, config dumps, JSON/schema blobs, error traces, and media payloads that no longer need to remain verbatim in dynamic context.

This matters because long agent sessions accumulate large amounts of context that is technically valid but operationally stale. A file read that mattered one turn ago, a long command log where only the exit status and tail still matter, or a repeated config dump can continue consuming model input on every prompt. ContextClaw targets this dynamic middle: not static prompt caching, and not late-session summarization, but deterministic trimming during `assemble()`.

The ask is to review ContextClaw for inclusion as a first-class or community context-engine plugin, and to use the dogfood findings as feedback on the plugin API surface. The plugin is working locally and has been running in production on a Copilot Pro+ subscription since April 5, 2026.

## How It Works

ContextClaw implements the OpenClaw context-engine slot. Its core path is:

```text
messages -> classify content type -> compute turn age -> apply policy -> return lean context
```

The classifier is intentionally simple pattern matching. It does not call an LLM, compute embeddings, score relevance, or attempt semantic summarization. The current implementation defines these content categories:

- `system-prompt`
- `user-message`
- `assistant-reply`
- `tool-file-read`
- `tool-cmd-output`
- `error-trace`
- `config-dump`
- `json-schema-blob`
- `image-media`
- `tool-generic`
- `tool-search-result`

The first ten are the intended public taxonomy for this proposal. The current code also has `tool-search-result` as a specialized tool-output category; it can remain as a distinct type or be folded into `tool-generic` depending on the desired plugin API surface.

Retention policy is per type. Representative defaults:

- System prompts are never touched.
- Recent user messages are preserved; older user messages are shortened.
- Recent assistant replies are preserved; older assistant replies are trimmed.
- File reads are kept full for one turn, then reduced to bookends.
- Command output is kept full for one turn, then reduced to the tail.
- Error traces are kept for two turns, then reduced to the primary error line.
- Config dumps and JSON/schema blobs are kept briefly, then reduced to bookends.
- Image/media payloads are reduced immediately to a pointer.

Truncation extractors are deterministic: `bookends`, `tail`, `pointer`, and `error_line`. The plugin only truncates when the result saves meaningful space, currently more than 20 percent of the original content.

Structural safety is explicit. If a message contains structured content blocks such as `tool_use` or `tool_result`, ContextClaw does not flatten the array and does not alter structural fields. `tool_use.id`, `tool_use.name`, `tool_use.input`, and `tool_result.tool_use_id` are preserved. Truncation happens only inside text/content fields.

Truncated content is flushed to cold storage as JSONL for forensics and possible future rehydration. Each truncation marker includes a nonce, and the cold-storage record preserves role, detected type, timestamp, original character count, action, and original content.

ContextClaw reports `ownsCompaction: false` and delegates compaction back to OpenClaw. It is a context-assembly policy layer, not a replacement for native compaction.

## Evidence

The current efficiency ledger records production dogfood data as of April 15, 2026:

- 4,364,744 characters saved.
- Approximately 1,091,186 tokens saved using the documented `chars / 4` estimate.
- 1,536 messages truncated.
- 45 lifetime `assemble()` calls in the stats file.
- 49 tracked per-call efficiency points.
- Average savings of 100,602 characters, or about 25,151 tokens, per tracked prompt.
- Peak single-call savings of 142,096 characters, or about 35,524 tokens.

The observed behavior matches the design goal: as a session matures, stale tool output and file content are progressively shortened while conversation turns remain present. In the main tracked session, saved context grew from 8,577 characters on the first assemble to roughly 142,000 characters once the session accumulated 170+ messages.

The poisoned-session guardrail document separates ContextClaw behavior from a distinct OpenClaw failure mode: malformed replayed session history. Model errors involving orphaned `tool_use_id`, unmatched `tool_result`, or wrong content block shape can look like context-engine bugs because they surface near `assemble()`. The documented root cause is session history corruption after crash/restart/recovery, not ContextClaw truncation. ContextClaw does not create, delete, reorder, or relabel messages.

The plugin test suite is under `plugin/__tests__/`. It contains 42 source-level test cases across classifier, policy, engine, and tool-safety coverage, including 6 tool-safety tests. The current `npm run test:plugin` command passes in this checkout. Node's runner reports the four test files as passing:

```text
classifier.test.js
engine.test.js
policy.test.js
tool-safety.test.js
```

The tool-safety tests verify that:

- `tool_use` IDs are never modified by `assemble()`.
- `tool_use` and `tool_result` remain paired after truncation.
- `tool_use.name` and `tool_use.input` are preserved exactly.
- Truncation markers do not bleed into structural fields.
- Message count is preserved.
- Message roles are preserved.

## What ContextClaw Does Not Do

ContextClaw does not rewrite, summarize, rephrase, or semantically alter message content. It truncates oversized stale content according to deterministic policies and leaves markers plus cold-storage records.

ContextClaw does not manage the session-history lifecycle. OpenClaw remains responsible for session files, replay, recovery, and compaction. ContextClaw only receives the message array passed to `assemble()` and returns a leaner message array.

ContextClaw does not cause `tool_use` / `tool_result` pairing errors. If a model rejects a prompt because a tool result lacks a matching tool use, the likely failure domain is session replay or session-file integrity. ContextClaw preserves pairing fields and content block structure.

ContextClaw does not touch auth, model routing, or provider selection as part of context compression. The repository has provider quota-rotation utilities, but that is separate from the context-engine compression path proposed here.

## Plugin API Feedback

What worked well:

- The `registerContextEngine()` slot model is a good fit for this kind of deterministic context policy.
- The `assemble()` boundary gives the plugin enough information to classify, truncate, estimate tokens, and return a normalized message set.
- `ownsCompaction: false` allows ContextClaw to coexist with OpenClaw native compaction instead of replacing it.
- The runtime usage API hook is useful when available, because cost estimates can use real pricing rather than heuristic pricing.
- The plugin manifest config schema is enough for path, telemetry, and policy override configuration.

What was painful:

- Plugin-loader compatibility issues were hard to diagnose. A previous local version used top-level dynamic imports for `openclaw/plugin-sdk/core` and `openclaw/plugin-sdk/plugin-entry`; the synchronous Jiti load path rejected the top-level `await`, so the plugin never registered.
- Slot resolution did not surface the import failure. OpenClaw honored `plugins.slots.contextEngine = "contextclaw"`, but only `legacy` was registered, causing every agent turn to fail with a context-engine resolution error rather than the actual plugin import error.
- Module caching and loader behavior made repair loops confusing during active plugin development.
- When a critical runtime plugin fails, the error surface is too close to the agent turn and too far from plugin loading.

Specific asks:

- Attach plugin load errors to critical slot resolution. If `contextclaw` is selected as `contextEngine` and plugin import fails, report the plugin import failure directly.
- Add better plugin error isolation for critical slots. Either refuse startup with a clear diagnostic or provide an explicit configured fallback path.
- Add pre-flight validation for tool-call pairing before provider requests. This should validate that `tool_use` and `tool_result` blocks remain paired after session replay and before any model call.
- Provide a non-mutating plugin verification path such as `openclaw plugins verify contextclaw --requires context-engine`.
- Provide safer dry-run behavior for broad repair commands, especially a machine-readable `doctor --dry-run --json` path.

## Installation And Configuration

ContextClaw can be installed as a path-based plugin in `openclaw.json`. A representative configuration is:

```json
{
  "plugins": {
    "entries": {
      "contextclaw": {
        "path": "/absolute/path/to/contextclaw/plugin",
        "enabled": true,
        "config": {
          "coldStorageDir": "~/.openclaw/workspace/memory/cold",
          "wsPort": 41234,
          "enableTelemetry": true,
          "policies": {}
        }
      }
    },
    "slots": {
      "contextEngine": "contextclaw"
    }
  }
}
```

The manifest exposes these configuration options:

- `coldStorageDir`: directory for cold-stored truncated content.
- `wsPort`: local WebSocket telemetry port, default `41234`.
- `enableTelemetry`: enables or disables telemetry broadcast.
- `policies`: per-type policy overrides keyed by content type.

Example policy override:

```json
{
  "policies": {
    "tool-file-read": {
      "keepTurns": 2,
      "maxCharsAfter": 500
    },
    "tool-cmd-output": {
      "tailLines": 30
    }
  }
}
```

Verification steps:

- Run `openclaw plugins list` and confirm the plugin is present and enabled.
- Confirm gateway logs include `ContextClaw context engine registered successfully`.
- Confirm the configured context-engine slot resolves to `contextclaw`, not only `legacy`.
- Run a fresh agent turn and check for ContextClaw `ASSEMBLE` telemetry or gateway log lines showing truncated content by type.
- Inspect `~/.openclaw/.contextclaw-stats.json` for increasing `saved`, `truncated`, and `assembles` counters.
- Inspect the configured cold-storage directory for JSONL records when truncation occurs.

## Inclusion Proposal

ContextClaw is a conservative candidate for a community plugin because its behavior is deterministic, testable, and easy to disable. It does not depend on a model, embeddings, external services, or provider-specific APIs. Its risk surface is concentrated at message-shape preservation, which is already covered by dedicated tool-safety tests.

The main maintainer review areas are:

- Whether the public classifier taxonomy should be exactly ten types or include `tool-search-result`.
- Whether the default retention thresholds are appropriate for a community plugin.
- Whether cold-storage and telemetry defaults should be enabled by default or opt-in.
- Whether OpenClaw should add pre-flight message validation before provider calls.
- Whether critical plugin slot resolution should fail earlier and with clearer diagnostics.

The goal is not to replace OpenClaw native compaction. The goal is to give OpenClaw a small, deterministic context-engine example that reduces dynamic context waste and exposes practical API improvements for plugin authors.

## Premium Model Preflight Principle

ContextClaw also formalizes a safety pattern for multi-model OpenClaw setups: raw human prompting should not blindly hit the most expensive model with the full hot session attached.

The first implementation is intentionally modest. The ledger now exposes a pure `getPremiumPreflightDecision()` helper that can warn or block expensive non-final premium calls when they exceed token/cost thresholds or look like exploratory work. This is not a style constraint and does not force minimal output. It is a preflight warning/guardrail before provider execution.

This is the product line between useful governance and harmful muzzling:

- Good: prevent accidental Opus/GPT-5-class calls carrying stale giant context.
- Good: require preflight for exploratory expensive calls.
- Bad: force the premium model to answer in an opaque minimal style.
- Bad: compress away task intent, evidence, blockers, or acceptance criteria.

The policy should stay auditable: if ContextClaw warns or blocks, it should say exactly why.
