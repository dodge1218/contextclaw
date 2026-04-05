# ContextClaw
## One-liner description
ContextClaw is an OSS tool/plugin for OpenClaw (AI agent framework) that monitors, scores, and evicts context from AI agent sessions to prevent token waste.
## The problem
Real data from our sessions:
- Main session: 195K tokens/turn, 6.3M cache reads across 52 turns
- Subagent sessions: 22-24K tokens/turn (clean baseline)
- 8-9x waste in main session vs focused work
- 150.5M total input tokens in one extended session
## How it works
ContextClaw caps context at 60K, uses compaction on free models (Groq), limits max history share to 40%, and isolates subagents to free models.
## Install/quickstart
1. Install as OpenClaw plugin
2. Set slot
3. Restart
## Benchmarks
| Metric | Before | After |
| --- | --- | --- |
| Tokens/turn | 195K | 22-24K |
| Cache reads | 6.3M | 760K |
## Roadmap
- Content-addressable context
- Scoring
- Cold storage
## License
MIT