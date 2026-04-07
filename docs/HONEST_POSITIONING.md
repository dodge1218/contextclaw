# ContextClaw — What It Is (Honest Version)

## The Problem We Solve

AI coding agents read files, run commands, and dump configs into their context window.
After 20 turns, 80% of context is stale tool output the agent will never look at again.
This causes:
1. **Premature context overflow** → lossy compaction → agent forgets important decisions
2. **Wasted tokens** → you pay for 35K of Dockerfile sitting in context for 40 turns
3. **Slower responses** → more tokens = more latency

## What ContextClaw Does

**A plugin for OpenClaw that classifies every piece of context by content type and applies retention policies.**

That's it. No LLM in the loop. No embeddings. No magic. Pattern matching + time decay.

### Content Types We Detect
| Type | Example | What Happens |
|------|---------|-------------|
| FILE_READ | `cat package.json` output | Truncated to first/last 10 lines after 2 turns |
| CMD_OUTPUT | `npm install` log | Tailed to last 30 lines after 1 turn |
| CONFIG_DUMP | Large YAML/JSON config | Truncated to 200 chars after 1 turn |
| ERROR_TRACE | Stack traces | Kept 2 turns, then truncated |
| JSON_BLOB | Large JSON tool results | Truncated to bookends |
| IMAGE_MEDIA | Base64 images | Replaced with pointer immediately |
| SYSTEM | System prompt | Never touched |
| USER | User messages | Never touched |

### What We DON'T Do
- We don't manage your context window end-to-end (your framework does that)
- We don't replace prompt caching (we're complementary — they handle prefix, we handle mid-conversation)
- We don't do semantic understanding (we don't know if a file read is "important" — we know it's OLD and BIG)
- We don't auto-retrieve evicted content (yet)

## Who This Is For

### Primary: OpenClaw users
Install the plugin. Context bloat drops 42-94%. Sessions last 2-3x longer before compaction. Done.

### Secondary: Agent framework builders
The classification + policy pattern is ~700 lines of JS. Fork it, adapt it, use the same content type taxonomy in your own framework.

### NOT for:
- Direct API users who manually manage their messages array
- Simple chatbots with no tool use
- Anything that doesn't have the "stale tool output" problem

## Why Not Just [X]?

### "Anthropic's prompt caching already does this"
No. Prompt caching saves money on the STATIC PREFIX of your prompt (system prompt, tool definitions). It does nothing about the 35K Dockerfile that's been sitting in your context since turn 3.

### "Just truncate old messages"
That's what naive compaction does. It loses important assistant decisions along with the bloat. ContextClaw classifies WHAT to truncate — tool outputs get aggressive truncation, user messages and assistant decisions are preserved.

### "Anthropic could build this in a week"
Yes. They could. But they haven't, and every provider would need to build their own version. ContextClaw works on ANY provider because it operates at the framework level, not the API level.

## Architecture

```
User message → [OpenClaw Gateway] → [ContextClaw Plugin] → [LLM API]
                                           ↓
                                    1. Classify each message
                                    2. Apply retention policy
                                    3. Truncate stale content
                                    4. Pass cleaned context to LLM
```

The plugin hooks into OpenClaw's `onAssemble` lifecycle — it processes messages BEFORE they're sent to the LLM. Zero latency added (pattern matching, not inference).

## Honest Assessment

### Strengths
- Actually works in production (running on OpenClaw instances now)
- 47 tests passing, real eval pipeline with measured results
- Zero dependencies beyond OpenClaw plugin API
- Tiny footprint (~700 lines plugin, ~1300 lines core library)

### Weaknesses
- Core library (src/) and plugin (plugin/) are not connected — two separate codepaths
- No semantic understanding — can't distinguish "important" file reads from unimportant ones
- Keyword search for cold storage retrieval (not embeddings)
- Single star on GitHub (one Chinese developer, not organic community)
- Classification is regex-based — new tool output formats need manual pattern additions

### What Would Kill Us
- Anthropic/OpenAI adding content-type-aware context management natively
- A framework-level solution from LangChain/CrewAI/AutoGen that does this AND semantic scoring
- OpenClaw building this into core (it's a natural feature for them)

### What Keeps Us Alive
- We're the only ones doing this right now
- The pattern is provider-agnostic (works with Claude, GPT, Gemini, local models)
- The multi-agent shared context protocol (RFC stage) is genuinely novel
- First-mover in a space that every agent framework will eventually need
