#!/usr/bin/env node

import { startChat } from './chat.js';
import { startInspector } from './inspector/server.js';
import { GatewayClient } from './gateway-client.js';
import { ContextClaw } from './orchestrator.js';
import { analyzeSession } from './analyzer.js';
import { SessionWatcher } from './watcher.js';

const DEFAULT_WS_URL = 'ws://127.0.0.1:18789';

function showHelp() {
  console.log(`
ContextClaw — Context orchestration for OpenClaw agents

Usage: contextclaw <command> [options]

Commands:
  analyze [current|all|<file>]  Token usage breakdown for sessions
  watch                         Monitor active session, alert on bloat
  compact [--dry-run]           Generate compaction plan (flush bloat to cold storage)
  status                        Quick snapshot of current session health
  inspect                       Start inspector web UI on port 3333
  clear                         Clear the current session
  chat                          Start interactive chat (default)
  help                          Show this help

Options (watch):
  --warn <tokens>       Warn threshold (default: 40000)
  --compact <tokens>    Auto-compact threshold (default: 55000)
  --tool-max <tokens>   Max tokens per tool result (default: 2000)

Examples:
  contextclaw analyze                 Analyze current session
  contextclaw analyze all             Compare recent sessions
  contextclaw watch                   Start monitoring daemon
  contextclaw watch --warn 30000      Custom warn threshold
  contextclaw compact                 Show what would be flushed
  contextclaw compact --execute       Actually flush to cold storage
  contextclaw status                  Quick health check
`);
}

function parseFlag(flag: string, defaultVal: number): number {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= process.argv.length) return defaultVal;
  return parseInt(process.argv[idx + 1], 10) || defaultVal;
}

async function main() {
  const command = process.argv[2];

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    showHelp();
    process.exit(0);
  }

  switch (command) {
    case 'analyze': {
      const target = process.argv[3] ?? 'current';
      await analyzeSession(target);
      break;
    }

    case 'watch': {
      const watcher = new SessionWatcher({
        warnThreshold: parseFlag('--warn', 40000),
        compactThreshold: parseFlag('--compact', 55000),
        toolResultMaxTokens: parseFlag('--tool-max', 2000),
      }, (msg) => {
        console.log(msg);
      });
      watcher.start();
      console.log('[ContextClaw] Watching... Ctrl+C to stop.');
      // Keep alive
      await new Promise(() => {});
      break;
    }

    case 'compact': {
      const watcher = new SessionWatcher();
      const dryRun = !process.argv.includes('--execute');
      const plan = await watcher.generateCompactionPlan();

      console.log('\n=== Compaction Plan ===\n');

      if (plan.flush.length === 0) {
        console.log('✅ Nothing to compact — session is clean.');
        break;
      }

      console.log(`FLUSH to cold storage (${plan.flush.length} items, ~${plan.estimatedSavings.toLocaleString()} tokens):`);
      for (const item of plan.flush) {
        console.log(`  ❌ ${item.type} (${item.tokens} tokens) — ${item.reason}`);
        console.log(`     ${item.preview.slice(0, 80)}...`);
      }

      console.log(`\nKEEP (${plan.keep.length} items, ~${plan.keep.reduce((s, k) => s + k.tokens, 0).toLocaleString()} tokens):`);
      for (const item of plan.keep.slice(0, 5)) {
        console.log(`  ✅ ${item.type} (${item.tokens} tokens)`);
      }
      if (plan.keep.length > 5) console.log(`  ... and ${plan.keep.length - 5} more`);

      if (dryRun) {
        console.log('\n[Dry run] Add --execute to flush to cold storage.');
      } else {
        // Flush each item to cold storage
        let flushed = 0;
        for (const item of plan.flush) {
          const summary = `## ${item.type}\nReason: ${item.reason}\nTokens: ${item.tokens}\n\n${item.preview}`;
          const path = await watcher.flushToColdStorage(summary, item.type);
          console.log(`  → Flushed to ${path}`);
          flushed++;
        }
        console.log(`\n✅ Flushed ${flushed} items to cold storage. Saved ~${plan.estimatedSavings.toLocaleString()} tokens.`);
      }
      break;
    }

    case 'status': {
      const watcher = new SessionWatcher();
      const analysis = await watcher.analyzeCurrentSession();

      if (!analysis) {
        console.log('No active session found.');
        break;
      }

      const emoji = analysis.recommendation === 'ok' ? '✅' :
        analysis.recommendation === 'warn' ? '🟡' : '🔴';

      console.log(`\n${emoji} ContextClaw Status`);
      console.log(`  Session: ${analysis.sessionFile}`);
      console.log(`  Turns: ${analysis.turnCount}`);
      console.log(`  Context: ~${(analysis.estimatedContextTokens / 1000).toFixed(1)}K tokens`);
      console.log(`  Status: ${analysis.recommendation.toUpperCase()}`);
      console.log('\n  Breakdown:');
      for (const [type, data] of Object.entries(analysis.breakdown)) {
        console.log(`    ${type}: ${data.count} turns, ~${(data.tokens / 1000).toFixed(1)}K tokens`);
      }
      if (analysis.bloatSources.length > 0) {
        console.log('\n  ⚠️ Bloat sources:');
        for (const b of analysis.bloatSources.slice(0, 5)) {
          console.log(`    ${b.type}: ${b.tokens} tokens — ${b.preview.slice(0, 60)}...`);
        }
      }
      break;
    }

    case 'inspect': {
      const claw = new ContextClaw({
        maxContextTokens: 60000,
        evictionStrategy: 'lru-scored',
        memoryStore: '.contextclaw-memory',
        retryCircuitBreaker: { maxRetries: 3, fallbackModels: [] },
        subagentDefaults: { maxContextTokens: 30000, injectOnly: ['task', 'files'] },
      });
      await startInspector(claw, 3333);
      break;
    }

    case 'clear': {
      const client = new GatewayClient();
      await client.connect(DEFAULT_WS_URL);
      await client.clearSession();
      console.log('Session cleared.');
      process.exit(0);
      break;
    }

    case 'chat': {
      const claw = new ContextClaw({
        maxContextTokens: 60000,
        evictionStrategy: 'lru-scored',
        memoryStore: '.contextclaw-memory',
        retryCircuitBreaker: { maxRetries: 3, fallbackModels: [] },
        subagentDefaults: { maxContextTokens: 30000, injectOnly: ['task', 'files'] },
      });
      await startChat(claw, DEFAULT_WS_URL);
      break;
    }

    default: {
      console.error(`Unknown command: ${command}`);
      showHelp();
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
