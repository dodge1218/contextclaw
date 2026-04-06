/**
 * 💰 ContextClaw Cost Attribution
 *
 * Tracks per-task token costs so users can see exactly where
 * their budget goes. Persists to disk for weekly waste reports.
 *
 * Not a billing system — a visibility system.
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const COST_DIR = join(homedir(), '.openclaw', 'workspace', 'contextclaw', 'telemetry');
const COST_FILE = join(COST_DIR, 'cost-log.jsonl');

// Pricing per 1M tokens (input/output) — approximate, user-configurable
const DEFAULT_PRICING = {
  'anthropic/claude-sonnet-4': { input: 3.0, output: 15.0 },
  'anthropic/claude-opus-4': { input: 15.0, output: 75.0 },
  'openai/gpt-4o': { input: 2.5, output: 10.0 },
  'openai/gpt-4.1': { input: 2.0, output: 8.0 },
  'google/gemini-2.5-pro': { input: 1.25, output: 5.0 },
  'github-copilot/claude-opus-4': { input: 0, output: 0 }, // free via copilot
  'groq/llama-3.3-70b-versatile': { input: 0.59, output: 0.79 },
  default: { input: 3.0, output: 15.0 },
};

// ---------------------------------------------------------------------------
// Task tracking
// ---------------------------------------------------------------------------

const activeTasks = new Map(); // taskId -> { startTokens, model, startTime }

/**
 * Start tracking a task. Call when a new user message arrives.
 */
export function startTask(taskId, { model, inputTokens }) {
  activeTasks.set(taskId, {
    model: model || 'unknown',
    startTime: Date.now(),
    inputTokens: inputTokens || 0,
    outputTokens: 0,
    evictedTokens: 0,
    turns: 0,
  });
}

/**
 * Record a turn for the current task.
 */
export function recordTurn(taskId, { inputTokens, outputTokens, evictedTokens }) {
  const task = activeTasks.get(taskId);
  if (!task) return;
  task.inputTokens += inputTokens || 0;
  task.outputTokens += outputTokens || 0;
  task.evictedTokens += evictedTokens || 0;
  task.turns++;
}

/**
 * End a task and persist the cost record.
 */
export function endTask(taskId, { summary } = {}) {
  const task = activeTasks.get(taskId);
  if (!task) return null;

  const pricing = DEFAULT_PRICING[task.model] || DEFAULT_PRICING.default;
  const inputCost = (task.inputTokens / 1_000_000) * pricing.input;
  const outputCost = (task.outputTokens / 1_000_000) * pricing.output;
  const totalCost = inputCost + outputCost;
  const savedCost = (task.evictedTokens / 1_000_000) * pricing.input;

  const record = {
    taskId,
    model: task.model,
    startTime: new Date(task.startTime).toISOString(),
    endTime: new Date().toISOString(),
    durationMs: Date.now() - task.startTime,
    turns: task.turns,
    inputTokens: task.inputTokens,
    outputTokens: task.outputTokens,
    evictedTokens: task.evictedTokens,
    totalCost: Math.round(totalCost * 10000) / 10000,
    savedCost: Math.round(savedCost * 10000) / 10000,
    summary: summary || null,
  };

  // Persist
  try {
    mkdirSync(COST_DIR, { recursive: true });
    writeFileSync(COST_FILE, JSON.stringify(record) + '\n', { flag: 'a' });
  } catch (_) { /* best effort */ }

  activeTasks.delete(taskId);
  return record;
}

// ---------------------------------------------------------------------------
// Waste report — weekly digest
// ---------------------------------------------------------------------------

/**
 * Generate a waste report from the cost log.
 * Returns { totalCost, totalSaved, totalTokens, taskBreakdown, period }
 */
export function generateWasteReport({ daysBack = 7 } = {}) {
  if (!existsSync(COST_FILE)) return null;

  const cutoff = Date.now() - (daysBack * 24 * 60 * 60 * 1000);
  const lines = readFileSync(COST_FILE, 'utf-8').trim().split('\n').filter(Boolean);

  let totalCost = 0;
  let totalSaved = 0;
  let totalInput = 0;
  let totalOutput = 0;
  let totalEvicted = 0;
  let taskCount = 0;
  const byModel = {};

  for (const line of lines) {
    try {
      const record = JSON.parse(line);
      if (new Date(record.startTime).getTime() < cutoff) continue;

      taskCount++;
      totalCost += record.totalCost;
      totalSaved += record.savedCost;
      totalInput += record.inputTokens;
      totalOutput += record.outputTokens;
      totalEvicted += record.evictedTokens;

      if (!byModel[record.model]) byModel[record.model] = { cost: 0, tokens: 0, tasks: 0 };
      byModel[record.model].cost += record.totalCost;
      byModel[record.model].tokens += record.inputTokens + record.outputTokens;
      byModel[record.model].tasks++;
    } catch (_) { /* skip bad lines */ }
  }

  return {
    period: `Last ${daysBack} days`,
    taskCount,
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
    totalEvictedTokens: totalEvicted,
    totalCost: Math.round(totalCost * 100) / 100,
    totalSaved: Math.round(totalSaved * 100) / 100,
    savingsPercent: totalCost > 0
      ? Math.round((totalSaved / (totalCost + totalSaved)) * 100)
      : 0,
    byModel,
    summary: totalSaved > 0
      ? `ContextClaw saved $${(Math.round(totalSaved * 100) / 100).toFixed(2)} (${Math.round((totalEvicted / (totalInput + totalEvicted)) * 100)}% of input tokens evicted before API call)`
      : 'No evictions recorded this period.',
  };
}
