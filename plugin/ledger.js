import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';

const DEFAULT_LEDGER_PATH = join(homedir(), '.openclaw', 'contextclaw', 'ledger.jsonl');
const LEGACY_LEDGER_PATH = join(homedir(), '.openclaw', 'contextclaw-ledger.jsonl');
const DEFAULT_MAX_CALLS_PER_PROMPT = 8;
const DEFAULT_MAX_ESTIMATED_INPUT_TOKENS = 32000;
const DEFAULT_MAX_ESTIMATED_COST_USD = 0.15;
const LEDGER_SCHEMA_VERSION = 2;

const COST_PER_MILLION = {
  'anthropic/claude-opus-4-7': { input: 5, output: 25, cacheRead: 0, cacheWrite: 0 },
  'anthropic/claude-opus-4-6': { input: 5, output: 25, cacheRead: 0, cacheWrite: 0 },
  'anthropic/claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0, cacheWrite: 0 },
  'deepseek/deepseek-reasoner': { input: 0.55, output: 2.19, cacheRead: 0, cacheWrite: 0 },
  'deepseek/deepseek-chat': { input: 0.3, output: 0.5, cacheRead: 0, cacheWrite: 0 },
  'gemini/gemini-2.5-pro': { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  'gemini/gemini-2.5-flash': { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  'github-copilot/gpt-4o': { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  'github-copilot/claude-opus-4.7': { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  'github-copilot/claude-sonnet-4.6': { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

const PREMIUM_PATTERNS = [
  /opus/i,
  /gpt-5/i,
  /highest.*reasoning/i,
];

function stableJson(value) {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

export function hashValue(value) {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

export function messageText(message) {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(block => {
      if (typeof block === 'string') return block;
      if (block?.type === 'text' && typeof block.text === 'string') return block.text;
      if (typeof block?.content === 'string') return block.content;
      return '';
    }).join('\n');
  }
  return '';
}

export function getParentPrompt(messages = []) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') return messageText(messages[i]);
  }
  return '';
}

export function splitProviderModel(modelId = '') {
  const [provider = 'unknown', ...rest] = String(modelId).split('/');
  return { provider, model: rest.join('/') || 'unknown' };
}

function normalizePerMillion(value) {
  if (!Number.isFinite(value) || value < 0) return 0;
  // OpenClaw configs sometimes store dollars/token, e.g. 0.000003, and sometimes dollars/M tokens.
  return value > 0 && value < 0.01 ? value * 1_000_000 : value;
}

export function createPricingSnapshot({ modelId, pricing = {}, runtimePricing = null, source = null, capturedAt = new Date().toISOString() } = {}) {
  const { provider, model } = splitProviderModel(modelId || 'unknown/unknown');
  const runtimeCost = runtimePricing || null;
  const configured = pricing[modelId] || COST_PER_MILLION[modelId] || {};
  const selected = runtimeCost || configured;
  const selectedSource = source || (runtimeCost ? 'openclaw-runtime' : (pricing[modelId] ? 'configured' : (COST_PER_MILLION[modelId] ? 'builtin' : 'heuristic')));
  const snapshot = {
    source: selectedSource,
    provider,
    model,
    providerModel: modelId || 'unknown/unknown',
    currency: 'USD',
    unit: 'per_1m_tokens',
    input: normalizePerMillion(selected.input ?? 0),
    output: normalizePerMillion(selected.output ?? 0),
    cacheRead: normalizePerMillion(selected.cacheRead ?? selected.cache_read ?? 0),
    cacheWrite: normalizePerMillion(selected.cacheWrite ?? selected.cache_write ?? 0),
    capturedAt,
  };
  snapshot.configHash = hashValue({ ...snapshot, capturedAt: undefined }).slice(0, 16);
  return snapshot;
}

export function estimateCostFromSnapshot(snapshot, usage = {}) {
  const input = usage.inputTokens ?? usage.estimatedInputTokens ?? 0;
  const output = usage.outputTokens ?? usage.estimatedOutputTokens ?? 0;
  const cacheRead = usage.cacheReadTokens ?? usage.estimatedCacheReadTokens ?? 0;
  const cacheWrite = usage.cacheWriteTokens ?? usage.estimatedCacheWriteTokens ?? 0;
  return (
    input * (snapshot?.input || 0) +
    output * (snapshot?.output || 0) +
    cacheRead * (snapshot?.cacheRead || 0) +
    cacheWrite * (snapshot?.cacheWrite || 0)
  ) / 1_000_000;
}

export function estimateCostUsd(modelId, inputTokens, outputTokens = 0, pricing = {}) {
  return estimateCostFromSnapshot(createPricingSnapshot({ modelId, pricing }), {
    inputTokens,
    outputTokens,
  });
}

export function isPremiumModel(modelId = '') {
  return PREMIUM_PATTERNS.some(pattern => pattern.test(modelId));
}

export function isLikelyFinalPass(messages = []) {
  const prompt = getParentPrompt(messages).toLowerCase();
  return /\b(final|synthesize|report|submit|conclusion|deliverable|ship|ready to send|high-confidence)\b/.test(prompt);
}

export function inferSessionKind(params = {}) {
  const explicit = params.sessionKind || params.runContext?.sessionKind || params.metadata?.sessionKind;
  if (explicit) return explicit;
  const sessionKey = params.sessionKey || params.sessionId || params.runContext?.sessionKey || '';
  if (String(sessionKey).includes('subagent')) return 'subagent';
  if (params.parentSessionKey || params.childSessionKey || params.subagentOrToolName) return 'subagent';
  if (String(sessionKey).includes('cron')) return 'cron';
  return 'main';
}

function expandHome(path) {
  if (path.startsWith('~/')) return join(homedir(), path.slice(2));
  return path;
}

function parseLedgerLines(path) {
  try {
    const raw = readFileSync(path, 'utf8').trim();
    if (!raw) return [];
    return raw.split('\n').filter(Boolean).map(line => JSON.parse(line));
  } catch {
    return [];
  }
}

export class RequestLedger {
  constructor(config = {}) {
    this.path = expandHome(config.path || DEFAULT_LEDGER_PATH);
    this.legacyPath = expandHome(config.legacyPath || LEGACY_LEDGER_PATH);
    this.maxCallsPerPrompt = config.maxCallsPerPrompt ?? DEFAULT_MAX_CALLS_PER_PROMPT;
    this.defaultModel = config.defaultModel || 'unknown/unknown';
    this.pricing = config.pricing || {};
    this.runtimePricingResolver = config.runtimePricingResolver || null;
    this.state = new Map();
  }

  resolveRuntimePricing(modelId, provider, model) {
    if (!this.runtimePricingResolver) return null;
    try {
      return this.runtimePricingResolver({ provider, model: modelId }) || this.runtimePricingResolver({ provider, model });
    } catch {
      return null;
    }
  }

  recordEstimate(params) {
    const messages = params.messages || [];
    const modelId = params.modelId || this.defaultModel;
    const { provider, model } = splitProviderModel(modelId);
    const parentPrompt = getParentPrompt(messages);
    const parentUserPromptId = hashValue(parentPrompt || params.sessionId || params.sessionKey || 'unknown').slice(0, 16);
    const promptHash = hashValue(parentPrompt);
    const contextHash = hashValue(messages);
    const state = this.state.get(parentUserPromptId) || { calls: 0, contexts: new Set() };
    state.calls += 1;
    const duplicateContext = state.contexts.has(contextHash);
    state.contexts.add(contextHash);
    this.state.set(parentUserPromptId, state);

    const estimatedInputTokens = params.estimatedInputTokens || 0;
    const estimatedOutputTokens = params.estimatedOutputTokens || 0;
    const estimatedCacheReadTokens = params.estimatedCacheReadTokens || 0;
    const estimatedCacheWriteTokens = params.estimatedCacheWriteTokens || 0;
    const pricingSnapshot = createPricingSnapshot({
      modelId,
      pricing: this.pricing,
      runtimePricing: this.resolveRuntimePricing(modelId, provider, model),
    });
    const costEstimateUsd = estimateCostFromSnapshot(pricingSnapshot, {
      estimatedInputTokens,
      estimatedOutputTokens,
      estimatedCacheReadTokens,
      estimatedCacheWriteTokens,
    });
    const overCallBudget = state.calls > this.maxCallsPerPrompt;
    const premiumDeferred = isPremiumModel(modelId) && !isLikelyFinalPass(messages);

    const entry = {
      id: randomUUID(),
      schemaVersion: LEDGER_SCHEMA_VERSION,
      timestamp: new Date().toISOString(),
      event: 'estimate',
      sessionKind: inferSessionKind(params),
      sessionKey: params.sessionKey || params.sessionId || null,
      parentSessionKey: params.parentSessionKey || null,
      childSessionKey: params.childSessionKey || null,
      agentId: params.agentId || null,
      runId: params.runId || null,
      missionId: params.missionId || null,
      provider,
      model,
      providerModel: modelId,
      promptHash,
      contextHash,
      duplicateContext,
      estimatedInputTokens,
      estimatedOutputTokens,
      estimatedCacheReadTokens,
      estimatedCacheWriteTokens,
      actualInputTokens: null,
      actualOutputTokens: null,
      actualCacheReadTokens: null,
      actualCacheWriteTokens: null,
      actualUsageStatus: 'unavailable',
      pricingSnapshot,
      costEstimateUsd,
      actualCostUsd: null,
      parentUserPromptId,
      subagentOrToolName: params.subagentOrToolName || null,
      retryIndex: params.retryIndex ?? 0,
      stopReason: null,
      callIndexForPrompt: state.calls,
      maxCallsPerPrompt: this.maxCallsPerPrompt,
      overCallBudget,
      premiumDeferred,
      premiumFinalPass: isLikelyFinalPass(messages),
      compression: params.compression || null,
    };
    this.append(entry);
    return entry;
  }

  recordReceipt(params = {}) {
    const estimate = params.estimateEntry || null;
    const pricingSnapshot = estimate?.pricingSnapshot || createPricingSnapshot({
      modelId: params.modelId || this.defaultModel,
      pricing: this.pricing,
    });
    const actualCostUsd = Number.isFinite(params.actualCostUsd)
      ? params.actualCostUsd
      : estimateCostFromSnapshot(pricingSnapshot, {
        inputTokens: params.actualInputTokens || 0,
        outputTokens: params.actualOutputTokens || 0,
        cacheReadTokens: params.actualCacheReadTokens || 0,
        cacheWriteTokens: params.actualCacheWriteTokens || 0,
      });
    const entry = {
      id: randomUUID(),
      schemaVersion: LEDGER_SCHEMA_VERSION,
      timestamp: new Date().toISOString(),
      event: 'receipt',
      estimateEntryId: estimate?.id || params.estimateEntryId || null,
      sessionKind: estimate?.sessionKind || inferSessionKind(params),
      sessionKey: estimate?.sessionKey || params.sessionKey || null,
      parentSessionKey: estimate?.parentSessionKey || params.parentSessionKey || null,
      childSessionKey: estimate?.childSessionKey || params.childSessionKey || null,
      agentId: estimate?.agentId || params.agentId || null,
      runId: estimate?.runId || params.runId || null,
      missionId: estimate?.missionId || params.missionId || null,
      provider: pricingSnapshot.provider,
      model: pricingSnapshot.model,
      providerModel: pricingSnapshot.providerModel,
      pricingSnapshot,
      actualInputTokens: params.actualInputTokens ?? null,
      actualOutputTokens: params.actualOutputTokens ?? null,
      actualCacheReadTokens: params.actualCacheReadTokens ?? null,
      actualCacheWriteTokens: params.actualCacheWriteTokens ?? null,
      actualUsageStatus: params.actualUsageStatus || 'available',
      actualCostUsd,
      costEstimateUsd: estimate?.costEstimateUsd ?? null,
      costVarianceUsd: estimate?.costEstimateUsd == null ? null : actualCostUsd - estimate.costEstimateUsd,
      stopReason: params.stopReason || null,
    };
    this.append(entry);
    return entry;
  }

  append(entry) {
    mkdirSync(dirname(this.path), { recursive: true });
    appendFileSync(this.path, `${JSON.stringify(entry)}\n`);
  }

  readLast(count = 20) {
    return parseLedgerLines(this.path).slice(-count);
  }

  readAll() {
    return parseLedgerLines(this.path);
  }

  summarize(options = {}) {
    return summarizeLedger(this.readAll(), options);
  }
}

export function summarizeLedger(entries = [], options = {}) {
  const sinceMs = options.since ? new Date(options.since).getTime() : null;
  const filtered = entries.filter(entry => {
    if (sinceMs && new Date(entry.timestamp).getTime() < sinceMs) return false;
    if (options.sessionKey && entry.sessionKey !== options.sessionKey && entry.parentSessionKey !== options.sessionKey) return false;
    if (options.missionId && entry.missionId !== options.missionId) return false;
    return true;
  });
  const summary = {
    entries: filtered.length,
    estimates: 0,
    receipts: 0,
    estimatedCostUsd: 0,
    actualCostUsd: 0,
    estimatedInputTokens: 0,
    estimatedOutputTokens: 0,
    actualInputTokens: 0,
    actualOutputTokens: 0,
    byModel: {},
    bySessionKind: {},
  };
  for (const entry of filtered) {
    const modelKey = entry.providerModel || `${entry.provider || 'unknown'}/${entry.model || 'unknown'}`;
    const sessionKind = entry.sessionKind || 'unknown';
    summary.byModel[modelKey] ||= { estimatedCostUsd: 0, actualCostUsd: 0, estimatedTokens: 0, actualTokens: 0, entries: 0 };
    summary.bySessionKind[sessionKind] ||= { estimatedCostUsd: 0, actualCostUsd: 0, entries: 0 };
    summary.byModel[modelKey].entries++;
    summary.bySessionKind[sessionKind].entries++;

    if (entry.event === 'receipt') {
      summary.receipts++;
      const actual = entry.actualCostUsd || 0;
      summary.actualCostUsd += actual;
      summary.byModel[modelKey].actualCostUsd += actual;
      summary.bySessionKind[sessionKind].actualCostUsd += actual;
      summary.actualInputTokens += entry.actualInputTokens || 0;
      summary.actualOutputTokens += entry.actualOutputTokens || 0;
      summary.byModel[modelKey].actualTokens += (entry.actualInputTokens || 0) + (entry.actualOutputTokens || 0);
    } else {
      summary.estimates++;
      const estimated = entry.costEstimateUsd || 0;
      summary.estimatedCostUsd += estimated;
      summary.byModel[modelKey].estimatedCostUsd += estimated;
      summary.bySessionKind[sessionKind].estimatedCostUsd += estimated;
      summary.estimatedInputTokens += entry.estimatedInputTokens || 0;
      summary.estimatedOutputTokens += entry.estimatedOutputTokens || 0;
      summary.byModel[modelKey].estimatedTokens += (entry.estimatedInputTokens || 0) + (entry.estimatedOutputTokens || 0);
    }
  }
  return summary;
}

export function readLedgerSummary(path = DEFAULT_LEDGER_PATH, options = {}) {
  return summarizeLedger(parseLedgerLines(expandHome(path)), options);
}

export function getBudgetGateDecision(entry, policy = {}) {
  if (!entry) return { block: false, reasons: [] };
  const enforce = policy.enforce === true;
  if (!enforce) return { block: false, reasons: [] };

  const reasons = [];
  const maxEstimatedInputTokens = policy.maxEstimatedInputTokens ?? DEFAULT_MAX_ESTIMATED_INPUT_TOKENS;
  const maxEstimatedCostUsd = policy.maxEstimatedCostUsd ?? DEFAULT_MAX_ESTIMATED_COST_USD;

  if (entry.overCallBudget) reasons.push('over-call-budget');
  if (policy.blockDuplicateContexts !== false && entry.duplicateContext) reasons.push('duplicate-context');
  if (policy.blockPremiumUntilFinalPass === true && entry.premiumDeferred) reasons.push('premium-deferred');
  if (entry.estimatedInputTokens > maxEstimatedInputTokens) reasons.push('input-token-budget');
  if (entry.costEstimateUsd > maxEstimatedCostUsd) reasons.push('cost-budget');

  return { block: reasons.length > 0, reasons };
}

export function formatReceipt(entry) {
  const flags = [
    entry.duplicateContext ? 'duplicate-context' : null,
    entry.overCallBudget ? 'over-call-budget' : null,
    entry.premiumDeferred ? 'premium-deferred' : null,
  ].filter(Boolean);
  const suffix = flags.length ? ` flags=${flags.join(',')}` : '';
  const kind = entry.sessionKind ? ` ${entry.sessionKind}` : '';
  return `[ContextClaw receipt]${kind} call=${entry.callIndexForPrompt}/${entry.maxCallsPerPrompt} model=${entry.providerModel} est_tokens=${entry.estimatedInputTokens}+${entry.estimatedOutputTokens} est_cost=$${entry.costEstimateUsd.toFixed(6)} price=${entry.pricingSnapshot?.source || 'unknown'}:${entry.pricingSnapshot?.configHash || 'none'} prompt=${entry.parentUserPromptId}${suffix}`;
}

export { DEFAULT_LEDGER_PATH, LEGACY_LEDGER_PATH, LEDGER_SCHEMA_VERSION };
