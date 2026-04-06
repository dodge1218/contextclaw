/**
 * 🎯 ContextClaw Intent Extractor
 *
 * Pre-processes user prompts to extract every actionable item,
 * question, and decision point. Injects a checklist into the
 * system prompt so the model MUST address each one.
 *
 * Solves: "I asked 5 things and got 2 answers."
 *
 * Runs as a pre-assemble hook — zero model calls, pure heuristic.
 */

// ---------------------------------------------------------------------------
// Intent patterns — ordered by specificity
// ---------------------------------------------------------------------------

const INTENT_PATTERNS = [
  // Direct commands / imperatives
  { type: 'action', pattern: /(?:^|\.\s+)((?:please\s+)?(?:fix|build|create|write|deploy|push|ship|update|install|remove|delete|add|check|test|run|set up|configure|implement|refactor|review|move|copy|rename|merge|revert|undo|send|schedule|monitor|track|log|commit|publish|start|stop|restart|kill|debug|investigate|research|find|search|fetch|download|upload|open|close))\s+(.{5,}?)(?:\.|$|;|\band\b|\bthen\b)/gi },

  // Questions
  { type: 'question', pattern: /(?:^|\.\s+)((?:what|how|why|when|where|which|who|is|are|can|could|should|would|does|do|will|has|have|did)\s+.{5,}?\?)/gi },

  // Decision points — "should we X or Y", "pick between"
  { type: 'decision', pattern: /(?:should\s+(?:we|i|you)\s+(.{5,}?)\s+or\s+(.{5,}?)(?:\?|$))/gi },

  // Numbered/bulleted lists
  { type: 'list_item', pattern: /(?:^|\n)\s*(?:\d+[\.\)]\s*|-\s*|\*\s*)(.{5,})/gm },

  // "Also" / "and also" — the buried second request
  { type: 'also', pattern: /(?:also|and also|oh and|btw|by the way|one more thing|additionally)\s+(.{5,}?)(?:\.|$|;)/gi },

  // "Make sure" / "don't forget" — constraints
  { type: 'constraint', pattern: /(?:make sure|don't forget|ensure|remember to|be sure to)\s+(.{5,}?)(?:\.|$|;)/gi },

  // "Think about" / "consider" — reflection requests
  { type: 'reflection', pattern: /(?:think about|consider|brainstorm|come up with|figure out|plan|design|architect|scope|outline|draft|propose|suggest|recommend)\s+(.{5,}?)(?:\.|$|;)/gi },
];

// ---------------------------------------------------------------------------
// Core extractor
// ---------------------------------------------------------------------------

/**
 * Extract intents from a user message.
 * Returns { intents: [...], checklist: string, count: number }
 */
export function extractIntents(text) {
  if (!text || typeof text !== 'string') return { intents: [], checklist: '', count: 0 };

  const intents = [];
  const seen = new Set();

  for (const { type, pattern } of INTENT_PATTERNS) {
    // Reset regex state
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const raw = (match[1] || match[0]).trim();
      // Dedupe by normalized text
      const key = raw.toLowerCase().replace(/\s+/g, ' ').slice(0, 80);
      if (seen.has(key)) continue;
      seen.add(key);

      intents.push({
        type,
        text: raw.slice(0, 200), // cap length
        position: match.index,
      });
    }
  }

  // Sort by position in original message
  intents.sort((a, b) => a.position - b.position);

  // Build checklist for system prompt injection
  const checklist = intents.length > 1
    ? buildChecklist(intents)
    : '';

  return { intents, checklist, count: intents.length };
}

// ---------------------------------------------------------------------------
// Checklist builder — injected into system prompt
// ---------------------------------------------------------------------------

function buildChecklist(intents) {
  const lines = ['[ContextClaw Intent Checklist — address every item below]'];

  const grouped = {};
  for (const intent of intents) {
    if (!grouped[intent.type]) grouped[intent.type] = [];
    grouped[intent.type].push(intent);
  }

  const typeLabels = {
    action: '🔧 Actions',
    question: '❓ Questions',
    decision: '⚖️ Decisions',
    list_item: '📋 Items',
    also: '➕ Additional',
    constraint: '⚠️ Constraints',
    reflection: '💭 Reflections',
  };

  for (const [type, items] of Object.entries(grouped)) {
    lines.push(`\n${typeLabels[type] || type}:`);
    for (const item of items) {
      lines.push(`  □ ${item.text}`);
    }
  }

  lines.push('\n[Respond to ALL items above. Mark each as addressed.]');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Completeness scorer — run AFTER the response to grade coverage
// ---------------------------------------------------------------------------

/**
 * Given the original intents and the assistant's response,
 * score how many intents were actually addressed (0.0 - 1.0).
 */
export function scoreCompleteness(intents, responseText) {
  if (!intents.length || !responseText) return { score: 1.0, missed: [] };

  const response = responseText.toLowerCase();
  const missed = [];
  let addressed = 0;

  for (const intent of intents) {
    // Extract key terms from the intent
    const words = intent.text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3);

    // Check if at least 40% of key terms appear in response
    const hits = words.filter(w => response.includes(w)).length;
    const coverage = words.length > 0 ? hits / words.length : 0;

    if (coverage >= 0.4) {
      addressed++;
    } else {
      missed.push(intent);
    }
  }

  return {
    score: intents.length > 0 ? addressed / intents.length : 1.0,
    addressed,
    total: intents.length,
    missed,
    missedChecklist: missed.length > 0
      ? `[ContextClaw: ${missed.length} intent(s) may not have been addressed]\n` +
        missed.map(m => `  ⚠ ${m.type}: ${m.text}`).join('\n')
      : null,
  };
}

// ---------------------------------------------------------------------------
// Integration hook for ContextClaw engine
// ---------------------------------------------------------------------------

/**
 * Call this in the assemble() method before returning messages.
 * If the latest user message has 2+ intents, injects a checklist
 * into systemPromptAddition.
 */
export function preProcessPrompt(messages) {
  if (!messages || !messages.length) return { checklist: '', intents: [] };

  // Find the last user message
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  if (!lastUser) return { checklist: '', intents: [] };

  const text = typeof lastUser.content === 'string'
    ? lastUser.content
    : JSON.stringify(lastUser.content);

  return extractIntents(text);
}
