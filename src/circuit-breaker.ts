import type { CircuitBreakerConfig } from './types.js';

export class CircuitBreaker {
  private config: CircuitBreakerConfig;
  private failureCount: Map<string, number> = new Map();
  private lastFailure: Map<string, number> = new Map();

  constructor(config: CircuitBreakerConfig) {
    this.config = config;
  }

  recordFailure(model: string, statusCode: number): void {
    const count = (this.failureCount.get(model) || 0) + 1;
    this.failureCount.set(model, count);
    this.lastFailure.set(model, Date.now());

    if (statusCode === 429) {
      console.warn(`[ContextClaw] 429 on ${model} (attempt ${count}/${this.config.maxRetries})`);
    }
  }

  shouldRetry(model: string): boolean {
    const count = this.failureCount.get(model) || 0;
    return count < this.config.maxRetries;
  }

  getNextModel(currentModel: string): string | null {
    if (this.shouldRetry(currentModel)) return currentModel;

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

  isOpen(model: string): boolean {
    const count = this.failureCount.get(model) || 0;
    if (count < this.config.maxRetries) return false;

    // Check cooldown
    const cooldown = this.config.cooldownMs || 60_000;
    const last = this.lastFailure.get(model) || 0;
    if (Date.now() - last > cooldown) {
      this.failureCount.set(model, 0); // reset after cooldown
      return false;
    }

    return true;
  }

  reset(): void {
    this.failureCount.clear();
    this.lastFailure.clear();
  }
}
