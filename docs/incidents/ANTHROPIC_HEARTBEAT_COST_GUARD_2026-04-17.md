# Anthropic Heartbeat Cost Guard

Date: 2026-04-17

## Incident

OpenClaw was left running with native Anthropic API as the active model. Scheduled heartbeat jobs continued while Ryan was away. The local session log shows repeated `HEARTBEAT_OK` runs where the model produced about 15 output tokens, but each run sent/cache-wrote roughly 67k-81k context tokens.

This makes native Anthropic API unsafe for always-on OpenClaw unless ContextClaw or OpenClaw enforces a cost guard.

## Requirement

ContextClaw must prevent expensive no-op background calls before Ryan can safely use Anthropic API as an always-on model.

Minimum guard behavior:

- Never route `HEARTBEAT_OK` / cron no-op checks through paid frontier models by default.
- If a scheduled/background task would send more than a small context budget, skip, downgrade, or require explicit approval.
- If provider is Anthropic API and task type is heartbeat/cron/reminder, block unless explicitly allowlisted.
- Log skipped calls with reason, estimated context tokens, model, provider, and trigger.
- Prefer local rules or a cheap model for "nothing to do" checks.

## Acceptance

- A closed laptop / idle gateway cannot burn Anthropic credits on repeated full-context heartbeat checks.
- A no-op heartbeat produces either no model call or a cheap-model call with tiny context.
- Anthropic API is reserved for explicit interactive work or allowlisted high-value background jobs.
