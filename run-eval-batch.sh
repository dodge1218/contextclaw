#!/bin/bash
# Run ContextClaw quality eval at two budget levels and write results
set -e
cd /home/yin/.openclaw/workspace/contextclaw/packages/core

export GROQ_API_KEY=$GROQ_API_KEY

echo "=== Run 1: 80% budget (production-realistic) ==="
node -e "
import { runQualityEval } from './dist/eval/runner.js';
await runQualityEval({
  maxSessions: 20,
  tasksPerSession: 5,
  budgetPct: 0.8,
  outputPath: '../../eval/results/quality-eval-80pct.json',
  judgeModel: 'llama-3.3-70b-versatile',
  judgeApiBase: 'https://api.groq.com/openai/v1',
  judgeApiKey: process.env.GROQ_API_KEY,
  verbose: true,
});
"

echo ""
echo "=== Run 2: 50% budget (stress test) ==="
node -e "
import { runQualityEval } from './dist/eval/runner.js';
await runQualityEval({
  maxSessions: 20,
  tasksPerSession: 5,
  budgetPct: 0.5,
  outputPath: '../../eval/results/quality-eval-50pct.json',
  judgeModel: 'llama-3.3-70b-versatile',
  judgeApiBase: 'https://api.groq.com/openai/v1',
  judgeApiKey: process.env.GROQ_API_KEY,
  verbose: true,
});
"

echo ""
echo "=== Done. Results in eval/results/ ==="
