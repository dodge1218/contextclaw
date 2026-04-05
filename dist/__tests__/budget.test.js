"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const budget_js_1 = require("../budget.js");
function makeBlock(id, tokens, opts = {}) {
    return {
        id,
        type: 'user',
        content: 'test',
        tokens,
        createdAt: Date.now(),
        lastReferencedAt: Date.now(),
        score: 0.5,
        pinned: false,
        evictable: false,
        ...opts,
    };
}
(0, vitest_1.describe)('ContextBudget', () => {
    (0, vitest_1.it)('tracks totalTokens after add', () => {
        const b = new budget_js_1.ContextBudget(1000);
        b.add(makeBlock('a', 100));
        b.add(makeBlock('b', 200));
        (0, vitest_1.expect)(b.totalTokens).toBe(300);
    });
    (0, vitest_1.it)('reports overBudget correctly', () => {
        const b = new budget_js_1.ContextBudget(100);
        (0, vitest_1.expect)(b.overBudget).toBe(false);
        b.add(makeBlock('a', 150));
        (0, vitest_1.expect)(b.overBudget).toBe(true);
    });
    (0, vitest_1.it)('remove reduces totalTokens', () => {
        const b = new budget_js_1.ContextBudget(1000);
        b.add(makeBlock('a', 100));
        b.add(makeBlock('b', 200));
        b.remove('a');
        (0, vitest_1.expect)(b.totalTokens).toBe(200);
    });
    (0, vitest_1.it)('getEvictionCandidates excludes pinned blocks', () => {
        const b = new budget_js_1.ContextBudget(1000);
        b.add(makeBlock('a', 100, { pinned: true }));
        b.add(makeBlock('b', 100, { pinned: false }));
        const candidates = b.getEvictionCandidates();
        (0, vitest_1.expect)(candidates.length).toBe(1);
        (0, vitest_1.expect)(candidates[0].id).toBe('b');
    });
});
(0, vitest_1.describe)('countTokens', () => {
    (0, vitest_1.it)('returns a positive number for non-empty text', () => {
        (0, vitest_1.expect)((0, budget_js_1.countTokens)('hello world')).toBeGreaterThan(0);
    });
    (0, vitest_1.it)('returns 0 for empty string', () => {
        (0, vitest_1.expect)((0, budget_js_1.countTokens)('')).toBe(0);
    });
});
//# sourceMappingURL=budget.test.js.map