"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContextBudget = void 0;
exports.countTokens = countTokens;
const tiktoken_1 = require("tiktoken");
let _encoder = null;
function getEncoder() {
    if (_encoder)
        return _encoder;
    try {
        _encoder = (0, tiktoken_1.get_encoding)('cl100k_base');
        return _encoder;
    }
    catch {
        return null;
    }
}
function countTokens(text) {
    const enc = getEncoder();
    if (enc) {
        try {
            return enc.encode_ordinary(text).length;
        }
        catch {
            // fall through to estimate
        }
    }
    return Math.ceil(text.length / 4);
}
class ContextBudget {
    maxTokens;
    blocks = new Map();
    constructor(maxTokens) {
        this.maxTokens = maxTokens;
    }
    get totalTokens() {
        let total = 0;
        for (const block of this.blocks.values())
            total += block.tokens;
        return total;
    }
    get remaining() {
        return Math.max(0, this.maxTokens - this.totalTokens);
    }
    get utilization() {
        return this.totalTokens / this.maxTokens;
    }
    get overBudget() {
        return this.totalTokens > this.maxTokens;
    }
    add(block) {
        this.blocks.set(block.id, block);
    }
    remove(id) {
        const block = this.blocks.get(id);
        if (block)
            this.blocks.delete(id);
        return block;
    }
    reference(id) {
        const block = this.blocks.get(id);
        if (block) {
            block.lastReferencedAt = Date.now();
            block.score = Math.min(1, block.score + 0.1);
        }
    }
    getAll() {
        return Array.from(this.blocks.values());
    }
    getSorted() {
        return this.getAll().sort((a, b) => {
            if (a.pinned && !b.pinned)
                return -1;
            if (!a.pinned && b.pinned)
                return 1;
            return b.score - a.score;
        });
    }
    getEvictionCandidates() {
        return this.getAll()
            .filter(b => !b.pinned)
            .sort((a, b) => a.score - b.score || a.lastReferencedAt - b.lastReferencedAt);
    }
}
exports.ContextBudget = ContextBudget;
//# sourceMappingURL=budget.js.map