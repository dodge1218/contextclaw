# What ContextClaw Does

ContextClaw is an OpenClaw context engine. Its job is to keep long conversations usable by shortening stale, bulky context before the next model call.

It watches the messages OpenClaw is about to send, classifies each one by type, and applies simple retention rules. Recent material stays full. Older file reads, command output, errors, config dumps, JSON blobs, media, and generic tool output get shortened.

ContextClaw does not decide what is important. It does not summarize. It uses deterministic rules based on message type and age: the same conversation shape gets the same trimming decisions. The small recovery ID in each truncation marker is generated when the marker is written.

## What It Does

- Watches every message in your OpenClaw conversation before the model call.
- Classifies each message as a type, such as file read, command output, error trace, config dump, JSON blob, image/media, or normal chat.
- Keeps recent content in full.
- Shortens older or bulky content according to per-type rules.
- Preserves message roles and tool-call structure, including `tool_use_id` and `tool_result` fields.
- Writes truncated originals to cold storage at `~/.openclaw/workspace/memory/cold/`.
- Adds recovery markers that point back to the full saved content.

## Types It Recognizes

ContextClaw recognizes these message types and handles each one differently:

| Type | What It Means | What Happens |
| --- | --- | --- |
| `SYSTEM` | System prompt and runtime instructions. | Never touched. |
| `USER` | Your messages. | Last 5 user turns stay full; older ones are trimmed to about 300 chars. |
| `ASSISTANT` | Assistant replies. | Last 3 assistant turns stay full; older ones are trimmed to about 500 chars. |
| `FILE_READ` | File contents or source snippets returned by a tool. | Kept for 1 turn, then bookend-truncated so the header and footer remain. |
| `CMD_OUTPUT` | Terminal, build, test, install, or shell output. | Kept for 1 turn, then tailed to the last 20 lines. |
| `SEARCH_RESULT` | Search or fetch results. | Kept for 1 turn, then bookend-truncated. |
| `ERROR_TRACE` | Stack traces, crashes, fatal errors, or common OS errors. | Kept for 2 turns, then reduced to the main error line. |
| `CONFIG_DUMP` | Large config-like JSON, YAML, TOML, or plugin config output. | Kept for 1 turn, then bookend-truncated. |
| `JSON_BLOB` | Large JSON arrays, objects, schemas, or similar blobs. | Kept for 1 turn, then bookend-truncated. |
| `IMAGE_MEDIA` | Images, base64 media, media paths, or media attachments. | Immediately reduced to a pointer; binary content is not cold-stored. |
| `TOOL_GENERIC` | Tool output that does not match a more specific type. | Kept for 2 turns, then bookend-truncated. |

Bookend truncation means ContextClaw keeps the beginning and end of the content and replaces the middle with a marker.

## What It Does Not Do

- It does not summarize or rewrite your conversation.
- It does not call an AI model.
- It does not delete messages; it only shortens message content.
- It does not reorder messages.
- It does not create or remove tool calls or tool results.
- It does not manage OpenClaw session files.
- It does not choose or change the model you are using.

## The Truncation Marker

When ContextClaw shortens content, you will see a marker like this:

```text
[ContextClaw:1a2b3c4d truncated 8421 chars (Run cc_rehydrate("1a2b3c4d") to read full)]
```

The marker tells you:

- `1a2b3c4d` is the short recovery ID for that truncated item.
- `truncated 8421 chars` is how much text was removed.
- `cc_rehydrate("1a2b3c4d")` is the recovery command shown by the marker.

For errors, ContextClaw may replace a long trace with:

```text
[ContextClaw: error summary]
TypeError: example failure
```

Full truncated text is written as JSONL files under:

```text
~/.openclaw/workspace/memory/cold/
```

Each cold-storage record includes the role, detected type, timestamp, original size, action, full content, and recovery ID when one is present.

## Recovering Full Content

Use the recovery ID from the marker:

```js
cc_rehydrate("1a2b3c4d")
```

If you need to inspect cold storage manually, look in:

```bash
ls -lt ~/.openclaw/workspace/memory/cold/
```

The newest files are usually the most relevant. Each `.jsonl` line is one saved truncated item.

## When Things Go Wrong

### "The model rejected my prompt with tool_use errors"

This is usually poisoned session history, not ContextClaw.

Common error text includes `tool_use_id`, `tool_result`, `call_id`, `tool_result block(s) do not have corresponding tool_use block(s)`, or `tool call ID not found`.

Diagnosis:

1. Start a fresh OpenClaw session with `/new`.
2. If the fresh session works, the old session file is probably malformed.
3. Check recent session files under `~/.openclaw/agents/main/sessions/`.
4. Look for orphaned tool calls or tool results in the old `.jsonl` session.

Fast recovery:

```text
/new
```

### "Context engine contextclaw is not registered"

This means OpenClaw selected ContextClaw as the context engine, but the plugin did not register successfully.

Diagnosis:

1. Check gateway logs for ContextClaw startup errors.
2. Look for this success line:

```text
[ContextClaw] context engine registered successfully
```

3. If the log says only `legacy` is available, ContextClaw failed to load before registration.
4. Check the plugin install path and `openclaw.json` plugin configuration.

### "Model says unavailable, cooldown, quota, or provider error"

This is usually provider routing, quota, auth, or model availability, not ContextClaw.

Diagnosis:

1. Try a fresh session with a known-working model.
2. Check provider status, credentials, quota, and configured fallbacks.
3. Check gateway logs for provider cooldown or rotation messages.

ContextClaw may report provider health or cooldown state, but it is not the source of provider availability.

## Configuration

ContextClaw is configured through the `plugins` section of `openclaw.json`.

The important slot is:

```json
{
  "plugins": {
    "slots": {
      "contextEngine": "contextclaw"
    }
  }
}
```

The plugin also accepts config values from its plugin entry:

```json
{
  "coldStorageDir": "~/.openclaw/workspace/memory/cold",
  "wsPort": 41234,
  "enableTelemetry": true,
  "policies": {}
}
```

You can customize:

- `coldStorageDir`: where full truncated content is saved.
- `wsPort`: the local WebSocket telemetry port.
- `enableTelemetry`: whether ContextClaw broadcasts local telemetry.
- `policies`: per-type retention policy overrides.

## Verifying It Is Running

Check gateway logs for:

```text
[ContextClaw] context engine registered successfully
```

During active use, ContextClaw also logs truncation summaries like:

```text
[ContextClaw] tool-file-read: 1 truncated (8421 chars saved)
```

You can also check the lifetime stats file:

```bash
cat ~/.openclaw/.contextclaw-stats.json
```

If `saved`, `truncated`, or `assembles` increase over time, ContextClaw is processing model context.
