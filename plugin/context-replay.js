/**
 * 🔄 ContextClaw Context Replay
 *
 * Rehydrate evicted messages from cold storage.
 * Users can selectively bring back context:
 * - By time range ("load yesterday's research")
 * - By topic keywords ("load the deployment discussion")
 * - By session ID
 *
 * The point: eviction isn't deletion. It's RAM → disk.
 * This is disk → RAM.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const COLD_DIR = join(homedir(), '.openclaw', 'workspace', 'memory', 'cold');

// ---------------------------------------------------------------------------
// List available cold storage files
// ---------------------------------------------------------------------------

export function listColdStorage() {
  if (!existsSync(COLD_DIR)) return [];

  return readdirSync(COLD_DIR)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => {
      const lines = readFileSync(join(COLD_DIR, f), 'utf-8').trim().split('\n');
      const messages = lines.map(l => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
      const timestamps = messages.map(m => m.timestamp).filter(Boolean).sort();

      return {
        file: f,
        messageCount: messages.length,
        totalTokens: messages.reduce((s, m) => s + (m.tokens || 0), 0),
        timeRange: timestamps.length > 0
          ? { from: timestamps[0], to: timestamps[timestamps.length - 1] }
          : null,
        roles: [...new Set(messages.map(m => m.role))],
      };
    })
    .sort((a, b) => (b.timeRange?.to || '').localeCompare(a.timeRange?.to || ''));
}

// ---------------------------------------------------------------------------
// Load messages from cold storage with filters
// ---------------------------------------------------------------------------

/**
 * Load cold-stored messages matching the given filters.
 *
 * @param {Object} options
 * @param {string} [options.sessionId] - Filter by session ID prefix
 * @param {string[]} [options.keywords] - Filter by keyword presence in content
 * @param {string} [options.after] - ISO timestamp — only messages after this
 * @param {string} [options.before] - ISO timestamp — only messages before this
 * @param {string[]} [options.roles] - Filter by role (user, assistant, tool)
 * @param {number} [options.maxTokens] - Max tokens to load (budget protection)
 * @returns {{ messages: Array, totalTokens: number, filesSearched: number }}
 */
export function loadFromCold({
  sessionId,
  keywords,
  after,
  before,
  roles,
  maxTokens = 10000,
} = {}) {
  if (!existsSync(COLD_DIR)) return { messages: [], totalTokens: 0, filesSearched: 0 };

  const files = readdirSync(COLD_DIR).filter(f => f.endsWith('.jsonl'));
  const results = [];
  let totalTokens = 0;
  let filesSearched = 0;

  for (const file of files) {
    // Session ID filter
    if (sessionId && !file.startsWith(sessionId)) continue;

    filesSearched++;
    const lines = readFileSync(join(COLD_DIR, file), 'utf-8').trim().split('\n');

    for (const line of lines) {
      if (totalTokens >= maxTokens) break;

      let msg;
      try { msg = JSON.parse(line); } catch (_) { continue; }

      // Time filters
      if (after && msg.timestamp && msg.timestamp < after) continue;
      if (before && msg.timestamp && msg.timestamp > before) continue;

      // Role filter
      if (roles && !roles.includes(msg.role)) continue;

      // Keyword filter (any match)
      if (keywords && keywords.length > 0) {
        const content = (msg.content || '').toLowerCase();
        if (!keywords.some(kw => content.includes(kw.toLowerCase()))) continue;
      }

      // Budget protection
      const tokens = msg.tokens || 0;
      if (totalTokens + tokens > maxTokens) continue;

      results.push(msg);
      totalTokens += tokens;
    }

    if (totalTokens >= maxTokens) break;
  }

  return {
    messages: results,
    totalTokens,
    filesSearched,
    truncated: totalTokens >= maxTokens,
  };
}

// ---------------------------------------------------------------------------
// Rehydrate — convert cold messages back to assemble-ready format
// ---------------------------------------------------------------------------

/**
 * Load from cold and convert to messages[] format ready
 * for injection into the next assemble() call.
 *
 * Adds a [Rehydrated] tag so the model knows this is recalled context.
 */
export function rehydrate(filters) {
  const { messages, totalTokens, filesSearched, truncated } = loadFromCold(filters);

  const rehydrated = messages.map(m => ({
    role: m.role || 'assistant',
    content: `[Rehydrated from cold storage] ${m.content || ''}`,
  }));

  return {
    messages: rehydrated,
    totalTokens,
    filesSearched,
    truncated,
    summary: `Rehydrated ${messages.length} messages (${totalTokens} tokens) from ${filesSearched} cold storage files${truncated ? ' (budget-limited)' : ''}.`,
  };
}
