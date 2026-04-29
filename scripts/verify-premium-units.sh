#!/usr/bin/env bash
set -euo pipefail
npx tsc -p packages/core/tsconfig.json --noEmit
npx vitest run packages/core/src/__tests__/mission-ledger.test.ts
npm run build >/tmp/cc_build.log
node packages/core/dist/cli.js mission-demo > /tmp/contextclaw-premium-units.out
grep 'estimatedPremiumUnits' /tmp/contextclaw-premium-units.out | head
