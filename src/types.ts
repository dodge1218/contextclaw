export interface ContextClawConfig {
  maxContextTokens: number;
  evictionStrategy: EvictionStrategy;
  memoryStore: string;
  retryCircuitBreaker: CircuitBreakerConfig;
  subagentDefaults: SubagentDefaults;
}

export type EvictionStrategy = 'lru-scored' | 'fifo' | 'manual';

export interface CircuitBreakerConfig {
  maxRetries: number;
  cooldownMs?: number;
  fallbackModels: string[];
}

export interface SubagentDefaults {
  maxContextTokens: number;
  injectOnly: ('task' | 'files' | 'skill' | 'memory')[];
  raiseHandAfter?: number; // attempts before reporting back
  model?: string;
}

export interface ContextBlock {
  id: string;
  type: 'system' | 'user' | 'assistant' | 'tool-result' | 'file-read' | 'exec-output' | 'memory';
  content: string;
  tokens: number;
  createdAt: number;
  lastReferencedAt: number;
  score: number; // 0-1, higher = more important
  pinned: boolean; // never evict
  source?: string; // tool name, file path, etc.
}

export interface SubagentConfig {
  role: 'coder' | 'writer' | 'browser-automator' | 'researcher' | 'reviewer';
  task: string;
  files?: string[];
  skill?: string;
  exitCriteria: string;
  raiseHand?: boolean;
  model?: string;
  maxContextTokens?: number;
  timeoutMs?: number;
}

export interface EvictionResult {
  evicted: ContextBlock[];
  kept: ContextBlock[];
  savedTokens: number;
  flushedToMemory: string[]; // file paths
}

export interface InspectorState {
  blocks: ContextBlock[];
  totalTokens: number;
  budgetTokens: number;
  utilizationPercent: number;
  evictionHistory: { blockId: string; reason: string; at: number }[];
}
