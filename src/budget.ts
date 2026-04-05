import type { ContextBlock } from './types.js';

export class ContextBudget {
  private maxTokens: number;
  private blocks: Map<string, ContextBlock> = new Map();

  constructor(maxTokens: number) {
    this.maxTokens = maxTokens;
  }

  get totalTokens(): number {
    let total = 0;
    for (const block of this.blocks.values()) total += block.tokens;
    return total;
  }

  get remaining(): number {
    return Math.max(0, this.maxTokens - this.totalTokens);
  }

  get utilization(): number {
    return this.totalTokens / this.maxTokens;
  }

  get overBudget(): boolean {
    return this.totalTokens > this.maxTokens;
  }

  add(block: ContextBlock): void {
    this.blocks.set(block.id, block);
  }

  remove(id: string): ContextBlock | undefined {
    const block = this.blocks.get(id);
    if (block) this.blocks.delete(id);
    return block;
  }

  reference(id: string): void {
    const block = this.blocks.get(id);
    if (block) {
      block.lastReferencedAt = Date.now();
      block.score = Math.min(1, block.score + 0.1);
    }
  }

  getAll(): ContextBlock[] {
    return Array.from(this.blocks.values());
  }

  getSorted(): ContextBlock[] {
    return this.getAll().sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return b.score - a.score;
    });
  }

  getEvictionCandidates(): ContextBlock[] {
    return this.getAll()
      .filter(b => !b.pinned)
      .sort((a, b) => a.score - b.score || a.lastReferencedAt - b.lastReferencedAt);
  }
}
