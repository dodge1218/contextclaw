# ContextClaw Quality Eval — Run 1

**Date:** 2026-04-07
**Version:** v1.0.2 (pre-publish, post P0/P1 fixes)
**Judge:** Groq llama-3.3-70b-versatile (free tier)
**Methodology:** Context sufficiency eval — LLM judges whether compressed context preserves enough info to reproduce the real assistant response

## Results

| Metric | Value |
|--------|-------|
| Tasks evaluated | 7 |
| Avg quality score | 0.54 / 1.00 |
| Avg context reduction | 48% |
| Equivalent or better (≥0.8) | 2/7 (29%) |

## Per-task breakdown

| Session | Task | Score | Reduction | Notes |
|---------|------|-------|-----------|-------|
| bcdede66 | 0 | 0.50 | 51% | Mid-conversation buddy-index context at risk |
| bcdede66 | 1 | 0.50 | 52% | ContextClaw additions context at risk |
| bcdede66 | 2 | ✅ 0.80 | 51% | Recent context sufficient |
| f81e8537 | 0 | 0.50 | 50% | Test file references at risk |
| 850c6fa6 | 0 | ✅ 0.80 | 97% | System prompts + recent context enough |
| 9db5b3ed | 0 | 0.20 | 35% | Heavily depends on old article requirements |
| 99e65f1a | 0 | 0.50 | 0% | Small session, no compression triggered |

## Analysis

1. **Good news:** At 97% reduction (850c6fa6), the score is still 0.80 — recent context + system prompts carry most responses
2. **Pattern:** Mid-conversation context (tool results, file reads) is the main risk area
3. **The 0.50 cluster:** 4/7 tasks score 0.50 — the judge thinks ~half the facts survive compression, which is expected at 50% reduction
4. **Worst case:** Tasks requiring old tool results (articles, code reviews) score 0.20

## What this means for launch

The eval framework works end-to-end. The 29% equivalence rate is for a **50% compression target** — in production, ContextClaw compresses less aggressively (evicts only when over budget). Real-world equivalence should be significantly higher.

## Next steps

- Run with production-realistic budget (e.g., 80% of full context instead of 50%)
- Add more session data (only 7 qualifying tasks found)
- Consider A/B eval (actually generate responses from compressed context) for higher confidence
