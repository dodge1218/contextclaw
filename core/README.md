# contextclaw

Stop sending Dockerfiles to your LLM 30 turns after you read them.

Content-type classification and retention policies for LLM context windows. Works with any framework — OpenAI, Anthropic, LangChain, CrewAI, or raw API calls.

## Install

```bash
npm install contextclaw
```

## Usage

```js
import { prune } from 'contextclaw';

// Your existing messages array (OpenAI/Anthropic format)
const { messages: lean } = prune(messages);

// Pass lean to your LLM instead of messages
const response = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages: lean,
});
```

That's it. One function. Your conversation stays intact. File reads, command output, config dumps, and error traces get truncated based on how old they are.

## What it does

Every message gets classified into one of 11 content types, each with its own retention rule:

| Type | Rule |
|------|------|
| `system-prompt` | Never touched |
| `user-message` | Verbatim for 5 turns, then trimmed to 300 chars |
| `assistant-reply` | Verbatim for 3 turns, then trimmed to 500 chars |
| `tool-file-read` | Full for 1 turn, then first+last 100 chars |
| `tool-cmd-output` | Full for 1 turn, then last 20 lines |
| `error-trace` | Full for 2 turns, then error line only |
| `image-media` | Immediately reduced to pointer |
| `config-dump` | Full for 1 turn, then 200 chars |
| `json-schema-blob` | Full for 1 turn, then 500 chars |
| `tool-search-result` | Full for 1 turn, then 300 chars |
| `tool-generic` | Full for 2 turns, then 500 chars |

## With stats

```js
const { messages, stats } = prune(messages, { stats: true });
console.log(`Saved ${stats.totalSaved} chars`);
```

## Custom policies

```js
const { messages } = prune(messages, {
  policies: {
    'tool-file-read': { keepTurns: 2, maxCharsAfter: 500 },
    'tool-cmd-output': { keepTurns: 3 },
  },
});
```

## Step-by-step API

```js
import { classifyAll, computeTurnsAgo, applyPolicy } from 'contextclaw';

const classified = classifyAll(messages);
const turnsAgo = computeTurnsAgo(classified);

classified.forEach((msg, i) => {
  console.log(`${msg._type} (${turnsAgo[i]} turns ago): ${msg._chars} chars`);
});
```

## Real-world results

Tested on 5 production autonomous agent sessions:

| Metric | Value |
|--------|-------|
| Average reduction | 55.8% |
| Best case | 65.9% |
| Re-read triggers | 0 |
| Messages lost | 0 |

## Framework adapters

The core works with any `{ role, content }` message format. Framework-specific adapters:

- **OpenClaw** — built-in plugin at `plugin/`
- **LangChain** — [wanted](https://github.com/dodge1218/contextclaw/issues)
- **CrewAI** — [wanted](https://github.com/dodge1218/contextclaw/issues)
- **Cline** — [wanted](https://github.com/dodge1218/contextclaw/issues)
- **AutoGen** — [wanted](https://github.com/dodge1218/contextclaw/issues)

PRs welcome. The adapter pattern is simple — call `prune()` before sending messages to your LLM.

## License

MIT
