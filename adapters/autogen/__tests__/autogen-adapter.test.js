import { test } from 'node:test';
import assert from 'node:assert';
import { ContextClawAutoGenAdapter } from '../index.js';

test('ContextClawAutoGenAdapter - basic instantiation', () => {
  const adapter = new ContextClawAutoGenAdapter();
  assert.ok(adapter);
});

test('ContextClawAutoGenAdapter - pruneMessages returns messages array', () => {
  const adapter = new ContextClawAutoGenAdapter();
  const messages = [
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hi there!' },
  ];
  const { messages: result } = adapter.pruneMessages(messages);
  assert.ok(Array.isArray(result));
  assert.equal(result.length, 2);
});

test('ContextClawAutoGenAdapter - handles empty messages', () => {
  const adapter = new ContextClawAutoGenAdapter();
  const { messages } = adapter.pruneMessages([]);
  assert.ok(Array.isArray(messages));
  assert.equal(messages.length, 0);
});

test('ContextClawAutoGenAdapter - throws on invalid input', () => {
  const adapter = new ContextClawAutoGenAdapter();
  assert.throws(() => {
    adapter.pruneMessages('not an array');
  });
});

test('ContextClawAutoGenAdapter - preprocessMessages works', () => {
  const adapter = new ContextClawAutoGenAdapter();
  const messages = [{ role: 'user', content: 'Test' }];
  const result = adapter.preprocessMessages(messages);
  assert.ok(result.messages);
});

test('ContextClawAutoGenAdapter - analyzeContext returns stats', () => {
  const adapter = new ContextClawAutoGenAdapter();
  const messages = [
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hi' },
  ];
  const stats = adapter.analyzeContext(messages);
  assert.ok(stats.totalMessages);
  assert.ok(stats.totalChars >= 0);
  assert.ok(stats.typeCounts);
});

test('ContextClawAutoGenAdapter - custom policies work', () => {
  const adapter = new ContextClawAutoGenAdapter({
    policies: { FILE_READ: { keep: 2 } },
  });
  assert.ok(adapter.policies.FILE_READ);
});

test('ContextClawAutoGenAdapter - debug mode works', () => {
  const adapter = new ContextClawAutoGenAdapter({ debug: true });
  const messages = [{ role: 'user', content: 'Test' }];
  const { messages: result } = adapter.pruneMessages(messages);
  assert.ok(result);
});
