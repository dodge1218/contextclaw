# ContextClaw — Real-World Eval
Tested on 5 actual autonomous agent sessions from production.

| Session | Messages | Input Tokens | Output Tokens | Reduction | Truncated Items |
|---------|----------|--------------|---------------|-----------|------------------|
| 39f56ed3… | 98 | 12,315 | 5,857 | **52.4%** | 19 |
| 39f56ed3… | 81 | 18,471 | 6,300 | **65.9%** | 37 |
| 1b6eaeed… | 77 | 8,682 | 8,402 | **3.2%** | 5 |
| 39f56ed3… | 72 | 16,051 | 5,531 | **65.5%** | 32 |
| 39f56ed3… | 69 | 15,425 | 5,268 | **65.8%** | 31 |
| **Total** | | **70,944** | **31,358** | **55.8%** | |

## What Got Truncated

### 39f56ed3…
- tool-search-result: 10 items truncated
- tool-generic: 7 items truncated
- assistant-reply: 1 items truncated
- tool-file-read: 1 items truncated

### 39f56ed3…
- assistant-reply: 8 items truncated
- tool-search-result: 2 items truncated
- tool-generic: 22 items truncated
- error-trace: 3 items truncated
- tool-file-read: 2 items truncated

### 1b6eaeed…
- tool-file-read: 1 items truncated
- tool-search-result: 4 items truncated

### 39f56ed3…
- assistant-reply: 7 items truncated
- tool-search-result: 2 items truncated
- tool-generic: 18 items truncated
- error-trace: 3 items truncated
- tool-file-read: 2 items truncated

### 39f56ed3…
- assistant-reply: 7 items truncated
- tool-search-result: 2 items truncated
- tool-generic: 17 items truncated
- error-trace: 3 items truncated
- tool-file-read: 2 items truncated

## Re-Read Risk Assessment
Items truncated within 2 turns of a user message referencing the same content could cause re-reads.
- Potential re-read triggers found: **0** across 5 sessions
- ✅ No items truncated within the safety window (2 turns)
