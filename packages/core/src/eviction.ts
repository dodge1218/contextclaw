import type { ContextBlock, EvictionResult, EvictionStrategy } from './types.js';
import { ContextBudget } from './budget.js';
import { MemoryStore } from './memory.js';

export class EvictionEngine {
  private budget: ContextBudget;
  private memory: MemoryStore;
  private strategy: EvictionStrategy;
  private history: { blockId: string; reason: string; at: number }[] = [];

  constructor(budget: ContextBudget, memory: MemoryStore, strategy: EvictionStrategy = 'lru-scored') {
    this.budget = budget;
    this.memory = memory;
    this.strategy = strategy;
  }

  async evictUntilBudget(): Promise<EvictionResult> {
    const evicted: ContextBlock[] = [];
    const flushedPaths: string[] = [];
    const candidates = this.getCandidates();

    while (this.budget.overBudget) {
      if (candidates.length === 0) break;

      const victim = candidates.shift();
      if (!victim) break;
      this.budget.remove(victim.id);
      evicted.push(victim);

      // Flush valuable evicted content to persistent memory
      if (victim.score > 0.3 || victim.type === 'assistant') {
        const path = await this.memory.flush(victim);
        if (path) flushedPaths.push(path);
      }

      this.history.push({
        blockId: victim.id,
        reason: `${this.strategy}: score=${victim.score.toFixed(2)}, age=${Date.now() - victim.lastReferencedAt}ms`,
        at: Date.now(),
      });
    }

    return {
      evicted,
      kept: this.budget.getAll(),
      savedTokens: evicted.reduce((sum, b) => sum + b.tokens, 0),
      flushedToMemory: flushedPaths,
    };
  }

  getHistory() {
    return this.history;
  }

  private getCandidates(): ContextBlock[] {
    switch (this.strategy) {
      case 'fifo':
        return this.budget.getAll()
          .filter(b => !b.pinned)
          .sort((a, b) => a.createdAt - b.createdAt);
      case 'manual':
        return this.budget.getAll()
          .filter(b => !b.pinned && b.evictable)
          .sort((a, b) => a.createdAt - b.createdAt);
      case 'lru-scored':
      default:
        return this.budget.getEvictionCandidates();
    }
  }
}
