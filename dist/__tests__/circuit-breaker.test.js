"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const circuit_breaker_js_1 = require("../circuit-breaker.js");
(0, vitest_1.describe)('CircuitBreaker', () => {
    const config = { maxRetries: 3, cooldownMs: 100, fallbackModels: ['gpt-4o-mini'] };
    (0, vitest_1.it)('allows retry when under max retries', () => {
        const cb = new circuit_breaker_js_1.CircuitBreaker(config);
        cb.recordFailure('gpt-4o', 500);
        (0, vitest_1.expect)(cb.shouldRetry('gpt-4o')).toBe(true);
    });
    (0, vitest_1.it)('blocks retry after max retries reached', () => {
        const cb = new circuit_breaker_js_1.CircuitBreaker(config);
        cb.recordFailure('gpt-4o', 429);
        cb.recordFailure('gpt-4o', 429);
        cb.recordFailure('gpt-4o', 429);
        (0, vitest_1.expect)(cb.shouldRetry('gpt-4o')).toBe(false);
    });
    (0, vitest_1.it)('falls back to next model when primary exhausted', () => {
        const cb = new circuit_breaker_js_1.CircuitBreaker(config);
        for (let i = 0; i < 3; i++)
            cb.recordFailure('gpt-4o', 429);
        const next = cb.getNextModel('gpt-4o');
        (0, vitest_1.expect)(next).toBe('gpt-4o-mini');
    });
    (0, vitest_1.it)('returns null when all models exhausted', () => {
        const cb = new circuit_breaker_js_1.CircuitBreaker(config);
        for (let i = 0; i < 3; i++)
            cb.recordFailure('gpt-4o', 429);
        for (let i = 0; i < 3; i++)
            cb.recordFailure('gpt-4o-mini', 429);
        (0, vitest_1.expect)(cb.getNextModel('gpt-4o')).toBeNull();
    });
    (0, vitest_1.it)('resets after cooldown', async () => {
        const cb = new circuit_breaker_js_1.CircuitBreaker({ ...config, cooldownMs: 50 });
        for (let i = 0; i < 3; i++)
            cb.recordFailure('gpt-4o', 429);
        (0, vitest_1.expect)(cb.isOpen('gpt-4o')).toBe(true);
        await new Promise(r => setTimeout(r, 60));
        (0, vitest_1.expect)(cb.isOpen('gpt-4o')).toBe(false);
    });
});
//# sourceMappingURL=circuit-breaker.test.js.map