#!/usr/bin/env bash
set -euo pipefail
npx tsc -p packages/core/tsconfig.json --noEmit
npx vitest run packages/core/src/__tests__/mission-ledger.test.ts
npm run build >/tmp/cc_build.log
node packages/core/dist/cli.js mission-demo --save /tmp/contextclaw-ledger-reject.json >/tmp/contextclaw-reject-demo.out
PASS_ID=$(node -e "const s=require('/tmp/contextclaw-ledger-reject.json'); const p=s.passes.find(p=>p.decision==='allowed'); if(!p) process.exit(1); console.log(p.id)")
node packages/core/dist/cli.js mission-reject --load /tmp/contextclaw-ledger-reject.json --pass "$PASS_ID" --reason "too broad" | sed -n '1,80p'
node -e "const s=require('/tmp/contextclaw-ledger-reject.json'); const p=s.passes.find(p=>p.id===process.argv[1]); if(p.decision!=='rejected') process.exit(1); console.log(p.decision)" "$PASS_ID"
