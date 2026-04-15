# ContextClaw Compression Examples

ContextClaw proves a narrow claim: deterministic truncation can preserve the information an LLM actually needs while removing stale bulk from the prompt. It does not summarize, rewrite, rank, or infer relevance. It classifies content by type, waits until that content is old enough, then applies a fixed extractor such as bookends, tail lines, an error line, or a media pointer.

The examples below mirror `plugin/policy.js` and `plugin/classifier.js`. Each one shows the original shape, the compressed shape with the ContextClaw marker, and what the model still knows after stale content has been reduced.

## FILE_READ: 200-line JS file to bookends

Policy: `tool-file-read`, full for 1 turn, then first 100 chars + last 100 chars.

**Before**
```js
import { readFile, writeFile } from 'node:fs/promises';
import { classifyAll } from './classifier.js';

const DEFAULT_LIMIT = 2000;

export async function loadSession(path) {
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw);
}

export function normalizeMessages(messages) {
  return messages.map((msg, index) => ({ ...msg, _index: index }));
}

// ... about 180 lines of validation, retry, cache, and helper code ...

export async function saveSession(path, messages) {
  const classified = classifyAll(normalizeMessages(messages));
  await writeFile(path, JSON.stringify(classified, null, 2));
}

export { DEFAULT_LIMIT };
```

**After**
```text
import { readFile, writeFile } from 'node:fs/promises';
import { classifyAll } from './classifier

[ContextClaw:9f2a81bc truncated 6468 chars (Run cc_rehydrate("9f2a81bc") to read full)]

wait writeFile(path, JSON.stringify(classified, null, 2));
}

export { DEFAULT_LIMIT };
```

**What's preserved:** imports, module purpose, visible exported functions, and footer exports.

**What's lost:** middle implementation details. That is acceptable when the file was read in full on the previous turn and the current model mostly needs orientation, not every helper body.

## CMD_OUTPUT: npm install output to tail

Policy: `tool-cmd-output`, full for 1 turn, then last 20 lines.

**Before**
```text
$ npm install
npm http fetch GET 200 https://registry.npmjs.org/@types/node 49ms
npm timing idealTree:init Completed in 18ms
...
npm info run esbuild@0.25.0 postinstall { code: 0, signal: null }

added 129 packages, and audited 130 packages in 7s
28 packages are looking for funding
found 0 vulnerabilities
Process exited with code 0
```

**After**
```text
[ContextClaw:41c0aa12 truncated 83 lines (Run cc_rehydrate("41c0aa12") to read full)]
npm timing build:queue Completed in 3ms
npm info run esbuild@0.25.0 postinstall node_modules/esbuild node install.js
npm info run esbuild@0.25.0 postinstall { code: 0, signal: null }

added 129 packages, and audited 130 packages in 7s
28 packages are looking for funding
found 0 vulnerabilities
Process exited with code 0
```

**What's preserved:** final status, package count, vulnerability result, postinstall status, and process exit code.

**What's lost:** registry fetches, dependency resolution timing, and intermediate install chatter. Those lines rarely affect the next coding step unless the command failed.

## ERROR_TRACE: stack trace to error line

Policy: `error-trace`, full for 2 turns, then first detected error line up to 300 chars.

**Before**
```text
Traceback (most recent call last):
  File "/app/scripts/build.py", line 91, in <module>
    main()
  File "/app/scripts/build.py", line 72, in main
    compile_assets(config)
  File "/app/scripts/build.py", line 44, in compile_assets
    manifest = load_manifest(config.manifest_path)
  File "/app/scripts/build.py", line 19, in load_manifest
    with open(path) as handle:
FileNotFoundError: [Errno 2] No such file or directory: 'dist/manifest.json'
```

**After**
```text
[ContextClaw: error summary]
FileNotFoundError: [Errno 2] No such file or directory: 'dist/manifest.json'
```

**What's preserved:** the failing condition and missing path.

**What's lost:** deep call stack frames. The model still knows what failed and can ask for rehydration if the exact call path becomes necessary.

## CONFIG_DUMP: openclaw.json to bookends

Policy: `config-dump`, full for 1 turn, then first 100 chars + last 100 chars.

**Before**
```json
{
  "pluginApi": 1,
  "minGatewayVersion": "0.4.0",
  "plugins": {
    "contextclaw": {
      "enabled": true,
      "retention": {
        "tool-file-read": { "keepTurns": 1, "maxCharsAfter": 200 },
        "tool-cmd-output": { "keepTurns": 1, "tailLines": 20 },
        "error-trace": { "keepTurns": 2, "maxCharsAfter": 300 }
      },
      "telemetry": { "efficiencyLedger": true, "costHeuristicUsdPerMTok": 3 },
      "debug": false
    }
  },
  "providers": { "copilot": { "models": ["gpt-5.4", "claude-sonnet-4.6"] } }
}
```

**After**
```text
{
  "pluginApi": 1,
  "minGatewayVersion": "0.4.0",
  "plugins": {
    "contextclaw"

[ContextClaw:5e8fb420 truncated 512 chars (Run cc_rehydrate("5e8fb420") to read full)]

  "providers": { "copilot": { "models": ["gpt-5.4", "claude-sonnet-4.6"] } }
}
```

**What's preserved:** config shape, plugin location, gateway compatibility, and provider section.

**What's lost:** middle retention and telemetry details. That is acceptable after the first turn because the model can still identify the config and rehydrate it if exact values matter.

## JSON_BLOB: API response to bookends

Policy: `json-schema-blob`, applies to JSON over 2000 chars, full for 1 turn, then first 250 chars + last 250 chars.

**Before**
```json
{
  "object": "list",
  "request_id": "req_abc123",
  "data": [
    { "id": "msg_001", "role": "user", "content": "..." },
    { "id": "msg_002", "role": "assistant", "content": "..." },
    { "id": "msg_003", "role": "tool", "content": "..." }
  ],
  "pagination": { "first_id": "msg_001", "last_id": "msg_250", "has_more": true },
  "usage": { "input_tokens": 184219, "output_tokens": 1137 }
}
```

**After**
```text
{
  "object": "list",
  "request_id": "req_abc123",
  "data": [
    { "id": "msg_001", "role": "user", "content": "..." },

[ContextClaw:6d91e003 truncated 24736 chars (Run cc_rehydrate("6d91e003") to read full)]

  "usage": { "input_tokens": 184219, "output_tokens": 1137 }
}
```

**What's preserved:** response type, request identifier, top-level shape, pagination/usage tail fields, and evidence that the middle is bulk data.

**What's lost:** repeated array entries. The model retains the schema and boundary values without carrying every item.

## IMAGE_MEDIA: base64 image to pointer

Policy: `image-media`, reduced immediately to a pointer or binary-dropped marker.

**Before**
```text
[media attached: /tmp/contextclaw/screenshot-login.png]
data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAoAAAAHgCAYAAAD...
... 384000 more base64 chars ...
```

**After**
```text
[ContextClaw:ab7792d0 media pointer: screenshot-login.png (Run cc_rehydrate("ab7792d0") to read full)]
```

**What's preserved:** the fact that an image existed and the filename pointer.

**What's lost:** raw base64. That is intentional because binary image bytes are expensive prompt content and the image should already have been processed by the model or tool that received it.

## Compression Ratios

Production telemetry in `docs/EFFICIENCY_LEDGER.md` shows an average of 100,602 characters saved per prompt, with mature sessions stabilizing around 140K characters saved per call.

| Type | Typical Input Size | After Truncation | Ratio | Info Retained |
|---|---:|---:|---:|---|
| FILE_READ | 10,000 chars | ~280 chars | ~36:1 | imports, header, footer, exports |
| CMD_OUTPUT | 100 lines / 8,000 chars | last 20 lines / ~1,800 chars | ~4:1 | final status, errors, exit code |
| ERROR_TRACE | 12,000 chars | ~330 chars | ~36:1 | error class/message and failing path |
| CONFIG_DUMP | 6,000 chars | ~280 chars | ~21:1 | config shape and boundary sections |
| JSON_BLOB | 25,000 chars | ~580 chars | ~43:1 | response shape and first/last keys |
| IMAGE_MEDIA | 384,000 chars | ~110 chars | ~3,490:1 | attachment presence and filename |

## Edge Cases

- Small content below the extractor result size is kept unchanged because truncation must save more than 20 percent to apply.
- Recent content is kept verbatim: file reads, command output, config dumps, and JSON blobs stay full for 1 turn; error traces stay full for 2 turns.
- System prompts are never touched.
- `tool_use` and `tool_result` arrays keep their structural fields. ContextClaw truncates only inner `content` or `text` strings, preserving `id`, `name`, `input`, and `tool_use_id` pairing.
- If an error trace has no detectable error line, ContextClaw falls back to bookends instead of inventing a summary.
