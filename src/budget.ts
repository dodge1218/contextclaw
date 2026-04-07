import { get_encoding, type Tiktoken } from 'tiktoken';
import type { ContextBlock } from './types.js';

let encoder: Tiktoken | null = null;

function getEncoder(): Tiktoken | null {
  if (encoder) return encoder;
  try {
    encoder = get_encoding('cl100k_base');
    return encoder;
  } catch {
    return null;
  }
}

export function countTokens(text: string): number {
  const enc = getEncoder();
  if (enc) {
    try {
      return enc.encode_ordinary(text).length;
    } catch {
      // If encoding fails for any reason, fall through to heuristic estimate
    }
  }

  // Rough heuristic: 4 characters per token
  return Math.ceil(text.length / 4);
}

export class ContextBudget {
  private readonly blocks = new Map<string, ContextBlock>();

  constructor(readonly maxTokens: number) {}

  get totalTokens(): number {
    let total = 0;
    for (const block of this.blocks.values()) total += block.tokens;
    return total;
  }

  get remaining(): number {
    return Math.max(0, this.maxTokens - this.totalTokens);
  }

  get utilization(): number {
    return this.maxTokens === 0 ? 0 : this.totalTokens / this.maxTokens;
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
    if (!block) return;

    block.lastReferencedAt = Date.now();
    block.score = Math.min(1, block.score + 0.1);
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
      .filter(block => !block.pinned)
      .sort((a, b) => (a.score - b.score) || (a.lastReferencedAt - b.lastReferencedAt));
  }
}
