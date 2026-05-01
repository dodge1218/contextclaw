# ContextClaw — PRD

## Vision
The universal context engine for AI agents. Every agent deployment on earth wastes 40-60% of tokens on stale context. ContextClaw eliminates that waste — automatically scoring, evicting, and cold-storing context so agents run at peak intelligence with minimal tokens. 

The endgame: ContextClaw becomes to AI agents what Redis became to web apps — the invisible layer everyone depends on. Ships as an npm package, integrates with every agent framework, and becomes the default context manager for the OpenClaw ecosystem.

## TAM / SAM / SOM
- **TAM:** $50B+ AI infrastructure market (2026), growing 40% YoY. Every LLM API call is a context management problem.
- **SAM:** ~500K active AI agent deployments (OpenClaw, LangChain, CrewAI, AutoGen). Each burns $50-500/mo in wasted tokens.
- **SOM Year 1:** 2,000 OpenClaw users × $0 (OSS) → contributor path to Anthropic OSS Program. Revenue via enterprise support + hosted analytics.

## Why This Wins
- **First-mover in agent context management** — LangChain has memory, nobody has intelligent eviction
- **55% token reduction proven** — real metrics from production usage on Ryan's own agent stack
- **OpenClaw integration** — ships as a plugin, instant distribution to entire ecosystem
- **Unfair advantage:** Ryan IS a power user building the tool he needs. Dogfooding at extreme scale.

## Revenue Path
1. Open source → adoption → contributor reputation
2. Anthropic OSS Program acceptance → funding + visibility
3. Enterprise tier: hosted context analytics dashboard, team-level token optimization
4. Long-term: context-as-a-service API ($0.001 per context decision)

## Acceptance Criteria
- [ ] `npm install contextclaw` works from public registry
- [ ] 55% token reduction verified on benchmark suite
- [ ] Plugin integrates with OpenClaw in <5 lines of config
- [ ] Cold storage + rehydration works across sessions
- [ ] README has architecture diagram + benchmarks
- [ ] Anthropic OSS Program application submitted
- [ ] 100+ GitHub stars in first 30 days

## Current Status
- [x] Core scoring + eviction engine
- [x] cc_rehydrate() for on-demand context recovery
- [x] Production-tested on Ryan's agent stack
- [ ] npm publish
- [ ] Benchmark suite
- [ ] Studio UI (React 19)
- [ ] OpenClaw plugin manifest

## Commands
- Install: `npm install`
- Test: `npm test`
- Build: `npm run build`
