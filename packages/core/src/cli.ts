#!/usr/bin/env node

import { startChat } from './chat.js';
import { startInspector } from './inspector/server.js';
import { GatewayClient } from './gateway-client.js';
import { ContextClaw } from './orchestrator.js';
import { analyzeSession } from './analyzer.js';
import { SessionWatcher } from './watcher.js';
import { isUsingHeuristic } from './budget.js';
import { MissionLedger } from './mission-ledger.js';

const DEFAULT_WS_URL = 'ws://127.0.0.1:18789';

function showHelp() {
  console.log(`
ContextClaw — Context orchestration for OpenClaw agents

Usage: cc <command> [options]

Commands:
  analyze [current|all|<file>]  Token usage breakdown for sessions
  watch                         Monitor active session, alert on bloat
  compact [--dry-run]           Generate compaction plan (flush bloat to cold storage)
  status                        Quick snapshot of current session health
  eval [--verbose]              Run quality eval (proves compression doesn't degrade output)
  inspect                       Start inspector web UI on port 3333
  ledger                        Friendly local ledger demo (no model call)
  mission-demo                  Developer demo: mission ledger budget gate + review feed
  mission-review --load <file>  Print review cards from a saved mission ledger
  mission-why --load <file>     Explain the latest blocked pass in a saved ledger
  mission-approve --load <file> Approve a blocked pass in a saved ledger
  mission-reject --load <file>  Reject a pass and pause its mission
  mission-revise --load <file>  Create a smaller follow-up pass from an existing pass
  mission-receipt --load <file> Record actual usage for a pass
  mission-variance --load <file> Show estimate-vs-actual variance for a pass
  clear                         Clear the current session
  chat                          Start interactive chat (default)
  help                          Show this help

Options (watch):
  --warn <tokens>       Warn threshold (default: 40000)
  --compact <tokens>    Auto-compact threshold (default: 55000)
  --tool-max <tokens>   Max tokens per tool result (default: 2000)

Options (eval):
  --sessions <n>        Max sessions to evaluate (default: 5)
  --tasks <n>           Tasks per session (default: 3)
  --budget <pct>        Budget as % of full context (default: 50)
  --output <path>       Output JSON path (default: quality-eval-results.json)
  --verbose             Show per-task breakdown
  --judge-model <m>     Judge LLM model (default: llama-3.3-70b-versatile)
  --judge-api <url>     Judge API base (default: https://api.groq.com/openai/v1)

Examples:
  cc analyze                 Analyze current session
  cc analyze all             Compare recent sessions
  cc watch                   Start monitoring daemon
  cc watch --warn 30000      Custom warn threshold
  cc compact                 Show what would be flushed
  cc compact --execute       Actually flush to cold storage
  cc status                  Quick health check
  cc eval                    Run quality eval with defaults
  cc eval --verbose          Eval with per-task breakdown
  cc ledger                  Friendly local ledger demo, no model call
  cc mission-demo            Developer JSON demo, no model call
  cc mission-demo --save /tmp/ledger.json
  cc mission-review --load /tmp/ledger.json
  cc mission-review --load /tmp/ledger.json --format json
  cc mission-why --load /tmp/ledger.json
  cc mission-approve --load /tmp/ledger.json --pass <id> --increase-budget 0.25
  cc mission-reject --load /tmp/ledger.json --pass <id> --reason "too broad"
  cc mission-revise --load /tmp/ledger.json --pass <id> --prompt "smaller pass" --output-tokens 500 --max-spend 0.01
  cc mission-receipt --load /tmp/ledger.json --pass <id> --actual-cost 0.014 --tokens-in 12000 --tokens-out 800 --cache-read 9000
  cc mission-variance --load /tmp/ledger.json --pass <id>
`);
}

function parseFlag(flag: string, defaultVal: number): number {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= process.argv.length) return defaultVal;
  return parseInt(process.argv[idx + 1], 10) || defaultVal;
}

function parseStringFlag(flag: string, defaultVal: string): string {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= process.argv.length) return defaultVal;
  return process.argv[idx + 1] || defaultVal;
}

function requireStringFlag(flag: string): string {
  const value = parseStringFlag(flag, '');
  if (!value) {
    console.error(`Missing required ${flag} <path>`);
    process.exit(1);
  }
  return value;
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

      if (isUsingHeuristic()) {
        console.log(`  ⚠ Token counting: heuristic (~4 chars/token). Install tiktoken for accuracy.`);
      }
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

    case 'eval': {
      const { runQualityEval } = await import('./eval/runner.js');

      const judgeApiKey = process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY || '';
      if (!judgeApiKey) {
        console.error('❌ Need GROQ_API_KEY or OPENAI_API_KEY for the judge LLM.');
        console.error('   Export one: export GROQ_API_KEY=gsk_...');
        process.exit(1);
      }

      await runQualityEval({
        maxSessions: parseFlag('--sessions', 5),
        tasksPerSession: parseFlag('--tasks', 3),
        budgetPct: parseFlag('--budget', 50) / 100,
        outputPath: parseStringFlag('--output', 'quality-eval-results.json'),
        judgeModel: parseStringFlag('--judge-model', 'llama-3.3-70b-versatile'),
        judgeApiBase: parseStringFlag('--judge-api', 'https://api.groq.com/openai/v1'),
        judgeApiKey,
        verbose: process.argv.includes('--verbose'),
      });
      break;
    }

    case 'ledger': {
      const ledger = new MissionLedger();
      const mission = ledger.createMission({
        id: 'mis_local_demo',
        objective: 'Show predictable spend before a model call',
        budget: 0.05,
        sticker: 'LOCAL-DEMO',
        acceptanceCriteria: 'Explain allow/block decisions without calling a model',
        premiumUnitBudget: 3,
        unitCostBasis: 'fixed-prompt',
      });
      ledger.addArtifact({
        missionId: mission.id,
        type: 'note',
        text: 'Small current task context. This is an artifact in the ledger, not a model prompt.',
        summary: 'Small current task context',
        sticker: 'LOCAL-DEMO',
      });
      const allowed = ledger.planPass({
        missionId: mission.id,
        role: 'planner',
        model: 'example/local-free',
        artifactIds: 'all',
        prompt: 'Plan one small bounded next step.',
        estimatedTokensOut: 500,
        maxSpend: 0.05,
        maxPremiumUnits: 1,
        unitCostBasis: 'fixed-prompt',
        sticker: 'LOCAL-DEMO',
      });
      const blocked = ledger.planPass({
        missionId: mission.id,
        role: 'planner',
        model: 'example/premium-frontier',
        artifactIds: 'all',
        prompt: 'Pretend this is a huge premium synthesis pass.',
        estimatedTokensOut: 100_000,
        maxSpend: 0.001,
        maxPremiumUnits: 0.3,
        unitCostBasis: 'fixed-prompt',
        fixedUnitsPerPrompt: 1,
        sticker: 'LOCAL-DEMO-BLOCK',
      });

      const savePath = parseStringFlag('--save', '');
      if (savePath) ledger.save(savePath);

      console.log('\nContextClaw local ledger demo');
      console.log('No model was called. This only estimates and gates hypothetical passes.');
      console.log(`Mission: ${mission.objective}`);
      console.log(`Ledger: ${savePath || '(not saved; add --save /tmp/ledger.json)'}`);
      console.log('\nAllowed pass:');
      console.log(`- Model label: ${allowed.model}`);
      console.log(`- Estimated spend: $${allowed.estimatedCost.toFixed(6)}`);
      console.log(`- Premium units: ${allowed.estimatedPremiumUnits?.toFixed(3)} / max ${allowed.maxPremiumUnits?.toFixed(3)}`);
      console.log(`- Decision: ${allowed.decision}`);
      console.log('\nBlocked pass:');
      console.log(`- Model label: ${blocked.model}`);
      console.log(`- Estimated spend: $${blocked.estimatedCost.toFixed(6)} (max $${blocked.maxSpend.toFixed(6)})`);
      console.log(`- Premium units: ${blocked.estimatedPremiumUnits?.toFixed(3)} / max ${blocked.maxPremiumUnits?.toFixed(3)}`);
      console.log(`- Decision: ${blocked.decision} (${blocked.reason})`);
      console.log('\nWhat this means: ContextClaw can say “this pass is too expensive / too many premium units” before execution.');
      console.log('Next real integration is wiring actual OpenClaw/provider receipts into this ledger.');
      break;
    }

    case 'mission-demo': {
      const ledger = new MissionLedger();
      const mission = ledger.createMission({
        id: 'mis_demo_review_feed',
        objective: 'Demo: review-feed governed agent work',
        budget: 0.05,
        sticker: 'DEMO',
        acceptanceCriteria: 'Show one allowed pass, one blocked pass, and a review-feed card',
        premiumUnitBudget: 3,
        unitCostBasis: 'fixed-prompt',
      });
      ledger.addArtifact({
        missionId: mission.id,
        type: 'product-plan',
        text: 'Mission ledger MVP: mission, artifact ledger, bounded pass, budget governor, review feed.',
        summary: 'Mission ledger MVP architecture and rationale',
        sticker: 'DEMO',
      });
      ledger.addArtifact({
        missionId: mission.id,
        type: 'readme',
        text: 'ContextClaw README: cost defense with memory for agentic work.',
        summary: 'Current public ContextClaw README positioning',
        sticker: 'DEMO',
      });
      const allowed = ledger.planPass({
        missionId: mission.id,
        role: 'planner',
        model: 'local/free',
        artifactIds: 'all',
        prompt: 'Plan a small README update from these artifacts.',
        estimatedTokensOut: 500,
        maxSpend: 0.05,
        maxPremiumUnits: 1,
        unitCostBasis: 'fixed-prompt',
        sticker: 'DEMO',
      });
      const blocked = ledger.planPass({
        missionId: mission.id,
        role: 'planner',
        model: 'premium/frontier',
        artifactIds: 'all',
        prompt: 'Oversized pass that should be blocked.',
        estimatedTokensOut: 100_000,
        maxSpend: 0.001,
        maxPremiumUnits: 0.3,
        unitCostBasis: 'fixed-prompt',
        fixedUnitsPerPrompt: 1,
        sticker: 'DEMO-BLOCK',
      });

      const saveIdx = process.argv.indexOf('--save');
      if (saveIdx !== -1 && saveIdx + 1 < process.argv.length) {
        ledger.save(process.argv[saveIdx + 1]);
        console.log(`Saved mission ledger snapshot to ${process.argv[saveIdx + 1]}`);
      }

      console.log(ledger.explain(blocked.id));
      console.log('\n=== Review cards ===');
      console.log(JSON.stringify([ledger.reviewCard(blocked.id), ledger.reviewCard(allowed.id)], null, 2));
      break;
    }

    case 'mission-review': {
      const ledger = MissionLedger.load(requireStringFlag('--load'));
      const limit = parseFlag('--limit', 10);
      const format = parseStringFlag('--format', 'markdown');
      const passes = [...ledger.passes.values()].slice(-limit).reverse();
      if (format === 'json') {
        console.log(JSON.stringify(passes.map((pass) => ledger.reviewCard(pass.id)), null, 2));
      } else {
        console.log(passes.map((pass) => ledger.renderReviewCard(pass.id)).join('\n\n---\n\n'));
      }
      break;
    }

    case 'mission-approve': {
      const path = requireStringFlag('--load');
      const ledger = MissionLedger.load(path);
      const passId = requireStringFlag('--pass');
      const increaseBudget = Number(parseStringFlag('--increase-budget', '0')) || 0;
      const approved = ledger.approvePass(passId, { increaseBudget });
      ledger.save(path);
      console.log(`Approved ${approved.id}. Updated ledger saved to ${path}.`);
      console.log(ledger.renderReviewCard(approved.id));
      break;
    }

    case 'mission-reject': {
      const path = requireStringFlag('--load');
      const ledger = MissionLedger.load(path);
      const passId = requireStringFlag('--pass');
      const reason = parseStringFlag('--reason', 'manual reject');
      const rejected = ledger.rejectPass(passId, reason);
      ledger.save(path);
      console.log(`Rejected ${rejected.id}. Updated ledger saved to ${path}.`);
      console.log(ledger.renderReviewCard(rejected.id));
      break;
    }

    case 'mission-revise': {
      const path = requireStringFlag('--load');
      const ledger = MissionLedger.load(path);
      const passId = requireStringFlag('--pass');
      const prompt = requireStringFlag('--prompt');
      const estimatedTokensOut = parseFlag('--output-tokens', 500);
      const maxSpend = Number(parseStringFlag('--max-spend', '0.01')) || 0.01;
      const model = parseStringFlag('--model', '');
      const role = parseStringFlag('--role', '');
      const sticker = parseStringFlag('--sticker', '');
      const revised = ledger.revisePass(passId, {
        prompt,
        estimatedTokensOut,
        maxSpend,
        model: model || undefined,
        role: role || undefined,
        sticker: sticker || undefined,
      });
      ledger.save(path);
      console.log(`Created revised pass ${revised.id}. Updated ledger saved to ${path}.`);
      console.log(ledger.renderReviewCard(revised.id));
      break;
    }

    case 'mission-receipt': {
      const path = requireStringFlag('--load');
      const ledger = MissionLedger.load(path);
      const passId = requireStringFlag('--pass');
      ledger.recordReceipt(passId, {
        actualCostUsd: Number(parseStringFlag('--actual-cost', '')) || undefined,
        actualTokensIn: parseFlag('--tokens-in', 0) || undefined,
        actualTokensOut: parseFlag('--tokens-out', 0) || undefined,
        actualPremiumUnits: Number(parseStringFlag('--actual-premium-units', '')) || undefined,
        cacheReadTokens: parseFlag('--cache-read', 0) || undefined,
        cacheWriteTokens: parseFlag('--cache-write', 0) || undefined,
        receiptSource: parseStringFlag('--source', 'manual') as 'provider' | 'gateway' | 'manual' | 'estimate-only',
      });
      ledger.save(path);
      console.log(`Recorded receipt for ${passId}. Updated ledger saved to ${path}.`);
      console.log(ledger.renderReviewCard(passId));
      break;
    }

    case 'mission-variance': {
      const ledger = MissionLedger.load(requireStringFlag('--load'));
      const passId = requireStringFlag('--pass');
      console.log(JSON.stringify(ledger.variance(passId), null, 2));
      break;
    }

    case 'mission-why': {
      const ledger = MissionLedger.load(requireStringFlag('--load'));
      const passId = parseStringFlag('--pass', '');
      const pass = passId
        ? ledger.passes.get(passId)
        : [...ledger.passes.values()].reverse().find((candidate) => candidate.decision === 'blocked') ?? [...ledger.passes.values()].at(-1);
      if (!pass) {
        console.error('No pass found in ledger.');
        process.exit(1);
      }
      console.log(ledger.explain(pass.id));
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
