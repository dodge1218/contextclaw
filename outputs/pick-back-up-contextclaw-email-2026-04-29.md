Subject: Pick ContextClaw back up: automatic OpenClaw receipt integration

Ryan,

Pick ContextClaw back up from here:

Current state:
- Mission ledger core is implemented in TypeScript.
- CLI can demo, save/load ledgers, review passes, explain blocked passes, approve/reject/revise, record manual receipts, and show variance.
- Premium-unit budgeting is implemented as the Copilot-style predictable spend mental model.
- Manual receipt + cache-aware variance tracking works.
- OpenClaw plugin remains disabled/unsafe until context-engine registration compatibility is fixed.

Next ticket:
- `contextclaw/NEXT_TICKET.md`
- Title: Wire provider/gateway receipts into mission ledger automatically

Next concrete step:
1. Find where OpenClaw exposes actual model usage/cost/cache metadata after a provider call.
2. Map that metadata into `UsageReceipt`.
3. Call `recordReceipt(passId, receipt)` automatically after execution.
4. Keep the manual receipt CLI as fallback.

Useful commands:
```bash
cd /home/yin/.openclaw/workspace/contextclaw
npm run ledger
npm run build
npx vitest run packages/core/src/__tests__/mission-ledger.test.ts
```

Important caveat:
Do not re-enable the ContextClaw OpenClaw plugin yet. The safe state is standalone CLI/core only.

Last good commits:
- `0567ead Add friendly local ledger command`
- `d61024f Add usage receipts and variance tracking`
- `84b91ca Add premium unit budgeting to mission ledger`

Resume with automatic receipt ingestion, not more demo polish.
