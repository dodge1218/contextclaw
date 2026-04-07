import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ContextClaw } from '../orchestrator.js';
import type { ContextBlock } from '../types.js';

function makeBlock(type: ContextBlock['type'], content: string, tokens: number): Omit<ContextBlock, 'id' | 'createdAt' | 'lastReferencedAt' | 'score' | 'pinned' | 'evictable'> {
  return { type, content, tokens };
}

describe('ContextClaw', () => {
  let cc: ContextClaw;

  beforeEach(() => {
    cc = new ContextClaw({
      maxContextTokens: 1000,
      evictionStrategy: 'lru-scored',
      memoryStore: '/tmp/contextclaw-memory',
      retryCircuitBreaker: { maxRetries: 3, fallbackModels: ['gpt-4o-mini'] },
      subagentDefaults: { maxContextTokens: 500, injectOnly: ['task'] },
    });
  });

  describe('ingest', () => {
    it('adds blocks to budget', async () => {
      await cc.ingest(makeBlock('user', 'Hello', 10));
      expect(cc.budget.totalTokens).toBe(10);
    });

    it('triggers eviction when over budget', async () => {
      const evictSpy = vi.spyOn(cc.eviction, 'evictUntilBudget');
      for (let i = 0; i < 15; i++) {
        await cc.ingest(makeBlock('user', `Message ${i}`, 100));
      }
      expect(evictSpy).toHaveBeenCalled();
    });

    it('handles concurrent ingest safely', async () => {
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(cc.ingest(makeBlock('user', `Concurrent ${i}`, 50)));
      }
      await Promise.all(promises);
      expect(cc.budget.totalTokens).toBe(500);
    });
  });

  describe('scoreBlock', () => {
    it('scores system messages highest', async () => {
      const block = makeBlock('system', 'System config', 100);
      await cc.ingest(block);
      const added = cc.budget.getAll().find(b => b.content === 'System config');
      expect(added?.score).toBe(1.0);
    });

    it('scores user messages high', async () => {
      const block = makeBlock('user', 'User input', 100);
      await cc.ingest(block);
      const added = cc.budget.getAll().find(b => b.content === 'User input');
      expect(added?.score).toBe(0.9);
    });

    it('scores large tool results lower', async () => {
      // Create it with size < 1000 to avoid immediate eviction
      const block = makeBlock('tool-result', 'Large output', 600);
      await cc.ingest(block);
      const added = cc.budget.getAll().find(b => b.content === 'Large output');
      expect(added?.score).toBe(0.4); // tokens > 500
    });
  });

  describe('decayScores', () => {
    it('reduces non-pinned block scores and leaves pinned blocks untouched', async () => {
      await cc.ingest(makeBlock('assistant', 'Older decision', 50));
      await cc.ingest(makeBlock('system', 'Root instructions', 50));

      cc.decayScores(3);

      const older = cc.budget.getAll().find(b => b.content === 'Older decision');
      const system = cc.budget.getAll().find(b => b.content === 'Root instructions');
      const expected = 0.7 * Math.pow(0.95, 3);
      expect(older?.score).toBeCloseTo(expected, 5);
      expect(system?.score).toBe(1);
    });

    it('applies decay automatically during ingest when turns have elapsed', async () => {
      await cc.ingest(makeBlock('assistant', 'First reply', 50));
      await cc.ingest({ ...makeBlock('user', 'Latest instructions', 10), turnsElapsed: 2 });

      const firstReply = cc.budget.getAll().find(b => b.content === 'First reply');
      const expected = 0.7 * Math.pow(0.95, 2);
      expect(firstReply?.score).toBeCloseTo(expected, 5);
    });

    it('supports configurable decay factors', async () => {
      const custom = new ContextClaw({
        maxContextTokens: 1000,
        evictionStrategy: 'lru-scored',
        memoryStore: '/tmp/contextclaw-memory',
        retryCircuitBreaker: { maxRetries: 3, fallbackModels: ['gpt-4o-mini'] },
        subagentDefaults: { maxContextTokens: 500, injectOnly: ['task'] },
        scoreDecayFactor: 0.5,
      });

      await custom.ingest(makeBlock('assistant', 'Test', 10));
      await custom.ingest({ ...makeBlock('user', 'turn', 10), turnsElapsed: 4 });
      const target = custom.budget.getAll().find(b => b.content === 'Test');
      expect(target?.score).toBeCloseTo(0.7 * Math.pow(0.5, 4), 5);
    });
  });
});
