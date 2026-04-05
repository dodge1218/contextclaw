#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const chat_js_1 = require("./chat.js");
const server_js_1 = require("./inspector/server.js");
const gateway_client_js_1 = require("./gateway-client.js");
const orchestrator_js_1 = require("./orchestrator.js");
const analyzer_js_1 = require("./analyzer.js");
const DEFAULT_WS_URL = 'ws://127.0.0.1:18789';
function showHelp() {
    console.log(`
ContextClaw — Context orchestration for OpenClaw agents

Usage: contextclaw <command> [options]

Commands:
  analyze [current|all|<file>]  Show token usage breakdown for sessions
  inspect                       Start inspector web UI on port 3333
  status                        Show current context budget status
  clear                         Clear the current session
  chat                          Start interactive chat (default)
  help                          Show this help

Examples:
  contextclaw analyze           Analyze current session
  contextclaw analyze all       Analyze 10 most recent sessions
  contextclaw inspect           Open inspector at http://localhost:3333
`);
}
async function main() {
    const command = process.argv[2];
    if (!command || command === 'help' || command === '--help' || command === '-h') {
        showHelp();
        process.exit(0);
    }
    const claw = new orchestrator_js_1.ContextClaw({
        maxContextTokens: 60000,
        evictionStrategy: 'lru-scored',
        memoryStore: '.contextclaw-memory',
        retryCircuitBreaker: { maxRetries: 3, fallbackModels: [] },
        subagentDefaults: { maxContextTokens: 30000, injectOnly: ['task', 'files'] },
    });
    switch (command) {
        case 'analyze': {
            const target = process.argv[3] ?? 'current';
            await (0, analyzer_js_1.analyzeSession)(target);
            break;
        }
        case 'inspect': {
            await (0, server_js_1.startInspector)(claw, 3333);
            break;
        }
        case 'clear': {
            const client = new gateway_client_js_1.GatewayClient();
            await client.connect(DEFAULT_WS_URL);
            await client.clearSession();
            console.log('Session cleared.');
            process.exit(0);
            break;
        }
        case 'status': {
            const state = claw.inspect();
            console.log(`Tokens: ${Math.round(state.totalTokens / 1000)}K / ${Math.round((state.totalTokens + state.budgetTokens) / 1000)}K`);
            console.log(`Blocks: ${state.blocks.length}`);
            console.log(`Utilization: ${state.utilizationPercent}%`);
            break;
        }
        case 'chat': {
            await (0, chat_js_1.startChat)(claw, DEFAULT_WS_URL);
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
//# sourceMappingURL=cli.js.map