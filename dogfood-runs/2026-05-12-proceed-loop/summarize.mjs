#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

function readJson(name, fallback = null) {
  const file = path.join(root, name);
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function lineCount(name) {
  const file = path.join(root, name);
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  return text.trim() ? text.trimEnd().split('\n').length : 0;
}

function readJsonl(name) {
  const file = path.join(root, name);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .trimEnd()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function num(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function delta(before, after, key) {
  return num(after?.[key]) - num(before?.[key]);
}

function fmt(value, digits = 2) {
  return Number(value).toLocaleString('en-US', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

const before = readJson('stats-before.json');
const after = readJson('stats-after.json');

if (!before || !after) {
  console.error('Missing stats-before.json or stats-after.json. Capture after files first.');
  process.exit(1);
}

const beforeLedgerLines = lineCount('ledger-before.jsonl');
const afterLedgerLines = lineCount('ledger-after.jsonl');
const ledgerDelta = afterLedgerLines == null || beforeLedgerLines == null
  ? null
  : afterLedgerLines - beforeLedgerLines;
const beforeLedger = readJsonl('ledger-before.jsonl');
const afterLedger = readJsonl('ledger-after.jsonl');
const newLedgerEntries = afterLedger.slice(beforeLedger.length);

const fields = [
  ['Assembles', 'assembles'],
  ['Chars saved', 'saved'],
  ['Estimated savings USD', 'savingsUsd'],
  ['Ledger spend USD', 'ledgerSpendUsd'],
  ['Truncated items', 'truncated'],
];

console.log('# ContextClaw Dogfood Delta');
console.log('');
console.log('| Metric | Delta | Before | After |');
console.log('| --- | ---: | ---: | ---: |');
for (const [label, key] of fields) {
  const d = delta(before, after, key);
  console.log(`| ${label} | ${fmt(d)} | ${fmt(num(before[key]))} | ${fmt(num(after[key]))} |`);
}

if (ledgerDelta != null) {
  console.log(`| Ledger entries | ${fmt(ledgerDelta, 0)} | ${fmt(beforeLedgerLines, 0)} | ${fmt(afterLedgerLines, 0)} |`);
}

if (newLedgerEntries.length) {
  const compressedChars = newLedgerEntries.reduce((sum, entry) => sum + num(entry.compression?.charsSaved), 0);
  const truncatedCount = newLedgerEntries.reduce((sum, entry) => sum + num(entry.compression?.truncatedCount), 0);
  const estimatedInputTokens = newLedgerEntries.reduce((sum, entry) => sum + num(entry.estimatedInputTokens), 0);
  const costEstimateUsd = newLedgerEntries.reduce((sum, entry) => sum + num(entry.costEstimateUsd), 0);
  console.log('');
  console.log('## New Ledger Entries');
  console.log('');
  console.log(`- Entries: ${newLedgerEntries.length}`);
  console.log(`- Estimated input tokens: ${fmt(estimatedInputTokens, 0)}`);
  console.log(`- Estimated spend: $${fmt(costEstimateUsd, 4)}`);
  console.log(`- Compression chars saved: ${fmt(compressedChars, 0)}`);
  console.log(`- Truncated items: ${fmt(truncatedCount, 0)}`);
  console.log(`- Latest session: ${newLedgerEntries.at(-1)?.sessionKey ?? 'unknown'}`);
}

console.log('');
console.log('Caveat: this delta is only valid if ContextClaw was enabled as the OpenClaw context engine before the run and the gateway/TUI were restarted.');
