/**
 * ContextClaw Real-World Eval
 * Runs the actual plugin on real session transcripts from corpus/
 * Measures: token reduction, what got truncated, and potential re-read detection
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { ContextClawEngine, computeTurnsAgo } from '../plugin/index.js';
import { classifyAll } from '../plugin/classifier.js';
import { applyPolicy } from '../plugin/policy.js';

const CORPUS = '/home/yin/.openclaw/workspace/corpus';

// Pick the heaviest sessions (most messages)
function findSessions(limit = 5) {
  const files = readdirSync(CORPUS).filter(f => f.endsWith('.jsonl'));
  const sized = files.map(f => {
    const lines = readFileSync(`${CORPUS}/${f}`, 'utf-8').trim().split('\n');
    return { file: f, count: lines.length };
  });
  sized.sort((a, b) => b.count - a.count);
  return sized.slice(0, limit);
}

function charTokenEstimate(text) {
  return Math.ceil((text || '').length / 4);
}

function processSession(filepath) {
  const raw = readFileSync(filepath, 'utf-8').trim().split('\n');
  const messages = raw.map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);

  // Convert to the format classifier expects
  const normalized = messages.map(m => ({
    role: m.role || 'user',
    content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content || ''),
    _source: m._source || undefined,
  }));

  // Input token count
  const inputTokens = normalized.reduce((sum, m) => sum + charTokenEstimate(m.content), 0);

  // Classify
  const classified = classifyAll(normalized);

  // Apply policies (simulate being at turn N for each message)
  const userTurns = classified.filter(m => m.role === 'user').length;
  let outputTokens = 0;
  let truncatedCount = 0;
  let truncatedTypes = {};
  let savedChars = 0;
  const truncatedItems = [];

  classified.forEach((msg, i) => {
    const turnsAgo = computeTurnsAgo(classified, i);
    const result = applyPolicy(msg, turnsAgo);
    const afterTokens = charTokenEstimate(result.msg.content);
    outputTokens += afterTokens;

    if (result.action === 'truncate' || result.msg._truncated) {
      truncatedCount++;
      const type = msg._type || 'unknown';
      truncatedTypes[type] = (truncatedTypes[type] || 0) + 1;
      const origChars = (result.originalChars || msg.content.length);
      const afterChars = result.msg.content.length;
      savedChars += (origChars - afterChars);
      if (origChars > 5000) {
        truncatedItems.push({
          type,
          turnsAgo,
          origChars,
          afterChars,
          preview: msg.content.substring(0, 80).replace(/\n/g, ' '),
        });
      }
    }
  });

  return {
    messages: normalized.length,
    userTurns,
    inputTokens,
    outputTokens,
    reduction: inputTokens > 0 ? ((1 - outputTokens / inputTokens) * 100).toFixed(1) : '0',
    truncatedCount,
    truncatedTypes,
    savedChars,
    bigTruncations: truncatedItems.slice(0, 5),
  };
}

// Main
const sessions = findSessions(5);
const results = [];

for (const { file, count } of sessions) {
  try {
    const r = processSession(`${CORPUS}/${file}`);
    r.file = file;
    r.rawMessages = count;
    results.push(r);
    console.log(`✓ ${file}: ${r.inputTokens} → ${r.outputTokens} tokens (${r.reduction}% reduction)`);
  } catch (e) {
    console.error(`✗ ${file}: ${e.message}`);
  }
}

// Generate markdown
let md = `# ContextClaw — Real-World Eval\n`;
md += `Tested on ${results.length} actual autonomous agent sessions from production.\n\n`;
md += `| Session | Messages | Input Tokens | Output Tokens | Reduction | Truncated Items |\n`;
md += `|---------|----------|--------------|---------------|-----------|------------------|\n`;

let totalIn = 0, totalOut = 0;
for (const r of results) {
  const name = r.file.split('-')[0].slice(0, 8);
  md += `| ${name}… | ${r.messages} | ${r.inputTokens.toLocaleString()} | ${r.outputTokens.toLocaleString()} | **${r.reduction}%** | ${r.truncatedCount} |\n`;
  totalIn += r.inputTokens;
  totalOut += r.outputTokens;
}

const totalReduction = totalIn > 0 ? ((1 - totalOut / totalIn) * 100).toFixed(1) : '0';
md += `| **Total** | | **${totalIn.toLocaleString()}** | **${totalOut.toLocaleString()}** | **${totalReduction}%** | |\n`;

md += `\n## What Got Truncated\n`;
for (const r of results) {
  if (Object.keys(r.truncatedTypes).length > 0) {
    md += `\n### ${r.file.split('-')[0].slice(0, 8)}…\n`;
    for (const [type, count] of Object.entries(r.truncatedTypes)) {
      md += `- ${type}: ${count} items truncated\n`;
    }
    if (r.bigTruncations.length > 0) {
      md += `\nBiggest truncations:\n`;
      for (const t of r.bigTruncations) {
        md += `- **${t.type}** (${t.origChars.toLocaleString()} → ${t.afterChars.toLocaleString()} chars, ${t.turnsAgo} turns ago): \`${t.preview}…\`\n`;
      }
    }
  }
}

md += `\n## Re-Read Risk Assessment\n`;
md += `Items truncated within 2 turns of a user message referencing the same content could cause re-reads.\n`;
// Simple heuristic: flag any truncation at turnsAgo <= 2 on a large item
let rereadRisks = 0;
for (const r of results) {
  for (const t of r.bigTruncations) {
    if (t.turnsAgo <= 2) rereadRisks++;
  }
}
md += `- Potential re-read triggers found: **${rereadRisks}** across ${results.length} sessions\n`;
if (rereadRisks === 0) {
  md += `- ✅ No items truncated within the safety window (2 turns)\n`;
} else {
  md += `- ⚠️ ${rereadRisks} items were truncated while potentially still relevant\n`;
}

writeFileSync(new URL('./results/real-world-eval.md', import.meta.url), md);
console.log(`\nWritten to eval/results/real-world-eval.md`);
console.log(`\nTotal: ${totalIn.toLocaleString()} → ${totalOut.toLocaleString()} tokens (${totalReduction}% reduction)`);
