/**
 * 🧠 ContextClaw — Context Engine Plugin for OpenClaw
 *
 * Treats your context window like RAM, not a logbook.
 * Scores every message by topic relevance, recency, and role —
 * then evicts the lowest-value items to cold storage before
 * each API call.
 *
 * MIT — https://github.com/dodge1218/contextclaw
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { WebSocketServer } from 'ws';
import { encoding_for_model } from 'tiktoken';

// Reuse a single encoder instance (cl100k_base covers GPT-4/Claude-class models)
const enc = encoding_for_model('gpt-4');

// ---------------------------------------------------------------------------
// Lifetime stats — track total tokens saved
// ---------------------------------------------------------------------------

const stats = {
  totalEvicted: 0,
  totalTokensSaved: 0,
  totalAssembleCalls: 0,
};

const COLD_DIR = join(homedir(), '.openclaw', 'workspace', 'memory', 'cold');
const TARGET_RATIO = 0.12;   // aggressive for testing — force eviction on small sessions
const WS_PORT = 41234;

// ---------------------------------------------------------------------------
// Token estimation (~4 chars/token, cl100k-ish)
// ---------------------------------------------------------------------------

function countTokens(text) {
  if (!text) return 0;
  if (typeof text !== 'string') text = JSON.stringify(text);
  try {
    return enc.encode(text).length;
  } catch (_) {
    // Fallback: ~5.5 chars/token for English text (measured)
    return Math.ceil(text.length / 5);
  }
}

function messageTokens(msg) {
  if (!msg) return 0;
  const c = msg.content;
  if (typeof c === 'string') return countTokens(c);
  if (Array.isArray(c)) {
    return c.reduce((sum, block) => {
      if (typeof block === 'string') return sum + countTokens(block);
      if (block.type === 'text') return sum + countTokens(block.text);
      return sum + 100; // images, binary, etc.
    }, 0);
  }
  return countTokens(JSON.stringify(c));
}

// ---------------------------------------------------------------------------
// Topic extraction — pull keywords from recent user messages
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
  'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as',
  'into', 'about', 'like', 'through', 'after', 'over', 'between',
  'and', 'but', 'or', 'nor', 'not', 'so', 'yet', 'both', 'either',
  'neither', 'each', 'every', 'all', 'any', 'few', 'more', 'most',
  'other', 'some', 'such', 'no', 'only', 'own', 'same', 'than',
  'too', 'very', 'just', 'because', 'if', 'when', 'where', 'how',
  'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those',
  'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'him', 'his',
  'she', 'her', 'it', 'its', 'they', 'them', 'their', 'also', 'then',
  'here', 'there', 'up', 'out', 'yes', 'no', 'ok', 'okay', 'sure',
  'now', 'well', 'get', 'got', 'make', 'made', 'let', 'go', 'going',
  'think', 'know', 'see', 'look', 'want', 'use', 'using', 'used',
]);

function extractKeywords(text) {
  if (!text || typeof text !== 'string') return new Set();
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-_]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w))
  );
}

function getTopicKeywords(messages) {
  // Pull keywords from last 3 user messages = current topic
  const recentUser = messages
    .filter(m => m.role === 'user')
    .slice(-3);

  const keywords = new Set();
  for (const msg of recentUser) {
    const text = typeof msg.content === 'string'
      ? msg.content
      : JSON.stringify(msg.content);
    for (const kw of extractKeywords(text)) {
      keywords.add(kw);
    }
  }
  return keywords;
}

// ---------------------------------------------------------------------------
// Scoring — topic-aware, recency-weighted, role-adjusted
// ---------------------------------------------------------------------------

function scoreMessage(msg, index, total, topicKeywords) {
  // System messages are sacred
  if (msg.role === 'system') return 999;

  let score = 0;

  // 1. Recency: 0.0 (oldest) → 0.4 (newest)
  score += (index / Math.max(total - 1, 1)) * 0.4;

  // 2. Role weight
  if (msg.role === 'user') score += 0.25;
  else if (msg.role === 'assistant') score += 0.15;
  else score += 0.05; // tool results, tool calls

  // 3. Topic relevance: does this message mention current-topic keywords?
  const text = typeof msg.content === 'string'
    ? msg.content
    : JSON.stringify(msg.content || '');
  const msgWords = extractKeywords(text);
  let overlap = 0;
  for (const kw of msgWords) {
    if (topicKeywords.has(kw)) overlap++;
  }
  // Normalize overlap to 0..0.35 range
  const relevance = topicKeywords.size > 0
    ? Math.min(overlap / topicKeywords.size, 1) * 0.35
    : 0;
  score += relevance;

  // 4. Size penalty: bloated tool outputs are prime eviction candidates
  const tokens = messageTokens(msg);
  if (tokens > 2000) score -= 0.15;
  if (tokens > 5000) score -= 0.25;
  if (tokens > 10000) score -= 0.35;
  if (tokens > 20000) score -= 0.5;

  return score;
}

// ---------------------------------------------------------------------------
// Cold storage — flush evicted messages to disk
// ---------------------------------------------------------------------------

function flushToCold(sessionId, messages) {
  if (!messages.length) return;
  mkdirSync(COLD_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const file = join(COLD_DIR, `${sessionId.slice(0, 8)}-${ts}.jsonl`);
  const lines = messages.map(m => JSON.stringify({
    role: m.role,
    timestamp: m.timestamp || new Date().toISOString(),
    tokens: messageTokens(m),
    // Truncate to save disk — full content isn't needed for recall
    content: typeof m.content === 'string'
      ? m.content.slice(0, 2000)
      : JSON.stringify(m.content).slice(0, 2000),
  }));
  writeFileSync(file, lines.join('\n') + '\n');
}

// ---------------------------------------------------------------------------
// WebSocket telemetry — broadcast to Studio
// ---------------------------------------------------------------------------

let wss = null;
const clients = new Set();

function initWs() {
  if (wss) return;
  try {
    wss = new WebSocketServer({ port: WS_PORT });
    wss.on('error', () => { wss = null; }); // port busy, skip
    wss.on('connection', ws => {
      clients.add(ws);
      ws.on('close', () => clients.delete(ws));
    });
  } catch (_) {
    wss = null;
  }
}

function broadcast(data) {
  const payload = JSON.stringify(data);
  for (const c of clients) {
    if (c.readyState === 1) c.send(payload);
  }
}

// ---------------------------------------------------------------------------
// ContextClaw Engine
// ---------------------------------------------------------------------------

class ContextClawEngine {
  constructor() {
    this.info = {
      id: 'contextclaw',
      name: 'ContextClaw',
      version: '0.2.0',
      ownsCompaction: true,
    };
    this._sessions = new Map();
    initWs();
  }

  async bootstrap({ sessionId }) {
    this._sessions.set(sessionId, { turns: 0, evictions: 0 });
    return { bootstrapped: true };
  }

  async ingest({ sessionId }) {
    const s = this._sessions.get(sessionId) || { turns: 0, evictions: 0 };
    s.turns++;
    this._sessions.set(sessionId, s);
    return { ingested: true };
  }

  async ingestBatch({ sessionId, messages }) {
    const s = this._sessions.get(sessionId) || { turns: 0, evictions: 0 };
    s.turns += messages.length;
    this._sessions.set(sessionId, s);
    return { ingestedCount: messages.length };
  }

  /**
   * Core loop — runs on every turn before the API call.
   *
   * 1. Extract topic keywords from last 3 user messages
   * 2. Score every message: topic relevance + recency + role - size penalty
   * 3. Evict lowest-scored until we're at 60% of budget
   * 4. Flush evicted messages to cold storage on disk
   * 5. Broadcast telemetry to Studio via WebSocket
   */
  async assemble({ sessionId, messages, tokenBudget }) {
    if (!tokenBudget) tokenBudget = 55000;
    const target = tokenBudget * TARGET_RATIO;

    stats.totalAssembleCalls++;

    // Step 1: What is the user talking about right now?
    const topicKeywords = getTopicKeywords(messages);

    // Step 2: Score everything
    const scored = messages.map((msg, i) => ({
      msg,
      index: i,
      tokens: messageTokens(msg),
      score: scoreMessage(msg, i, messages.length, topicKeywords),
    }));

    const totalTokens = scored.reduce((s, m) => s + m.tokens, 0);

    console.log(`[ContextClaw] assemble: ${messages.length} msgs, ${totalTokens} tokens (real), budget=${tokenBudget}, target=${target}`);

    // Step 3: Protect last 3 turn pairs (6 messages) — never evict these
    const PROTECTED_TURNS = 6; // 3 user + 3 assistant
    const protectedStart = Math.max(0, messages.length - PROTECTED_TURNS);
    
    const evictCandidates = [...scored]
      .filter(s => s.score < 999 && s.index < protectedStart) // skip system AND recent turns
      .sort((a, b) => a.score - b.score);

    const evicted = new Set();
    let currentTokens = totalTokens;

    for (const item of evictCandidates) {
      if (currentTokens <= target) break;
      evicted.add(item.index);
      currentTokens -= item.tokens;
    }

    // Step 4: Cold storage
    const evictedMsgs = scored.filter(s => evicted.has(s.index)).map(s => s.msg);
    if (evictedMsgs.length > 0) {
      flushToCold(sessionId, evictedMsgs);
    }

    // Build output (preserve original order)
    const kept = scored.filter(s => !evicted.has(s.index)).map(s => s.msg);
    const keptTokens = scored
      .filter(s => !evicted.has(s.index))
      .reduce((sum, s) => sum + s.tokens, 0);

    // Step 5: Telemetry
    broadcast({
      type: 'ASSEMBLE',
      sessionId,
      totalTokens,
      keptTokens,
      evictedCount: evictedMsgs.length,
      budget: tokenBudget,
      topicKeywords: [...topicKeywords].slice(0, 10),
      lifetimeTokensSaved: stats.totalTokensSaved,
      lifetimeEvictions: stats.totalEvicted,
      lifetimeAssembles: stats.totalAssembleCalls,
    });

    const sess = this._sessions.get(sessionId) || { turns: 0, evictions: 0 };
    sess.evictions += evictedMsgs.length;
    const tokensSaved = totalTokens - keptTokens;
    stats.totalEvicted += evictedMsgs.length;
    stats.totalTokensSaved += tokensSaved;
    this._sessions.set(sessionId, sess);

    if (evictedMsgs.length > 0) {
      console.log(`[ContextClaw] evicted ${evictedMsgs.length} msgs, saved ${tokensSaved} tokens this turn | lifetime: ${stats.totalTokensSaved} tokens saved across ${stats.totalAssembleCalls} turns`);
    }

    return {
      messages: kept,
      estimatedTokens: keptTokens,
      systemPromptAddition: evictedMsgs.length > 0
        ? `[ContextClaw] Evicted ${evictedMsgs.length} low-relevance messages. ${keptTokens} tokens kept of ${totalTokens}. Topic: ${[...topicKeywords].slice(0, 5).join(', ')}`
        : undefined,
    };
  }

  async compact({ sessionId, tokenBudget, force, currentTokenCount }) {
    // ContextClaw handles compaction at assemble time, not here
    return {
      ok: true,
      compacted: force,
      reason: 'ContextClaw handles eviction at assemble time',
    };
  }

  async afterTurn({ sessionId, messages, runtimeContext }) {
    // Truncate oversized tool results in the transcript
    if (!runtimeContext?.rewriteTranscriptEntries) return;

    const replacements = [];
    for (const msg of messages) {
      if ((msg.role === 'toolResult' || msg.role === 'tool') && messageTokens(msg) > 5000) {
        const truncated = typeof msg.content === 'string'
          ? msg.content.slice(0, 2000) + `\n\n[ContextClaw: truncated from ${messageTokens(msg)} tokens]`
          : msg.content;
        if (msg.id) {
          replacements.push({ entryId: msg.id, message: { ...msg, content: truncated } });
        }
      }
    }

    if (replacements.length > 0) {
      try { await runtimeContext.rewriteTranscriptEntries({ replacements }); }
      catch (_) { /* best effort */ }
    }
  }

  async maintain() {
    return { changed: false, bytesFreed: 0, rewrittenEntries: 0 };
  }

  async dispose() {
    this._sessions.clear();
    if (wss) { wss.close(); wss = null; }
  }
}

// ---------------------------------------------------------------------------
// Plugin registration
// ---------------------------------------------------------------------------

export default function setup(runtime) {
  runtime.registerContextEngine('contextclaw', () => new ContextClawEngine());
}
