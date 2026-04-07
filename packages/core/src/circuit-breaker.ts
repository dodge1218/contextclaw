import type { CircuitBreakerConfig } from './types.js';

type ModelIdentifier = string;

export class CircuitBreaker {
  private readonly failureCount = new Map<ModelIdentifier, number>();
  private readonly lastFailure = new Map<ModelIdentifier, number>();

  constructor(private readonly config: CircuitBreakerConfig) {}

  recordFailure(model: ModelIdentifier, statusCode: number): void {
    const count = (this.failureCount.get(model) || 0) + 1;
    this.failureCount.set(model, count);
    this.lastFailure.set(model, Date.now());

    if (statusCode === 429) {
      console.warn(`[ContextClaw] 429 on ${model} (attempt ${count}/${this.config.maxRetries})`);
    }
  }

  shouldRetry(model: ModelIdentifier): boolean {
    const count = this.failureCount.get(model) || 0;
    return count < this.config.maxRetries;
  }

  getNextModel(currentModel: ModelIdentifier): string | null {
    if (this.shouldRetry(currentModel)) return currentModel;

    for (const fallback of this.config.fallbackModels) {
      if (this.shouldRetry(fallback)) {
        console.warn(`[ContextClaw] Circuit breaker: ${currentModel} → ${fallback}`);
        return fallback;
      }
    }

    console.error('[ContextClaw] All models exhausted. Stopping.');
    return null;
  }

  isOpen(model: ModelIdentifier): boolean {
    const count = this.failureCount.get(model) || 0;
    if (count < this.config.maxRetries) return false;

    const cooldown = this.config.cooldownMs ?? 60_000;
    const last = this.lastFailure.get(model) ?? 0;
    if (Date.now() - last > cooldown) {
      this.failureCount.set(model, 0);
      return false;
    }

    return true;
  }

  reset(): void {
    this.failureCount.clear();
    this.lastFailure.clear();
  }
}
