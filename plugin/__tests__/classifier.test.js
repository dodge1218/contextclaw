import test from 'node:test';
import assert from 'node:assert';
import { classify, classifyAll, TYPES } from '../classifier.js';

// -------------------------------------------------------
// System / User / Assistant basics
// -------------------------------------------------------

test('system messages classify as SYSTEM', () => {
  assert.strictEqual(classify({ role: 'system', content: 'You are helpful.' }), TYPES.SYSTEM);
});

test('user messages classify as USER', () => {
  assert.strictEqual(classify({ role: 'user', content: 'fix the login page' }), TYPES.USER);
});

test('assistant messages classify as ASSISTANT', () => {
  assert.strictEqual(classify({ role: 'assistant', content: 'Done. Fixed the bug.' }), TYPES.ASSISTANT);
});

// -------------------------------------------------------
// File reads
// -------------------------------------------------------

test('tool result with file content classifies as FILE_READ', () => {
  const msg = { role: 'tool', content: 'Successfully read 200 lines from /src/auth.ts\n\nimport { db } from "./db";\nexport function login() {}' };
  assert.strictEqual(classify(msg), TYPES.FILE_READ);
});

test('tool result with code patterns classifies as FILE_READ', () => {
  const msg = { role: 'tool', content: 'import { useState } from "react";\n\nexport function App() {\n  return <div>Hello</div>;\n}' };
  assert.strictEqual(classify(msg), TYPES.FILE_READ);
});

test('tool result with markdown heading classifies as FILE_READ', () => {
  const msg = { role: 'tool', content: '# README\n\nThis is a project readme with instructions.' };
  assert.strictEqual(classify(msg), TYPES.FILE_READ);
});

// -------------------------------------------------------
// Command output
// -------------------------------------------------------

test('npm install output classifies as CMD_OUTPUT', () => {
  const msg = { role: 'tool', content: '$ npm install\nadded 847 packages in 12s\n\n200 packages are looking for funding' };
  assert.strictEqual(classify(msg), TYPES.CMD_OUTPUT);
});

test('test results classify as CMD_OUTPUT', () => {
  const msg = { role: 'tool', content: '✓ test 1 passed\n✓ test 2 passed\n✗ test 3 failed\n\nTests: 2 passed, 1 failed' };
  assert.strictEqual(classify(msg), TYPES.CMD_OUTPUT);
});

test('process exit classifies as CMD_OUTPUT', () => {
  const msg = { role: 'tool', content: 'Process exited with code 0\nOutput was written to file.txt' };
  assert.strictEqual(classify(msg), TYPES.CMD_OUTPUT);
});

// -------------------------------------------------------
// Errors
// -------------------------------------------------------

test('JS error with stack trace classifies as ERROR_TRACE', () => {
  const msg = { role: 'tool', content: 'TypeError: Cannot read property "id" of undefined\n    at login (/src/auth.ts:47:12)\n    at handler (/src/routes.ts:23:5)' };
  assert.strictEqual(classify(msg), TYPES.ERROR_TRACE);
});

test('ECONNREFUSED classifies as ERROR_TRACE', () => {
  const msg = { role: 'tool', content: 'Error: ECONNREFUSED 127.0.0.1:5432\nPostgreSQL is not running' };
  assert.strictEqual(classify(msg), TYPES.ERROR_TRACE);
});

// -------------------------------------------------------
// Config dumps
// -------------------------------------------------------

test('large YAML-style config classifies as CONFIG_DUMP', () => {
  const lines = Array.from({ length: 40 }, (_, i) => `setting${i}: value${i}_${'x'.repeat(20)}`).join('\n');
  const msg = { role: 'tool', content: lines };
  assert.strictEqual(classify(msg), TYPES.CONFIG_DUMP);
});

// -------------------------------------------------------
// JSON blobs
// -------------------------------------------------------

test('large JSON object classifies as JSON_BLOB', () => {
  const bigJson = JSON.stringify({ data: Array.from({ length: 100 }, (_, i) => ({ id: i, name: `item${i}` })) });
  const msg = { role: 'tool', content: bigJson };
  assert.strictEqual(classify(msg), TYPES.JSON_BLOB);
});

// -------------------------------------------------------
// Images
// -------------------------------------------------------

test('media attachment classifies as IMAGE_MEDIA', () => {
  const msg = { role: 'tool', content: '[media attached: /home/user/screenshot.jpg (image/jpeg)]' };
  assert.strictEqual(classify(msg), TYPES.IMAGE_MEDIA);
});

test('base64 image classifies as IMAGE_MEDIA', () => {
  const msg = { role: 'tool', content: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg...' };
  assert.strictEqual(classify(msg), TYPES.IMAGE_MEDIA);
});

// -------------------------------------------------------
// classifyAll adds _type and _chars
// -------------------------------------------------------

test('classifyAll adds _type and _chars to each message', () => {
  const msgs = [
    { role: 'system', content: 'Be helpful' },
    { role: 'user', content: 'Hello' },
    { role: 'tool', content: '$ ls\nfile1.txt\nfile2.txt' },
  ];
  const result = classifyAll(msgs);
  assert.strictEqual(result.length, 3);
  assert.strictEqual(result[0]._type, TYPES.SYSTEM);
  assert.strictEqual(result[1]._type, TYPES.USER);
  assert.ok(result[0]._chars > 0);
});

// -------------------------------------------------------
// Edge cases
// -------------------------------------------------------

test('null/empty message defaults to TOOL_GENERIC', () => {
  assert.strictEqual(classify(null), TYPES.TOOL_GENERIC);
  assert.strictEqual(classify({}), TYPES.TOOL_GENERIC);
});

test('short tool output defaults to TOOL_GENERIC', () => {
  const msg = { role: 'tool', content: 'ok' };
  assert.strictEqual(classify(msg), TYPES.TOOL_GENERIC);
});
