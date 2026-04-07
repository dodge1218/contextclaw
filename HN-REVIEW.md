# ContextClaw — Critical HN Review (Head of Anthropic Lens)

## Self-Assessment: Would This Survive HN?

### What Works
1. **Real problem statement** — "AI agents silently accumulate garbage in context" resonates with every dev hitting 429s
2. **Content-type classification** — genuinely novel insight vs naive recency/relevance scoring
3. **82.6% avg reduction** — impressive benchmark number IF it holds under scrutiny
4. **36 plugin tests + 30 core tests** — shows engineering rigor
5. **MIT license** — no strings attached

### What Would Get Ripped Apart

#### 1. "82.6% reduction" — Where's The Methodology?
HN's first question: "Compared to what baseline? How many sessions? What workloads?"
- **Current state**: `eval/benchmark.js` runs against synthetic scenarios, not real production sessions
- **Fix needed**: Real eval against 10+ diverse sessions with published methodology
- Show: before/after token counts per turn, not a single aggregate number
- Without this, it's marketing masquerading as engineering

#### 2. The Plugin Only Runs Inside OpenClaw
HN: "Cool, but I use LangChain / Cline / raw API calls."
- **Current state**: Tightly coupled to OpenClaw's assemble() hook
- `@contextclaw/core` exists in packages/core but it's a different architecture than the plugin
- The plugin IS the working code. The core package is an aspirational monorepo.
- **Fix**: Either honest about OpenClaw-only for v1, or ship a standalone adapter

#### 3. ownsCompaction: false — What Does It Actually Do?
If ContextClaw doesn't own compaction and OpenClaw's native compaction already handles 173+ compactions perfectly...
- **Real question**: What's the delta? What does ContextClaw save BEYOND what OpenClaw already does?
- The earlier internal review found this was initially unclear
- **Must prove**: Run ContextClaw vs native-only over 50+ turns, show the difference

#### 4. "Classify + Truncate" Is Not Novel
Senior engineers will say: "This is just content-aware truncation. I could write this in 200 lines."
- They're right for the plugin (classifier.js + policy.js = ~400 lines)
- **Counter**: The value isn't the code — it's the policy decisions and tested defaults
- Need to position as "we tested what retention policies actually work" not "we invented classification"

#### 5. The Studio Dashboard Is Vaporware
- `studio/src/Dashboard.tsx` exists but is it functional?
- WS telemetry broadcasts to nothing if Studio isn't running
- **Either ship it or remove it** — HN hates half-baked features

#### 6. No Real-World Testimonial / Dogfooding Data
- Is ContextClaw running on THIS OpenClaw instance right now?
- What are the actual savings over the last 24 hours?
- "We use it ourselves" with real numbers >> any synthetic benchmark

### The Honest Positioning That Would Work on HN

**Don't say:** "ContextClaw saved 82.6% on token costs"
**Say:** "We classified 11 types of LLM context and discovered that tool outputs (file reads, command results) are 80%+ of token waste. Here's our open-source policy engine with tested defaults."

**The story:**
1. We burned $X running AI agents 24/7
2. We noticed context was full of stale Dockerfiles and old command output
3. We classified what types of content sit in context and for how long
4. Here's what we found (data table)
5. Here's the open-source engine with sane defaults

**This positions it as research/insight, not product marketing.**

### Priority Fixes Before HN Post

1. **P0: Real dogfooding data** — Enable ContextClaw on this OpenClaw, collect 24h of real savings data
2. **P0: Honest README** — "OpenClaw plugin (v1). Standalone adapters coming."
3. **P0: Real eval methodology** — Document exactly how the 82.6% was measured, or re-run with proper methodology
4. **P1: Remove or ship Studio** — Don't leave dead UI code
5. **P1: Clarify delta vs native compaction** — Show what ContextClaw adds beyond OpenClaw's built-in
6. **P2: Per-prompt savings display** — Nice for screenshots but not critical for HN credibility
7. **P2: Content-type breakdown blog post** — "What's actually in your LLM context window" data analysis

### Verdict
**Not ready for HN yet.** The code quality is there (B+), but the positioning is soft. The benchmark is synthetic. The "82.6%" claim without rigorous methodology will get called out immediately. 

**What would make it ready:**
- 24h of real dogfooding data with before/after
- Honest "OpenClaw-only for now" positioning
- Show the INSIGHT (content-type analysis) not the PRODUCT (plugin)
- 1-page "what we found" data writeup as the HN post itself
