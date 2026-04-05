import type { EvictionResult, EvictionStrategy } from './types.js';
import { ContextBudget } from './budget.js';
import { MemoryStore } from './memory.js';
export declare class EvictionEngine {
    private budget;
    private memory;
    private strategy;
    private history;
    constructor(budget: ContextBudget, memory: MemoryStore, strategy?: EvictionStrategy);
    evictUntilBudget(): Promise<EvictionResult>;
    getHistory(): {
        blockId: string;
        reason: string;
        at: number;
    }[];
    private getCandidates;
}
//# sourceMappingURL=eviction.d.ts.map