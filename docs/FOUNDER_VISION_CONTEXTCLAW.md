# ContextClaw Founder Note

So the obvious question is: why does this matter if every model company is already working on bigger context windows, prompt caching, and native compaction?

Because the waste is not only a model problem. It is a workflow problem.

Long-running agent sessions do not just get bigger. They get polluted. A Dockerfile that mattered 30 turns ago stays in the hot prompt. A 5,000-line test log gets carried forward when the model only needs the exit code and tail. JSON schemas, config dumps, browser snapshots, tool envelopes, stale branches of work, and old errors keep getting re-sent because the runtime has no cheap deterministic layer asking whether this exact payload still deserves premium model attention.

That is the thing ContextClaw is trying to make boring.

## The Caveman Version

Autocompact says:

> The context is too full. Summarize the conversation.

ContextClaw says:

> Before every expensive call, trim the stale junk, keep the real conversation, and write down what changed.

That difference sounds small until you use agents all day.

Autocompact is a cliff. ContextClaw is a governor.

Autocompact happens after the session is already bloated. ContextClaw sits in the preflight path before the model call and asks a simpler question: why are we still paying to send this?

## Why I Think This Can Be Large

If agentic coding becomes normal, context waste becomes infrastructure-level waste.

Not "my prompt was a little too long" waste. More like millions of agent turns replaying stale files, logs, schemas, browser snapshots, retries, and wrong-task context into expensive models because nobody put a meter on the dynamic middle of the prompt.

At small scale, this is annoying. At startup scale, it is margin. At platform scale, it could plausibly be billions of dollars of avoidable token spend over time.

That is not the claim I would send to an OpenClaw maintainer as proof. It is the founder hypothesis. The measured claim has to stay boring: chars removed, truncations recorded, receipts written, cold storage preserved, tests passing.

But the ambition is bigger than a local plugin. The ambition is that every serious agent runtime eventually needs a context governor.

## What We Have Now

ContextClaw currently works as an OpenClaw context-engine plugin.

It classifies transcript and tool context by type:

- system prompts;
- user messages;
- assistant replies;
- file reads;
- command output;
- config dumps;
- JSON/schema blobs;
- error traces;
- media payloads;
- generic tool output.

Then it applies deterministic retention policy. Recent conversation stays hot. Bulky stale tool output gets shortened. Full originals go to cold storage. Each assembly emits a ledger entry so the user can see what happened.

No LLM call. No embedding lookup. No vibe-based relevance scoring.

That is the point. The cheap layer should be cheap.

## The Current Proof

The cleanest current proof is not the big old launch table. It is the recent OpenClaw dogfood batch.

One repeated OpenClaw `proceed` workflow, same session, after restarting with ContextClaw enabled as the context engine:

- 10 post-baseline assemblies;
- 436,460 estimated input tokens after compression;
- 3,854,677 chars saved;
- 749 ledger-recorded truncations;
- $1.6166 estimated compressed-prompt spend;
- $2.89 estimated savings.

Those are estimate/receipt metrics, not provider-billed before/after measurements. That distinction matters. If this is going to survive serious review, the measurement language has to be exact enough that a skeptical maintainer can reproduce it or reject it cleanly.

## The Product Shape

I do not think ContextClaw should be a new agent runtime. OpenClaw is the runtime.

ContextClaw should be the control plane around context and spend:

- deterministic context trimming;
- append-only request ledger;
- per-call pricing snapshots;
- budget gates before expensive calls;
- cold storage for removed context;
- receipts after provider calls when usage is exposed;
- user-facing controls for how aggressive the policy should be.

The UI should be boring too. During `/onboard`, a user should be able to pick a mode:

- Off;
- Light;
- Balanced;
- Aggressive.

Not because users want to think about compaction theory. They do not. They want to know whether their agent is quietly burning credits.

## The Next Layer

The labeling/sticker work is where this gets more interesting, but it should not be the first maintainer pitch.

The local policy MVP can label context by lane, project, task, content type, privacy risk, lifespan, and stale/off-topic state. It can react when the user says the agent is on the wrong task. It can keep the current task hot and turn the old task into a pointer.

That matters because recency is a weak proxy for relevance. In real work, the expensive stale thing is often not old chat. It is one giant tool result from the wrong branch of work.

But the first public proof should stay narrower:

> ContextClaw works inside OpenClaw as deterministic preflight compression with receipts.

Then the founder version can say:

> If that primitive is right, task-aware context routing becomes possible.

## Incentives

There is an awkward platform incentive here.

Users want to spend less. Model providers may not love a tool whose whole job is to reduce unnecessary input tokens. But agent runtimes should be on the user's side. If an agent framework cannot tell a user where their context spend went, that framework is incomplete.

The serious version of this is not "we saved a few dollars locally." The serious version is:

> agent runtimes need fiduciary-style context controls before agent work becomes economically normal.

That is the lane.

## What I Would Show a Maintainer

Not the billion-dollar hypothesis.

I would show:

- the OpenClaw context-engine hook;
- the deterministic classifier/policy path;
- the tool-shape safety tests;
- the dogfood ledger;
- the cold-storage records;
- the exact measurement definitions;
- the CI status.

The ask should be small:

> Does this context-engine plugin shape fit OpenClaw, and what API or loader changes would make it safer?

That is the professional review.

The founder thesis is separate:

> Context windows are becoming an economic surface. ContextClaw is a first pass at making that surface auditable.

I think that is where this is going.
