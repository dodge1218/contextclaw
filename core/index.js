/**
 * contextclaw — Content-type classification and retention for LLM context windows.
 *
 * Works with any LLM framework. No dependencies beyond Node.js crypto.
 *
 * Usage:
 *   import { prune } from 'contextclaw';
 *   const { messages } = prune(myMessages);
 *
 * Or step by step:
 *   import { classifyAll, computeTurnsAgo, applyPolicy } from 'contextclaw';
 */

import { classifyAll, classify, TYPES } from './classifier.js';
import { applyPolicy, DEFAULT_POLICIES } from './policy.js';

export { classify, classifyAll, TYPES } from './classifier.js';
export { applyPolicy, DEFAULT_POLICIES } from './policy.js';

/**
 * Count how many user turns ago each message was.
 * Turn 0 = current turn. A "turn" = a user message.
 *
 * @param {Object[]} messages - Array of { role, content, ... }
 * @returns {number[]} turnsAgo for each message
 */
export function computeTurnsAgo(messages) {
  let turnCount = 0;
  const turnsAgo = new Array(messages.length).fill(0);
  for (let i = messages.length - 1; i >= 0; i--) {
    turnsAgo[i] = turnCount;
    if (messages[i].role === 'user') turnCount++;
  }
  return turnsAgo;
}

/**
 * Prune a message array in one call.
 * Classifies each message, computes turn distance, applies retention policies.
 * Returns clean messages with internal metadata stripped.
 *
 * @param {Object[]} messages - Array of { role, content, ... }
 * @param {Object} [options]
 * @param {Object} [options.policies] - Per-type policy overrides
 * @param {boolean} [options.stats] - Include reduction stats in return value
 * @returns {{ messages: Object[], stats?: Object }}
 *
 * @example
 * import { prune } from 'contextclaw';
 *
 * const conversation = [
 *   { role: 'system', content: 'You are helpful.' },
 *   { role: 'user', content: 'Read my config file' },
 *   { role: 'tool', content: '{ "database": { "host": "..." } ... 50KB of JSON ... }' },
 *   { role: 'assistant', content: 'I see your database config.' },
 *   { role: 'user', content: 'Now help me write tests' },
 *   // ... 20 more turns later, that 50KB config is still in context
 * ];
 *
 * const { messages } = prune(conversation);
 * // Config is now truncated to 200 chars. Conversation intact.
 */
export function prune(messages, options = {}) {
  const classified = classifyAll(messages);
  const turnsAgo = computeTurnsAgo(classified);

  let totalSaved = 0;
  const typeCounts = {};

  const results = classified.map((msg, i) => {
    const result = applyPolicy(msg, turnsAgo[i], options.policies);

    const type = msg._type;
    if (!typeCounts[type]) typeCounts[type] = { count: 0, truncated: 0, charsSaved: 0 };
    typeCounts[type].count++;
    if (result.action === 'truncate') {
      typeCounts[type].truncated++;
      typeCounts[type].charsSaved += result.savedChars || 0;
      totalSaved += result.savedChars || 0;
    }

    // Strip internal metadata
    const { _type, _chars, _truncated, _originalChars, ...clean } = result.msg;
    return clean;
  });

  if (options.stats) {
    return {
      messages: results,
      stats: { totalSaved, typeCounts, inputCount: messages.length, outputCount: results.length },
    };
  }

  return { messages: results };
}
