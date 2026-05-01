import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { ContextClawEngine } from '../index.js';

test('ContextClaw records llm_output usage receipts against latest estimate', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'contextclaw-llm-output-'));
  const ledgerPath = join(dir, 'ledger.jsonl');
  const engine = new ContextClawEngine({
    enableTelemetry: false,
    activeModel: 'anthropic/claude-opus-4-7',
    ledger: {
      enabled: true,
      path: ledgerPath,
      estimatedOutputTokens: 100,
    },
  });

  await engine.assemble({
    sessionId: 'main-session',
    messages: [{ role: 'user', content: 'final report please' }],
  });

  const receipt = engine.recordLlmOutput({
    runId: 'run-1',
    sessionId: 'main-session',
    provider: 'anthropic',
    model: 'claude-opus-4-7',
    resolvedRef: 'anthropic/claude-opus-4-7',
    assistantTexts: ['done'],
    usage: {
      input: 80,
      output: 20,
      cacheRead: 5,
      cacheWrite: 0,
      total: 105,
    },
  }, {
    sessionKey: 'main-session',
    sessionId: 'main-session',
    agentId: 'main',
  });

  assert.equal(receipt.event, 'receipt');
  assert.equal(receipt.sessionKey, 'main-session');
  assert.equal(receipt.estimateEntryId != null, true);
  assert.equal(receipt.actualInputTokens, 80);
  assert.equal(receipt.actualOutputTokens, 20);
  assert.equal(receipt.actualCacheReadTokens, 5);
  assert.equal(receipt.actualUsageStatus, 'available');

  const entries = engine.ledger.readAll();
  assert.equal(entries.length, 2);
  assert.equal(entries[0].event, 'estimate');
  assert.equal(entries[1].event, 'receipt');
  assert.equal(entries[1].estimateEntryId, entries[0].id);

  await engine.dispose();
});
