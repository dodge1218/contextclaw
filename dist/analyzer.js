"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeSession = analyzeSession;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_os_1 = require("node:os");
const SESSIONS_DIR = (0, node_path_1.join)((0, node_os_1.homedir)(), '.openclaw', 'agents', 'main', 'sessions');
function formatTokens(n) {
    if (n >= 1_000_000)
        return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000)
        return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
}
function analyzeFile(path) {
    const raw = (0, node_fs_1.readFileSync)(path, 'utf-8');
    const lines = raw.split('\n').filter(Boolean);
    let totalInput = 0, totalOutput = 0, cacheRead = 0, cacheWrite = 0, totalCost = 0;
    let turnsWithUsage = 0, messages = 0;
    const models = {};
    const heaviest = [];
    for (const line of lines) {
        let d;
        try {
            d = JSON.parse(line);
        }
        catch {
            continue;
        }
        if (d.type !== 'message')
            continue;
        messages++;
        const msg = d.message ?? {};
        const usage = msg.usage;
        if (!usage)
            continue;
        turnsWithUsage++;
        totalInput += usage.input ?? 0;
        totalOutput += usage.output ?? 0;
        cacheRead += usage.cacheRead ?? 0;
        cacheWrite += usage.cacheWrite ?? 0;
        totalCost += usage.cost?.total ?? 0;
        const model = (msg.model ?? 'unknown');
        models[model] = (models[model] ?? 0) + 1;
        const total = usage.totalTokens ?? (usage.input + usage.output);
        let preview = '';
        const content = msg.content;
        if (Array.isArray(content)) {
            for (const c of content) {
                if (c?.type === 'text') {
                    preview = (c.text ?? '').slice(0, 50);
                    break;
                }
                if (c?.type === 'toolCall') {
                    preview = `[tool: ${c.name ?? '?'}]`;
                    break;
                }
            }
        }
        else if (typeof content === 'string') {
            preview = content.slice(0, 50);
        }
        heaviest.push({ tokens: total, role: msg.role ?? '?', model, preview });
    }
    heaviest.sort((a, b) => b.tokens - a.tokens);
    const sizeKB = (0, node_fs_1.statSync)(path).size / 1024;
    const redundancyPct = (cacheRead / Math.max(totalInput + cacheRead, 1)) * 100;
    return {
        file: path.split('/').pop(),
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
function printStats(s) {
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
            const shortModel = h.model.includes('/') ? h.model.split('/').pop().slice(0, 20) : h.model.slice(0, 20);
            console.log(`  ${formatTokens(h.tokens).padStart(8)}  ${h.role.padStart(10)}  ${shortModel.padStart(20)}  ${h.preview.slice(0, 40)}`);
        }
    }
}
async function analyzeSession(target) {
    const files = [];
    if (target === 'current') {
        const all = (0, node_fs_1.readdirSync)(SESSIONS_DIR)
            .filter(f => f.endsWith('.jsonl'))
            .map(f => ({ name: f, mtime: (0, node_fs_1.statSync)((0, node_path_1.join)(SESSIONS_DIR, f)).mtimeMs }))
            .sort((a, b) => b.mtime - a.mtime);
        if (all.length > 0)
            files.push((0, node_path_1.join)(SESSIONS_DIR, all[0].name));
    }
    else if (target === 'all') {
        const all = (0, node_fs_1.readdirSync)(SESSIONS_DIR)
            .filter(f => f.endsWith('.jsonl'))
            .map(f => ({ name: f, mtime: (0, node_fs_1.statSync)((0, node_path_1.join)(SESSIONS_DIR, f)).mtimeMs }))
            .sort((a, b) => b.mtime - a.mtime)
            .slice(0, 10);
        for (const f of all)
            files.push((0, node_path_1.join)(SESSIONS_DIR, f.name));
    }
    else {
        const full = target.includes('/') ? target : (0, node_path_1.join)(SESSIONS_DIR, target);
        files.push(full);
    }
    for (const f of files) {
        try {
            const stats = analyzeFile(f);
            printStats(stats);
        }
        catch (err) {
            console.error(`Error analyzing ${f}: ${err.message}`);
        }
    }
}
//# sourceMappingURL=analyzer.js.map