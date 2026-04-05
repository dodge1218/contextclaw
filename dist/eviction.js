"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EvictionEngine = void 0;
class EvictionEngine {
    budget;
    memory;
    strategy;
    history = [];
    constructor(budget, memory, strategy = 'lru-scored') {
        this.budget = budget;
        this.memory = memory;
        this.strategy = strategy;
    }
    async evictUntilBudget() {
        const evicted = [];
        const flushedPaths = [];
        while (this.budget.overBudget) {
            const candidates = this.getCandidates();
            if (candidates.length === 0)
                break;
            const victim = candidates[0];
            this.budget.remove(victim.id);
            evicted.push(victim);
            // Flush valuable evicted content to persistent memory
            if (victim.score > 0.3 || victim.type === 'assistant') {
                const path = await this.memory.flush(victim);
                if (path)
                    flushedPaths.push(path);
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
    getCandidates() {
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
exports.EvictionEngine = EvictionEngine;
//# sourceMappingURL=eviction.js.map