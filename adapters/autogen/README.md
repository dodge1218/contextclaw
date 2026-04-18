# ContextClaw AutoGen Adapter 🦀

[![npm version](https://img.shields.io/npm/v/contextclaw-autogen-adapter.svg)](https://www.npmjs.com/package/contextclaw-autogen-adapter)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/dodge1218/contextclaw/blob/main/LICENSE)

> Intelligent context management for Microsoft AutoGen. Reduce token usage by **50-90%** through smart context pruning without losing critical conversational intent.

Context limits and token costs are the biggest bottlenecks when building autonomous agents. The **ContextClaw AutoGen Adapter** intercepts and optimizes message histories before they hit your LLM, ensuring you only pay for the context that actually matters.

---

## ✨ Features

- **✂️ Intelligent Message Truncation:** Automatically identifies and truncates overly verbose tool outputs or system logs.
- **🏷️ Content-Type Classification:** Understands the difference between user prompts, system instructions, and tool outputs.
- **📉 Token Usage Optimization:** Drastically reduces LLM costs and prevents context-window overflow.
- **⚙️ Custom Retention Policies:** Define exactly how many messages of a certain type to keep, and how long they should be.
- **🐛 Debug Mode:** Built-in troubleshooting tools to see exactly what is being pruned and why.
- **🔌 Framework Agnostic:** Designed for AutoGen, but works seamlessly with any standard LLM message array framework.

---

## 📦 Installation

Install the package via npm:

```bash
npm install contextclaw-autogen-adapter
🚀 Quick Start
Get up and running in seconds. Here is the most basic implementation:

JavaScript
import { ContextClawAutoGenAdapter } from 'contextclaw-autogen-adapter';

// 1. Initialize the adapter
const adapter = new ContextClawAutoGenAdapter();

// 2. Your standard message array
const messages = [
  { role: 'user', content: 'Can you analyze this 50MB log file?' },
  { role: 'tool', content: '{ ... massive JSON output ... }' },
  { role: 'assistant', content: 'I have analyzed the file.' },
];

// 3. Prune the context before sending to the LLM
const { messages: leanMessages } = adapter.pruneMessages(messages);

console.log(leanMessages);
🔧 Advanced Configuration
You can customize the adapter's behavior by passing an options object during instantiation. Tailor the retention policies to fit your specific agent's needs.

JavaScript
const adapter = new ContextClawAutoGenAdapter({
  stats: true,      // Enable statistics tracking
  debug: true,      // Enable detailed debug logging
  policies: {       // Define custom retention rules
    FILE_READ: { keep: 2, truncate: 200 },
    CMD_OUTPUT: { keep: 1, truncate: 150 }
  }
});
📖 Usage Examples
Example 1: Extracting Optimization Statistics
Curious how many tokens/characters you are saving? Enable stats and check the output.

JavaScript
const adapter = new ContextClawAutoGenAdapter({ stats: true });

const { messages, stats } = adapter.pruneMessages(conversation);

console.log(`Optimization Complete!`);
console.log(`Messages reduced: ${stats.inputCount} → ${stats.outputCount}`);
console.log(`Total characters saved: ${stats.totalSaved}`);
Example 2: Preparing Context directly for the LLM
If you don't need the stats object and just want the lean array returned directly:

JavaScript
const adapter = new ContextClawAutoGenAdapter();

// Returns just the pruned array, ready to be passed to your LLM API
const leanContext = adapter.prepareContextForLLM(conversation);
📚 API Reference
pruneMessages(messages)
Core function that applies ContextClaw policies to an array of messages.

Parameters:
messages (Array) - Array of standard message objects (must contain role and content).
Returns:
Object - Contains { messages: Array, stats?: Object }.
prepareContextForLLM(messages)
A convenience wrapper around pruneMessages that returns strictly the pruned message array.

Parameters:
messages (Array) - Array of message objects.
Returns:
Array - The optimized array of messages.
analyzeContext(messages)
Analyzes the current context window without modifying it, returning useful size and composition statistics.

Parameters:
messages (Array) - Array of message objects.
Returns:
Object - { totalMessages: Number, totalChars: Number, typeCounts: Object }.
🧪 Testing
This project maintains high test coverage. To run the test suite locally:

bash
npm test
Expected Output:

Text
✔ ContextClawAutoGenAdapter - basic instantiation
✔ ContextClawAutoGenAdapter - pruneMessages returns messages array
✔ ContextClawAutoGenAdapter - handles empty messages
✔ ContextClawAutoGenAdapter - throws on invalid input
✔ ContextClawAutoGenAdapter - preprocessMessages works
✔ ContextClawAutoGenAdapter - analyzeContext returns stats
✔ ContextClawAutoGenAdapter - custom policies work
✔ ContextClawAutoGenAdapter - debug mode works

pass 8
fail 0
📄 License
This project is licensed under the MIT License. See the LICENSE file for details.

Maintained by @dodge1218