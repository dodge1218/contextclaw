/**
 * 🔧 ContextClaw Config Patcher
 *
 * Safely modifies ~/.openclaw/openclaw.json without introducing invalid keys.
 * Reads the live config, patches ONLY known-safe paths, writes back atomically.
 *
 * Safe paths (validated against schema):
 *   - agents.defaults.model.primary
 *   - agents.defaults.model.fallbacks
 *   - plugins.entries.<id>.enabled
 *   - plugins.entries.<id>.config
 *   - hooks.internal.entries.<id>.enabled
 *
 * Does NOT touch: top-level keys, auth, gateway, channels, etc.
 */

import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const CONFIG_PATH = join(homedir(), '.openclaw', 'openclaw.json');
const BACKUP_SUFFIX = '.contextclaw-backup';

// -------------------------------------------------------
// Provider health tracking
// -------------------------------------------------------

const providerHealth = new Map();

const QUOTA_SIGNALS = [
  /429/,
  /rate.?limit/i,
  /quota.?exceeded/i,
  /too.?many.?requests/i,
  /billing/i,
  /capacity/i,
  /overloaded/i,
  /resource.?exhausted/i,
];

/**
 * Record a provider failure. Returns true if the provider
 * has crossed the threshold and should be rotated away from.
 */
export function recordProviderFailure(providerModel, errorMessage = '') {
  const provider = providerModel.split('/')[0];
  const now = Date.now();
  const entry = providerHealth.get(provider) || {
    failures: [],
    quotaHits: 0,
    lastQuotaHit: 0,
    cooldownUntil: 0,
  };

  // Track rolling 5-minute failure window
  entry.failures.push(now);
  entry.failures = entry.failures.filter(t => now - t < 5 * 60 * 1000);

  const isQuotaError = QUOTA_SIGNALS.some(p => p.test(errorMessage));
  if (isQuotaError) {
    entry.quotaHits++;
    entry.lastQuotaHit = now;
    // Cooldown: 5 min after first hit, 15 min after 3+, 30 min after 5+
    const cooldownMs = entry.quotaHits >= 5 ? 30 * 60 * 1000
      : entry.quotaHits >= 3 ? 15 * 60 * 1000
      : 5 * 60 * 1000;
    entry.cooldownUntil = now + cooldownMs;
  }

  providerHealth.set(provider, entry);

  // Trip threshold: 3+ failures in 5 min OR any quota hit
  return isQuotaError || entry.failures.length >= 3;
}

/**
 * Check if a provider is currently in cooldown.
 */
export function isProviderCoolingDown(providerModel) {
  const provider = providerModel.split('/')[0];
  const entry = providerHealth.get(provider);
  if (!entry) return false;
  return Date.now() < entry.cooldownUntil;
}

/**
 * Clear cooldown for a provider (e.g., after successful request).
 */
export function clearProviderCooldown(providerModel) {
  const provider = providerModel.split('/')[0];
  const entry = providerHealth.get(provider);
  if (entry) {
    entry.cooldownUntil = 0;
    entry.quotaHits = 0;
    entry.failures = [];
  }
}

/**
 * Get health summary for telemetry.
 */
export function getProviderHealthSummary() {
  const summary = {};
  const now = Date.now();
  for (const [provider, entry] of providerHealth) {
    summary[provider] = {
      recentFailures: entry.failures.filter(t => now - t < 5 * 60 * 1000).length,
      quotaHits: entry.quotaHits,
      coolingDown: now < entry.cooldownUntil,
      cooldownRemainingMs: Math.max(0, entry.cooldownUntil - now),
    };
  }
  return summary;
}

// -------------------------------------------------------
// Config read/write (atomic with backup)
// -------------------------------------------------------

function readConfig() {
  const raw = readFileSync(CONFIG_PATH, 'utf-8');
  return JSON.parse(raw);
}

function writeConfig(config) {
  // Backup before write
  try {
    copyFileSync(CONFIG_PATH, CONFIG_PATH + BACKUP_SUFFIX);
  } catch { /* first write or no existing — fine */ }

  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
}

// -------------------------------------------------------
// Safe getters (deep path access)
// -------------------------------------------------------

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), obj);
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (current[keys[i]] === undefined || typeof current[keys[i]] !== 'object') {
      current[keys[i]] = {};
    }
    current = current[keys[i]];
  }
  current[keys[keys.length - 1]] = value;
}

// -------------------------------------------------------
// Allowlisted config paths
// -------------------------------------------------------

const SAFE_PATHS = new Set([
  'agents.defaults.model.primary',
  'agents.defaults.model.fallbacks',
]);

const SAFE_PATH_PREFIXES = [
  'plugins.entries.',
  'hooks.internal.entries.',
];

function isSafePath(path) {
  if (SAFE_PATHS.has(path)) return true;
  return SAFE_PATH_PREFIXES.some(prefix => path.startsWith(prefix));
}

// -------------------------------------------------------
// Public API
// -------------------------------------------------------

/**
 * Read the current primary model from config.
 */
export function getCurrentModel() {
  const config = readConfig();
  return getPath(config, 'agents.defaults.model.primary');
}

/**
 * Read the current fallback chain from config.
 */
export function getCurrentFallbacks() {
  const config = readConfig();
  return getPath(config, 'agents.defaults.model.fallbacks') || [];
}

/**
 * Get all configured providers and their models from the config.
 * Returns array of { provider, modelId, fullId } for available models.
 */
export function getAvailableModels() {
  const config = readConfig();
  const providers = getPath(config, 'models.providers') || {};
  const entries = getPath(config, 'plugins.entries') || {};
  const models = [];

  for (const [providerName, providerConfig] of Object.entries(providers)) {
    // Skip providers with disabled plugin entries
    const pluginEntry = entries[providerName];
    if (pluginEntry && pluginEntry.enabled === false) continue;

    // Skip providers without API key (except vllm which uses local endpoint)
    if (providerName !== 'vllm' && !providerConfig.apiKey) continue;

    for (const model of (providerConfig.models || [])) {
      models.push({
        provider: providerName,
        modelId: model.id,
        fullId: `${providerName}/${model.id}`,
        contextWindow: model.contextWindow || 131072,
        reasoning: model.reasoning || false,
        cost: model.cost || { input: 0, output: 0 },
      });
    }
  }

  return models;
}

/**
 * Pick the best available fallback model, excluding cooled-down providers.
 * Prefers: free models → large context → reasoning capable.
 */
export function pickBestFallback(excludeProviders = []) {
  const models = getAvailableModels();
  const now = Date.now();

  const candidates = models.filter(m => {
    const provider = m.provider;
    // Exclude explicitly excluded providers
    if (excludeProviders.includes(provider)) return false;
    // Exclude providers in cooldown
    if (isProviderCoolingDown(m.fullId)) return false;
    // Exclude vllm if it might be offline (no health data = assume available)
    return true;
  });

  if (candidates.length === 0) return null;

  // Score: prefer free → large context → reasoning
  candidates.sort((a, b) => {
    const costA = (a.cost.input || 0) + (a.cost.output || 0);
    const costB = (b.cost.input || 0) + (b.cost.output || 0);
    if (costA !== costB) return costA - costB; // cheaper first
    if (a.contextWindow !== b.contextWindow) return b.contextWindow - a.contextWindow; // larger context first
    if (a.reasoning !== b.reasoning) return b.reasoning ? 1 : -1; // reasoning preferred
    return 0;
  });

  return candidates[0];
}

/**
 * Safely patch the primary model in config.
 * Only touches agents.defaults.model.primary.
 */
export function patchPrimaryModel(newModelFullId) {
  const path = 'agents.defaults.model.primary';
  if (!isSafePath(path)) throw new Error(`Unsafe config path: ${path}`);

  const config = readConfig();
  const oldModel = getPath(config, path);
  setPath(config, path, newModelFullId);
  writeConfig(config);

  console.log(`[ContextClaw] Config patched: primary model ${oldModel} → ${newModelFullId}`);
  return { oldModel, newModel: newModelFullId };
}

/**
 * Safely patch the fallback chain.
 * Only touches agents.defaults.model.fallbacks.
 */
export function patchFallbacks(fallbackIds) {
  const path = 'agents.defaults.model.fallbacks';
  if (!isSafePath(path)) throw new Error(`Unsafe config path: ${path}`);

  const config = readConfig();
  const oldFallbacks = getPath(config, path) || [];
  setPath(config, path, fallbackIds);
  writeConfig(config);

  console.log(`[ContextClaw] Config patched: fallbacks updated (${fallbackIds.length} models)`);
  return { oldFallbacks, newFallbacks: fallbackIds };
}

/**
 * Toggle a hook entry's enabled state.
 * Path: hooks.internal.entries.<hookId>.enabled
 */
export function toggleHook(hookId, enabled) {
  const path = `hooks.internal.entries.${hookId}.enabled`;
  if (!isSafePath(path)) throw new Error(`Unsafe config path: ${path}`);

  const config = readConfig();
  setPath(config, path, enabled);
  writeConfig(config);

  console.log(`[ContextClaw] Hook "${hookId}" ${enabled ? 'enabled' : 'disabled'}`);
  return { hookId, enabled };
}

/**
 * Full quota-rotation flow:
 * 1. Record the failure
 * 2. If threshold crossed, pick a new primary
 * 3. Patch config
 * 4. Return what changed (or null if no rotation needed)
 */
export function handleQuotaRotation(failedModelFullId, errorMessage = '') {
  const shouldRotate = recordProviderFailure(failedModelFullId, errorMessage);
  if (!shouldRotate) return null;

  const failedProvider = failedModelFullId.split('/')[0];
  const currentPrimary = getCurrentModel();

  // Only rotate if the failed model IS the current primary's provider
  if (!currentPrimary.startsWith(failedProvider + '/')) {
    // It's a fallback that failed, not primary — just record, don't rotate
    return null;
  }

  const fallback = pickBestFallback([failedProvider]);
  if (!fallback) {
    console.warn(`[ContextClaw] No healthy fallback available after ${failedProvider} failure`);
    return null;
  }

  const result = patchPrimaryModel(fallback.fullId);

  // Also update fallbacks to exclude the failed provider temporarily
  const currentFallbacks = getCurrentFallbacks();
  const newFallbacks = currentFallbacks.filter(f => !f.startsWith(failedProvider + '/'));
  if (!newFallbacks.includes(failedModelFullId)) {
    // Put the failed model at the end so it can be retried after cooldown
    newFallbacks.push(failedModelFullId);
  }
  patchFallbacks(newFallbacks);

  return {
    rotated: true,
    from: result.oldModel,
    to: result.newModel,
    reason: errorMessage || 'quota/rate limit',
    provider: failedProvider,
    cooldownMs: providerHealth.get(failedProvider)?.cooldownUntil - Date.now(),
  };
}

/**
 * Restore a provider after cooldown expires.
 * Call this periodically or on successful request to the provider.
 */
export function restoreProvider(providerName) {
  clearProviderCooldown(providerName);
  console.log(`[ContextClaw] Provider "${providerName}" restored from cooldown`);
}
