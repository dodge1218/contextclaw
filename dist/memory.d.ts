import type { ContextBlock } from './types.js';
export declare class MemoryStore {
    private dir;
    constructor(dir: string);
    init(): Promise<void>;
    flush(block: ContextBlock): Promise<string | null>;
    search(query: string, maxResults?: number): Promise<{
        path: string;
        snippet: string;
        score: number;
    }[]>;
}
//# sourceMappingURL=memory.d.ts.map