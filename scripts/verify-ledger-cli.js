#!/usr/bin/env node

import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RequestLedger } from '../plugin/ledger.js';

const dir = mkdtempSync(join(tmpdir(), 'contextclaw-ledger-cli-'));
const path = join(dir, 'ledger.jsonl');
const ledger = new RequestLedger({
  path,
  pricing: { 'demo/model': { input: 1, output: 2 } },
});
const entry = ledger.recordEstimate({
  sessionKind: 'main',
  sessionKey: 'verify-session',
  modelId: 'demo/model',
  messages: [{ role: 'user', content: 'verify ledger cli' }],
  estimatedInputTokens: 1000,
  estimatedOutputTokens: 100,
});
console.log(JSON.stringify({ path, entryId: entry.id }));
console.log(readFileSync(path, 'utf8').trim());
