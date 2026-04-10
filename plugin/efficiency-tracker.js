/**
 * 🧠 ContextClaw — Premium Request Efficiency Tracker
 *
 * Tracks the relationship between context truncation and
 * Copilot premium request consumption. Proves that smaller
 * context = fewer premium requests burned per prompt.
 *
 * How it works:
 * - Records chars/tokens saved per assemble() call
 * - If the user provides dashboard % snapshots (before/after),
 *   correlates truncation volume with actual premium request cost
 * - Over time, builds a statistical model of efficiency gain
 *
 * Data is stored in ~/.openclaw/.contextclaw-efficiency.json
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const EFFICIENCY_PATH = join(homedir(), '.openclaw', '.contextclaw-efficiency.json');

// GitHub Copilot model multipliers (premium requests per prompt)
const MODEL_MULTIPLIERS = {
  'claude-opus-4.6': 3,
  'claude-opus-4.5': 3,
  'claude-sonnet-4': 1,
  'claude-sonnet-4.5': 1,
  'claude-sonnet-4.6': 1,
  'claude-haiku-4.5': 0.33,
  'gemini-2.5-pro': 1,
  'gemini-3-flash': 0.33,
  'gemini-3.1-pro': 1,
  'gpt-4.1': 0,
  'gpt-4o': 0,
  'gpt-5-mini': 0,
  'gpt-5.4': 1,
  'o3-pro': 20,
  'o4-mini': 0.33,
};

// Plan allowances
const PLAN_ALLOWANCES = {
  free: 50,
  pro: 300,
  'pro+': 1500,
  business: 300,
  enterprise: 1000,
};

/**
 * Load efficiency tracking data
 */
function loadEfficiencyData() {
  try {
    return JSON.parse(readFileSync(EFFICIENCY_PATH, 'utf-8'));
  } catch {
    return {
      sessions: [],
      dataPoints: [],
      summary: {
        totalPromptsTracked: 0,
        avgCharsSavedPerPrompt: 0,
        avgTokensSavedPerPrompt: 0,
        correlations: [],
      },
    };
  }
}

/**
 * Save efficiency tracking data
 */
function saveEfficiencyData(data) {
  try {
    writeFileSync(EFFICIENCY_PATH, JSON.stringify(data, null, 2));
  } catch { /* non-critical */ }
}

/**
 * Record a data point from an assemble() call.
 * Called by the main ContextClaw engine after each assemble.
 */
function recordAssemblePoint({
  sessionId,
  charsSaved,
  tokensSaved,
  messageCount,
  truncatedCount,
  modelId,
  provider,
}) {
  const data = loadEfficiencyData();
  
  data.dataPoints.push({
    ts: Date.now(),
    sessionId,
    charsSaved,
    tokensSaved,
    messageCount,
    truncatedCount,
    modelId,
    provider,
  });

  // Keep last 1000 points
  if (data.dataPoints.length > 1000) {
    data.dataPoints = data.dataPoints.slice(-1000);
  }

  data.summary.totalPromptsTracked++;
  
  // Running average
  const n = data.summary.totalPromptsTracked;
  data.summary.avgCharsSavedPerPrompt = 
    ((data.summary.avgCharsSavedPerPrompt * (n - 1)) + charsSaved) / n;
  data.summary.avgTokensSavedPerPrompt = 
    ((data.summary.avgTokensSavedPerPrompt * (n - 1)) + tokensSaved) / n;

  saveEfficiencyData(data);
  return data.summary;
}

/**
 * Record a dashboard snapshot (premium request % before/after a prompt).
 * Called by the user or by automated scraping.
 */
function recordDashboardSnapshot({
  pctBefore,
  pctAfter,
  method, // 'openclaw' or 'vanilla'
  modelId,
  plan = 'pro',
}) {
  const data = loadEfficiencyData();
  const pctConsumed = pctAfter - pctBefore;
  const allowance = PLAN_ALLOWANCES[plan] || 300;
  const premiumRequestsConsumed = (pctConsumed / 100) * allowance;

  data.sessions.push({
    ts: Date.now(),
    method,
    modelId,
    plan,
    pctBefore,
    pctAfter,
    pctConsumed,
    premiumRequestsConsumed,
  });

  // Recalculate correlations
  updateCorrelations(data);
  saveEfficiencyData(data);

  return {
    pctConsumed,
    premiumRequestsConsumed,
    currentSummary: data.summary,
  };
}

/**
 * Calculate correlation between method and efficiency
 */
function updateCorrelations(data) {
  const byMethod = {};
  
  for (const session of data.sessions) {
    if (!byMethod[session.method]) {
      byMethod[session.method] = [];
    }
    byMethod[session.method].push(session.pctConsumed);
  }

  data.summary.correlations = Object.entries(byMethod).map(([method, values]) => {
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const sorted = [...values].sort((a, b) => a - b);
    const median = sorted.length % 2 
      ? sorted[Math.floor(sorted.length / 2)]
      : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;

    return {
      method,
      n: values.length,
      avgPctPerPrompt: Math.round(avg * 1000) / 1000,
      medianPctPerPrompt: Math.round(median * 1000) / 1000,
      minPct: Math.min(...values),
      maxPct: Math.max(...values),
    };
  });

  // Calculate efficiency gain if both methods present
  const oc = data.summary.correlations.find(c => c.method === 'openclaw');
  const va = data.summary.correlations.find(c => c.method === 'vanilla');
  
  if (oc && va && va.avgPctPerPrompt > 0) {
    data.summary.efficiencyGain = {
      pctReduction: Math.round((1 - oc.avgPctPerPrompt / va.avgPctPerPrompt) * 1000) / 10,
      stretchMultiplier: Math.round((va.avgPctPerPrompt / oc.avgPctPerPrompt) * 100) / 100,
      extraPromptsPerMonth: Math.round(
        (100 / oc.avgPctPerPrompt) - (100 / va.avgPctPerPrompt)
      ),
      monthlyValueUsd: Math.round(
        ((100 / oc.avgPctPerPrompt) - (100 / va.avgPctPerPrompt)) * 0.04 * 100
      ) / 100,
    };
  }
}

/**
 * Get the current efficiency summary for display
 */
function getEfficiencySummary() {
  const data = loadEfficiencyData();
  return {
    ...data.summary,
    modelMultipliers: MODEL_MULTIPLIERS,
    planAllowances: PLAN_ALLOWANCES,
  };
}

/**
 * Get raw data for the benchmark report
 */
function getEfficiencyData() {
  return loadEfficiencyData();
}

export {
  recordAssemblePoint,
  recordDashboardSnapshot,
  getEfficiencySummary,
  getEfficiencyData,
  MODEL_MULTIPLIERS,
  PLAN_ALLOWANCES,
};
