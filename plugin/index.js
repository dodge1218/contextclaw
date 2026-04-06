/**
 * 🧠 ContextClaw v1 — Context Engine Plugin for OpenClaw
 *
 * Classifies context by content type. Applies retention policies.
 * Files get truncated. Command output gets tailed. Conversations stay intact.
 *
 * MIT — https://github.com/dodge1218/contextclaw
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { WebSocketServer } from 'ws';
import { classifyAll, TYPES } from './classifier.js';
import { applyPolicy, DEFAULT_POLICIES } from './policy.js';

// -------------------------------------------------------
// Lifetime stats
// -------------------------------------------------------

const stats = {
  totalTruncated: 0,
  totalCharsSaved: 0,
  totalAssembleCalls: 0,
  byType: {},
};

// Default config
const DEFAULT_CONFIG = {
  coldStorageDir: join(homedir(), '.openclaw', 'workspace', 'memory', 'cold'),
  wsPort: 41234,
  enableTelemetry: true,
  policies: {},  // per-type policy overrides
};

// -------------------------------------------------------
// Cold storage — flush truncated/evicted items to disk
// -------------------------------------------------------

function flushToCold(sessionId, items, coldDir) {
  if (!items.length) return;
  setImmediate(() => {
    try {
      const expandedDir = coldDir.startsWith('~/')
        ? join(homedir(), coldDir.slice(2))
        : coldDir;
      mkdirSync(expandedDir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const sid = (sessionId || 'unknown').slice(0, 8);
      const file = join(expandedDir, `${sid}-${ts}.jsonl`);
      const lines = items.map(item => JSON.stringify({
        role: item.msg.role,
        type: item.msg._type,
        timestamp: item.msg.timestamp || new Date().toISOString(),
        originalChars: item.originalChars,
        action: item.action,
        content: typeof item.msg.content === 'string'
          ? item.msg.content.slice(0, 3000)
          : JSON.stringify(item.msg.content || '').slice(0, 3000),
      }));
      writeFileSync(file, lines.join('\n') + '\n');
    } catch (e) {
      console.error('[ContextClaw] cold storage flush failed:', e.message);
    }
  });
}

// -------------------------------------------------------
// Turn counter — figure out how many turns ago each message was
// -------------------------------------------------------

function computeTurnsAgo(messages) {
  // A "turn" = a user message. Count backwards from the end.
  let turnCount = 0;
  const turnsAgo = new Array(messages.length).fill(0);

  for (let i = messages.length - 1; i >= 0; i--) {
    turnsAgo[i] = turnCount;
    if (messages[i].role === 'user') turnCount++;
  }

  return turnsAgo;
}

// -------------------------------------------------------
// Engine
// -------------------------------------------------------

class ContextClawEngine {
  constructor(pluginConfig) {
    this.info = {
      id: 'contextclaw',
      name: 'ContextClaw',
      version: '1.0.0',
      ownsCompaction: false,
    };
    this._sessions = new Map();
    this.config = { ...DEFAULT_CONFIG, ...pluginConfig };
    this.wss = null;
    this.clients = new Set();
    if (this.config.enableTelemetry) {
      this._initWs();
    }
  }

  _initWs() {
    if (this.wss) return;
    try {
      this.wss = new WebSocketServer({ port: this.config.wsPort });
      this.wss.on('error', (e) => {
        console.warn(`[ContextClaw] WS error port ${this.config.wsPort}: ${e.message}`);
        this.wss = null;
      });
      this.wss.on('connection', ws => {
        this.clients.add(ws);
        ws.on('close', () => this.clients.delete(ws));
      });
    } catch (e) {
      this.wss = null;
    }
  }

  _broadcast(data) {
    if (!this.wss) return;
    try {
      const payload = JSON.stringify(data);
      for (const c of this.clients) {
        if (c.readyState === 1) c.send(payload);
      }
    } catch (_) {}
  }

  async bootstrap({ sessionId }) {
    this._sessions.set(sessionId, { turns: 0 });
    return { bootstrapped: true };
  }

  async ingest({ sessionId }) {
    const s = this._sessions.get(sessionId) || { turns: 0 };
    s.turns++;
    this._sessions.set(sessionId, s);
    return { ingested: true };
  }

  async ingestBatch({ sessionId, messages }) {
    const s = this._sessions.get(sessionId) || { turns: 0 };
    s.turns += messages.length;
    this._sessions.set(sessionId, s);
    return { ingestedCount: messages.length };
  }

  /**
   * Core loop:
   * 1. Classify every message by content type
   * 2. Compute how many turns ago each message was
   * 3. Apply retention policy per type
   * 4. Cold-store anything truncated
   * 5. Return the lean message set
   */
  async assemble({ sessionId, messages, tokenBudget }) {
    try {
      stats.totalAssembleCalls++;

      // Step 1: classify
      const classified = classifyAll(messages);

      // Step 2: turn distance
      const turnsAgo = computeTurnsAgo(classified);

      // Step 3: apply policies
      const results = classified.map((msg, i) =>
        applyPolicy(msg, turnsAgo[i], this.config.policies)
      );

      // Step 4: collect what to cold-store
      const truncatedItems = results.filter(r =>
        r.action === 'truncate' &&
        DEFAULT_POLICIES[r.msg._type]?.coldStore !== false
      );

      if (truncatedItems.length > 0) {
        flushToCold(sessionId, truncatedItems, this.config.coldStorageDir);
      }

      // Step 5: build output
      const kept = results.map(r => {
        // Strip internal metadata before returning
        const { _type, _chars, _truncated, _originalChars, ...clean } = r.msg;
        return clean;
      });

      // Stats
      let totalSavedChars = 0;
      const typeCounts = {};
      for (const r of results) {
        const type = r.msg._type;
        if (!typeCounts[type]) typeCounts[type] = { count: 0, truncated: 0, charsSaved: 0 };
        typeCounts[type].count++;
        if (r.action === 'truncate') {
          typeCounts[type].truncated++;
          typeCounts[type].charsSaved += r.savedChars || 0;
          totalSavedChars += r.savedChars || 0;
          stats.totalTruncated++;
          stats.totalCharsSaved += r.savedChars || 0;
        }
      }

      // Telemetry
      if (this.config.enableTelemetry) {
        this._broadcast({
          type: 'ASSEMBLE',
          sessionId,
          messageCount: messages.length,
          typeCounts,
          totalSavedChars,
          lifetimeCharsSaved: stats.totalCharsSaved,
          lifetimeTruncated: stats.totalTruncated,
          lifetimeAssembles: stats.totalAssembleCalls,
        });
      }

      if (totalSavedChars > 0) {
        const summaryParts = Object.entries(typeCounts)
          .filter(([, v]) => v.truncated > 0)
          .map(([k, v]) => `${k}: ${v.truncated} truncated (${v.charsSaved} chars saved)`)
          .join(', ');
        console.log(`[ContextClaw] ${summaryParts}`);
      }

      return {
        messages: kept,
        estimatedTokens: 0, // not our job to estimate — gateway handles this
      };
    } catch (e) {
      console.error('[ContextClaw] assemble error:', e);
      return { messages, estimatedTokens: 0 };
    }
  }

  async compact() {
    return { ok: true, compacted: false, reason: 'ContextClaw uses type-based truncation, not compaction' };
  }

  async afterTurn() {
    // No post-turn processing needed — truncation happens at assemble time
  }

  async maintain() {
    return { changed: false, bytesFreed: 0, rewrittenEntries: 0 };
  }

  async dispose() {
    this._sessions.clear();
    if (this.wss) {
      try { this.wss.close(); } catch (_) {}
      this.wss = null;
    }
  }
}

// -------------------------------------------------------
// Plugin registration
// -------------------------------------------------------

export default function setup(runtime) {
  const config = runtime.pluginConfig || {};
  runtime.registerContextEngine('contextclaw', () => new ContextClawEngine(config));
}

export { ContextClawEngine, computeTurnsAgo };
