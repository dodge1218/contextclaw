import test from 'node:test';
import assert from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ContextClawEngine, computeTurnsAgo } from '../index.js';

// -------------------------------------------------------
// Turn counting
// -------------------------------------------------------

test('computeTurnsAgo counts user messages as turn boundaries', () => {
  const msgs = [
    { role: 'user', content: 'first' },
    { role: 'assistant', content: 'reply 1' },
    { role: 'tool', content: 'tool output' },
    { role: 'user', content: 'second' },
    { role: 'assistant', content: 'reply 2' },
    { role: 'user', content: 'third' },
  ];
  const turns = computeTurnsAgo(msgs);
  // Last user = turn 0, second-to-last = turn 1, first = turn 2
  assert.strictEqual(turns[5], 0);  // third user msg
  assert.strictEqual(turns[3], 1);  // second user msg
  assert.strictEqual(turns[0], 2);  // first user msg
  // Non-user messages get the same turn count as the next user message
});

// -------------------------------------------------------
// Engine basics
// -------------------------------------------------------

test('engine info is correct', () => {
  const engine = new ContextClawEngine({ enableTelemetry: false });
  assert.strictEqual(engine.info.id, 'contextclaw');
  assert.strictEqual(engine.info.version, '1.0.0');
  assert.strictEqual(engine.info.ownsCompaction, false);
});

test('bootstrap creates session entry', async () => {
  const engine = new ContextClawEngine({ enableTelemetry: false });
  const result = await engine.bootstrap({ sessionId: 'test-1' });
  assert.strictEqual(result.bootstrapped, true);
});

// -------------------------------------------------------
// Full assemble flow
// -------------------------------------------------------

test('assemble truncates old file read but keeps recent conversation', async () => {
  const engine = new ContextClawEngine({ enableTelemetry: false, coldStorageDir: '/tmp/contextclaw-test-cold' });

  const bigFile = 'import stuff\n' + 'const x = ' + 'y'.repeat(10000) + ';\n';
  const messages = [
    { role: 'system', content: 'You are helpful' },
    { role: 'user', content: 'Read the auth file' },
    { role: 'tool', content: bigFile },          // old file read
    { role: 'assistant', content: 'Here is the auth file content' },
    { role: 'user', content: 'Now something else entirely' },
    { role: 'assistant', content: 'Sure, working on it' },
    { role: 'user', content: 'Fix the login' },
    { role: 'assistant', content: 'Fixed.' },
    { role: 'user', content: 'Thanks, deploy it' },
  ];

  const result = await engine.assemble({ sessionId: 'test-assemble', messages });

  // Should have same number of messages (truncation, not removal)
  assert.strictEqual(result.messages.length, messages.length);

  // The file read (index 2) should be truncated
  const fileReadBlocks = result.messages[2].content;
  assert.ok(Array.isArray(fileReadBlocks));
  const fileReadText = fileReadBlocks.map(b => (b?.text ?? b)).join('');
  assert.ok(fileReadText.length < bigFile.length, 'File read should be truncated');
  assert.match(fileReadText, /\[ContextClaw:[0-9a-f]{8} truncated \d+ chars/i);

  // Recent messages should be intact
  const getTextContent = (msg) => {
    const c = msg.content;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) return c.map(b => b?.text ?? b).join('');
    return '';
  };
  assert.strictEqual(getTextContent(result.messages[8]), 'Thanks, deploy it');
  assert.strictEqual(getTextContent(result.messages[7]), 'Fixed.');
  assert.ok(result.estimatedTokens > 0, 'should include token estimate');
});

test('assemble preserves system prompt always', async () => {
  const engine = new ContextClawEngine({ enableTelemetry: false });
  const longSystem = 'Rule: ' + 'x'.repeat(5000);
  const messages = [
    { role: 'system', content: longSystem },
    ...Array.from({ length: 20 }, (_, i) => [
      { role: 'user', content: `msg ${i}` },
      { role: 'assistant', content: `reply ${i}` },
    ]).flat(),
  ];

  const result = await engine.assemble({ sessionId: 'test-system', messages });
  assert.strictEqual(result.messages[0].content[0].text, longSystem, 'System prompt untouched');
});

test('assemble handles empty messages gracefully', async () => {
  const engine = new ContextClawEngine({ enableTelemetry: false });
  const result = await engine.assemble({ sessionId: 'test-empty', messages: [] });
  assert.strictEqual(result.messages.length, 0);
});

test('assemble strips internal metadata from output', async () => {
  const engine = new ContextClawEngine({ enableTelemetry: false });
  const messages = [
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'hi' },
  ];
  const result = await engine.assemble({ sessionId: 'test-clean', messages });
  assert.strictEqual(result.messages[0]._type, undefined, 'No _type in output');
  assert.strictEqual(result.messages[0]._chars, undefined, 'No _chars in output');
});

test('assemble budget gate replaces oversized premium context with synthetic message', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'contextclaw-engine-ledger-'));
  const engine = new ContextClawEngine({
    enableTelemetry: false,
    activeModel: 'anthropic/claude-opus-4-7',
    ledger: {
      enabled: true,
      path: join(dir, 'ledger.jsonl'),
      maxCallsPerPrompt: 8,
      enforce: true,
      maxEstimatedInputTokens: 100,
      maxEstimatedCostUsd: 0.001,
      blockPremiumUntilFinalPass: true,
      estimatedOutputTokens: 100,
      printReceipt: false,
    },
  });

  const result = await engine.assemble({
    sessionId: 'test-budget-gate',
    messages: [
      { role: 'system', content: 'You are helpful' },
      { role: 'user', content: `explore and keep working ${'x'.repeat(2000)}` },
    ],
  });

  assert.strictEqual(result.messages.length, 2);
  assert.strictEqual(result.messages[0].role, 'system');
  assert.match(result.messages[0].content[0].text, /budget gate is active/i);
  assert.match(result.messages[1].content, /Reason: premium-deferred, input-token-budget, cost-budget/);
  assert.ok(result.estimatedTokens < 500);
});
