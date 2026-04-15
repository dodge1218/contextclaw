# ContextClaw Lore for OpenClaw Maintainers

**Date:** 2026-04-15  
**Audience:** OpenClaw maintainers and plugin/runtime contributors  
**Status:** Local ContextClaw is working again after a plugin-loader compatibility fix.

## Short Version

ContextClaw is a custom OpenClaw context-engine plugin built to reduce dynamic context waste during long agent sessions. It classifies messages by type, applies retention policies, and keeps conversation intent intact while aggressively trimming stale file reads, command output, schema blobs, config dumps, traces, and media payloads.

The sharp lesson from dogfooding was not just "ContextClaw saves tokens." It was this:

OpenClaw needs first-class guardrails for experimental runtime plugins. A broken context-engine plugin should not brick every agent turn, and broad repair commands should not silently rewrite a heavily customized setup back toward generic defaults.

That is the maintainer ask.

## Why ContextClaw Exists

Long agent sessions accumulate context that is technically true but operationally stale:

- A full Dockerfile that mattered one turn ago.
- A 5,000-line command result where only the exit code and last 20 lines matter now.
- JSON schemas and tool definitions repeated far past their usefulness.
- Config dumps where the agent needed one field but carried the entire blob forward.
- Base64 or media envelopes that should become pointers, not payload.

Native compaction helps after the session is already bloated. Prompt caching helps static prefix cost. ContextClaw targets the dynamic middle: the growing transcript and tool-result stream.

The design is intentionally boring:

- No LLM call.
- No embedding lookup.
- No relevance debate.
- No semantic magic.
- Classify content type.
- Apply a deterministic policy.
- Preserve recent conversation.
- Cold-store what gets truncated.

That boring part is the selling point. The agent does not need to "think" about whether a stale file read should stay verbatim forever.

## What It Does

ContextClaw implements OpenClaw's `contextEngine` slot. Its runtime path is:

```text
messages -> classify content type -> compute age -> apply policy -> assemble lean context
```

Representative policy examples:

- `system-prompt`: never touch.
- `user-message`: preserve recent turns, strip older metadata.
- `assistant-reply`: keep recent turns fuller, trim older narration.
- `tool-file-read`: keep briefly, then preserve bookends.
- `tool-cmd-output`: keep briefly, then preserve exit signal and tail.
- `json/schema`: truncate aggressively.
- `config-dump`: keep key signal, drop bulk.
- `image/media`: pointer only, no giant payload.
- `error-trace`: keep while relevant, then reduce to the error line.

It does not own native compaction. In the current plugin it reports `ownsCompaction: false` and delegates compaction back to OpenClaw.

## The Dogfood Incident

On 2026-04-15, OpenClaw was configured to use:

```json
{
  "plugins": {
    "slots": {
      "contextEngine": "contextclaw"
    }
  }
}
```

But the ContextClaw plugin failed before it could register its engine. Every agent turn failed before reply with:

```text
Context engine "contextclaw" is not registered. Available engines: legacy.
```

The plugin was present in config. The load path was present. The install record was present. The problem was runtime registration.

Root cause:

`plugin/index.js` used top-level dynamic imports:

```js
const { buildMemorySystemPromptAddition, delegateCompactionToRuntime } =
  await import('openclaw/plugin-sdk/core');

const { definePluginEntry } =
  await import('openclaw/plugin-sdk/plugin-entry');
```

OpenClaw's plugin loader imports plugin entries synchronously through Jiti. That path rejected the top-level `await` with:

```text
SyntaxError: await is only valid in async functions and the top level bodies of modules
```

Because module evaluation failed, `register(api)` never ran, so this never happened:

```js
api.registerContextEngine('contextclaw', () => new ContextClawEngine(config));
```

OpenClaw then respected the configured slot, tried to resolve `contextclaw`, found only `legacy`, and failed the entire agent turn.

## The Local Fix

The local fix was narrow:

```js
import {
  buildMemorySystemPromptAddition,
  delegateCompactionToRuntime,
} from 'openclaw/plugin-sdk/core';
import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
```

No `openclaw doctor --fix`.
No plugin reinstall.
No config rewrite.

After restarting the gateway, logs showed:

```text
[ContextClaw] context engine registered successfully
[gateway] ready
```

A minimal agent test then reached ContextClaw instead of failing at engine resolution.

## The Bigger Problem

The direct bug was a plugin-loader compatibility bug. The bigger problem was operational safety.

The agent kept trying to "fix" the issue by restoring or relinking ContextClaw in config. That was reasonable from a generic repair perspective, but wrong for a customized runtime. It reintroduced the broken slot before the plugin could actually register.

Separately, broad repair tools are risky in customized OpenClaw setups. In this environment, prior `openclaw doctor --fix` runs rewrote `openclaw.json` from roughly 20KB to 330 bytes. That kind of broad normalization is dangerous when the user is actively developing a custom runtime stack.

The issue is not that repair commands exist. The issue is that agents treat them as safe first moves.

## Maintainer Ask

Please consider these OpenClaw updates:

### 1. Context-engine fallback should fail closed

If `plugins.slots.contextEngine` points at an unregistered engine, OpenClaw should have a safe behavior:

- Preferably refuse startup with a clear plugin-load diagnostic before accepting agent turns.
- Or fall back to `legacy` with a loud warning when configured to do so.
- But do not let every agent turn fail before reply with only `Available engines: legacy`.

The config layer knows the desired slot. The plugin loader knows whether the plugin failed. Those diagnostics should meet before the runner starts.

### 2. Plugin load errors should be attached to slot resolution

If the selected context engine is `contextclaw`, and plugin `contextclaw` failed to import, the error should say:

```text
Context engine "contextclaw" is selected but plugin "contextclaw" failed to load:
SyntaxError: await is only valid in async functions and the top level bodies of modules
```

That would have saved multiple repair loops.

### 3. Doctor should have a dry-run diff path agents can use

Agents need a safe default:

```bash
openclaw doctor --non-interactive --dry-run --json
```

Then they can report exact proposed changes before running a mutating fix.

For customized installs, `doctor --fix` should not be a reflex.

### 4. Config edits should be path-scoped

OpenClaw already supports config helpers. The agentic workflow needs stronger norms and tooling:

- Edit one approved JSON path.
- Show before and after.
- Avoid whole-file rewrites.
- Treat `plugins.*`, `auth.*`, and `gateway.*` as high-risk.

### 5. Experimental plugins need quarantine semantics

A plugin under active development should be able to exist in the workspace without owning a critical runtime slot until it passes a registration check.

Something like:

```json
{
  "plugins": {
    "entries": {
      "contextclaw": {
        "enabled": true,
        "quarantined": true
      }
    },
    "slots": {
      "contextEngine": "legacy"
    }
  }
}
```

Or an equivalent CLI workflow:

```bash
openclaw plugins verify contextclaw --requires context-engine
openclaw plugins promote contextclaw --slot contextEngine
```

## Marketing Angle

ContextClaw is not just a plugin. It is a pattern OpenClaw should encourage:

Build agents that manage their own attention before asking bigger models for more tokens.

This is the frame:

> We should do this more often. Dogfood the runtime, catch the context waste, turn the pain into plugin contracts, and make OpenClaw safer for people pushing custom agent stacks.

ContextClaw makes OpenClaw feel less like a chat wrapper and more like an operating environment for long-running agents. That environment needs memory, policy, repair discipline, and runtime safety rails.

## Current Local Status

As of 2026-04-15:

- ContextClaw plugin import has been fixed locally.
- Gateway restart loaded the plugin.
- Logs showed `context engine registered successfully`.
- `openclaw health --json` returned `ok: true`.
- A test turn no longer failed with `Context engine "contextclaw" is not registered`.

Remaining caution:

- Do not run `openclaw doctor --fix` as a generic repair.
- Do not run `openclaw plugins install` or relink ContextClaw unless explicitly requested.
- Do not change `plugins.slots.contextEngine` without verifying the engine registers.

## Suggested Maintainer Message

Hi OpenClaw maintainers,

I am dogfooding a custom context-engine plugin called ContextClaw. It classifies transcript/tool context by content type and trims stale dynamic context before the model call. The plugin is useful, but it exposed a runtime safety issue.

When the plugin failed to import, OpenClaw still honored `plugins.slots.contextEngine = "contextclaw"`, then every agent turn failed before reply because only `legacy` was registered. The underlying plugin error was a top-level `await` incompatibility with the synchronous plugin loader, but the visible error was only:

```text
Context engine "contextclaw" is not registered. Available engines: legacy.
```

The larger ask is better safety for experimental runtime plugins:

- Surface plugin import failures directly during context-engine slot resolution.
- Provide safe fallback or startup refusal when a selected critical slot is unregistered.
- Add a dry-run diff path for `doctor --fix`.
- Encourage path-scoped config edits instead of broad repair rewrites.
- Support quarantine/promote semantics for plugins that are installed but not yet trusted to own a critical slot.

ContextClaw is a good example of where OpenClaw can lead: agent runtimes should manage attention, not just chase larger context windows.

