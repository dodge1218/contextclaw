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
import { RequestLedger, formatReceipt, getBudgetGateDecision } from './ledger.js';
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
const STATS_SCHEMA_VERSION = 2;

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
function estimateSavings(charsSaved, modelId, provider, authProfile = null) {
  const tokensSaved = Math.ceil(charsSaved / 4);
  const resolved = resolveInputCostPerMillion({ modelId, provider, authProfile });
  return {
    tokensSaved,
    savingsUsd: (tokensSaved * resolved.inputCostPerMillion) / 1_000_000,
    pricing: resolved,
  };
}

function normalizeInputCostPerMillion(inputCost) {
  if (!Number.isFinite(inputCost) || inputCost < 0) return null;
  if (inputCost === 0) return 0;
  // OpenClaw configs are mixed in the wild:
  // - Anthropic native often stores dollars/token, e.g. 0.000005
  // - OpenAI-compatible community configs often store dollars/M tokens, e.g. 0.3
  return inputCost < 0.01 ? inputCost * 1_000_000 : inputCost;
}

function resolveConfiguredModelCost({ modelId, provider, authProfile }) {
  try {
    const raw = readFileSync(join(homedir(), '.openclaw', 'openclaw.json'), 'utf8');
    const config = JSON.parse(raw);
    const profilePricing = config?.contextclaw?.ledger?.pricingByAuthProfile?.[authProfile] ||
      config?.plugins?.contextclaw?.ledger?.pricingByAuthProfile?.[authProfile] ||
      null;
    if (profilePricing) {
      const profileMatch = profilePricing[modelId] || profilePricing.default;
      if (profileMatch) return { ...profileMatch, _source: 'auth-profile-config' };
    }
    const providerName = provider || modelId?.split('/')?.[0];
    const shortModel = modelId?.split('/')?.slice(1).join('/');
    const models = config?.models?.providers?.[providerName]?.models || [];
    const match = models.find(model => model.id === shortModel || `${providerName}/${model.id}` === modelId);
    return match?.cost || null;
  } catch {
    return null;
  }
}

function resolveInputCostPerMillion({ modelId, provider, authProfile }) {
  if (_runtimeUsage && _runtimeUsage.resolveModelCostConfig) {
    try {
      const shortModel = modelId?.split('/')?.slice(1).join('/');
      const costConfig = _runtimeUsage.resolveModelCostConfig({ provider, model: modelId }) ||
        _runtimeUsage.resolveModelCostConfig({ provider, model: shortModel });
      if (costConfig) {
        const inputCostPerMillion = normalizeInputCostPerMillion(costConfig.input);
        if (inputCostPerMillion != null) {
          return {
            source: 'runtime',
            modelId: modelId || 'unknown/unknown',
            provider: provider || modelId?.split('/')?.[0] || 'unknown',
            inputCostPerMillion,
            capturedAt: new Date().toISOString(),
          };
        }
      }
    } catch { /* fall through to heuristic */ }
  }

  const configuredCost = resolveConfiguredModelCost({ modelId, provider, authProfile });
  const configuredInputCostPerMillion = normalizeInputCostPerMillion(configuredCost?.input);
  if (configuredInputCostPerMillion != null) {
    return {
      source: configuredCost?._source || 'openclaw-config',
      modelId: modelId || 'unknown/unknown',
      provider: provider || modelId?.split('/')?.[0] || 'unknown',
      authProfile: authProfile || null,
      inputCostPerMillion: configuredInputCostPerMillion,
      capturedAt: new Date().toISOString(),
    };
  }

  return {
    source: 'heuristic',
    modelId: modelId || 'unknown/unknown',
    provider: provider || modelId?.split('/')?.[0] || 'unknown',
    authProfile: authProfile || null,
    inputCostPerMillion: HEURISTIC_COST_PER_MILLION,
    capturedAt: new Date().toISOString(),
  };
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
      totalEstimatedLedgerSpendUsd: prev.ledgerSpendUsd || 0,
      totalEstimatedSubagentSpendUsd: prev.subagentSpendUsd || 0,
      savingsByModel: prev.savingsByModel || {},
      savingsByAuthProfile: prev.savingsByAuthProfile || {},
      pricingSnapshots: prev.pricingSnapshots || {},
      byType: {},
    };
  } catch {
    return {
      totalTruncated: 0,
      totalCharsSaved: 0,
      totalAssembleCalls: 0,
      totalEstimatedSavingsUsd: 0,
      totalEstimatedLedgerSpendUsd: 0,
      totalEstimatedSubagentSpendUsd: 0,
      savingsByModel: {},
      savingsByAuthProfile: {},
      pricingSnapshots: {},
      byType: {},
    };
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

function resolveConfiguredPrimaryModel() {
  try {
    const raw = readFileSync(join(homedir(), '.openclaw', 'openclaw.json'), 'utf8');
    const config = JSON.parse(raw);
    return config?.agents?.defaults?.model?.primary || 'unknown/unknown';
  } catch {
    return 'unknown/unknown';
  }
}

// Default config
const DEFAULT_CONFIG = {
  coldStorageDir: join(homedir(), '.openclaw', 'workspace', 'memory', 'cold'),
  wsPort: 41234,
  enableTelemetry: true,
  policies: {},  // per-type policy overrides
  ledger: {
    enabled: true,
    path: join(homedir(), '.openclaw', 'contextclaw', 'ledger.jsonl'),
    maxCallsPerPrompt: 8,
    enforce: false,
    maxEstimatedInputTokens: 32000,
    maxEstimatedCostUsd: 0.15,
    blockDuplicateContexts: true,
    blockPremiumUntilFinalPass: false,
    estimatedOutputTokens: 2048,
    printReceipt: true,
    authProfile: null,
    pricingByAuthProfile: {},
  },
};

function excerpt(text = '', limit = 1200) {
  const normalized = String(text).replace(/\s+/g, ' ').trim();
  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
}

function lastUserText(messages = []) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role !== 'user') continue;
    const content = messages[i].content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content.map(block => {
        if (typeof block === 'string') return block;
        if (block?.type === 'text' && typeof block.text === 'string') return block.text;
        return '';
      }).join('\n');
    }
  }
  return '';
}

function buildBudgetGateMessages({ ledgerEntry, reasons, originalMessages }) {
  const reasonText = reasons.join(', ');
  const promptExcerpt = excerpt(lastUserText(originalMessages));
  return [
    {
      role: 'system',
      content: [{
        type: 'text',
        text: [
          'ContextClaw budget gate is active.',
          'A high-cost or duplicate context was blocked before provider execution.',
          'Do not attempt hidden retries or request the full prior context.',
          'Give a concise status with the block reason, then ask for explicit final-pass approval or a cheaper model route.',
        ].join(' '),
      }],
    },
    {
      role: 'user',
      content: [
        'ContextClaw blocked this LLM call before sending the large assembled context.',
        `Reason: ${reasonText}`,
        `Model: ${ledgerEntry.providerModel}`,
        `Estimated input tokens: ${ledgerEntry.estimatedInputTokens}`,
        `Estimated output tokens: ${ledgerEntry.estimatedOutputTokens}`,
        `Estimated cost: $${ledgerEntry.costEstimateUsd.toFixed(6)}`,
        `Prompt id: ${ledgerEntry.parentUserPromptId}`,
        '',
        'Last user prompt excerpt:',
        promptExcerpt || '(no user prompt text found)',
      ].join('\n'),
    },
  ];
}

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
    this.config.ledger = { ...DEFAULT_CONFIG.ledger, ...(pluginConfig?.ledger || {}) };
    this.ledger = this.config.ledger.enabled ? new RequestLedger({
      path: this.config.ledger.path,
      maxCallsPerPrompt: this.config.ledger.maxCallsPerPrompt,
      defaultModel: this.config.activeModel,
      authProfile: this.config.ledger.authProfile || this.config.authProfile || null,
      pricing: this.config.ledger.pricing || {},
      pricingByAuthProfile: this.config.ledger.pricingByAuthProfile || {},
      runtimePricingResolver: _runtimeUsage?.resolveModelCostConfig?.bind(_runtimeUsage),
    }) : null;
    this._latestEstimateByRun = new Map();
    this._latestEstimateBySession = new Map();
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

      const preliminarySavedChars = results.reduce((sum, r) => sum + (r.savedChars || 0), 0);
      const activeModel = this.config.activeModel || resolveConfiguredPrimaryModel();
      const activeAuthProfile = this.config.ledger.authProfile || this.config.authProfile || null;
      const ledgerEntry = this.ledger?.recordEstimate({
        sessionId,
        sessionKey: sessionId,
        sessionKind: sessionId && String(sessionId).includes('subagent') ? 'subagent' : 'main',
        parentSessionKey: this.config.parentSessionKey,
        childSessionKey: sessionId && String(sessionId).includes('subagent') ? sessionId : null,
        agentId: this.config.agentId,
        runId: this.config.runId,
        missionId: this.config.missionId,
        messages: kept,
        modelId: activeModel,
        authProfile: activeAuthProfile,
        estimatedInputTokens: estimatedTokens,
        estimatedOutputTokens: this.config.ledger.estimatedOutputTokens,
        compression: {
          originalMessageCount: messages.length,
          returnedMessageCount: kept.length,
          charsSaved: preliminarySavedChars,
          truncatedCount: truncatedItems.length,
        },
      });
      if (ledgerEntry) {
        stats.totalEstimatedLedgerSpendUsd = (stats.totalEstimatedLedgerSpendUsd || 0) + (ledgerEntry.costEstimateUsd || 0);
        if (ledgerEntry.runId) this._latestEstimateByRun.set(ledgerEntry.runId, ledgerEntry);
        if (ledgerEntry.sessionKey) this._latestEstimateBySession.set(ledgerEntry.sessionKey, ledgerEntry);
        if (ledgerEntry.sessionKind === 'subagent') {
          stats.totalEstimatedSubagentSpendUsd = (stats.totalEstimatedSubagentSpendUsd || 0) + (ledgerEntry.costEstimateUsd || 0);
        }
      }
      const budgetGate = getBudgetGateDecision(ledgerEntry, this.config.ledger);
      let returnedMessages = kept;
      let returnedEstimatedTokens = estimatedTokens;
      if (budgetGate.block) {
        returnedMessages = buildBudgetGateMessages({
          ledgerEntry,
          reasons: budgetGate.reasons,
          originalMessages: kept,
        });
        returnedEstimatedTokens = returnedMessages.reduce((sum, msg) => {
          if (msg.role === 'user' && typeof msg.content === 'string') {
            return sum + countTokens(msg.content);
          }
          return sum + countContentTokens(ensureContentBlocks(msg.content));
        }, 0);
        console.warn(`[ContextClaw budget gate] blocked context reasons=${budgetGate.reasons.join(',')} model=${activeModel} estimatedTokens=${estimatedTokens}`);
      }

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
        const provider = activeModel?.split('/')?.[0];
        const savings = estimateSavings(totalSavedChars, activeModel, provider, activeAuthProfile);
        turnSavingsUsd = savings.savingsUsd;
        stats.totalEstimatedSavingsUsd += turnSavingsUsd;

        const modelKey = savings.pricing.modelId;
        const authKey = activeAuthProfile || savings.pricing.source || 'unknown-auth';
        const existing = stats.savingsByModel[modelKey] || {
          provider: savings.pricing.provider,
          modelId: modelKey,
          tokensSaved: 0,
          charsSaved: 0,
          savingsUsd: 0,
          pricingSamples: [],
        };
        existing.tokensSaved += savings.tokensSaved;
        existing.charsSaved += totalSavedChars;
        existing.savingsUsd += turnSavingsUsd;
        existing.lastInputCostPerMillion = savings.pricing.inputCostPerMillion;
        existing.lastPricingSource = savings.pricing.source;
        existing.lastCapturedAt = savings.pricing.capturedAt;
        if (
          existing.pricingSamples.length === 0 ||
          existing.pricingSamples[existing.pricingSamples.length - 1].inputCostPerMillion !== savings.pricing.inputCostPerMillion ||
          existing.pricingSamples[existing.pricingSamples.length - 1].source !== savings.pricing.source
        ) {
          existing.pricingSamples.push(savings.pricing);
        }
        if (existing.pricingSamples.length > 20) existing.pricingSamples = existing.pricingSamples.slice(-20);
        stats.savingsByModel[modelKey] = existing;
        stats.pricingSnapshots[modelKey] = savings.pricing;

        const authExisting = stats.savingsByAuthProfile[authKey] || {
          authProfile: authKey,
          tokensSaved: 0,
          charsSaved: 0,
          savingsUsd: 0,
          models: {},
        };
        authExisting.tokensSaved += savings.tokensSaved;
        authExisting.charsSaved += totalSavedChars;
        authExisting.savingsUsd += turnSavingsUsd;
        authExisting.models[modelKey] ||= { tokensSaved: 0, charsSaved: 0, savingsUsd: 0 };
        authExisting.models[modelKey].tokensSaved += savings.tokensSaved;
        authExisting.models[modelKey].charsSaved += totalSavedChars;
        authExisting.models[modelKey].savingsUsd += turnSavingsUsd;
        stats.savingsByAuthProfile[authKey] = authExisting;
      }

      // Track efficiency data point
      recordAssemblePoint({
        sessionId,
        charsSaved: totalSavedChars,
        tokensSaved: Math.ceil(totalSavedChars / 4),
        messageCount: messages.length,
        truncatedCount: results.filter(r => r.action === 'truncate').length,
        modelId: activeModel,
        provider: activeModel?.split('/')?.[0],
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
          requestLedger: ledgerEntry,
          budgetGate,
        });
      }

      if (totalSavedChars > 0) {
        const summaryParts = Object.entries(typeCounts)
          .filter(([, v]) => v.truncated > 0)
          .map(([k, v]) => `${k}: ${v.truncated} truncated (${v.charsSaved} chars saved)`)
          .join(', ');
        console.log(`[ContextClaw] ${summaryParts}`);
      }
      if (ledgerEntry && this.config.ledger.printReceipt) {
        const gateSuffix = budgetGate.block ? ` BLOCKED reasons=${budgetGate.reasons.join(',')}` : '';
        console.log(`${formatReceipt(ledgerEntry)}${gateSuffix}`);
      }

      // Write stats file for TUI footer (lifetime accumulator — survives restarts)
      try {
        writeFileSync(STATS_PATH, JSON.stringify({
          saved: stats.totalCharsSaved,
          truncated: stats.totalTruncated,
          assembles: stats.totalAssembleCalls,
          savingsUsd: stats.totalEstimatedSavingsUsd,
          ledgerSpendUsd: stats.totalEstimatedLedgerSpendUsd || 0,
          subagentSpendUsd: stats.totalEstimatedSubagentSpendUsd || 0,
          schemaVersion: STATS_SCHEMA_VERSION,
          savingsByModel: stats.savingsByModel,
          savingsByAuthProfile: stats.savingsByAuthProfile,
          pricingSnapshots: stats.pricingSnapshots,
          usingRealPricing: !!_runtimeUsage,
          ts: Date.now(),
        }));
      } catch { /* non-critical */ }

      return {
        messages: returnedMessages,
        estimatedTokens: returnedEstimatedTokens,
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

  recordLlmOutput(event = {}, ctx = {}) {
    if (!this.ledger || !event.usage) return null;
    const sessionKey = ctx.sessionKey || event.sessionKey || event.sessionId || ctx.sessionId;
    const estimate = (event.runId && this._latestEstimateByRun.get(event.runId)) ||
      (sessionKey && this._latestEstimateBySession.get(sessionKey)) ||
      null;
    const usage = event.usage || {};
    const receipt = this.ledger.recordReceipt({
      estimateEntry: estimate,
      estimateEntryId: estimate?.id || null,
      sessionKey,
      sessionId: event.sessionId || ctx.sessionId,
      sessionKind: estimate?.sessionKind || (String(sessionKey || '').includes('subagent') ? 'subagent' : 'main'),
      parentSessionKey: estimate?.parentSessionKey || null,
      childSessionKey: estimate?.childSessionKey || null,
      agentId: ctx.agentId || estimate?.agentId || null,
      runId: event.runId || ctx.runId || null,
      modelId: event.resolvedRef || `${event.provider || 'unknown'}/${event.model || 'unknown'}`,
      actualInputTokens: usage.input ?? null,
      actualOutputTokens: usage.output ?? null,
      actualCacheReadTokens: usage.cacheRead ?? null,
      actualCacheWriteTokens: usage.cacheWrite ?? null,
      actualUsageStatus: 'available',
      stopReason: event.lastAssistant?.stopReason || null,
    });
    if (receipt?.actualCostUsd) {
      if (receipt.sessionKind === 'subagent') {
        stats.totalEstimatedSubagentSpendUsd = (stats.totalEstimatedSubagentSpendUsd || 0) + receipt.actualCostUsd;
      }
    }
    this._broadcast({ type: 'LLM_USAGE_RECEIPT', receipt });
    return receipt;
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
    const engine = new ContextClawEngine(config);
    if (typeof api.registerHook === 'function') {
      api.registerHook('llm_output', (event, ctx) => {
        try {
          engine.recordLlmOutput(event, ctx);
        } catch (error) {
          api.logger?.warn?.(`[ContextClaw] llm_output receipt failed: ${error?.message || String(error)}`);
        }
      });
    }
    if (typeof api.registerStatusProvider === 'function') {
      api.registerStatusProvider({
        id: 'contextclaw',
        getStatus: () => {
          try {
            const saved = stats.totalCharsSaved || 0;
            const spend = stats.totalEstimatedLedgerSpendUsd || 0;
            const subagent = stats.totalEstimatedSubagentSpendUsd || 0;
            const savedDisplay = saved >= 1_000_000 ? `${(saved / 1_000_000).toFixed(1)}M` : saved >= 1_000 ? `${(saved / 1_000).toFixed(1)}K` : `${saved}`;
            return `ContextClaw: $${spend.toFixed(2)} est | $${subagent.toFixed(2)} sub | ${savedDisplay} chars saved`;
          } catch {
            return 'ContextClaw: ledger unavailable';
          }
        },
      });
    }
    if (typeof api.registerContextEngine === 'function') {
      api.registerContextEngine('contextclaw', () => engine);
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
