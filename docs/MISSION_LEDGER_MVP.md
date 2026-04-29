# ContextClaw Mission Ledger MVP

ContextClaw is expanding from real-time context compression into **cost defense with memory for agentic work**.

The original plugin answers: "what stale content should not be resent?"

The mission-ledger MVP answers the next question: "how do we keep delegated agent work moving without repeatedly sending the entire world, losing task identity, or leaking money through invisible retries?"

## Core primitives

### Mission
The unit of delegated work.

A mission has an objective, owner, acceptance criteria, state, total budget, remaining budget, and a task sticker.

### Artifact
Durable context outside the prompt.

Artifacts can be notes, source files, command outputs, plans, transcripts, evidence, or summaries. Each gets a content hash, token estimate, summary, source, sensitivity, and sticker.

### Pass
One bounded model/tool invocation.

A pass records role, model, selected artifacts, assembled-context hash, prompt hash, estimated input/output tokens, estimated spend, budget decision, and manifest.

### Budget governor
The firewall before provider spend.

It blocks a pass when the pass budget or mission budget would be exceeded. Future gates should also block repeated retry loops, unknown premium-model pricing, and resending large artifacts without justification.

### Review feed
The human approval surface.

Every pass can be rendered as a small review card: what was attempted, what artifacts were included, estimated spend, why it was allowed or blocked, and the next action.

## Current prototype

A local Python CLI prototype lives at:

```bash
prototypes/contextclaw_mvp.py
```

It supports:

```bash
python3 prototypes/contextclaw_mvp.py mission "ContextClaw MVP before security research" --sticker CC-MVP
python3 prototypes/contextclaw_mvp.py artifact mis_contextclaw_mvp --file README.md --sticker CC-MVP
python3 prototypes/contextclaw_mvp.py pass mis_contextclaw_mvp --artifacts all --prompt "Plan next pass" --max-spend 0.05 --sticker CC-MVP
python3 prototypes/contextclaw_mvp.py why-blocked mis_contextclaw_mvp
python3 prototypes/contextclaw_mvp.py review-feed mis_contextclaw_mvp
```

For a clean end-to-end demo that does not touch your local ledger:

```bash
bash prototypes/demo_mission_ledger.sh
```

The demo stores its SQLite DB and artifacts in `/tmp` unless `CONTEXTCLAW_DB` / `CONTEXTCLAW_STORE` are set.

The TypeScript core can also save and inspect JSON snapshots:

```bash
npm run build
node packages/core/dist/cli.js mission-demo --save /tmp/contextclaw-ledger-demo.json
node packages/core/dist/cli.js mission-review --load /tmp/contextclaw-ledger-demo.json
node packages/core/dist/cli.js mission-why --load /tmp/contextclaw-ledger-demo.json
```

See [`MVP_REVIEW_FEED_DEMO.md`](MVP_REVIEW_FEED_DEMO.md) for the first dogfood review-feed output.

## Why this matters

For high-throughput agent work, the bottleneck is not just context-window size. It is operator trust:

- What did the agent use?
- Why did this call cost that much?
- Was this the right task context?
- Did the system resend giant stale artifacts?
- Can the human approve or stop the work without reading a whole transcript?

ContextClaw should make those answers explicit before money is spent.

## Relationship to the existing plugin

The existing OpenClaw plugin remains the compression layer: classify content by type, apply retention policy, and reduce dynamic prompt waste.

The mission ledger sits one layer above it:

```text
Mission ledger / review feed
        ↓
Pass planner + budget governor
        ↓
Artifact selector / context assembler
        ↓
ContextClaw classifier + retention policy
        ↓
Provider call
```

The plugin integration is intentionally not re-enabled in this local environment until the context-engine registration issue is fixed. The MVP is a safe CLI prototype for proving the operating loop first.
