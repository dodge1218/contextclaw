import type { ContextClawConfig, ContextBlock } from './types.js';
import { ContextBudget } from './budget.js';
import { EvictionEngine } from './eviction.js';
import { MemoryStore } from './memory.js';
import { CircuitBreaker } from './circuit-breaker.js';
import { SubagentLauncher } from './subagent.js';

export class ContextClaw {
  readonly budget: ContextBudget;
  readonly eviction: EvictionEngine;
  readonly memory: MemoryStore;
  readonly circuitBreaker: CircuitBreaker;
  readonly subagents: SubagentLauncher;

  constructor(config: ContextClawConfig) {
    this.budget = new ContextBudget(config.maxContextTokens);
    this.memory = new MemoryStore(config.memoryStore);
    this.eviction = new EvictionEngine(this.budget, this.memory, config.evictionStrategy);
    this.circuitBreaker = new CircuitBreaker(config.retryCircuitBreaker);
    this.subagents = new SubagentLauncher(config.subagentDefaults);
  }

  /**
   * Add a new context block. If over budget, automatically evicts lowest-scored blocks.
   */
  async ingest(block: Omit<ContextBlock, 'id' | 'createdAt' | 'lastReferencedAt' | 'score' | 'pinned'>): Promise<void> {
    const fullBlock: ContextBlock = {
      ...block,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      lastReferencedAt: Date.now(),
      score: this.scoreBlock(block),
      pinned: block.type === 'system',
    };

    this.budget.add(fullBlock);

    if (this.budget.overBudget) {
      await this.eviction.evictUntilBudget();
    }
  }

  /**
   * Score a block based on type and content heuristics.
   */
  private scoreBlock(block: Pick<ContextBlock, 'type' | 'content' | 'tokens'>): number {
    // System messages are always important
    if (block.type === 'system') return 1.0;

    // User messages are high value (they contain intent)
    if (block.type === 'user') return 0.9;

    // Assistant messages with decisions are valuable
    if (block.type === 'assistant') return 0.7;

    // Tool results degrade quickly — they're the biggest bloat source
    if (block.type === 'tool-result' || block.type === 'exec-output') {
      // Large tool results score lower (more bloat per token of value)
      if (block.tokens > 2000) return 0.2;
      if (block.tokens > 500) return 0.4;
      return 0.5;
    }

    // File reads — medium value, but stale fast
    if (block.type === 'file-read') return 0.4;

    return 0.5;
  }

  /**
   * Get current state for the visual inspector.
   */
  inspect() {
    return {
      blocks: this.budget.getSorted(),
      totalTokens: this.budget.totalTokens,
      budgetTokens: this.budget.remaining,
      utilizationPercent: Math.round(this.budget.utilization * 100),
      evictionHistory: this.eviction.getHistory(),
    };
  }
}
