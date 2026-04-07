import { describe, it, expect, beforeEach } from 'vitest';
import { EvictionEngine } from '../eviction.js';
import { ContextBudget } from '../budget.js';
import { MemoryStore } from '../memory.js';
import type { ContextBlock } from '../types.js';

function makeBlock(id: string, tokens: number, opts: Partial<ContextBlock> = {}): ContextBlock {
  return {
    id,
    type: 'user',
    content: 'test',
    tokens,
    createdAt: Date.now(),
    lastReferencedAt: Date.now(),
    score: 0.5,
    pinned: false,
    evictable: false,
    ...opts,
  };
}

describe('EvictionEngine', () => {
  let budget: ContextBudget;
  let memory: MemoryStore;
  let engine: EvictionEngine;

  beforeEach(async () => {
    budget = new ContextBudget(1000);
    memory = new MemoryStore('/tmp/contextclaw-memory');
    await memory.init();
    engine = new EvictionEngine(budget, memory);
  });

  describe('LRU-scored strategy', () => {
    it('evicts lowest-scored blocks first', async () => {
      budget.add(makeBlock('a', 800, { score: 0.9 }));
      budget.add(makeBlock('b', 800, { score: 0.3 }));
      budget.add(makeBlock('c', 800, { score: 0.1 }));
      budget.add(makeBlock('d', 800, { score: 0.5 }));

      const result = await engine.evictUntilBudget();
      expect(result.evicted.map(b => b.id)).toEqual(['c', 'b', 'd']);
    });

    it('preserves pinned blocks', async () => {
      budget.add(makeBlock('a', 800, { pinned: true }));
      budget.add(makeBlock('b', 800));
      budget.add(makeBlock('c', 800));
      budget.add(makeBlock('d', 800));

      const result = await engine.evictUntilBudget();
      expect(result.kept.map(b => b.id)).toContain('a');
    });
  });

  describe('FIFO strategy', () => {
    it('evicts oldest blocks first', async () => {
      engine = new EvictionEngine(budget, memory, 'fifo');
      budget.add(makeBlock('a', 800, { createdAt: Date.now() - 10000 }));
      budget.add(makeBlock('b', 800, { createdAt: Date.now() - 5000 }));
      budget.add(makeBlock('c', 800, { createdAt: Date.now() }));

      const result = await engine.evictUntilBudget();
      expect(result.evicted.map(b => b.id)).toEqual(['a', 'b']);
    });
  });

  describe('Manual strategy', () => {
    it('only evicts marked evictable blocks', async () => {
      engine = new EvictionEngine(budget, memory, 'manual');
      budget.add(makeBlock('a', 800, { evictable: true }));
      budget.add(makeBlock('b', 800, { evictable: false }));
      budget.add(makeBlock('c', 800, { evictable: true }));

      const result = await engine.evictUntilBudget();
      expect(result.evicted.map(b => b.id).sort()).toEqual(['a', 'c']);
      expect(result.kept.map(b => b.id)).toContain('b');
    });
  });

  describe('Edge cases', () => {
    it('handles empty budget', async () => {
      const result = await engine.evictUntilBudget();
      expect(result.evicted).toHaveLength(0);
    });

    it('handles all pinned blocks', async () => {
      budget.add(makeBlock('a', 200, { pinned: true }));
      budget.add(makeBlock('b', 200, { pinned: true }));
      budget.add(makeBlock('c', 200, { pinned: true }));

      const result = await engine.evictUntilBudget();
      expect(result.evicted).toHaveLength(0);
    });

    it('handles single item', async () => {
      budget.add(makeBlock('a', 1200));
      const result = await engine.evictUntilBudget();
      expect(result.evicted.map(b => b.id)).toEqual(['a']);
    });
  });
});
