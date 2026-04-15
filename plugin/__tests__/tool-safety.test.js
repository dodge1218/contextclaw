import test from 'node:test';
import assert from 'node:assert';
import { ContextClawEngine } from '../index.js';

// -------------------------------------------------------
// Tool-call safety — ContextClaw must never corrupt
// tool_use/tool_result pairing or structural fields.
//
// These tests verify the guarantees described in:
// docs/POISONED_SESSION_GUARDRAIL.md
// -------------------------------------------------------

/**
 * Helper: extract text from content (handles string or array format)
 */
function getTextContent(msg) {
  const c = msg.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(b => b?.text ?? (typeof b === 'string' ? b : JSON.stringify(b))).join('');
  return '';
}

/**
 * Helper: find all tool_use IDs in a message array
 */
function extractToolUseIds(messages) {
  const ids = new Set();
  for (const msg of messages) {
    const content = Array.isArray(msg.content) ? msg.content : [];
    for (const block of content) {
      if (block?.type === 'tool_use' && block?.id) ids.add(block.id);
    }
  }
  return ids;
}

/**
 * Helper: find all tool_result tool_use_ids in a message array
 */
function extractToolResultIds(messages) {
  const ids = new Set();
  for (const msg of messages) {
    const content = Array.isArray(msg.content) ? msg.content : [];
    for (const block of content) {
      if (block?.type === 'tool_result' && block?.tool_use_id) ids.add(block.tool_use_id);
    }
  }
  return ids;
}

// -------------------------------------------------------
// Structural integrity
// -------------------------------------------------------

test('tool_use IDs are never modified by assemble', async () => {
  const engine = new ContextClawEngine({ enableTelemetry: false });

  const messages = [
    { role: 'system', content: 'You are helpful' },
    { role: 'user', content: 'Read the file' },
    {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Let me read that file.' },
        { type: 'tool_use', id: 'toolu_abc123', name: 'read', input: { path: '/tmp/test.js' } },
      ],
    },
    {
      role: 'tool',
      content: [
        { type: 'tool_result', tool_use_id: 'toolu_abc123', content: 'x'.repeat(20000) },
      ],
    },
    { role: 'user', content: 'Now do something else' },
    { role: 'assistant', content: 'Sure.' },
    { role: 'user', content: 'One more thing' },
    { role: 'assistant', content: 'Done.' },
    { role: 'user', content: 'Thanks' },
  ];

  const result = await engine.assemble({ sessionId: 'tool-safety-1', messages });

  // The tool_use ID must survive untouched
  const useIds = extractToolUseIds(result.messages);
  assert.ok(useIds.has('toolu_abc123'), 'tool_use ID must be preserved');

  // The tool_result tool_use_id must survive untouched
  const resultIds = extractToolResultIds(result.messages);
  assert.ok(resultIds.has('toolu_abc123'), 'tool_result tool_use_id must be preserved');
});

test('tool_use and tool_result remain paired after truncation', async () => {
  const engine = new ContextClawEngine({ enableTelemetry: false });

  // Create multiple tool call pairs with large results
  const messages = [
    { role: 'system', content: 'You are helpful' },
    { role: 'user', content: 'Read both files' },
    {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Reading files.' },
        { type: 'tool_use', id: 'toolu_file1', name: 'read', input: { path: '/a.js' } },
        { type: 'tool_use', id: 'toolu_file2', name: 'read', input: { path: '/b.js' } },
      ],
    },
    {
      role: 'tool',
      content: [
        { type: 'tool_result', tool_use_id: 'toolu_file1', content: 'FILE_A_CONTENT\n' + 'a'.repeat(15000) },
        { type: 'tool_result', tool_use_id: 'toolu_file2', content: 'FILE_B_CONTENT\n' + 'b'.repeat(15000) },
      ],
    },
    { role: 'assistant', content: 'Here are both files.' },
    { role: 'user', content: 'Do something else now' },
    { role: 'assistant', content: 'Working on it.' },
    { role: 'user', content: 'One more' },
    { role: 'assistant', content: 'Done.' },
    { role: 'user', content: 'Thanks' },
  ];

  const result = await engine.assemble({ sessionId: 'tool-safety-2', messages });

  const useIds = extractToolUseIds(result.messages);
  const resultIds = extractToolResultIds(result.messages);

  // Every tool_use must still have a matching tool_result
  for (const id of useIds) {
    assert.ok(resultIds.has(id), `tool_use ${id} has no matching tool_result after assemble`);
  }

  // Every tool_result must still have a matching tool_use
  for (const id of resultIds) {
    assert.ok(useIds.has(id), `tool_result ${id} has no matching tool_use after assemble`);
  }
});

test('tool_use name and input fields are never modified', async () => {
  const engine = new ContextClawEngine({ enableTelemetry: false });

  const originalInput = { path: '/home/user/big-file.ts', offset: 100, limit: 500 };
  const messages = [
    { role: 'system', content: 'You are helpful' },
    { role: 'user', content: 'Read the file' },
    {
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 'toolu_preserve', name: 'read', input: { ...originalInput } },
      ],
    },
    {
      role: 'tool',
      content: [
        { type: 'tool_result', tool_use_id: 'toolu_preserve', content: 'x'.repeat(30000) },
      ],
    },
    { role: 'user', content: 'Thanks' },
    { role: 'assistant', content: 'Done' },
    { role: 'user', content: 'Next' },
  ];

  const result = await engine.assemble({ sessionId: 'tool-safety-3', messages });

  // Find the tool_use block in the result
  let foundToolUse = null;
  for (const msg of result.messages) {
    const content = Array.isArray(msg.content) ? msg.content : [];
    for (const block of content) {
      if (block?.type === 'tool_use' && block?.id === 'toolu_preserve') {
        foundToolUse = block;
      }
    }
  }

  assert.ok(foundToolUse, 'tool_use block must exist in output');
  assert.strictEqual(foundToolUse.name, 'read', 'tool name must be preserved');
  assert.deepStrictEqual(foundToolUse.input, originalInput, 'tool input must be preserved exactly');
});

// -------------------------------------------------------
// Truncation boundary safety
// -------------------------------------------------------

test('truncation of tool_result content does not bleed into structural fields', async () => {
  const engine = new ContextClawEngine({ enableTelemetry: false });

  const hugeResult = JSON.stringify({ data: 'x'.repeat(50000), nested: { key: 'value' } });
  const messages = [
    { role: 'system', content: 'You are helpful' },
    { role: 'user', content: 'Get data' },
    {
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 'toolu_bigresult', name: 'exec', input: { command: 'curl api' } },
      ],
    },
    {
      role: 'tool',
      content: [
        { type: 'tool_result', tool_use_id: 'toolu_bigresult', content: hugeResult },
      ],
    },
    { role: 'assistant', content: 'Got the data.' },
    { role: 'user', content: 'Next question' },
    { role: 'assistant', content: 'Working.' },
    { role: 'user', content: 'One more' },
    { role: 'assistant', content: 'Done' },
    { role: 'user', content: 'Deploy' },
  ];

  const result = await engine.assemble({ sessionId: 'tool-safety-4', messages });

  // Find the tool_result in output
  let foundResult = null;
  for (const msg of result.messages) {
    const content = Array.isArray(msg.content) ? msg.content : [];
    for (const block of content) {
      if (block?.tool_use_id === 'toolu_bigresult') {
        foundResult = block;
      }
    }
  }

  assert.ok(foundResult, 'tool_result block must exist');
  assert.strictEqual(foundResult.type, 'tool_result', 'type field must be preserved');
  assert.strictEqual(foundResult.tool_use_id, 'toolu_bigresult', 'tool_use_id must be preserved');

  // Content may be truncated but structural fields must be intact
  if (typeof foundResult.content === 'string' && foundResult.content.length < hugeResult.length) {
    // Truncation happened — verify the marker is in content, not in structural fields
    assert.ok(
      !foundResult.type.includes('ContextClaw'),
      'ContextClaw marker must not appear in type field'
    );
    assert.ok(
      !foundResult.tool_use_id.includes('ContextClaw'),
      'ContextClaw marker must not appear in tool_use_id field'
    );
  }
});

test('message count is preserved — truncation never removes messages', async () => {
  const engine = new ContextClawEngine({ enableTelemetry: false });

  const messages = [
    { role: 'system', content: 'System prompt' },
    { role: 'user', content: 'Step 1' },
    { role: 'assistant', content: 'Done 1. ' + 'detail '.repeat(2000) },
    { role: 'user', content: 'Step 2' },
    { role: 'tool', content: 'y'.repeat(30000) },
    { role: 'assistant', content: 'Done 2. ' + 'detail '.repeat(2000) },
    { role: 'user', content: 'Step 3' },
    { role: 'assistant', content: 'Done 3.' },
    { role: 'user', content: 'Step 4' },
  ];

  const result = await engine.assemble({ sessionId: 'tool-safety-5', messages });
  assert.strictEqual(
    result.messages.length,
    messages.length,
    `Message count must be preserved: expected ${messages.length}, got ${result.messages.length}`
  );
});

test('role field is never modified on any message', async () => {
  const engine = new ContextClawEngine({ enableTelemetry: false });

  const messages = [
    { role: 'system', content: 'System' },
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hi. ' + 'x'.repeat(10000) },
    { role: 'user', content: 'Read file' },
    { role: 'tool', content: 'z'.repeat(20000) },
    { role: 'assistant', content: 'Got it. ' + 'y'.repeat(10000) },
    { role: 'user', content: 'Thanks' },
  ];

  const result = await engine.assemble({ sessionId: 'tool-safety-6', messages });

  for (let i = 0; i < messages.length; i++) {
    assert.strictEqual(
      result.messages[i].role,
      messages[i].role,
      `Role at index ${i} must be preserved (expected ${messages[i].role}, got ${result.messages[i].role})`
    );
  }
});
