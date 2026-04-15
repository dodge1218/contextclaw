# Poisoned Session History — Detection & Recovery

## What This Document Is

A diagnostic guide for the specific failure mode where OpenClaw replays malformed tool-call history into model APIs, producing errors that look like context engine bugs but are actually session file corruption.

**Audience:** Anyone debugging ContextClaw-related failures, OpenClaw contributors, or the future maintainer proposal.

## The Failure Mode

### Symptoms

1. Model API returns errors mentioning `tool_use_id`, `tool_result`, or `call_id` mismatches.
2. Anthropic models reject prompts with: *"tool_result block(s) do not have corresponding tool_use block(s)"*
3. OpenAI models reject with: *"Invalid value for 'messages': tool call ID not found"*
4. The session was working fine, then stopped working after a crash/restart/recovery.
5. Fresh sessions on the same model work immediately.

### Root Cause

OpenClaw persists session history in `.jsonl` files under `~/.openclaw/agents/main/sessions/`. When a session crashes mid-turn (during a tool call), the session file may contain:

- A `tool_use` block without a matching `tool_result` (the tool never returned)
- A `tool_result` block without a matching `tool_use` (the request was lost)
- Assistant messages where `content` is a raw string instead of the expected array of content blocks
- Duplicate or reordered tool call/result pairs from retry logic

When OpenClaw loads this session file and replays it into the next model call, the model rejects the malformed conversation history.

### Why This Looks Like a Context Engine Bug

ContextClaw's `assemble()` sits between the session history and the model call. When the model rejects the prompt, the error surfaces at the context engine boundary. It's natural to suspect the context engine is corrupting the messages.

**But ContextClaw does not create, delete, or reorder messages.** It only:
- Classifies messages by content type
- Truncates the tail of oversized content strings (adds `[... N chars truncated by ContextClaw ...]`)
- Preserves message structure, roles, tool_use_id, and all metadata

The corruption exists in the session file *before* ContextClaw ever sees it.

## How to Diagnose

### Step 1: Confirm it's session-specific

```bash
# Does a fresh session work?
# In OpenClaw TUI: /new
# Or restart the gateway and let it create a fresh session
```

If fresh sessions work → the problem is in the old session file, not the context engine or model routing.

### Step 2: Inspect the session file

```bash
# Find the active session file
ls -lt ~/.openclaw/agents/main/sessions/*.jsonl | head -5

# Check for orphaned tool calls
python3 -c "
import json, sys

tool_uses = {}
tool_results = {}
orphans = []

for lineno, line in enumerate(open(sys.argv[1]), 1):
    try:
        msg = json.loads(line)
    except:
        continue
    
    role = msg.get('role', '')
    content = msg.get('content', [])
    
    # Handle string content (itself a corruption signal)
    if isinstance(content, str):
        print(f'LINE {lineno}: content is string, not array (role={role})')
        continue
    
    if not isinstance(content, list):
        continue
    
    for block in content:
        if isinstance(block, dict):
            if block.get('type') == 'tool_use':
                tid = block.get('id', '')
                tool_uses[tid] = lineno
            elif block.get('type') == 'tool_result':
                tid = block.get('tool_use_id', '')
                tool_results[tid] = lineno

# Find orphans
for tid, line in tool_uses.items():
    if tid not in tool_results:
        print(f'ORPHAN tool_use: {tid} at line {line} (no matching tool_result)')

for tid, line in tool_results.items():
    if tid not in tool_uses:
        print(f'ORPHAN tool_result: {tid} at line {line} (no matching tool_use)')

if not orphans:
    print('No orphaned tool calls found')
" ~/.openclaw/agents/main/sessions/ACTIVE_SESSION.jsonl
```

### Step 3: Check if ContextClaw truncation caused the mismatch

It shouldn't — ContextClaw truncates content *values*, not message structure. But to verify:

```bash
# Search for ContextClaw truncation markers near tool calls
grep -n 'truncated by ContextClaw' ~/.openclaw/agents/main/sessions/ACTIVE_SESSION.jsonl | head -10

# These markers only appear inside content strings, never in tool_use_id or structural fields
```

If you find a truncation marker inside a `tool_use_id` or `tool_result` structural field, that's a ContextClaw bug — file it. It has never happened.

## How to Recover

### Option A: Start a fresh session (recommended)

```
# In OpenClaw TUI
/new
```

This is the fastest fix. The old session is preserved on disk for forensics.

### Option B: Manually repair the session file

```bash
# Back up first
cp ~/.openclaw/agents/main/sessions/ACTIVE.jsonl ~/.openclaw/agents/main/sessions/ACTIVE.jsonl.bak

# Remove the last N lines (where corruption likely is)
head -n -10 ACTIVE.jsonl > ACTIVE_fixed.jsonl
mv ACTIVE_fixed.jsonl ACTIVE.jsonl
```

This is fragile. Only do it if the session contains critical context you can't reconstruct.

### Option C: Let OpenClaw recover

OpenClaw has session recovery logic that creates `recovered-*` sessions. If the gateway detects a malformed session on restart, it may automatically start a recovery session. Check:

```bash
ls -lt ~/.openclaw/agents/main/sessions/ | grep recovered
```

## What Should Change (Recommendations)

### For OpenClaw Core

1. **Pre-flight validation before model calls.** Before sending conversation history to any model, validate that every `tool_use` has a matching `tool_result` and vice versa. Strip orphans silently or warn in logs.

2. **Session file integrity check on load.** When loading a `.jsonl` session, validate message structure. Flag but don't crash on `content: string` (should be array for assistant messages with tool calls).

3. **Crash-safe tool call journaling.** Write a `tool_use` "intent" record before executing the tool, and the `tool_result` after. On recovery, either replay or discard incomplete tool calls.

### For ContextClaw

1. **Defensive passthrough for tool_use/tool_result blocks.** Already implemented — ContextClaw never modifies tool call IDs or structural fields. But add an explicit assertion/log if a tool_use block enters `assemble()` without a matching tool_result in the same context window.

2. **Log when truncation hits tool-adjacent messages.** If a message immediately preceding or following a tool_use/tool_result is truncated, log it at INFO level so forensics can confirm truncation wasn't involved.

## Key Principle

> **Separate the failure domains.** Context engine problems produce wrong or missing context. Session history problems produce structurally invalid conversations. Model routing problems produce auth/quota/unavailable errors. These are three different bugs with three different fixes. Never conflate them.**

---

*Last updated: 2026-04-15 02:34 EDT*
*Reference: CONTEXTCLAW_LORE_FOR_OPENCLAW_MAINTAINERS.md for the broader plugin story*
