import type { ContextClawConfig, ContextBlock } from './types.js';
import { ContextBudget } from './budget.js';
import { EvictionEngine } from './eviction.js';
import { MemoryStore } from './memory.js';
import { CircuitBreaker } from './circuit-breaker.js';
import { SubagentLauncher } from './subagent.js';

type IngestBlock = Omit<ContextBlock, 'id' | 'createdAt' | 'lastReferencedAt' | 'score' | 'pinned' | 'evictable'> & {
  turnsElapsed?: number;
};

export class ContextClaw {
  readonly budget: ContextBudget;
  readonly eviction: EvictionEngine;
  readonly memory: MemoryStore;
  readonly circuitBreaker: CircuitBreaker;
  readonly subagents: SubagentLauncher;
  private _ingestLock: Promise<void> = Promise.resolve();
  private currentTurn = 0;
  private decayFactor: number;

  constructor(config: ContextClawConfig) {
    this.budget = new ContextBudget(config.maxContextTokens);
    this.memory = new MemoryStore(config.memoryStore);
    this.eviction = new EvictionEngine(this.budget, this.memory, config.evictionStrategy);
    this.circuitBreaker = new CircuitBreaker(config.retryCircuitBreaker);
    this.subagents = new SubagentLauncher(config.subagentDefaults);
    this.decayFactor = config.scoreDecayFactor ?? 0.95;
  }

  /**
   * Decay scores of all non-pinned blocks to reflect aging.
   */
  decayScores(turnsElapsed: number): void {
    if (!turnsElapsed || turnsElapsed <= 0) return;
    const advanced = this.advanceTurns(turnsElapsed);
    if (advanced > 0) this.recalculateAgingScores();
  }

  /**
   * Add a new context block. If over budget, automatically evicts lowest-scored blocks.
   */
  async ingest(block: IngestBlock): Promise<void> {
    let release: () => void;
    const acquired = new Promise<void>(r => { release = r; });
    const prev = this._ingestLock;
    this._ingestLock = acquired;
    await prev;

    try {
      const { turnsElapsed, ...incoming } = block;
      const advanced = this.advanceTurns(turnsElapsed);
      if (advanced > 0) {
        this.recalculateAgingScores();
      }
      const baseScore = this.scoreBlock(incoming);
      const fullBlock: ContextBlock = {
        ...incoming,
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        lastReferencedAt: Date.now(),
        score: baseScore,
        baseScore,
        ingestTurn: this.currentTurn,
        pinned: incoming.type === 'system',
        evictable: false,
      };

      this.budget.add(fullBlock);

      if (this.budget.overBudget) {
        this.recalculateAgingScores();
        await this.eviction.evictUntilBudget();
      }
    } finally {
      release!();
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

  private advanceTurns(turnsElapsed?: number): number {
    if (typeof turnsElapsed === 'number' && Number.isFinite(turnsElapsed)) {
      const delta = Math.max(0, Math.floor(turnsElapsed));
      if (delta > 0) this.currentTurn += delta;
      return delta;
    }
    return 0;
  }

  private recalculateAgingScores(): void {
    for (const block of this.budget.getAll()) {
      if (block.pinned) continue;
      const base = block.baseScore ?? block.score;
      const startTurn = block.ingestTurn ?? this.currentTurn;
      const age = Math.max(0, this.currentTurn - startTurn);
      const decayed = base * Math.pow(this.decayFactor, age);
      block.baseScore = base;
      block.score = Math.max(0, decayed);
      if (!block.ingestTurn) {
        block.ingestTurn = startTurn;
      }
    }
  }
}
