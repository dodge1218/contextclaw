#!/usr/bin/env node

import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RequestLedger } from '../plugin/ledger.js';

const dir = mkdtempSync(join(tmpdir(), 'contextclaw-control-plane-demo-'));
const ledgerPath = join(dir, 'ledger.jsonl');

const ledger = new RequestLedger({
  path: ledgerPath,
  pricing: {
    'demo/main-cheap': { input: 0.5, output: 1.5 },
    'demo/subagent-premium': { input: 5, output: 25 },
    'demo/main-cheap-new-price': { input: 2, output: 6 },
  },
});

const main = ledger.recordEstimate({
  sessionKind: 'main',
  sessionKey: 'demo-main-session',
  missionId: 'demo-control-plane',
  modelId: 'demo/main-cheap',
  messages: [{ role: 'user', content: 'Plan the ContextClaw control-plane proof.' }],
  estimatedInputTokens: 20_000,
  estimatedOutputTokens: 1_000,
});

const subagent = ledger.recordEstimate({
  sessionKind: 'subagent',
  sessionKey: 'agent:orchestrator:subagent:demo',
  parentSessionKey: 'demo-main-session',
  childSessionKey: 'agent:orchestrator:subagent:demo',
  agentId: 'orchestrator',
  runId: 'demo-run-1',
  missionId: 'demo-control-plane',
  modelId: 'demo/subagent-premium',
  messages: [{ role: 'user', content: 'Verify the control-plane proof with a premium reviewer.' }],
  estimatedInputTokens: 50_000,
  estimatedOutputTokens: 2_000,
});

const laterMain = ledger.recordEstimate({
  sessionKind: 'main',
  sessionKey: 'demo-main-session',
  missionId: 'demo-control-plane',
  modelId: 'demo/main-cheap-new-price',
  messages: [{ role: 'user', content: 'Continue after provider price changed.' }],
  estimatedInputTokens: 20_000,
  estimatedOutputTokens: 1_000,
});

const receipt = ledger.recordReceipt({
  estimateEntry: subagent,
  actualInputTokens: 48_000,
  actualOutputTokens: 1_500,
  actualUsageStatus: 'available',
});

const all = ledger.summarize();
const parent = ledger.summarize({ sessionKey: 'demo-main-session' });

console.log('ContextClaw control-plane ledger demo');
console.log(`Ledger: ${ledgerPath}`);
console.log('');
console.log('Entries:');
for (const entry of [main, subagent, laterMain, receipt]) {
  const cost = entry.costEstimateUsd ?? entry.actualCostUsd ?? 0;
  console.log(`- ${entry.event} ${entry.sessionKind} ${entry.providerModel} cost=$${cost.toFixed(6)} priceHash=${entry.pricingSnapshot?.configHash}`);
}
console.log('');
console.log('Rollup:');
console.log(`- all estimated: $${all.estimatedCostUsd.toFixed(6)}`);
console.log(`- all actual:    $${all.actualCostUsd.toFixed(6)}`);
console.log(`- parent estimated including subagent: $${parent.estimatedCostUsd.toFixed(6)}`);
console.log(`- parent actual including subagent:    $${parent.actualCostUsd.toFixed(6)}`);
console.log('');
console.log('Proof:');
console.log('- The two main entries use different captured pricing snapshots.');
console.log('- The subagent remains separately visible but rolls up to the parent session.');
console.log('- Historical totals are the sum of entry costs, not lifetime tokens multiplied by one current price.');
