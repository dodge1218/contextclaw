#!/usr/bin/env bash
set -euo pipefail
npm run ledger > /tmp/contextclaw-friendly-ledger.out
grep 'No model was called' /tmp/contextclaw-friendly-ledger.out
grep 'Allowed pass:' /tmp/contextclaw-friendly-ledger.out
grep 'Blocked pass:' /tmp/contextclaw-friendly-ledger.out
cat /tmp/contextclaw-friendly-ledger.out
