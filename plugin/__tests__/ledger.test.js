import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  RequestLedger,
  createPricingSnapshot,
  estimateCostFromSnapshot,
  estimateCostUsd,
  formatReceipt,
  getBudgetGateDecision,
  getPremiumPreflightDecision,
  hashValue,
  inferSessionKind,
  isPremiumModel,
  summarizeLedger,
} from '../ledger.js';

test('hashValue is stable for reordered object keys', () => {
  assert.equal(hashValue({ b: 2, a: 1 }), hashValue({ a: 1, b: 2 }));
});

test('estimateCostUsd uses per-million token pricing', () => {
  const cost = estimateCostUsd('anthropic/claude-opus-4-7', 1_000_000, 100_000);
  assert.equal(cost, 7.5);
});

test('pricing snapshots preserve historical rates per entry', () => {
  const oldSnapshot = createPricingSnapshot({
    modelId: 'custom/frontier',
    pricing: { 'custom/frontier': { input: 2, output: 10 } },
    capturedAt: '2026-01-01T00:00:00.000Z',
  });
  const newSnapshot = createPricingSnapshot({
    modelId: 'custom/frontier',
    pricing: { 'custom/frontier': { input: 20, output: 100 } },
    capturedAt: '2026-02-01T00:00:00.000Z',
  });

  assert.equal(estimateCostFromSnapshot(oldSnapshot, { inputTokens: 1_000_000 }), 2);
  assert.equal(estimateCostFromSnapshot(newSnapshot, { inputTokens: 1_000_000 }), 20);
  assert.notEqual(oldSnapshot.configHash, newSnapshot.configHash);
});

test('RequestLedger writes auditable JSONL request estimates', () => {
  const dir = mkdtempSync(join(tmpdir(), 'contextclaw-ledger-'));
  const ledgerPath = join(dir, 'ledger.jsonl');
  const ledger = new RequestLedger({
    path: ledgerPath,
    maxCallsPerPrompt: 2,
    defaultModel: 'anthropic/claude-opus-4-7',
  });

  const entry = ledger.recordEstimate({
    sessionId: 's1',
    sessionKey: 'main-session',
    sessionKind: 'main',
    messages: [{ role: 'user', content: 'please produce final report' }],
    estimatedInputTokens: 1000,
    estimatedOutputTokens: 200,
  });

  assert.equal(entry.schemaVersion, 2);
  assert.equal(entry.sessionKind, 'main');
  assert.equal(entry.provider, 'anthropic');
  assert.equal(entry.model, 'claude-opus-4-7');
  assert.equal(entry.callIndexForPrompt, 1);
  assert.equal(entry.overCallBudget, false);
  assert.equal(entry.premiumFinalPass, true);
  assert.equal(entry.pricingSnapshot.input, 5);
  assert.equal(entry.actualUsageStatus, 'unavailable');

  const lines = readFileSync(ledgerPath, 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).contextHash, entry.contextHash);
});

test('RequestLedger detects duplicate context and call budget overrun', () => {
  const dir = mkdtempSync(join(tmpdir(), 'contextclaw-ledger-'));
  const ledger = new RequestLedger({
    path: join(dir, 'ledger.jsonl'),
    maxCallsPerPrompt: 1,
    defaultModel: 'deepseek/deepseek-reasoner',
  });
  const params = {
    sessionId: 's1',
    messages: [{ role: 'user', content: 'same prompt' }],
    estimatedInputTokens: 10,
  };
  const first = ledger.recordEstimate(params);
  const second = ledger.recordEstimate(params);

  assert.equal(first.duplicateContext, false);
  assert.equal(second.duplicateContext, true);
  assert.equal(second.overCallBudget, true);
});

test('subagent metadata remains separately inspectable and rolls up by parent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'contextclaw-ledger-'));
  const ledger = new RequestLedger({ path: join(dir, 'ledger.jsonl') });
  const entry = ledger.recordEstimate({
    sessionKey: 'agent:orchestrator:subagent:123',
    parentSessionKey: 'main:abc',
    childSessionKey: 'agent:orchestrator:subagent:123',
    agentId: 'orchestrator',
    runId: 'run-1',
    missionId: 'mission-contextclaw',
    modelId: 'deepseek/deepseek-chat',
    messages: [{ role: 'user', content: 'subagent work' }],
    estimatedInputTokens: 1000,
    estimatedOutputTokens: 1000,
  });

  assert.equal(entry.sessionKind, 'subagent');
  assert.equal(entry.parentSessionKey, 'main:abc');
  assert.equal(entry.childSessionKey, 'agent:orchestrator:subagent:123');
  const byParent = ledger.summarize({ sessionKey: 'main:abc' });
  assert.equal(byParent.entries, 1);
  assert.equal(byParent.bySessionKind.subagent.entries, 1);
});

test('recordReceipt appends actual usage without rewriting estimate', () => {
  const dir = mkdtempSync(join(tmpdir(), 'contextclaw-ledger-'));
  const ledger = new RequestLedger({
    path: join(dir, 'ledger.jsonl'),
    defaultModel: 'anthropic/claude-opus-4-7',
  });
  const estimate = ledger.recordEstimate({
    messages: [{ role: 'user', content: 'final report' }],
    estimatedInputTokens: 1000,
    estimatedOutputTokens: 100,
  });
  const receipt = ledger.recordReceipt({
    estimateEntry: estimate,
    actualInputTokens: 900,
    actualOutputTokens: 80,
    actualUsageStatus: 'available',
  });

  assert.equal(receipt.event, 'receipt');
  assert.equal(receipt.estimateEntryId, estimate.id);
  assert.equal(receipt.actualUsageStatus, 'available');
  assert.equal(ledger.readAll().length, 2);
  assert.equal(ledger.readAll()[0].event, 'estimate');
  assert.equal(ledger.readAll()[1].event, 'receipt');
});

test('summarizeLedger sums entry-level pricing snapshots instead of repricing totals', () => {
  const entries = [
    {
      event: 'estimate',
      timestamp: '2026-01-01T00:00:00.000Z',
      providerModel: 'custom/frontier',
      sessionKind: 'main',
      estimatedInputTokens: 1_000_000,
      estimatedOutputTokens: 0,
      costEstimateUsd: 2,
    },
    {
      event: 'estimate',
      timestamp: '2026-02-01T00:00:00.000Z',
      providerModel: 'custom/frontier',
      sessionKind: 'main',
      estimatedInputTokens: 1_000_000,
      estimatedOutputTokens: 0,
      costEstimateUsd: 20,
    },
  ];

  const summary = summarizeLedger(entries);
  assert.equal(summary.estimatedInputTokens, 2_000_000);
  assert.equal(summary.estimatedCostUsd, 22);
  assert.equal(summary.byModel['custom/frontier'].estimatedCostUsd, 22);
});

test('premium model final-pass gate marks non-final premium calls', () => {
  const dir = mkdtempSync(join(tmpdir(), 'contextclaw-ledger-'));
  const ledger = new RequestLedger({
    path: join(dir, 'ledger.jsonl'),
    defaultModel: 'anthropic/claude-opus-4-7',
  });
  const entry = ledger.recordEstimate({
    messages: [{ role: 'user', content: 'explore files and plan next steps' }],
    estimatedInputTokens: 100,
  });

  assert.equal(isPremiumModel(entry.providerModel), true);
  assert.equal(entry.premiumDeferred, true);
  assert.match(formatReceipt(entry), /premium-deferred/);
  assert.match(formatReceipt(entry), /price=/);
});

test('budget gate blocks oversized premium non-final calls when enforcement is enabled', () => {
  const entry = {
    duplicateContext: false,
    overCallBudget: false,
    premiumDeferred: true,
    estimatedInputTokens: 120000,
    costEstimateUsd: 0.7,
  };

  const decision = getBudgetGateDecision(entry, {
    enforce: true,
    blockPremiumUntilFinalPass: true,
    maxEstimatedInputTokens: 32000,
    maxEstimatedCostUsd: 0.15,
  });

  assert.equal(decision.block, true);
  assert.deepEqual(decision.reasons, ['premium-deferred', 'input-token-budget', 'cost-budget']);
});

test('budget gate is inert until enforcement is enabled', () => {
  const decision = getBudgetGateDecision({
    duplicateContext: true,
    overCallBudget: true,
    premiumDeferred: true,
    estimatedInputTokens: 120000,
    costEstimateUsd: 3,
  });

  assert.equal(decision.block, false);
  assert.deepEqual(decision.reasons, []);
});

test('premium preflight warns or blocks expensive non-final premium calls', () => {
  const entry = {
    providerModel: 'anthropic/claude-opus-4-7',
    premiumDeferred: true,
    estimatedInputTokens: 120000,
    costEstimateUsd: 1,
  };

  const warn = getPremiumPreflightDecision(entry, {
    warnPremiumUntilFinalPass: true,
    premiumPreflightInputTokens: 32000,
    premiumPreflightCostUsd: 0.15,
  });
  assert.equal(warn.block, false);
  assert.equal(warn.warn, true);
  assert.deepEqual(warn.reasons, ['premium-needs-preflight', 'premium-input-token-risk', 'premium-cost-risk']);

  const block = getPremiumPreflightDecision(entry, {
    warnPremiumUntilFinalPass: true,
    enforcePremiumPreflight: true,
    premiumPreflightInputTokens: 32000,
    premiumPreflightCostUsd: 0.15,
  });
  assert.equal(block.block, true);
  assert.equal(block.warn, false);
});

test('inferSessionKind identifies subagent session keys', () => {
  assert.equal(inferSessionKind({ sessionKey: 'agent:orchestrator:subagent:abc' }), 'subagent');
  assert.equal(inferSessionKind({ sessionKey: 'main' }), 'main');
});
