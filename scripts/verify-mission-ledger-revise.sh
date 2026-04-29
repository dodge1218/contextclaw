#!/usr/bin/env bash
set -euo pipefail
npx tsc -p packages/core/tsconfig.json --noEmit
npx vitest run packages/core/src/__tests__/mission-ledger.test.ts
npm run build >/tmp/cc_build.log
node packages/core/dist/cli.js mission-demo --save /tmp/contextclaw-ledger-revise.json >/tmp/contextclaw-revise-demo.out
PASS_ID=$(node -e "const s=require('/tmp/contextclaw-ledger-revise.json'); const p=s.passes.find(p=>p.decision==='blocked'); if(!p) process.exit(1); console.log(p.id)")
node packages/core/dist/cli.js mission-revise --load /tmp/contextclaw-ledger-revise.json --pass "$PASS_ID" --prompt "smaller bounded follow-up pass" --output-tokens 200 --max-spend 0.05 | sed -n '1,80p'
node -e "const s=require('/tmp/contextclaw-ledger-revise.json'); const p=s.passes.at(-1); if(p.decision!=='allowed') process.exit(1); console.log(p.decision)"
