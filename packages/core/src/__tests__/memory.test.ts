import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryStore } from '../memory.js';
import { rm } from 'fs/promises';
import { join } from 'path';
import type { ContextBlock } from '../types.js';

function makeBlock(id: string, content: string): ContextBlock {
  return {
    id,
    type: 'user',
    content,
    tokens: content.length,
    createdAt: Date.now(),
    lastReferencedAt: Date.now(),
    score: 0.5,
    pinned: false,
    evictable: false,
  };
}

describe('MemoryStore', () => {
  const testDir = '/tmp/contextclaw-memory-test';
  let store: MemoryStore;

  beforeEach(async () => {
    store = new MemoryStore(testDir);
    await store.init();
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('flush', () => {
    it('creates a markdown file with block content', async () => {
      const block = makeBlock('test-123', 'Test content');
      const path = await store.flush(block);
      expect(path).toContain(testDir);
      expect(path).toContain('.md');
    });

    it('includes block metadata in output', async () => {
      const block = makeBlock('test-123', 'Test content');
      const path = await store.flush(block);
      expect(path).toBeTruthy();
      const content = await import('fs/promises').then(fs => fs.readFile(path!, 'utf-8'));
      expect(content).toContain('Test content');
      expect(content).toContain('test-123');
    });
  });

  describe('search', () => {
    it('finds relevant blocks by keyword', async () => {
      const block1 = makeBlock('test-1', 'Important project details');
      const block2 = makeBlock('test-2', 'Unrelated content');
      await store.flush(block1);
      await store.flush(block2);

      const results = await store.search('project');
      expect(results.length).toBe(1);
      expect(results[0].snippet).toContain('Important project details');
    });

    it('returns multiple results when multiple matches', async () => {
      const block1 = makeBlock('test-1', 'Project planning');
      const block2 = makeBlock('test-2', 'Project execution');
      await store.flush(block1);
      await store.flush(block2);

      const results = await store.search('project');
      expect(results.length).toBe(2);
    });
  });
});
