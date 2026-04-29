# NEXT_TICKET: Wire provider/gateway receipts into mission ledger automatically

## Category
🔴 CRITICAL after manual receipt review.

## Why
Manual receipts and variance tracking now work. The next step is automatic receipt ingestion from OpenClaw/gateway/provider usage metadata after a pass executes.

## Scope
- Identify where OpenClaw exposes actual usage/cost/cache data for a model call.
- Map usage metadata into `UsageReceipt`.
- Call `recordReceipt(passId, receipt)` after execution.
- Preserve framework-agnostic core. Integration code should live outside the core ledger.

## Acceptance criteria
- A saved ledger can record actual provider/gateway usage without manual CLI entry.
- Review card shows estimate vs actual.
- Variance warning appears when actual cost materially exceeds estimate.
- No unsafe ContextClaw plugin re-enable until registration compatibility is fixed.

## Constraints
- Do not claim automatic provider receipts are implemented before this is wired.
- Keep manual receipt CLI as fallback.
