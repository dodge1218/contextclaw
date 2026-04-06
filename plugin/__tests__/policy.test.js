import test from 'node:test';
import assert from 'node:assert';
import { applyPolicy, DEFAULT_POLICIES } from '../policy.js';
import { TYPES } from '../classifier.js';

// -------------------------------------------------------
// System prompt — never touched
// -------------------------------------------------------

test('system prompt is never truncated regardless of age', () => {
  const msg = { role: 'system', content: 'You are helpful.', _type: TYPES.SYSTEM, _chars: 16 };
  const result = applyPolicy(msg, 100);
  assert.strictEqual(result.action, 'keep');
});

// -------------------------------------------------------
// User messages — recent kept, old stripped
// -------------------------------------------------------

test('recent user message (turn 0) kept verbatim', () => {
  const msg = { role: 'user', content: 'Fix the login page please', _type: TYPES.USER, _chars: 25 };
  const result = applyPolicy(msg, 0);
  assert.strictEqual(result.action, 'keep');
});

test('old user message (turn 10) gets truncated', () => {
  const longMsg = 'A '.repeat(500);
  const msg = { role: 'user', content: longMsg, _type: TYPES.USER, _chars: longMsg.length };
  const result = applyPolicy(msg, 10);
  assert.strictEqual(result.action, 'truncate');
  assert.ok(result.msg.content.length < longMsg.length);
});

// -------------------------------------------------------
// File reads — the big one
// -------------------------------------------------------

test('file read on current turn kept full', () => {
  const bigFile = 'x'.repeat(10000);
  const msg = { role: 'tool', content: bigFile, _type: TYPES.FILE_READ, _chars: bigFile.length };
  const result = applyPolicy(msg, 0);
  assert.strictEqual(result.action, 'keep');
});

test('file read 2 turns ago truncated to bookends', () => {
  const bigFile = 'HEADER\n' + 'middle line\n'.repeat(500) + 'FOOTER';
  const msg = { role: 'tool', content: bigFile, _type: TYPES.FILE_READ, _chars: bigFile.length };
  const result = applyPolicy(msg, 2);
  assert.strictEqual(result.action, 'truncate');
  assert.ok(result.msg.content.includes('HEADER'));
  assert.ok(result.msg.content.includes('FOOTER'));
  assert.ok(result.msg.content.includes('truncated by ContextClaw'));
  assert.ok(result.savedChars > 4000, `Should save significant chars, saved: ${result.savedChars}`);
});

// -------------------------------------------------------
// Command output — tail extraction
// -------------------------------------------------------

test('command output 2 turns ago gets tailed', () => {
  const lines = Array.from({ length: 100 }, (_, i) => `line ${i}: output data here`);
  const content = lines.join('\n');
  const msg = { role: 'tool', content, _type: TYPES.CMD_OUTPUT, _chars: content.length };
  const result = applyPolicy(msg, 2);
  assert.strictEqual(result.action, 'truncate');
  assert.ok(result.msg.content.includes('line 99'));  // last line kept
  assert.ok(result.msg.content.includes('truncated'));
});

// -------------------------------------------------------
// Image/media — immediate pointer
// -------------------------------------------------------

test('image reduced to pointer immediately', () => {
  const content = '[media attached: /home/user/screenshot.jpg (image/jpeg)] base64data...'.repeat(10);
  const msg = { role: 'tool', content, _type: TYPES.IMAGE_MEDIA, _chars: content.length };
  const result = applyPolicy(msg, 0);
  assert.strictEqual(result.action, 'truncate');
  assert.ok(result.msg.content.includes('screenshot.jpg'));
  assert.ok(result.msg.content.length < 200);
});

// -------------------------------------------------------
// Error traces
// -------------------------------------------------------

test('error trace kept for 2 turns', () => {
  const content = 'TypeError: Cannot read property "id"\n    at login (auth.ts:47)';
  const msg = { role: 'tool', content, _type: TYPES.ERROR_TRACE, _chars: content.length };
  
  const r1 = applyPolicy(msg, 1);
  assert.strictEqual(r1.action, 'keep', 'Keep at turn 1');
  
  const r2 = applyPolicy(msg, 2);
  assert.strictEqual(r2.action, 'keep', 'Keep at turn 2');
});

test('error trace truncated after 2 turns', () => {
  const stackLines = Array.from({ length: 40 }, (_, i) => `    at frame${i} (file${i}.ts:${i})`);
  const content = 'TypeError: Cannot read property "id"\n' + stackLines.join('\n');
  const msg = { role: 'tool', content, _type: TYPES.ERROR_TRACE, _chars: content.length };
  const result = applyPolicy(msg, 5);
  assert.strictEqual(result.action, 'truncate');
  assert.ok(result.msg.content.includes('TypeError'));
});

// -------------------------------------------------------
// Small messages not worth truncating (< 20% savings)
// -------------------------------------------------------

test('small tool output not truncated even when old', () => {
  const content = 'ok - done';
  const msg = { role: 'tool', content, _type: TYPES.TOOL_GENERIC, _chars: content.length };
  const result = applyPolicy(msg, 20);
  assert.strictEqual(result.action, 'keep', 'Too small to bother truncating');
});

// -------------------------------------------------------
// Savings math
// -------------------------------------------------------

test('35K file read saves ~34.8K chars after 1 turn', () => {
  const bigFile = 'x'.repeat(35000);
  const msg = { role: 'tool', content: bigFile, _type: TYPES.FILE_READ, _chars: bigFile.length };
  const result = applyPolicy(msg, 2);
  assert.strictEqual(result.action, 'truncate');
  assert.ok(result.savedChars > 34000, `Expected >34K saved, got ${result.savedChars}`);
});
