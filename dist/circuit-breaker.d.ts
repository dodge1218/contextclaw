import type { CircuitBreakerConfig } from './types.js';
export declare class CircuitBreaker {
    private config;
    private failureCount;
    private lastFailure;
    constructor(config: CircuitBreakerConfig);
    recordFailure(model: string, statusCode: number): void;
    shouldRetry(model: string): boolean;
    getNextModel(currentModel: string): string | null;
    isOpen(model: string): boolean;
    reset(): void;
}
//# sourceMappingURL=circuit-breaker.d.ts.map