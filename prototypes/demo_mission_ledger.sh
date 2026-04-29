#!/usr/bin/env bash
set -euo pipefail

# Run from the repo root:
#   bash prototypes/demo_mission_ledger.sh

export CONTEXTCLAW_DB="${CONTEXTCLAW_DB:-/tmp/contextclaw-demo.db}"
export CONTEXTCLAW_STORE="${CONTEXTCLAW_STORE:-/tmp/contextclaw-demo-artifacts}"
rm -f "$CONTEXTCLAW_DB"
rm -rf "$CONTEXTCLAW_STORE"

CLI="python3 prototypes/contextclaw_mvp.py"
MISSION="mis_demo_review_feed"

$CLI mission "Demo: review-feed governed agent work" \
  --id "$MISSION" \
  --budget 0.05 \
  --sticker DEMO \
  --acceptance "Show one allowed pass, one blocked pass, and a review-feed card"

$CLI artifact "$MISSION" \
  --file docs/MISSION_LEDGER_MVP.md \
  --type product-plan \
  --source demo \
  --sticker DEMO \
  --summary "Mission ledger MVP architecture and rationale"

$CLI artifact "$MISSION" \
  --file README.md \
  --type readme \
  --source demo \
  --sticker DEMO \
  --summary "Current public ContextClaw README"

$CLI pass "$MISSION" \
  --role planner \
  --model local/free \
  --artifacts all \
  --prompt "Plan a small README update from these artifacts." \
  --output-tokens 500 \
  --max-spend 0.05 \
  --sticker DEMO

$CLI pass "$MISSION" \
  --role planner \
  --model premium/frontier \
  --artifacts all \
  --prompt "Oversized pass that should be blocked." \
  --output-tokens 100000 \
  --max-spend 0.001 \
  --sticker DEMO-BLOCK || true

echo
$CLI why-blocked "$MISSION"

echo
$CLI review-feed "$MISSION" --limit 2
