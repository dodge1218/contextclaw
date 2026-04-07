# ContextClaw — Real Session Eval
Date: 2026-04-07

## Methodology
- Input: `.reset` files (pre-compaction session backups, full uncompacted conversation)
- Process: `ContextClawEngine.assemble()` on each session
- Metric: character reduction (input vs output), truncation count
- No synthetic data. These are real agent sessions.

## Results

| Session | Messages | Original | Output | Reduction | Truncated |
|---------|----------|----------|--------|-----------|-----------|
| 0c6a999e-2edc-43 | 681 | 870,819 | 185,702 | **78.7%** | 166 |
| 0c6a999e-2edc-43 | 253 | 464,918 | 108,038 | **76.8%** | 37 |
| 0c6a999e-2edc-43 | 190 | 322,912 | 205,981 | **36.2%** | 29 |
| bcdede66-e41f-46 | 688 | 1,208,119 | 227,451 | **81.2%** | 153 |
| **Total** | | **2,866,768** | **727,172** | **74.6%** | |

Est. tokens saved: ~534,899
