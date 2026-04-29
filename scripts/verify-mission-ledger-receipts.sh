#!/usr/bin/env bash
set -euo pipefail
npx tsc -p packages/core/tsconfig.json --noEmit
npx vitest run packages/core/src/__tests__/mission-ledger.test.ts
npm run build >/tmp/cc_build.log
node packages/core/dist/cli.js mission-demo --save /tmp/contextclaw-ledger-receipts.json >/tmp/contextclaw-receipts-demo.out
PASS_ID=$(node -e "const s=require('/tmp/contextclaw-ledger-receipts.json'); const p=s.passes.find(p=>p.decision==='allowed'); if(!p) process.exit(1); console.log(p.id)")
node packages/core/dist/cli.js mission-receipt --load /tmp/contextclaw-ledger-receipts.json --pass "$PASS_ID" --actual-cost 0.014 --tokens-in 12000 --tokens-out 800 --cache-read 9000 | sed -n '1,90p'
node packages/core/dist/cli.js mission-variance --load /tmp/contextclaw-ledger-receipts.json --pass "$PASS_ID"
