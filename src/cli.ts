#!/usr/bin/env node

import { startChat } from './chat.js';
import { startInspector } from './inspector/server.js';
import { GatewayClient } from './gateway-client.js';
import { ContextClaw } from './orchestrator.js';

const DEFAULT_WS_URL = 'ws://127.0.0.1:18789';

async function main() {
  const command = process.argv[2];

  const claw = new ContextClaw({
    maxContextTokens: 60000,
    evictionStrategy: 'lru-scored',
    memoryStore: '.contextclaw-memory',
    retryCircuitBreaker: { maxRetries: 3, fallbackModels: [] },
    subagentDefaults: { maxContextTokens: 30000, injectOnly: ['task', 'files'] },
  });

  switch (command) {
    case 'inspect': {
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
    case 'status': {
      const state = claw.inspect();
      console.log(`Tokens: ${Math.round(state.totalTokens / 1000)}K / ${Math.round((state.totalTokens + state.budgetTokens) / 1000)}K`);
      console.log(`Blocks: ${state.blocks.length}`);
      console.log(`Utilization: ${state.utilizationPercent}%`);
      break;
    }
    default: {
      await startChat(claw, DEFAULT_WS_URL);
      break;
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
