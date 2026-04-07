import { describe, it, expect } from 'vitest';
import { ContextBudget, countTokens } from '../budget.js';
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

describe('ContextBudget', () => {
  it('tracks totalTokens after add', () => {
    const b = new ContextBudget(1000);
    b.add(makeBlock('a', 100));
    b.add(makeBlock('b', 200));
    expect(b.totalTokens).toBe(300);
  });

  it('reports overBudget correctly', () => {
    const b = new ContextBudget(100);
    expect(b.overBudget).toBe(false);
    b.add(makeBlock('a', 150));
    expect(b.overBudget).toBe(true);
  });

  it('remove reduces totalTokens', () => {
    const b = new ContextBudget(1000);
    b.add(makeBlock('a', 100));
    b.add(makeBlock('b', 200));
    b.remove('a');
    expect(b.totalTokens).toBe(200);
  });

  it('getEvictionCandidates excludes pinned blocks', () => {
    const b = new ContextBudget(1000);
    b.add(makeBlock('a', 100, { pinned: true }));
    b.add(makeBlock('b', 100, { pinned: false }));
    const candidates = b.getEvictionCandidates();
    expect(candidates.length).toBe(1);
    expect(candidates[0].id).toBe('b');
  });
});

describe('countTokens', () => {
  it('returns a positive number for non-empty text', () => {
    expect(countTokens('hello world')).toBeGreaterThan(0);
  });

  it('returns 0 for empty string', () => {
    expect(countTokens('')).toBe(0);
  });
});
