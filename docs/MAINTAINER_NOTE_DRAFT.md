# Maintainer Note Draft

Subject: Request for feedback on an OpenClaw `contextEngine` guardrail plugin

Hi OpenClaw maintainers,

I built a small OpenClaw-first context/spend guardrail plugin and would value feedback on the plugin shape before trying to make a larger claim.

The narrow ask:

> Does this deterministic `contextEngine` plugin shape fit OpenClaw, and what API or loader changes would make it safer?

What ContextClaw does today:

- classifies dynamic context by content type;
- keeps system prompts and recent conversation hot;
- trims stale bulky tool/file/config/error/media payloads before the model call;
- cold-stores removed content locally;
- writes a request ledger with prompt/context hashes, model/profile metadata, pricing snapshot, estimated tokens, estimated spend, chars saved, and truncation count.

What I am not claiming:

- provider-billed before/after savings;
- quality equivalence against an uncompressed baseline;
- multi-agent shared context;
- automatic rehydration;
- adapter behavior outside OpenClaw.

Current evidence:

- One OpenClaw-native `proceed` workflow after enabling ContextClaw as the `contextEngine` and restarting the gateway.
- 10 post-baseline ContextClaw assemblies in the same session.
- 436,460 estimated input tokens after compression.
- 3,854,677 chars saved.
- 749 ledger-recorded truncations.
- $1.6166 estimated compressed-prompt spend.
- $2.89 estimated savings.

Those are estimate/receipt metrics, not provider-billed measurements.

Pointers:

- README: `README.md`
- Evidence packet: `docs/openclaw-dogfood-2026-05-12.md`
- Measurement definitions: `docs/MEASUREMENT.md`
- Maintainer triage: `docs/MAINTAINER_TRIAGE_2026-05-12.md`

The question I would most like answered is whether this belongs as a `contextEngine` plugin, or whether OpenClaw should expose a different preflight/context assembly surface for this class of guardrail.
