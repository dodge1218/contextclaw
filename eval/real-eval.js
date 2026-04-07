import { ContextClawEngine } from '../plugin/index.js';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

const SESSIONS_DIR = join(process.env.HOME, '.openclaw', 'agents', 'main', 'sessions');
const RESULTS_DIR = join(process.env.HOME, '.openclaw', 'workspace', 'contextclaw', 'eval', 'results');

/**
 * Run ContextClaw against real session .reset files (pre-compaction backups).
 * These contain the full uncompacted conversation — perfect eval input.
 */
async function runRealEval() {
  const engine = new ContextClawEngine({ enableTelemetry: false });
  
  // Find .reset files from the last 24h
  const allFiles = readdirSync(SESSIONS_DIR).filter(f => f.includes('.reset.'));
  const recent = allFiles
    .map(f => ({ name: f, path: join(SESSIONS_DIR, f), mtime: statSync(join(SESSIONS_DIR, f)).mtimeMs }))
    .filter(f => Date.now() - f.mtime < 86400000)
    .sort((a, b) => a.mtime - b.mtime);

  if (recent.length === 0) {
    console.error('No recent .reset files found');
    process.exit(1);
  }

  console.log(`Found ${recent.length} reset files from last 24h\n`);

  const results = [];

  for (const file of recent) {
    const raw = readFileSync(file.path, 'utf-8');
    const lines = raw.split('\n').filter(l => l.trim());
    
    // Parse OpenClaw session event log into messages array
    const messages = [];
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj.type !== 'message' || !obj.message) continue;
        const msg = obj.message;
        let role = msg.role;
        // Map OpenClaw roles to standard
        if (role === 'toolResult') role = 'tool';
        if (!['system', 'user', 'assistant', 'tool'].includes(role)) continue;
        
        let content = msg.content;
        // content is typically an array of parts
        if (Array.isArray(content)) {
          content = content.map(p => {
            if (typeof p === 'string') return p;
            if (p.type === 'text') return p.text || '';
            if (p.type === 'tool_result') return p.content || p.text || JSON.stringify(p);
            return JSON.stringify(p);
          }).join('\n');
        } else if (typeof content !== 'string') {
          content = JSON.stringify(content);
        }
        
        if (content && content.length > 0) {
          messages.push({ role, content });
        }
      } catch { /* skip */ }
    }

    if (messages.length < 5) continue;

    // Count original tokens (chars/4 approximation)
    const originalChars = messages.reduce((sum, m) => sum + (typeof m.content === 'string' ? m.content.length : 0), 0);
    
    // Run ContextClaw
    try {
      const result = await engine.assemble({
        sessionId: `eval-${basename(file.name)}`,
        messages,
      });

      const outputChars = result.messages.reduce((sum, m) => sum + (typeof m.content === 'string' ? m.content.length : 0), 0);
      const reduction = ((originalChars - outputChars) / originalChars * 100);
      
      // Count truncated items
      let truncated = 0;
      for (const msg of result.messages) {
        if (typeof msg.content === 'string' && msg.content.includes('[ContextClaw:')) {
          truncated++;
        }
      }

      const entry = {
        file: basename(file.name).slice(0, 16),
        messages: messages.length,
        originalChars,
        outputChars,
        reduction: Math.round(reduction * 10) / 10,
        truncated,
      };
      results.push(entry);
      
      console.log(`${entry.file}: ${entry.messages} msgs, ${entry.originalChars.toLocaleString()} → ${entry.outputChars.toLocaleString()} chars (${entry.reduction}% reduction, ${truncated} truncated)`);
    } catch (err) {
      console.error(`Failed on ${basename(file.name)}: ${err.message}`);
    }
  }

  // Summary
  const totalOrig = results.reduce((s, r) => s + r.originalChars, 0);
  const totalOut = results.reduce((s, r) => s + r.outputChars, 0);
  const avgReduction = totalOrig > 0 ? ((totalOrig - totalOut) / totalOrig * 100).toFixed(1) : 0;
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Sessions evaluated: ${results.length}`);
  console.log(`Total original: ${totalOrig.toLocaleString()} chars`);
  console.log(`Total output:   ${totalOut.toLocaleString()} chars`);
  console.log(`Overall reduction: ${avgReduction}%`);
  console.log(`Est. tokens saved: ~${Math.round((totalOrig - totalOut) / 4).toLocaleString()}`);

  // Write results
  const report = {
    date: new Date().toISOString(),
    methodology: 'Ran ContextClaw.assemble() against uncompacted .reset session files. Compared input vs output character counts.',
    sessions: results.length,
    totalOriginalChars: totalOrig,
    totalOutputChars: totalOut,
    overallReduction: `${avgReduction}%`,
    details: results,
  };
  
  writeFileSync(join(RESULTS_DIR, `real-eval-${new Date().toISOString().slice(0,10)}.json`), JSON.stringify(report, null, 2));
  
  // Markdown
  const md = `# ContextClaw — Real Session Eval
Date: ${new Date().toISOString().slice(0, 10)}

## Methodology
- Input: \`.reset\` files (pre-compaction session backups, full uncompacted conversation)
- Process: \`ContextClawEngine.assemble()\` on each session
- Metric: character reduction (input vs output), truncation count
- No synthetic data. These are real agent sessions.

## Results

| Session | Messages | Original | Output | Reduction | Truncated |
|---------|----------|----------|--------|-----------|-----------|
${results.map(r => `| ${r.file} | ${r.messages} | ${r.originalChars.toLocaleString()} | ${r.outputChars.toLocaleString()} | **${r.reduction}%** | ${r.truncated} |`).join('\n')}
| **Total** | | **${totalOrig.toLocaleString()}** | **${totalOut.toLocaleString()}** | **${avgReduction}%** | |

Est. tokens saved: ~${Math.round((totalOrig - totalOut) / 4).toLocaleString()}
`;
  writeFileSync(join(RESULTS_DIR, 'real-world-eval.md'), md);
  console.log(`\nWritten to: ${join(RESULTS_DIR, 'real-world-eval.md')}`);
}

runRealEval().catch(console.error);
