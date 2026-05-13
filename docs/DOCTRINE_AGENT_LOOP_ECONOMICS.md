# Doctrine: Agent Loop Economics

Date: 2026-05-12
Status: working doctrine, consolidated from prior memory

## Source Lineage

This is not a new doctrine. It consolidates the existing ContextClaw scope-creep / future-work notes into one maintainer-readable frame:

- `/home/yin/.openclaw/workspace/memory/permanent/contextclaw-v2-vision.md`
- `/home/yin/.openclaw/workspace/memory/permanent/contextclaw-seatbelt-doctrine.md`
- `/home/yin/.openclaw/workspace/memory/permanent/contextclaw-spend-ledger-doctrine.md`
- `/home/yin/.openclaw/workspace/outputs/openclaw-recovery-todo-20260418.md`

Those older notes already had the pieces:

- task bucket / sticker system;
- provider circuit breaker / quota detection;
- "Why did 4 prompts eat $25?";
- governor, not muzzle;
- spend ledger / fiduciary accounting;
- SRE-style routing and circuit breakers before frontier-model usage is safe.

This document names the shared failure mode: agent loops are now economic systems, not just reasoning loops.

## Thesis

The old mental model of an agent loop is wrong.

People still talk like the agent is one model call in a clean loop:

```text
prompt -> model -> tool -> result -> model -> answer
```

That is not how serious agent runtimes behave anymore.

Modern OpenClaw-style agent work is closer to:

```text
human prompt
  -> gateway
  -> model routing
  -> auth profile selection
  -> provider failover
  -> retries
  -> tool calls
  -> subagents
  -> replayed session context
  -> compaction / context assembly
  -> provider billing surfaces
  -> logs, receipts, crashes, recovery
```

The thing that looks like one user prompt can become many paid attempts across providers, models, auth profiles, retries, sibling failovers, and stale context replays.

That is the core issue.

## The Ralph Wiggum Loop

The Ralph Wiggum loop is the naive agent loop:

> I sent a prompt. The model tried. If it failed, it tries again.

That sounds harmless. It is not harmless when the runtime is carrying a large hot context and the failure condition is non-transient.

Examples:

- Provider quota is exhausted for the day or month.
- Billing account cap is hit across sibling models.
- Session replay is malformed and every provider receives the same broken history.
- A tool failure causes the agent to retry with the same giant context.
- Native compaction fires late, after repeated expensive attempts.
- The wrong task branch stays in context and keeps steering future calls.

In that world, "try again" is not a small control-flow choice. It is an economic event.

The loop is not:

```text
try -> fail -> retry
```

It is:

```text
replay large context -> route to premium model -> fail for structural reason
  -> retry with same bad premise
  -> fail over to sibling model sharing same account condition
  -> repeat in another run later
```

That is why the phrase "agent loop" can hide the actual problem. The loop is not only reasoning. It is billing, routing, replay, and state.

## Milgram Signal

Eric Milgram, PhD (`ScientificProgrammer`) gave a clean external example on OpenClaw PR #64127:

- Google Gemini billing account hit a monthly spending cap.
- The gateway produced 26 distinct runIds across a 7-day window.
- Each run repeated the same failover ladder.
- The cascade generated about 390 `RESOURCE_EXHAUSTED` events from one billing condition.
- The missing primitive was host-level memory that this provider/account condition was non-transient.

That is not ContextClaw compression proof. It is control-plane proof.

It shows why agent runtimes need memory around failure classes, provider state, and spend conditions. A model cannot reason its way out of a billing-account cap by being called again with the same giant session.

This maps directly to the older v2 deferred item:

> Provider Circuit Breaker (Quota Detection): track consecutive failures per provider, mark provider as tripped, skip in fallback chain, auto-reset, notify user, expose stats to TUI footer.

Milgram's incident is not the origin of the idea. It is external validation that the old deferred item was pointing at a real runtime failure class.

## Why ContextClaw Exists In This Frame

ContextClaw is not only "make prompts smaller."

The deeper frame is:

> Before an expensive model call, the runtime should know what it is about to spend, why, and whether the call is structurally likely to help.

Compression is one part of that:

- remove stale bulky context;
- preserve current task intent;
- cold-store what was removed;
- emit a receipt.

Circuit breaking is another part:

- detect quota/billing/rate-limit classes;
- stop repeating non-transient failures;
- avoid sibling failover when siblings share the same account condition;
- expose provider death to plugins/status surfaces.

Measurement is another part:

- record the model;
- record the auth profile;
- record estimated context size;
- record pricing snapshot;
- record actual usage when the provider exposes it;
- make retries and subagent spend attributable.

These are all the same doctrine:

> Agent runtimes need a control plane between raw human intent and expensive model execution.

This is the same product identity from the seatbelt doctrine:

> ContextClaw is the seatbelt for agentic coding.

And the same ledger identity from the spend doctrine:

> ContextClaw is a fiduciary ledger for agent work, not just a context reducer.

## Autocompact Is Not Enough

Autocompact solves a different problem.

Autocompact says:

> The context got too full. Summarize it.

But many failures happen before "too full" is the visible issue:

- one giant stale tool result keeps riding along;
- a billing cap makes every sibling retry doomed;
- a malformed replay poisons every provider attempt;
- the user switched tasks and the old task still dominates the window;
- retries happen before anyone sees the bill.

ContextClaw's doctrine is not "summarize harder."

It is:

> Label the state, price the call, trim waste, remember failure classes, and make the runtime explain why it is about to spend.

## User Framing

For users, this is simple:

> Why did four prompts eat $25?

The honest answer is usually not "the model is expensive" by itself.

It is:

- the prompt carried stale context;
- the agent retried;
- the provider failed structurally;
- the fallback ladder amplified the failure;
- the user had no receipt-level view of what happened.

ContextClaw should make that visible.

## Maintainer Framing

For maintainers, the ask should stay narrower:

> Does OpenClaw have the right plugin/runtime surfaces for context and spend guardrails to exist safely?

That means:

- context-engine plugins should fail safely;
- plugin load errors should surface before agent turns;
- provider failure classes should be durable enough to stop cascades;
- usage/pricing data should be observable by control-plane plugins;
- broad repair commands should be dry-run and diffable;
- runtime status should expose what is happening without giant log spelunking.

This is the professional version of the founder thesis.

## Boundary

Do not use the Milgram quota cascade as proof that ContextClaw saves tokens.

Use it as proof that the old agent-loop mental model is economically incomplete.

The ContextClaw dogfood batch proves deterministic preflight compression is working in one OpenClaw workflow.

The Milgram incident proves agent runtimes need durable control-plane memory around provider/account failure states.

Together they support the same direction:

> agent work is no longer one prompt and one answer. It is an economic system, and the runtime needs guardrails.

## What Moves From Scope Creep To Core

The old docs treated several items as deferred or scope-creep. The distinction should now be sharper.

Core for maintainer path:

- deterministic dynamic-context trimming;
- request ledger;
- pricing snapshots;
- compression receipts;
- provider/quota failure observability;
- safe plugin/runtime surfaces.

Still future work:

- task bucket / sticker retrieval;
- knowledge graph memory;
- social efficiency layer;
- full terminal agent / justpaid-style harness;
- auto-rehydration beyond cold-storage pointers.

Provider circuit breaker used to look like v2 scope creep. The Milgram incident makes it a control-plane sibling of ContextClaw, even if it stays implemented in OpenClaw core rather than inside the plugin.
