# Claude Code × ContextClaw Article Push — Next Steps

Saved 2026-05-03.

## Goal
Prove ContextClaw value with a Claude Code dogfood case study, then use it for an Anthropic outreach / maintainer-positioning push.

## Claim discipline
- OpenClaw savings are proven now, including the current ~$553 savings hook.
- Claude Code savings are not proven until the sidecar watcher analyzes real Claude Code transcripts.
- Use “estimated” for token/dollar savings unless matched to actual billing.

## Remaining work
1. Have Claude Code implement the read-only sidecar watcher from `contextclaw/claude-code/EQUIP_PLAN.md`.
2. Run it on at least 3 real Claude Code sessions.
3. Populate `contextclaw/logs/claude-code-savings-ledger.jsonl`.
4. Sanity-check receipts for token math, $ math, no secret leakage, and readable bloat classes.
5. Update `contextclaw/logs/claude-code-weekly-summary.md`.
6. Draft the article in `contextclaw/articles/contextclaw-claude-code-case-study-draft.md`.
7. Send Anthropic outreach using the case-study email draft after Claude Code-specific receipts exist.

## Article hook
“I saved $553 by making my AI agent show me what context it was wasting.”

## Immediate next move
Tell Claude Code to execute `contextclaw/claude-code/EQUIP_PLAN.md` and generate first ledger entries.
