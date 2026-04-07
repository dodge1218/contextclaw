/**
 * ContextClaw Watcher — monitors active session and triggers compaction.
 * 
 * Architecture note (glasses → PC):
 *   The watcher runs wherever the gateway runs (glasses, laptop, Pi).
 *   Cold storage lives on the remote machine (PC, Vast instance).
 *   The watcher just decides WHEN to compact and WHAT to keep.
 *   Storage backend is pluggable — local fs now, SSH/tunnel later.
 */

import { createReadStream, readdirSync, statSync } from 'fs';
import { writeFile, mkdir } from 'fs/promises';
import { join, basename } from 'path';
import { homedir } from 'os';
import { createInterface } from 'readline';
import { countTokens } from './budget.js';
import { streamJsonl } from './jsonl-reader.js';
import { generateTruncationMarker } from './markers.js';

export interface WatcherConfig {
  /** Token threshold before triggering compaction advisory */
  warnThreshold: number;
  /** Token threshold before auto-compacting */
  compactThreshold: number;
  /** Where to flush cold storage summaries */
  coldStorageDir: string;
  /** Max tokens for a single tool result before truncation */
  toolResultMaxTokens: number;
  /** Poll interval in ms (fallback if fs.watch doesn't fire) */
  pollIntervalMs: number;
}

const DEFAULT_CONFIG: WatcherConfig = {
  warnThreshold: 40000,
  compactThreshold: 55000,
  coldStorageDir: join(homedir(), '.openclaw', 'workspace', 'memory', 'cold'),
  toolResultMaxTokens: 2000,
  pollIntervalMs: 5000,
};

interface SessionTurn {
  role: string;
  content: string;
  tokens: number;
  type: string;
  timestamp: string;
  usage?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    totalTokens?: number;
  };
}

export class SessionWatcher {
  private config: WatcherConfig;
  private sessionsDir: string;
  private activeSessionPath: string | null = null;
  private lastSize = 0;
  private running = false;
  private onAlert?: (msg: string) => void;
  private pollTimer?: NodeJS.Timeout;
  private turnCache: SessionTurn[] = [];
  private streamOffset = 0;
  private pendingLine = '';
  private streamPromise: Promise<void> | null = null;

  constructor(config: Partial<WatcherConfig> = {}, onAlert?: (msg: string) => void) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.sessionsDir = join(homedir(), '.openclaw', 'agents', 'main', 'sessions');
    this.onAlert = onAlert;
  }

  /**
   * Find the most recently modified session file.
   */
  findActiveSession(): string | null {
    try {
      const files = readdirSync(this.sessionsDir)
        .filter(f => f.endsWith('.jsonl'))
        .map(f => ({
          name: f,
          path: join(this.sessionsDir, f),
          mtime: statSync(join(this.sessionsDir, f)).mtimeMs,
        }))
        .sort((a, b) => b.mtime - a.mtime);
      return files[0]?.path ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Parse a session JSONL via streaming to avoid OOM on large files.
   * Falls back to sync read for small files (<1MB) for speed.
   */
  async parseSessionAsync(filePath: string): Promise<SessionTurn[]> {
    const turns: SessionTurn[] = [];
    for await (const entry of streamJsonl(filePath)) {
      const turn = this._entryToTurn(entry);
      if (turn) turns.push(turn);
    }
    return turns;
  }

  private _entryToTurn(entry: any): SessionTurn | null {
    if (entry.type !== 'message' || !entry.message) return null;
    const msg = entry.message;
    const content = typeof msg.content === 'string'
      ? msg.content
      : JSON.stringify(msg.content ?? '');

    return {
      role: msg.role ?? 'unknown',
      content,
      tokens: msg.usage?.totalTokens ?? countTokens(content),
      type: this.classifyTurn(msg),
      timestamp: entry.timestamp ?? '',
      usage: msg.usage,
    };
  }

  private classifyTurn(msg: any): string {
    if (msg.role === 'user') return 'user';
    if (msg.role === 'assistant') {
      if (typeof msg.content === 'string') return 'assistant';
      // Check for tool calls in content array
      if (Array.isArray(msg.content)) {
        const hasToolUse = msg.content.some((b: any) => b.type === 'tool_use');
        if (hasToolUse) return 'tool-call';
      }
      return 'assistant';
    }
    if (msg.role === 'toolResult') return 'tool-result';
    return msg.role ?? 'unknown';
  }

  /**
   * Analyze current session and return a diagnostic report.
   */
  async analyzeCurrentSession(): Promise<{
    sessionFile: string;
    turnCount: number;
    estimatedContextTokens: number;
    breakdown: Record<string, { count: number; tokens: number }>;
    bloatSources: { type: string; tokens: number; preview: string }[];
    recommendation: 'ok' | 'warn' | 'compact-now';
  } | null> {
    const sessionPath = await this.ensureActiveSession();
    if (!sessionPath) return null;

    await this.ensureTurnsUpToDate();
    const turns = [...this.turnCache];
    const breakdown: Record<string, { count: number; tokens: number }> = {};
    const bloatSources: { type: string; tokens: number; preview: string }[] = [];

    let totalTokens = 0;
    for (const turn of turns) {
      if (!breakdown[turn.type]) breakdown[turn.type] = { count: 0, tokens: 0 };
      breakdown[turn.type].count++;
      breakdown[turn.type].tokens += turn.tokens;
      totalTokens += turn.tokens;

      // Flag individual bloat sources (>2K tokens)
      if (turn.tokens > this.config.toolResultMaxTokens) {
        bloatSources.push({
          type: turn.type,
          tokens: turn.tokens,
          preview: turn.content.slice(0, 100) + '...',
        });
      }
    }

    // Truncate oversized tool results and insert nonce markers
    for (const turn of turns) {
      if (turn.type === 'tool-result' && turn.tokens > this.config.toolResultMaxTokens) {
        const marker = generateTruncationMarker(turn.tokens);
        const maxChars = this.config.toolResultMaxTokens * 4; // rough chars-per-token
        turn.content = turn.content.slice(0, maxChars) + `\n${marker}`;
        turn.tokens = countTokens(turn.content);
      }
    }

    // Sort bloat sources by size
    bloatSources.sort((a, b) => b.tokens - a.tokens);

    // Use the last assistant turn's cache stats if available for real context size
    const lastAssistant = [...turns].reverse().find(t => t.usage?.cacheRead || t.usage?.input);
    const estimatedContextTokens = lastAssistant
      ? (lastAssistant.usage?.input ?? 0) + (lastAssistant.usage?.cacheRead ?? 0) + (lastAssistant.usage?.cacheWrite ?? 0)
      : totalTokens;

    let recommendation: 'ok' | 'warn' | 'compact-now' = 'ok';
    if (estimatedContextTokens > this.config.compactThreshold) recommendation = 'compact-now';
    else if (estimatedContextTokens > this.config.warnThreshold) recommendation = 'warn';

    return {
      sessionFile: basename(sessionPath),
      turnCount: turns.length,
      estimatedContextTokens,
      breakdown,
      bloatSources: bloatSources.slice(0, 10),
      recommendation,
    };
  }

  /**
   * Generate a compaction summary — what to keep, what to flush to cold storage.
   */
  async generateCompactionPlan(sessionPath?: string): Promise<{
    keep: { type: string; preview: string; tokens: number }[];
    flush: { type: string; preview: string; tokens: number; reason: string }[];
    estimatedSavings: number;
  }> {
    const path = sessionPath ?? await this.ensureActiveSession();
    if (!path) return { keep: [], flush: [], estimatedSavings: 0 };

    let turns: SessionTurn[];
    if (!sessionPath || path === this.activeSessionPath) {
      await this.ensureTurnsUpToDate();
      turns = [...this.turnCache];
    } else {
      turns = await this.parseSessionAsync(path);
    }
    const keep: { type: string; preview: string; tokens: number }[] = [];
    const flush: { type: string; preview: string; tokens: number; reason: string }[] = [];

    for (const turn of turns) {
      const preview = turn.content.slice(0, 120);

      // Keep: user messages, recent assistant messages (last 5)
      if (turn.role === 'user') {
        keep.push({ type: turn.type, preview, tokens: turn.tokens });
        continue;
      }

      // Flush: large tool results (the #1 problem)
      if (turn.type === 'tool-result' && turn.tokens > this.config.toolResultMaxTokens) {
        flush.push({
          type: turn.type, preview, tokens: turn.tokens,
          reason: `Tool result exceeds ${this.config.toolResultMaxTokens} token limit`,
        });
        continue;
      }

      // Flush: old assistant turns (keep last 5)
      const assistantTurns = turns.filter(t => t.role === 'assistant');
      const recentAssistant = new Set(assistantTurns.slice(-5));
      if (turn.role === 'assistant' && !recentAssistant.has(turn)) {
        flush.push({
          type: turn.type, preview, tokens: turn.tokens,
          reason: 'Old assistant turn (keeping last 5)',
        });
        continue;
      }

      keep.push({ type: turn.type, preview, tokens: turn.tokens });
    }

    return {
      keep,
      flush,
      estimatedSavings: flush.reduce((s, f) => s + f.tokens, 0),
    };
  }

  /**
   * Flush content to cold storage directory.
   */
  async flushToColdStorage(content: string, label: string): Promise<string> {
    await mkdir(this.config.coldStorageDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${label}-${ts}.md`;
    const path = join(this.config.coldStorageDir, filename);
    await writeFile(path, content, 'utf-8');
    return path;
  }

  /**
   * Start watching the active session. Fires onAlert when thresholds are crossed.
   */
  start(): void {
    this.running = true;
    this.activeSessionPath = this.findActiveSession();
    this.resetStreamState();

    if (!this.activeSessionPath) {
      this.onAlert?.('[ContextClaw] No active session found');
      return;
    }

    console.log(`[ContextClaw] Watching: ${basename(this.activeSessionPath)}`);
    console.log(`[ContextClaw] Warn at ${this.config.warnThreshold} tokens, compact at ${this.config.compactThreshold}`);

    // Initial analysis
    this.checkAndAlert();

    // Poll for changes (more reliable than fs.watch across platforms)
    this.pollTimer = setInterval(async () => {
      if (!this.running) return;
      try {
        const currentSession = this.findActiveSession();
        if (currentSession !== this.activeSessionPath) {
          console.log(`[ContextClaw] Session switched to: ${basename(currentSession ?? 'none')}`);
          this.activeSessionPath = currentSession;
          this.resetStreamState();
        }
        if (!this.activeSessionPath) return;

        const stat = statSync(this.activeSessionPath);
        if (stat.size !== this.lastSize) {
          this.lastSize = stat.size;
          await this.checkAndAlert();
        }
      } catch {
        // session file may be temporarily unavailable
      }
    }, this.config.pollIntervalMs);
  }

  stop(): void {
    this.running = false;
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  private async checkAndAlert(): Promise<void> {
    const analysis = await this.analyzeCurrentSession();
    if (!analysis) return;

    const ctx = analysis.estimatedContextTokens;
    const pct = ((ctx / this.config.compactThreshold) * 100).toFixed(0);

    if (analysis.recommendation === 'compact-now') {
      this.onAlert?.(
        `⚠️ [ContextClaw] COMPACT NOW — ${ctx.toLocaleString()} tokens (${pct}% of limit)\n` +
        `  Top bloat: ${analysis.bloatSources.slice(0, 3).map(b => `${b.type}: ${b.tokens} tokens`).join(', ')}`
      );
    } else if (analysis.recommendation === 'warn') {
      this.onAlert?.(
        `🟡 [ContextClaw] Context growing — ${ctx.toLocaleString()} tokens (${pct}% of limit)`
      );
    } else {
      console.log(`[ContextClaw] OK — ${ctx.toLocaleString()} tokens (${pct}% of limit)`);
    }
  }

  private resetStreamState(): void {
    this.turnCache = [];
    this.streamOffset = 0;
    this.pendingLine = '';
    this.streamPromise = null;
    this.lastSize = 0;
  }

  private async ensureActiveSession(): Promise<string | null> {
    if (this.activeSessionPath) return this.activeSessionPath;
    const path = this.findActiveSession();
    if (path) {
      this.activeSessionPath = path;
      this.resetStreamState();
    }
    return this.activeSessionPath;
  }

  private async ensureTurnsUpToDate(): Promise<void> {
    if (!this.activeSessionPath) return;
    if (this.streamPromise) {
      await this.streamPromise;
      return;
    }

    const path = this.activeSessionPath;
    this.streamPromise = this.consumeSessionStream(path).finally(() => {
      this.streamPromise = null;
    });
    await this.streamPromise;
  }

  private async consumeSessionStream(path: string): Promise<void> {
    let startOffset = this.streamOffset;
    try {
      const stat = statSync(path);
      if (startOffset > stat.size) {
        startOffset = 0;
        this.turnCache = [];
      }
      if (stat.size === startOffset && !this.pendingLine) {
        this.lastSize = stat.size;
        return;
      }
    } catch {
      return;
    }

    const rl = createInterface({
      input: createReadStream(path, { encoding: 'utf-8', start: startOffset }),
      crlfDelay: Infinity,
    });

    let carry = this.pendingLine;

    for await (const rawLine of rl) {
      const line = carry ? carry + rawLine : rawLine;
      carry = '';
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const entry = JSON.parse(trimmed);
        const turn = this._entryToTurn(entry);
        if (turn) this.turnCache.push(turn);
      } catch (err: any) {
        if (err?.message?.includes('Unexpected end of JSON input')) {
          carry = line;
        } else {
          console.warn('[ContextClaw] Skipping malformed session line:', err?.message ?? err);
        }
      }
    }

    this.pendingLine = carry;

    try {
      const stat = statSync(path);
      this.streamOffset = stat.size;
      this.lastSize = stat.size;
    } catch {
      // File vanished mid-stream; keep previous offsets so we'll retry later
    }
  }
}
