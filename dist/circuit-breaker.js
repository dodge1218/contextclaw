"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CircuitBreaker = void 0;
class CircuitBreaker {
    config;
    failureCount = new Map();
    lastFailure = new Map();
    constructor(config) {
        this.config = config;
    }
    recordFailure(model, statusCode) {
        const count = (this.failureCount.get(model) || 0) + 1;
        this.failureCount.set(model, count);
        this.lastFailure.set(model, Date.now());
        if (statusCode === 429) {
            console.warn(`[ContextClaw] 429 on ${model} (attempt ${count}/${this.config.maxRetries})`);
        }
    }
    shouldRetry(model) {
        const count = this.failureCount.get(model) || 0;
        return count < this.config.maxRetries;
    }
    getNextModel(currentModel) {
        if (this.shouldRetry(currentModel))
            return currentModel;
        // Find next available fallback
        for (const fallback of this.config.fallbackModels) {
            if (this.shouldRetry(fallback)) {
                console.warn(`[ContextClaw] Circuit breaker: ${currentModel} → ${fallback}`);
                return fallback;
            }
        }
        console.error(`[ContextClaw] All models exhausted. Stopping.`);
        return null;
    }
    isOpen(model) {
        const count = this.failureCount.get(model) || 0;
        if (count < this.config.maxRetries)
            return false;
        // Check cooldown
        const cooldown = this.config.cooldownMs || 60_000;
        const last = this.lastFailure.get(model) || 0;
        if (Date.now() - last > cooldown) {
            this.failureCount.set(model, 0); // reset after cooldown
            return false;
        }
        return true;
    }
    reset() {
        this.failureCount.clear();
        this.lastFailure.clear();
    }
}
exports.CircuitBreaker = CircuitBreaker;
//# sourceMappingURL=circuit-breaker.js.map