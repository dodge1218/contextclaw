# ContextClaw PRD — Finishing Sprint + Additions

## Status: Shipping v1.0 to npm + HN launch

### What's DONE (ship-ready)
- Classifier: 11 content types, 18 tests, Grade A-
- Policy engine: per-type retention, time-decay, truncation, 18 tests, Grade B+
- Plugin shell: assemble() hook, cold storage, WS telemetry, 36 tests passing
- Eval harness: benchmark.js, judge.js, real-world eval, 82.6% avg reduction
- CI pipeline: GitHub Actions, badges
- README: honest positioning, comparison table
- CONTRIBUTING.md, LICENSE (MIT)
- Multi-agent protocol RFC draft

### What MUST be fixed before launch (P0)
1. **Truncation marker spoofing** — use random nonce in markers so LLMs can't be tricked
2. **Stream JSONL parsing** in watcher.ts + analyzer.ts (currently readFileSync → OOM on large sessions)
3. **Score decay** — orchestrator scores on ingest only, never re-scores as context ages. Add age-based decay.
4. **Eviction perf** — evictUntilBudget() re-sorts every iteration. Sort once, pop.

### What SHOULD be fixed before launch (P1)
5. **Dedup watcher/analyzer** parsing into shared utility
6. **Memory store rotation** — evicted files accumulate forever, add cleanup
7. **Log tiktoken fallback** — silent fallback to heuristic means users think they have real counts
8. **Per-prompt savings display** — the "$4.38 saved" inline widget. THIS is the viral screenshot.

---

## Additions from 2026-04-07 Session

### A. Memory Buddy / Session Index (PUBLIC — goes into @contextclaw/core)
**What:** Lightweight session preprocessing that builds a compact searchable index from raw transcripts. Agents never touch raw 50MB session files — they read a 4-12KB index instead.

**Why it belongs in ContextClaw:**
- It IS context management — just at the session/history layer instead of the per-turn layer
- Solves the same problem: "don't ingest 200K tokens when you need 2K of signal"
- Adjacent to cold storage rehydration (v1 already writes to cold, this makes cold searchable)

**Implementation:**
- `icepie_index.py` → port to TS as `@contextclaw/core/indexer`
- Input: session .jsonl / .reset files
- Output: compact markdown index (all prompts, key decisions, topic tags)
- Compression: 300x (4MB sessions → 12KB index)

**Public/Private line:**
- PUBLIC: indexer engine, index format, search API
- PRIVATE: buddy subagent protocol (the spawn-a-free-model-to-hold-context pattern is OpenClaw-specific UX)

### B. Content-Addressable Dedup (PUBLIC — Phase 3 RFC)
**What:** Hash LLM payloads so identical tool outputs / file reads across turns aren't stored or billed twice.
- Already in the open-source strategy as Phase 3
- Not blocking launch — design spec only for now

### C. Sticker/Index System (PUBLIC — v2, post-launch)
**What:** Tag context items with [Project-Task] + ContentType so retrieval is task-scoped instead of recency-scoped.
- Changes context from "last N messages" to "messages relevant to THIS task"
- Designed but not coded. Post-launch feature.

### D. Knowledge Graph Compression (PUBLIC — v3, post-launch)
**What:** Replace evicted messages with concept nodes. 30x compression on "memory."
- Idea stage. Post-launch.

---

## The Public / Private Line (confirmed)

### OPEN SOURCE (ContextClaw npm)
- `@contextclaw/core` — classifier, policy, eviction, budget, scoring, indexer
- `@contextclaw/openclaw-plugin` — adapter for OpenClaw
- `@contextclaw/cline-plugin` — adapter for Cline (post-launch)
- Multi-agent protocol RFC
- Eval harness + benchmarks
- Session indexer (from ICE/PIE)

### PROPRIETARY (never public)
- SOUL.md, memory protocols, business workflows
- Buddy subagent protocol (spawn free model for context retrieval)
- Outreach pipeline, cold email tools
- DreamSiteBuilders funnel automation
- ICE/PIE Layer 2 ranking (competitive advantage)
- MktPeek / Hilbert Space

---

## Launch Checklist
- [ ] P0 fixes (4 items above)
- [ ] npm publish: `contextclaw` package
- [ ] README final pass: honest, technical, not marketing
- [ ] Show HN post: "I built a context manager that saved 82.6% on token costs"
- [ ] Proof: eval results link, not claims
- [ ] Per-prompt savings widget screenshot (the viral moment)

## Post-Launch (Week 1-2)
- [ ] Respond to HN feedback
- [ ] Split monorepo: @contextclaw/core + @contextclaw/openclaw-plugin
- [ ] Session indexer (port icepie_index to TS)
- [ ] Community issue triage

---

## Decisions — 2026-04-07 Evening Session

### We are NOT building framework adapters ourselves
- LangChain, Cline, CrewAI, AutoGen adapters = community-maintained
- README updated with "Wanted: Framework Adapter Maintainers" section
- Core engine is already framework-agnostic — adapter interface is ~50 lines
- We focus on core engine quality, community builds the bridges

### Renamed CLI: `contextclaw` → `cc`
- 2-letter command, less cognitive load
- npm package name stays `contextclaw`, just the bin is `cc`
- Commit: `36d1715`

### Confirmed Build Order (what WE build)
1. **Fix bugs** — content.flatMap crash, token estimate accuracy (P0)
2. **Sticker system (v2)** — task-scoped retrieval, the real innovation
3. **Content-addressable dedup** — hash-based, easy high-impact
4. **Auto-rehydration** — pull from cold storage when agent needs evicted content
5. **Studio dashboard** — only after 1-4 ship + real adoption
6. **Multi-agent protocol** — RFC exists, impl deferred

### Content Publishing Learnings
- Don't spam-post articles. Cron-queue 1/day per platform.
- Dev.to rate limit: 2 posts then 300s cooldown
- Build articles in advance, schedule per platform limits

---

## Ideal Additions (append as ideas come)

_Add future ideas below. Tag with date and source._

- `[2026-04-07]` Per-prompt savings widget — the "$4.38 saved" inline display. Viral screenshot material.
- `[2026-04-07]` Knowledge graph compression (v3) — replace evicted messages with concept nodes. 30x compression.
- `[2026-04-07]` Prompt Vault Chrome extension — clipboard history for agent prompts
- `[2026-04-07]` Session index builder — 300x compression on session history (ICE/PIE port to TS)
