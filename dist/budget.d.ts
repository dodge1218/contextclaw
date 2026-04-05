import type { ContextBlock } from './types.js';
export declare function countTokens(text: string): number;
export declare class ContextBudget {
    private maxTokens;
    private blocks;
    constructor(maxTokens: number);
    get totalTokens(): number;
    get remaining(): number;
    get utilization(): number;
    get overBudget(): boolean;
    add(block: ContextBlock): void;
    remove(id: string): ContextBlock | undefined;
    reference(id: string): void;
    getAll(): ContextBlock[];
    getSorted(): ContextBlock[];
    getEvictionCandidates(): ContextBlock[];
}
//# sourceMappingURL=budget.d.ts.map