#!/usr/bin/env bash
set -euo pipefail
npx tsc -p packages/core/tsconfig.json --noEmit
npx vitest run packages/core/src/__tests__/mission-ledger.test.ts
npm run build >/tmp/cc_build.log
node packages/core/dist/cli.js mission-demo --save /tmp/contextclaw-ledger-demo.json | sed -n '1,40p'
test -s /tmp/contextclaw-ledger-demo.json
node -e "const s=require('/tmp/contextclaw-ledger-demo.json'); console.log(s.missions.length, s.artifacts.length, s.passes.length)"
