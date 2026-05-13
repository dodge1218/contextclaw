/**
 * 🧠 ContextClaw v1 — Context Engine Plugin for OpenClaw
 *
 * Classifies context by content type. Applies retention policies.
 * Files get truncated. Command output gets tailed. Conversations stay intact.
 *
 * MIT — https://github.com/dodge1218/contextclaw
 */

import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { get_encoding } from 'tiktoken';
import { classifyAll, TYPES } from './classifier.js';
import { applyPolicy, DEFAULT_POLICIES } from './policy.js';
import {
  handleQuotaRotation,
  getProviderHealthSummary,
  getAvailableModels,
  restoreProvider,
  clearProviderCooldown,
} from './config-patcher.js';
import { guardHeartbeat, getStuckSessionSummary } from './heartbeat-guard.js';
import { recordAssemblePoint, recordDashboardSnapshot, getEfficiencySummary, getEfficiencyData } from './efficiency-tracker.js';
import { buildMemorySystemPromptAddition, delegateCompactionToRuntime } from 'openclaw/plugin-sdk/core';
import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';

// -------------------------------------------------------
// Lifetime stats — persisted across restarts
// -------------------------------------------------------

const STATS_PATH = join(homedir(), '.openclaw', '.contextclaw-stats.json');
const HEURISTIC_COST_PER_MILLION = 3.0; // fallback when real pricing unavailable

/** Resolve actual model pricing from gateway, or null if unavailable. */
let _runtimeUsage = null;

function setRuntimeUsage(usage) {
  _runtimeUsage = usage;
}

/**
 * Estimate cost saved from truncated chars.
 * Uses real model pricing when available (via plugin runtime.usage API),
 * falls back to heuristic ($3/M tokens ≈ Sonnet-class pricing).
 */
function estimateSavings(charsSaved, modelId, provider) {
  const tokensSaved = Math.ceil(charsSaved / 4);
  if (_runtimeUsage && _runtimeUsage.resolveModelCostConfig) {
    try {
      const costConfig = _runtimeUsage.resolveModelCostConfig({ provider, model: modelId });
      if (costConfig) {
        // Input tokens saved (truncated context is input)
        return (tokensSaved * costConfig.input) / 1_000_000;
      }
    } catch { /* fall through to heuristic */ }
  }
  return (tokensSaved * HEURISTIC_COST_PER_MILLION) / 1_000_000;
}

function loadLifetimeStats() {
  try {
    const raw = readFileSync(STATS_PATH, 'utf-8');
    const prev = JSON.parse(raw);
    return {
      totalTruncated: prev.truncated || 0,
      totalCharsSaved: prev.saved || 0,
      totalAssembleCalls: prev.assembles || 0,
      totalEstimatedSavingsUsd: prev.savingsUsd || 0,
      byType: {},
    };
  } catch {
    return { totalTruncated: 0, totalCharsSaved: 0, totalAssembleCalls: 0, totalEstimatedSavingsUsd: 0, byType: {} };
  }
}

const stats = loadLifetimeStats();

let encoder = null;
let warnedTokenizerFallback = false;

function getEncoder() {
  if (encoder) return encoder;
  try {
    encoder = get_encoding('cl100k_base');
  } catch {
    encoder = null;
  }
  return encoder;
}

function warnTokenizerFallback() {
  if (warnedTokenizerFallback) return;
  warnedTokenizerFallback = true;
  console.warn('[ContextClaw] tiktoken unavailable in plugin, using heuristic token counter (~4 chars/token)');
}

function countTokens(text = '') {
  const enc = getEncoder();
  if (enc) {
    try {
      return enc.encode_ordinary(text).length;
    } catch {
      warnTokenizerFallback();
    }
  } else {
    warnTokenizerFallback();
  }
  return Math.ceil(text.length / 4);
}

function ensureContentBlocks(content) {
  if (Array.isArray(content)) {
    return content.map(block => (typeof block === 'string'
      ? { type: 'text', text: block }
      : block));
  }
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }
  if (content == null) return [];
  if (typeof content === 'object' && content.type) return [content];
  return [{ type: 'text', text: typeof content === 'object' ? JSON.stringify(content) : String(content) }];
}

function countContentTokens(blocks) {
  if (!Array.isArray(blocks)) return 0;
  let total = 0;
  for (const block of blocks) {
    if (!block) continue;
    if (typeof block === 'string') {
      total += countTokens(block);
      continue;
    }
    if (block.type === 'text' && typeof block.text === 'string') {
      total += countTokens(block.text);
    }
  }
  return total;
}

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

// Whitelist filename charset to defeat path traversal in user-influenced
// segments (sessionId may originate from outside the engine).
function _sanitizeIdSegment(input, maxLen = 64) {
  if (input === null || input === undefined) return 'unknown';
  let s = String(input);
  s = s.replace(/[/\\]/g, '_');
  s = s.replace(/[^A-Za-z0-9._-]/g, '_');
  s = s.replace(/^\.+/, '_');
  if (!s) return 'unknown';
  if (s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}

// Redact home dir + absolute paths from text before logging it. Caps the
// information leakage from console.error of raw Error objects (Finding 8).
function _redactPaths(input) {
  if (input === null || input === undefined) return '';
  let s;
  if (input instanceof Error) s = input.message ?? String(input);
  else if (typeof input === 'string') s = input;
  else { try { s = String(input); } catch { return '<unprintable>'; } }
  const home = homedir();
  if (home && home.length > 1) {
    const escapedHome = home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    s = s.replace(new RegExp(escapedHome, 'g'), '<home>');
  }
  s = s.replace(/\/(?:[A-Za-z0-9._-]{1,128}\/){1,32}[A-Za-z0-9._-]{0,128}/g, '<abs-path>');
  s = s.replace(/[A-Za-z]:\\(?:[A-Za-z0-9._-]{1,128}\\){1,32}[A-Za-z0-9._-]{0,128}/g, '<abs-path>');
  return s;
}

function flushToCold(sessionId, items, coldDir) {
  if (!items.length) return;
  setImmediate(() => {
    try {
      const expandedDir = coldDir.startsWith('~/')
        ? join(homedir(), coldDir.slice(2))
        : coldDir;
      mkdirSync(expandedDir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      // Sanitize sessionId (defeat traversal) AND append a 32-bit nonce
      // (defeat ms-collision under concurrent flushes — Finding 7).
      const sid = _sanitizeIdSegment(sessionId).slice(0, 8) || 'unknown';
      const nonce = randomBytes(4).toString('hex');
      const filename = `${sid}-${ts}-${nonce}.jsonl`;
      const file = resolve(expandedDir, filename);
      // Belt-and-braces: assert resolved file is a child of the cold dir.
      const resolvedDir = resolve(expandedDir);
      if (file !== resolvedDir && !file.startsWith(resolvedDir + sep)) {
        throw new Error('ContextClaw: refused unsafe cold-storage path');
      }
      const lines = items.map(item => {
        const flatContent = typeof item.msg.content === 'string'
          ? item.msg.content
          : JSON.stringify(item.msg.content || '');
        const nonceMatch = item.msg._truncated
          ? flatContent.match(/ContextClaw:([a-f0-9]{8})/)
          : null;
        return JSON.stringify({
          role: item.msg.role,
          type: item.msg._type,
          timestamp: item.msg.timestamp || new Date().toISOString(),
          originalChars: item.originalChars,
          action: item.action,
          content: item.originalContent || flatContent,
          nonce: nonceMatch ? nonceMatch[1] : null,
        });
      });
      writeFileSync(file, lines.join('\n') + '\n');
    } catch (e) {
      console.error('[ContextClaw] cold storage flush failed:', _redactPaths(e));
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
      this.wss = new WebSocketServer({ port: this.config.wsPort, host: '127.0.0.1' });
      this.wss.on('error', (e) => {
        if (e.code === 'EADDRINUSE') {
          console.warn(`[ContextClaw] WS port ${this.config.wsPort} in use — telemetry disabled (non-fatal)`);
        } else {
          console.warn(`[ContextClaw] WS error: ${_redactPaths(e)}`);
        }
        try { this.wss?.close(); } catch (_) {}
        this.wss = null;
      });
      this.wss.on('connection', ws => {
        this.clients.add(ws);
        ws.on('close', () => this.clients.delete(ws));
      });
    } catch (e) {
      console.warn(`[ContextClaw] WS init failed: ${_redactPaths(e)} — telemetry disabled (non-fatal)`);
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

  /**
   * Handle provider quota/rate-limit errors.
   * Called by the gateway when a model request fails.
   * Returns rotation result or null.
   */
  handleProviderError(modelId, errorMessage) {
    const result = handleQuotaRotation(modelId, errorMessage);
    if (result && result.rotated) {
      this._broadcast({
        type: 'QUOTA_ROTATION',
        ...result,
      });
    }
    return result;
  }

  /**
   * Acknowledge a successful provider request (clears cooldown).
   */
  handleProviderSuccess(modelId) {
    clearProviderCooldown(modelId);
  }

  async ingest(params = {}) {
    const sessionId = params?.sessionId;
    if (sessionId) {
      const s = this._sessions.get(sessionId) || { turns: 0 };
      s.turns++;
      this._sessions.set(sessionId, s);
    }
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
  async assemble({ messages = [], availableTools, citationsMode, sessionId = 'unknown' } = {}) {
    try {
      stats.totalAssembleCalls++;

      // Step 0: heartbeat guard — detect stuck tool sessions
      const heartbeatWarning = guardHeartbeat(sessionId, messages);
      if (heartbeatWarning) {
        this._broadcast({
          type: 'HEARTBEAT_WARNING',
          ...heartbeatWarning,
        });
      }

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
      let estimatedTokens = 0;
      const kept = results.map(r => {
        // Strip internal metadata before returning
        const { _type, _chars, _truncated, _originalChars, ...clean } = r.msg;
        const normalized = { ...clean };

        // CRITICAL: Preserve original content shape per pi-agent-core types.
        // - UserMessage.content: string | (TextContent | ImageContent)[]  — both valid
        // - AssistantMessage.content: (TextContent | ThinkingContent | ToolCall)[]  — must be array
        // - ToolResultMessage.content: (TextContent | ImageContent)[]  — must be array
        // Only normalize to array for assistant/toolResult if content became a string (e.g. after truncation)
        if (normalized.role === 'user') {
          // User messages: keep string as string, array as array (both valid)
          estimatedTokens += typeof normalized.content === 'string'
            ? countTokens(normalized.content)
            : countContentTokens(ensureContentBlocks(normalized.content));
        } else {
          // assistant / toolResult / system: must be array of content blocks
          normalized.content = ensureContentBlocks(normalized.content);
          estimatedTokens += countContentTokens(normalized.content);
        }
        return normalized;
      });

      // Stats
      let totalSavedChars = 0;
      let turnSavingsUsd = 0;
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
      if (totalSavedChars > 0) {
        turnSavingsUsd = estimateSavings(totalSavedChars);
        stats.totalEstimatedSavingsUsd += turnSavingsUsd;
      }

      // Track efficiency data point
      recordAssemblePoint({
        sessionId,
        charsSaved: totalSavedChars,
        tokensSaved: Math.ceil(totalSavedChars / 4),
        messageCount: messages.length,
        truncatedCount: results.filter(r => r.action === 'truncate').length,
        modelId: undefined, // filled by gateway if available
        provider: undefined,
      });

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
          lifetimeSavingsUsd: stats.totalEstimatedSavingsUsd,
          usingRealPricing: !!_runtimeUsage,
          providerHealth: getProviderHealthSummary(),
          stuckSessions: getStuckSessionSummary(),
        });
      }

      if (totalSavedChars > 0) {
        const summaryParts = Object.entries(typeCounts)
          .filter(([, v]) => v.truncated > 0)
          .map(([k, v]) => `${k}: ${v.truncated} truncated (${v.charsSaved} chars saved)`)
          .join(', ');
        console.log(`[ContextClaw] ${summaryParts}`);
      }

      // Write stats file for TUI footer (lifetime accumulator — survives restarts)
      try {
        writeFileSync(STATS_PATH, JSON.stringify({
          saved: stats.totalCharsSaved,
          truncated: stats.totalTruncated,
          assembles: stats.totalAssembleCalls,
          savingsUsd: stats.totalEstimatedSavingsUsd,
          usingRealPricing: !!_runtimeUsage,
          ts: Date.now(),
        }));
      } catch { /* non-critical */ }

      return {
        messages: kept,
        estimatedTokens,
        systemPromptAddition: buildMemorySystemPromptAddition({
          availableTools: availableTools ?? new Set(),
          citationsMode,
        }),
      };
    } catch (e) {
      console.error('[ContextClaw] assemble error (falling back to pass-through):', _redactPaths(e));
      // Return original messages unmodified — the gateway's own pipeline will handle them.
      // This ensures ContextClaw can NEVER crash the gateway.
      return {
        messages,
        estimatedTokens: 0,
        systemPromptAddition: '',
      };
    }
  }

  async compact(params) {
    return await delegateCompactionToRuntime(params);
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

export default definePluginEntry({
  id: 'contextclaw',
  name: 'ContextClaw',
  description: 'Context budget engine',
  register(api) {
    const config = api.pluginConfig || {};
    // Capture the usage API if available (requires openclaw with plugin-cost-api)
    if (api.usage) {
      setRuntimeUsage(api.usage);
    }
    if (typeof api.registerContextEngine === 'function') {
      api.registerContextEngine('contextclaw', () => new ContextClawEngine(config));
      console.log('[ContextClaw] context engine registered successfully');
    } else {
      console.warn('[ContextClaw] api.registerContextEngine not available — api keys:', Object.keys(api).join(', '));
    }
  },
});

export { ContextClawEngine, computeTurnsAgo };
export {
  handleQuotaRotation,
  getProviderHealthSummary,
  getAvailableModels,
  restoreProvider,
} from './config-patcher.js';
export {
  guardHeartbeat,
  getStuckSessionSummary,
  disableHeartbeat,
  enableHeartbeat,
} from './heartbeat-guard.js';
export {
  recordDashboardSnapshot,
  getEfficiencySummary,
  getEfficiencyData,
  MODEL_MULTIPLIERS,
  PLAN_ALLOWANCES,
} from './efficiency-tracker.js';
