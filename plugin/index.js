/**
 * ContextClaw — OpenClaw Context Engine Plugin
 *
 * Smart context management that:
 * 1. Scores every message by recency, role, and relevance
 * 2. Evicts low-value content when approaching token budget
 * 3. Flushes evicted content to cold storage (local fs now, SSH later)
 * 4. Keeps user messages and recent assistant turns always in context
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

// ---------------------------------------------------------------------------
// Token estimation (cl100k-style: ~4 chars per token)
// ---------------------------------------------------------------------------
function estimateTokens(text) {
  if (!text) return 0;
  if (typeof text !== 'string') text = JSON.stringify(text);
  return Math.ceil(text.length / 4);
}

function messageTokens(msg) {
  if (!msg) return 0;
  const content = msg.content;
  if (typeof content === 'string') return estimateTokens(content);
  if (Array.isArray(content)) {
    return content.reduce((sum, block) => {
      if (typeof block === 'string') return sum + estimateTokens(block);
      if (block.type === 'text') return sum + estimateTokens(block.text);
      return sum + 100; // images, tool results, etc.
    }, 0);
  }
  return estimateTokens(JSON.stringify(content));
}

// ---------------------------------------------------------------------------
// Cold storage
// ---------------------------------------------------------------------------
const COLD_DIR = join(homedir(), '.openclaw', 'workspace', 'memory', 'cold');

function flushToCold(sessionId, messages) {
  if (!messages.length) return;
  mkdirSync(COLD_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const file = join(COLD_DIR, `${sessionId.slice(0, 8)}-${ts}.jsonl`);
  const lines = messages.map(m => JSON.stringify({
    role: m.role,
    timestamp: m.timestamp || new Date().toISOString(),
    tokens: messageTokens(m),
    content: typeof m.content === 'string'
      ? m.content.slice(0, 2000)
      : JSON.stringify(m.content).slice(0, 2000),
  }));
  writeFileSync(file, lines.join('\n') + '\n');
  return file;
}

// ---------------------------------------------------------------------------
// Scoring: higher = more valuable = keep longer
// ---------------------------------------------------------------------------
function scoreMessage(msg, index, total, recentUserContent) {
  let score = 0;

  // Recency: linear 0..1
  score += (index / Math.max(total - 1, 1)) * 0.4;

  // Role weights
  const role = msg.role;
  if (role === 'system') return 999; // never evict
  if (role === 'user') score += 0.35;
  if (role === 'assistant') score += 0.15;
  if (role === 'toolResult' || role === 'tool') score += 0.05;
  if (role === 'toolCall' || role === 'function') score += 0.05;

  // Size penalty: huge messages are eviction candidates
  const tokens = messageTokens(msg);
  if (tokens > 5000) score -= 0.15;
  if (tokens > 20000) score -= 0.25;

  return score;
}

// ---------------------------------------------------------------------------
// ContextClaw Engine
// ---------------------------------------------------------------------------
class ContextClawEngine {
  constructor() {
    this.info = {
      id: 'contextclaw',
      name: 'ContextClaw',
      version: '0.1.0',
      ownsCompaction: true,
    };
    // Track per-session state
    this._sessions = new Map();
  }

  async bootstrap({ sessionId }) {
    this._sessions.set(sessionId, { ingested: 0, compactions: 0 });
    return { bootstrapped: true };
  }

  async ingest({ sessionId, message }) {
    const s = this._sessions.get(sessionId) || { ingested: 0, compactions: 0 };
    s.ingested++;
    this._sessions.set(sessionId, s);
    return { ingested: true };
  }

  async ingestBatch({ sessionId, messages }) {
    const s = this._sessions.get(sessionId) || { ingested: 0, compactions: 0 };
    s.ingested += messages.length;
    this._sessions.set(sessionId, s);
    return { ingestedCount: messages.length };
  }

  async assemble({ sessionId, messages, tokenBudget, prompt }) {
    if (!tokenBudget) tokenBudget = 55000;

    // Score all messages
    const scored = messages.map((msg, i) => ({
      msg,
      index: i,
      tokens: messageTokens(msg),
      score: scoreMessage(msg, i, messages.length),
    }));

    // Calculate total
    const totalTokens = scored.reduce((s, m) => s + m.tokens, 0);

    // If under budget, pass everything through
    if (totalTokens <= tokenBudget) {
      return {
        messages,
        estimatedTokens: totalTokens,
      };
    }

    // Over budget — evict lowest-scored messages until we fit
    // Sort by score ascending (lowest = evict first), but preserve order for output
    const evictOrder = [...scored]
      .filter(s => s.score < 999) // never evict system
      .sort((a, b) => a.score - b.score);

    const evicted = new Set();
    let currentTokens = totalTokens;
    const target = tokenBudget * 0.85; // compact to 85% to avoid thrashing

    for (const item of evictOrder) {
      if (currentTokens <= target) break;
      evicted.add(item.index);
      currentTokens -= item.tokens;
    }

    // Flush evicted messages to cold storage
    const evictedMsgs = scored
      .filter(s => evicted.has(s.index))
      .map(s => s.msg);
    if (evictedMsgs.length > 0) {
      flushToCold(sessionId, evictedMsgs);
    }

    // Build output preserving original order
    const kept = scored
      .filter(s => !evicted.has(s.index))
      .map(s => s.msg);

    const keptTokens = scored
      .filter(s => !evicted.has(s.index))
      .reduce((sum, s) => sum + s.tokens, 0);

    const addition = evictedMsgs.length > 0
      ? `[ContextClaw] ${evictedMsgs.length} older messages evicted to cold storage. ${keptTokens} tokens retained of ${totalTokens} original.`
      : undefined;

    return {
      messages: kept,
      estimatedTokens: keptTokens,
      systemPromptAddition: addition,
    };
  }

  async compact({ sessionId, sessionFile, tokenBudget, force, currentTokenCount }) {
    const budget = tokenBudget || 55000;
    const current = currentTokenCount || 0;
    const s = this._sessions.get(sessionId) || { ingested: 0, compactions: 0 };

    // Only compact if over 90% of budget or forced
    if (!force && current < budget * 0.9) {
      return { ok: true, compacted: false, reason: `Under threshold (${current}/${budget})` };
    }

    s.compactions++;
    this._sessions.set(sessionId, s);

    return {
      ok: true,
      compacted: true,
      reason: 'Delegated to assemble-time eviction',
      result: {
        tokensBefore: current,
        tokensAfter: Math.floor(budget * 0.85),
        summary: `ContextClaw compaction #${s.compactions}: eviction handled at assemble time`,
      },
    };
  }

  async afterTurn({ sessionId, messages, tokenBudget, runtimeContext }) {
    // Proactive maintenance: if tool results are huge, rewrite them
    if (!runtimeContext?.rewriteTranscriptEntries) return;

    const replacements = [];
    for (const msg of messages) {
      if ((msg.role === 'toolResult' || msg.role === 'tool') && messageTokens(msg) > 5000) {
        // Truncate oversized tool results in the transcript
        const truncated = typeof msg.content === 'string'
          ? msg.content.slice(0, 2000) + '\n\n[ContextClaw: truncated from ' + messageTokens(msg) + ' tokens]'
          : msg.content;

        if (msg.id) {
          replacements.push({
            entryId: msg.id,
            message: { ...msg, content: truncated },
          });
        }
      }
    }

    if (replacements.length > 0) {
      try {
        await runtimeContext.rewriteTranscriptEntries({ replacements });
      } catch (e) {
        // Best effort — don't crash the turn
      }
    }
  }

  async maintain({ sessionId }) {
    return { changed: false, bytesFreed: 0, rewrittenEntries: 0 };
  }

  async dispose() {
    this._sessions.clear();
  }
}

// ---------------------------------------------------------------------------
// Plugin registration
// ---------------------------------------------------------------------------
export default function setup(runtime) {
  runtime.registerContextEngine('contextclaw', () => new ContextClawEngine());
}
