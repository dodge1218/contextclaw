#!/usr/bin/env bash
set -euo pipefail
bash scripts/verify-mission-ledger-persistence.sh
node packages/core/dist/cli.js mission-review --load /tmp/contextclaw-ledger-demo.json --format json | sed -n '1,30p'
