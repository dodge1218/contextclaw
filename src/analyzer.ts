import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const SESSIONS_DIR = join(homedir(), '.openclaw', 'agents', 'main', 'sessions');

interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: { total: number };
}

interface SessionStats {
  file: string;
  sizeKB: number;
  messages: number;
  turnsWithUsage: number;
  totalInput: number;
  totalOutput: number;
  cacheRead: number;
  cacheWrite: number;
  totalCost: number;
  redundancyPct: number;
  models: Record<string, number>;
  heaviest: Array<{ tokens: number; role: string; model: string; preview: string }>;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function analyzeFile(path: string): SessionStats {
  const raw = readFileSync(path, 'utf-8');
  const lines = raw.split('\n').filter(Boolean);

  let totalInput = 0, totalOutput = 0, cacheRead = 0, cacheWrite = 0, totalCost = 0;
  let turnsWithUsage = 0, messages = 0;
  const models: Record<string, number> = {};
  const heaviest: SessionStats['heaviest'] = [];

  for (const line of lines) {
    let d: any;
    try { d = JSON.parse(line); } catch { continue; }
    if (d.type !== 'message') continue;
    messages++;

    const msg = d.message ?? {};
    const usage: Usage | undefined = msg.usage;
    if (!usage) continue;

    turnsWithUsage++;
    totalInput += usage.input ?? 0;
    totalOutput += usage.output ?? 0;
    cacheRead += usage.cacheRead ?? 0;
    cacheWrite += usage.cacheWrite ?? 0;
    totalCost += usage.cost?.total ?? 0;

    const model = (msg.model ?? 'unknown') as string;
    models[model] = (models[model] ?? 0) + 1;

    const total = usage.totalTokens ?? (usage.input + usage.output);
    let preview = '';
    const content = msg.content;
    if (Array.isArray(content)) {
      for (const c of content) {
        if (c?.type === 'text') { preview = (c.text ?? '').slice(0, 50); break; }
        if (c?.type === 'toolCall') { preview = `[tool: ${c.name ?? '?'}]`; break; }
      }
    } else if (typeof content === 'string') {
      preview = content.slice(0, 50);
    }

    heaviest.push({ tokens: total, role: msg.role ?? '?', model, preview });
  }

  heaviest.sort((a, b) => b.tokens - a.tokens);

  const sizeKB = statSync(path).size / 1024;
  const redundancyPct = (cacheRead / Math.max(totalInput + cacheRead, 1)) * 100;

  return {
    file: path.split('/').pop()!,
    sizeKB,
    messages,
    turnsWithUsage,
    totalInput,
    totalOutput,
    cacheRead,
    cacheWrite,
    totalCost,
    redundancyPct,
    models,
    heaviest: heaviest.slice(0, 10),
  };
}

function printStats(s: SessionStats): void {
  const sep = '='.repeat(60);
  console.log(`\n${sep}`);
  console.log(`Session: ${s.file} (${s.sizeKB.toFixed(0)}KB)`);
  console.log(sep);
  console.log(`Messages: ${s.messages} | Turns w/ usage: ${s.turnsWithUsage}`);
  console.log(`\nToken Usage:`);
  console.log(`  Input:       ${formatTokens(s.totalInput)}`);
  console.log(`  Output:      ${formatTokens(s.totalOutput)}`);
  console.log(`  Cache Read:  ${formatTokens(s.cacheRead)}`);
  console.log(`  Cache Write: ${formatTokens(s.cacheWrite)}`);
  console.log(`  Redundancy:  ${s.redundancyPct.toFixed(1)}%`);
  console.log(`  Cost:        $${s.totalCost.toFixed(4)}`);
  console.log(`\nModels: ${JSON.stringify(s.models)}`);

  if (s.heaviest.length > 0) {
    console.log(`\nTop ${s.heaviest.length} Heaviest Turns:`);
    console.log(`  ${'Tokens'.padStart(8)}  ${'Role'.padStart(10)}  ${'Model'.padStart(20)}  Preview`);
    console.log(`  ${'-'.repeat(8)}  ${'-'.repeat(10)}  ${'-'.repeat(20)}  ${'-'.repeat(30)}`);
    for (const h of s.heaviest) {
      const shortModel = h.model.includes('/') ? h.model.split('/').pop()!.slice(0, 20) : h.model.slice(0, 20);
      console.log(`  ${formatTokens(h.tokens).padStart(8)}  ${h.role.padStart(10)}  ${shortModel.padStart(20)}  ${h.preview.slice(0, 40)}`);
    }
  }
}

export async function analyzeSession(target: string): Promise<void> {
  const files: string[] = [];

  if (target === 'current') {
    const all = readdirSync(SESSIONS_DIR)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => ({ name: f, mtime: statSync(join(SESSIONS_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    if (all.length > 0) files.push(join(SESSIONS_DIR, all[0].name));
  } else if (target === 'all') {
    const all = readdirSync(SESSIONS_DIR)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => ({ name: f, mtime: statSync(join(SESSIONS_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 10);
    for (const f of all) files.push(join(SESSIONS_DIR, f.name));
  } else {
    const full = target.includes('/') ? target : join(SESSIONS_DIR, target);
    files.push(full);
  }

  for (const f of files) {
    try {
      const stats = analyzeFile(f);
      printStats(stats);
    } catch (err: any) {
      console.error(`Error analyzing ${f}: ${err.message}`);
    }
  }
}
