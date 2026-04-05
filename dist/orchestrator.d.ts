import type { ContextClawConfig, ContextBlock } from './types.js';
import { ContextBudget } from './budget.js';
import { EvictionEngine } from './eviction.js';
import { MemoryStore } from './memory.js';
import { CircuitBreaker } from './circuit-breaker.js';
import { SubagentLauncher } from './subagent.js';
export declare class ContextClaw {
    readonly budget: ContextBudget;
    readonly eviction: EvictionEngine;
    readonly memory: MemoryStore;
    readonly circuitBreaker: CircuitBreaker;
    readonly subagents: SubagentLauncher;
    private _ingestLock;
    constructor(config: ContextClawConfig);
    /**
     * Add a new context block. If over budget, automatically evicts lowest-scored blocks.
     */
    ingest(block: Omit<ContextBlock, 'id' | 'createdAt' | 'lastReferencedAt' | 'score' | 'pinned' | 'evictable'>): Promise<void>;
    /**
     * Score a block based on type and content heuristics.
     */
    private scoreBlock;
    /**
     * Get current state for the visual inspector.
     */
    inspect(): {
        blocks: ContextBlock[];
        totalTokens: number;
        budgetTokens: number;
        utilizationPercent: number;
        evictionHistory: {
            blockId: string;
            reason: string;
            at: number;
        }[];
    };
}
//# sourceMappingURL=orchestrator.d.ts.map