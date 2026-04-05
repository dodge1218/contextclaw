"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContextClaw = void 0;
const budget_js_1 = require("./budget.js");
const eviction_js_1 = require("./eviction.js");
const memory_js_1 = require("./memory.js");
const circuit_breaker_js_1 = require("./circuit-breaker.js");
const subagent_js_1 = require("./subagent.js");
class ContextClaw {
    budget;
    eviction;
    memory;
    circuitBreaker;
    subagents;
    _ingestLock = Promise.resolve();
    constructor(config) {
        this.budget = new budget_js_1.ContextBudget(config.maxContextTokens);
        this.memory = new memory_js_1.MemoryStore(config.memoryStore);
        this.eviction = new eviction_js_1.EvictionEngine(this.budget, this.memory, config.evictionStrategy);
        this.circuitBreaker = new circuit_breaker_js_1.CircuitBreaker(config.retryCircuitBreaker);
        this.subagents = new subagent_js_1.SubagentLauncher(config.subagentDefaults);
    }
    /**
     * Add a new context block. If over budget, automatically evicts lowest-scored blocks.
     */
    async ingest(block) {
        let release;
        const acquired = new Promise(r => { release = r; });
        const prev = this._ingestLock;
        this._ingestLock = acquired;
        await prev;
        try {
            const fullBlock = {
                ...block,
                id: crypto.randomUUID(),
                createdAt: Date.now(),
                lastReferencedAt: Date.now(),
                score: this.scoreBlock(block),
                pinned: block.type === 'system',
                evictable: false,
            };
            this.budget.add(fullBlock);
            if (this.budget.overBudget) {
                await this.eviction.evictUntilBudget();
            }
        }
        finally {
            release();
        }
    }
    /**
     * Score a block based on type and content heuristics.
     */
    scoreBlock(block) {
        // System messages are always important
        if (block.type === 'system')
            return 1.0;
        // User messages are high value (they contain intent)
        if (block.type === 'user')
            return 0.9;
        // Assistant messages with decisions are valuable
        if (block.type === 'assistant')
            return 0.7;
        // Tool results degrade quickly — they're the biggest bloat source
        if (block.type === 'tool-result' || block.type === 'exec-output') {
            // Large tool results score lower (more bloat per token of value)
            if (block.tokens > 2000)
                return 0.2;
            if (block.tokens > 500)
                return 0.4;
            return 0.5;
        }
        // File reads — medium value, but stale fast
        if (block.type === 'file-read')
            return 0.4;
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
exports.ContextClaw = ContextClaw;
//# sourceMappingURL=orchestrator.js.map