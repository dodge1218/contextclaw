# ContextClaw Workspace Inventory + Anthropic / Claude Code Plan

Saved: 2026-05-03

## 1. Current ContextClaw workspace map

### Claude Code dogfood / plugin-adapter track
- `contextclaw/claude-code/EQUIP_PLAN.md`
  - Main instruction packet for Claude Code to equip itself with ContextClaw.
  - Current stance: read-only sidecar first, no transcript mutation, no Anthropic internals.
- `contextclaw/claude-code/adapter-spec.md`
  - Phase 1 spec for watching Claude Code transcript JSONL files and writing savings receipts.
  - Status: present but currently uncommitted before this note.
- `contextclaw/claude-code/contextclaw_claude_watcher.py`
  - Python watcher implementation scaffold / adapter candidate.
  - Status: present but currently uncommitted before this note.
- `contextclaw/logs/claude-code-savings-ledger.jsonl`
  - Receipt ledger for Claude Code runs.
  - Current status: scaffolded, needs real entries from at least 3 sessions.
- `contextclaw/logs/claude-code-weekly-summary.md`
  - Weekly rollup file for article numbers.
  - Current status: not started / zeroed until watcher runs.

### Article / content track
- `contextclaw/articles/contextclaw-claude-code-case-study-draft.md`
  - Hook: “I saved $553 by making my AI agent show me what context it was wasting.”
  - Current status: placeholder; must add verified Claude Code receipts before publishing.
- `contextclaw/notes/claude-code-article-next-steps.md`
  - Saved checklist for the week.
- `contextclaw/PRD-ADDITIONS.md`
  - Contains content/growth backlog:
    - Show HN post: “I built a context manager that saved 82.6% on token costs.”
    - Per-prompt savings widget screenshot.
    - Split packages/adapters.
    - Do not spam-post articles; build in advance and schedule.
- `contextclaw/HN-REVIEW.md`
  - Likely review/scratch for Hacker News positioning.
- `contextclaw/assets/tui-tokens-saved.png`
  - Screenshot asset for proof/social.

### OpenClaw/plugin/product track
- `contextclaw/plugin/`
  - Production OpenClaw plugin area.
  - Current limitation: actual provider usage reconciliation needs post-call provider usage hook / callback.
- `contextclaw/docs/CONTEXTCLAW_LORE_FOR_OPENCLAW_MAINTAINERS.md`
  - Maintainer-facing story for OpenClaw plugin safety and dogfooding.
- `contextclaw/docs/MAINTAINER_PROPOSAL.md`
  - OpenClaw maintainer proposal artifact.
- `contextclaw/docs/PRD-SPEND-ATTRIBUTION-LEDGER.md`
  - Spend ledger PRD.
- `contextclaw/docs/PRD-PREMIUM-PREFLIGHT-SEATBELT.md`
  - ContextClaw as preflight/seatbelt/governor, not mere savings toy.
- `contextclaw/docs/PREDICTABLE_SPEND_MODEL.md`
  - Spend predictability / budget control framing.
- `contextclaw/docs/EFFICIENCY_LEDGER.md`
  - Savings/efficiency proof docs.
- `contextclaw/WORK-IN-PROGRESS.md`
  - Current implementation backlog. Notes OpenClaw plugin compatibility / provider usage limitations.
- `contextclaw/NEXT_TICKET.md`
  - Immediate dev ticket backlog.

### Eval/proof track
- `contextclaw/eval/results/real-world-eval.md`
  - Existing proof: estimated ~534,899 tokens saved in earlier eval.
- `contextclaw/eval/results/quality-eval.md`
  - Quality tradeoff data.
- `contextclaw/eval/results/summary.md`
  - Eval summary.

## 2. ContextClaw TODO list

### P0, this week, article proof
1. Have Claude Code finish/verify its own read-only ContextClaw watcher.
2. Run watcher on at least 3 real Claude Code sessions.
3. Populate `logs/claude-code-savings-ledger.jsonl` with receipts.
4. Update `logs/claude-code-weekly-summary.md`.
5. Manually sanity-check:
   - token math,
   - price math,
   - repeated-pass assumptions,
   - no secrets in receipts,
   - examples are scrubbed,
   - claims distinguish OpenClaw-proven vs Claude-Code-estimated.
6. Update article draft with real Claude Code numbers.
7. Draft Anthropic cold email / maintainer pitch.

### P1, Claude Code plugin/adaptor packaging
1. Package watcher as a clean Claude Code sidecar:
   - `contextclaw-claude watch`
   - `contextclaw-claude summarize-week`
   - `contextclaw-claude receipt <session>`
2. Add config:
   - transcript roots,
   - pricing table,
   - redaction rules,
   - output ledger path,
   - min bloat threshold.
3. Add tests against fixture Claude Code transcripts.
4. Add install docs:
   - pipx/uvx or npm wrapper,
   - local-only/no-upload pledge,
   - read-only default.
5. Add a “Claude Code prompt” that tells Claude Code how to run it on itself.

### P2, OpenClaw / maintainer path
1. Keep OpenClaw plugin claims precise.
2. Fix plugin compatibility only with explicit approval/config discipline.
3. Push maintainer-facing issue/PR around plugin safety, quarantine/promote semantics, usage callback hooks.
4. Use OpenClaw proof as the credibility wedge.

### P3, broader product roadmap
1. Per-turn `$ saved` widget.
2. Spend ledger by project/subagent/model/auth source.
3. JustPaid-style agency/agent-ops control plane.
4. Enterprise dashboard for context hygiene and avoided waste.

## 3. Fiscal incentive analysis

### Why users/startups are aligned
ContextClaw is directly aligned with anyone paying the bill:

- Solo founders: fewer surprise bills, fewer “why did 4 prompts eat $25?” moments.
- Startups like JustPaid: if API spend is $10k-$15k/month, even 20-50% less waste is real runway.
- Agencies: can prove client/project/model spend and reduce margin leakage.
- Internal teams: can reduce waste from agents endlessly refactoring, rereading logs, retrying failed bloated prompts, or dragging stale tool dumps forward.
- Security/research teams: can keep receipts without poisoning future context.

The strongest framing is not “use fewer Claude tokens.” It is:

> Make expensive model usage accountable, auditable, and safer, so teams can scale agent work without losing control of context, budget, or trust.

### Why Anthropic can still be aligned, despite token-revenue tension
There is a surface-level negative incentive: if ContextClaw reduces raw token usage at B2C scale, Anthropic may earn less from waste tokens.

But the deeper alignment is stronger:

1. **Activation and retention beat waste.**
   Surprise bills and 429 loops make users churn, downgrade, or fear agentic workflows. ContextClaw increases confidence to use Claude more often on higher-value work.

2. **Enterprise buyers hate uncontrolled spend.**
   Anthropic’s best customers need governance. A tool that makes Claude Code/API usage auditable helps sell enterprise seats and larger deployments.

3. **Waste is low-quality revenue.**
   Token burn from stale logs, repeated failed tool outputs, giant DOM dumps, and retry loops is not durable value. It creates resentment and support burden.

4. **Context hygiene improves perceived model quality.**
   Bad context makes great models look dumb. Better context management makes Claude feel more reliable.

5. **Claude Code adoption expands if bills are predictable.**
   Teams blocked by budget uncertainty may not adopt agentic coding at all. ContextClaw can increase total legitimate usage by lowering fear and failure.

6. **Anthropic can position this as responsible AI operations.**
   “We help you avoid waste and keep receipts” is trust-building, especially for enterprise and regulated customers.

7. **Native integration can preserve Anthropic economics.**
   Anthropic could expose official hooks/panels while still monetizing high-value work, caching, teams, governance, enterprise, and support.

### Risky framing to avoid
Avoid saying:
- “We will reduce Anthropic revenue.”
- “Claude is wasting money.”
- “Users are being overcharged.”
- “This is an adblocker for tokens.”

Say instead:
- “ContextClaw converts invisible context waste into auditable receipts.”
- “It makes Claude Code safer for long-running real work.”
- “It helps teams scale usage predictably.”
- “It turns context management into trust infrastructure.”

## 4. Anthropic cold email thesis

### Target frame
Not B2C anti-token spend.

Frame as:

> We built a local-first context receipt layer that makes Claude/OpenClaw-style agent sessions cheaper, safer, and more auditable. We want to adapt it properly for Claude Code and maintain the integration in the open.

### Core proof sequence
1. OpenClaw dogfood receipt: current savings claim around ~$553, with compaction receipts.
2. Claude Code sidecar: run read-only on real transcript files.
3. Weekly report: sessions analyzed, estimated tokens saved, estimated dollars saved, bloat classes.
4. Article: public proof, careful claims.
5. Anthropic email: “this is valuable for your internal teams and enterprise customers; we want to help maintain it.”

### Explicit business alignment paragraph
ContextClaw does not try to make Claude usage smaller for its own sake. It makes Claude usage legible. In practice, this should increase high-value usage because teams trust the spend, can explain it internally, and can avoid the failure modes that make agent systems feel reckless.

## 5. What to tell Claude Code next

Paste this into Claude Code:

```text
You are building the Claude Code ContextClaw adapter so Claude Code can dogfood ContextClaw on itself.

Read:
- contextclaw/claude-code/EQUIP_PLAN.md
- contextclaw/claude-code/adapter-spec.md
- contextclaw/notes/contextclaw-workspace-inventory-and-anthropic-plan.md

Goal:
Create a clean local-first sidecar/plugin-style adapter that watches Claude Code transcript JSONL files, estimates context bloat savings, writes scrubbed receipts to contextclaw/logs/claude-code-savings-ledger.jsonl, and updates contextclaw/logs/claude-code-weekly-summary.md.

Constraints:
- Read-only first. Do not mutate Claude Code transcripts.
- Do not modify Anthropic/Claude Code internals.
- No secrets in receipts.
- Label dollar amounts estimated unless tied to billing.
- Produce tests/fixtures if practical.
- Run on at least 3 real local Claude Code sessions if available.
- Update the article draft only after ledger entries exist.

Deliverables:
1. working watcher command or script,
2. adapter README/spec update,
3. populated ledger entries,
4. weekly summary with token/$ estimates,
5. article draft updates with precise claims,
6. a short Anthropic outreach draft that frames this as enterprise trust/spend governance, not anti-token-spend.
```
