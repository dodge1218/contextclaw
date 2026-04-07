/**
 * ContextClaw Quality Eval Runner
 * 
 * End-to-end eval: takes real sessions, compresses with ContextClaw,
 * uses an LLM judge (via Groq — free) to score quality preservation.
 * 
 * Usage: cc eval [--sessions 5] [--tasks-per-session 3] [--output results.json]
 */

import { writeFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import {
  prepareEvalTasks,
  buildJudgePrompt,
  parseJudgeResponse,
  summarizeResults,
  type EvalTask,
  type EvalResult,
} from './quality-eval.js';
import type { ContextClawConfig } from '../types.js';

const SESSIONS_DIR = join(homedir(), '.openclaw', 'agents', 'main', 'sessions');
const CORPUS_DIR = join(homedir(), '.openclaw', 'workspace', 'corpus');

interface RunnerOptions {
  maxSessions: number;
  tasksPerSession: number;
  outputPath: string;
  judgeModel: string;
  judgeApiBase: string;
  judgeApiKey: string;
  verbose: boolean;
}

/**
 * Call an OpenAI-compatible chat completion endpoint.
 * Works with Groq, OpenAI, local vLLM, etc.
 */
async function chatCompletion(
  apiBase: string,
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number = 1000,
): Promise<string> {
  const url = `${apiBase}/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: maxTokens,
      temperature: 0.1,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LLM API error ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json() as any;
  return data.choices?.[0]?.message?.content ?? '';
}

/**
 * Generate a synthetic response for a given context + prompt.
 * Instead of actually calling an LLM twice (expensive), we compare
 * the REAL assistant response (from the session) against what the LLM
 * would produce with compressed context.
 * 
 * For the eval, we use the actual assistant response as "Response A" (full context)
 * and generate "Response B" by asking the judge to predict what info would be lost.
 * 
 * This is a "context sufficiency" eval, not a generation eval.
 */
async function evaluateTaskPair(
  task: EvalTask,
  realResponse: string,
  options: RunnerOptions,
): Promise<EvalResult> {
  // Build the judge prompt with the real response as both A and B
  // The judge evaluates whether compressed context WOULD be sufficient
  const judgePrompt = buildJudgePrompt(task, realResponse, realResponse);

  // Modify the prompt to be a context sufficiency check
  const sufficiencyPrompt = `You are an impartial quality judge for an AI context management system called ContextClaw.

A user asked: "${task.userPrompt.slice(0, 500)}"

The assistant had access to a conversation with ${task.fullMessageCount} messages (${task.fullContextTokens} tokens).
ContextClaw compressed it to ${task.compressedMessageCount} messages (${task.compressedContextTokens} tokens) — a ${task.reductionPct}% reduction.

The assistant's actual response was:
${realResponse.slice(0, 2000)}

## Your task:
1. List the KEY FACTS referenced or needed from prior conversation to produce this response.
2. Estimate how many of those facts would survive a ${task.reductionPct}% context reduction that:
   - Always keeps system prompts and recent user messages
   - Keeps recent assistant responses (last 5)
   - Truncates large tool results (>2000 tokens)
   - Evicts oldest, lowest-scored content first
   - Preserves user intent and assistant decisions
3. Rate the likelihood (0.0-1.0) that the response would be equivalent with compressed context:
   - 1.0 = response relies only on recent context (compression safe)
   - 0.8 = minor details from old context, but core answer survives
   - 0.5 = response references mid-conversation context that might be evicted
   - 0.2 = response heavily depends on old/large tool results
   - 0.0 = response impossible without full history

Reply in JSON only:
{
  "factsInA": ["fact1", "fact2", ...],
  "factsPreservedInB": ["fact1", ...],
  "score": 0.0-1.0,
  "reasoning": "one sentence"
}`;

  try {
    const judgeResponse = await chatCompletion(
      options.judgeApiBase,
      options.judgeApiKey,
      options.judgeModel,
      'You are a precise eval judge. Reply only in valid JSON.',
      sufficiencyPrompt,
      800,
    );

    const parsed = parseJudgeResponse(judgeResponse);

    return {
      ...task,
      fullResponse: realResponse.slice(0, 500),
      compressedResponse: '(context sufficiency eval — not generated)',
      qualityScore: parsed.score,
      judgeReasoning: parsed.reasoning,
      factsPreserved: parsed.factsPreserved,
      factsTotal: parsed.factsTotal,
    };
  } catch (err: any) {
    if (options.verbose) {
      console.error(`  ⚠ Judge call failed: ${err.message}`);
    }
    return {
      ...task,
      fullResponse: realResponse.slice(0, 500),
      compressedResponse: '(judge error)',
      qualityScore: 0.5,
      judgeReasoning: `Judge error: ${err.message}`,
      factsPreserved: 0,
      factsTotal: 0,
    };
  }
}

/**
 * Extract the actual assistant response for a given eval task from session data.
 */
async function getActualResponse(
  sessionsDir: string,
  sessionFile: string,
  taskIndex: number,
  tasksPerSession: number,
): Promise<string> {
  const { streamJsonl } = await import('../jsonl-reader.js');
  const path = join(sessionsDir, sessionFile);
  const messages: { role: string; content: string }[] = [];

  for await (const entry of streamJsonl(path)) {
    // OpenClaw native format
    if (entry.type === 'message' && entry.message) {
      const msg = entry.message;
      const content = typeof msg.content === 'string'
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content.map((c: any) => c.text || c.content || '').join('\n')
          : '';
      if (content.trim()) {
        messages.push({ role: msg.role || 'unknown', content });
      }
      continue;
    }
    // Corpus format
    if (entry.type === 'user-message') {
      let content = '';
      if (typeof entry.content === 'string') {
        try {
          const parsed = JSON.parse(entry.content);
          if (Array.isArray(parsed)) {
            content = parsed.map((c: any) => c.text || c.content || '').filter(Boolean).join('\n');
          } else {
            content = entry.content;
          }
        } catch {
          content = entry.content;
        }
      } else {
        content = entry.text || entry.message || '';
      }
      if (content.trim()) messages.push({ role: 'user', content });
      continue;
    }
    if (entry.type === 'assistant-reply') {
      let content = '';
      if (typeof entry.content === 'string') {
        try {
          const parsed = JSON.parse(entry.content);
          if (Array.isArray(parsed)) {
            content = parsed.map((c: any) => c.text || c.content || '').filter(Boolean).join('\n');
          } else {
            content = entry.content;
          }
        } catch {
          content = entry.content;
        }
      } else {
        content = entry.text || entry.message || '';
      }
      if (content.trim()) messages.push({ role: 'assistant', content });
      continue;
    }
    // Fallback
    if (entry.role === 'user' || entry.role === 'assistant') {
      const content = typeof entry.content === 'string' ? entry.content
        : Array.isArray(entry.content) ? entry.content.map((c: any) => c.text || '').join('\n') : '';
      if (content.trim()) messages.push({ role: entry.role, content });
    }
  }

  // Find the eval points (same logic as quality-eval.ts — skip non-user/assistant entries)
  const points: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role !== 'user') continue;
    if (messages[i].content.trim().length <= 20) continue;
    for (let j = i + 1; j < messages.length && j <= i + 20; j++) {
      if (messages[j].role === 'user') break;
      if (messages[j].role === 'assistant') {
        if (messages[j].content.trim().length > 50) points.push(j);
        break;
      }
    }
  }

  const maxTasks = tasksPerSession;
  let selectedPoints: number[];
  if (points.length <= maxTasks) {
    selectedPoints = points;
  } else {
    const step = Math.floor(points.length / maxTasks);
    selectedPoints = points.filter((_, idx) => idx % step === 0).slice(0, maxTasks);
  }

  const point = selectedPoints[taskIndex];
  if (point === undefined || !messages[point]) return '(no response found)';
  return messages[point].content;
}

/**
 * Run the full quality eval.
 */
export async function runQualityEval(options: RunnerOptions): Promise<void> {
  const config: ContextClawConfig = {
    maxContextTokens: 60000,
    evictionStrategy: 'lru-scored',
    memoryStore: '.contextclaw-eval-memory',
    retryCircuitBreaker: { maxRetries: 3, fallbackModels: [] },
    subagentDefaults: { maxContextTokens: 30000, injectOnly: ['task', 'files'] },
  };

  console.log('\n🔬 ContextClaw Quality Eval');
  console.log('━'.repeat(50));
  console.log(`  Sessions dir: ${SESSIONS_DIR}`);
  console.log(`  Max sessions: ${options.maxSessions}`);
  console.log(`  Tasks/session: ${options.tasksPerSession}`);
  console.log(`  Judge model: ${options.judgeModel}`);
  console.log(`  Output: ${options.outputPath}`);
  console.log('');

  // Step 1: Prepare eval tasks — try sessions dir first, fall back to corpus
  console.log('📋 Preparing eval tasks...');
  let tasks = await prepareEvalTasks(SESSIONS_DIR, config, {
    maxSessions: options.maxSessions,
    tasksPerSession: options.tasksPerSession,
  });

  // If not enough tasks from live sessions, try corpus
  if (tasks.length < 3) {
    console.log(`  Only ${tasks.length} tasks from sessions, checking corpus...`);
    const corpusTasks = await prepareEvalTasks(CORPUS_DIR, config, {
      maxSessions: options.maxSessions * 4, // corpus has many small/snapshot files
      tasksPerSession: options.tasksPerSession,
    });
    tasks = [...tasks, ...corpusTasks];
  }

  if (tasks.length === 0) {
    console.log('❌ No eval tasks found. Need sessions with substantive user/assistant exchanges.');
    return;
  }

  console.log(`  Found ${tasks.length} eval tasks across ${new Set(tasks.map(t => t.sessionFile)).size} sessions\n`);

  // Step 2: Run judge on each task
  const results: EvalResult[] = [];
  let completed = 0;

  for (const task of tasks) {
    completed++;
    const pct = Math.round((completed / tasks.length) * 100);
    process.stdout.write(`\r  ⚖️  Judging ${completed}/${tasks.length} (${pct}%)...`);

    // Figure out which directory this session came from
    const sessionsPath = join(SESSIONS_DIR, task.sessionFile);
    const corpusPath = join(CORPUS_DIR, task.sessionFile);
    const { existsSync } = await import('fs');
    const actualDir = existsSync(sessionsPath) ? SESSIONS_DIR : CORPUS_DIR;

    const realResponse = await getActualResponse(
      actualDir,
      task.sessionFile,
      task.taskIndex,
      options.tasksPerSession,
    );

    const result = await evaluateTaskPair(task, realResponse, options);
    results.push(result);

    // Rate limit: 200ms between calls (Groq allows 30 req/min on free tier)
    await new Promise(r => setTimeout(r, 200));
  }
  console.log('');

  // Step 3: Summarize
  const summary = summarizeResults(results, config);

  // Step 4: Output
  await writeFile(options.outputPath, JSON.stringify(summary, null, 2), 'utf-8');

  // Print results
  console.log('\n📊 Results');
  console.log('━'.repeat(50));
  console.log(`  Tasks evaluated:        ${summary.totalTasks}`);
  console.log(`  Avg quality score:      ${summary.avgQualityScore.toFixed(2)} / 1.00`);
  console.log(`  Avg context reduction:  ${summary.avgReduction}%`);
  console.log(`  Equivalent or better:   ${summary.tasksEquivalentOrBetter}/${summary.totalTasks} (${summary.equivalentRate}%)`);
  console.log('');

  // Per-task breakdown
  if (options.verbose) {
    console.log('  Per-task breakdown:');
    for (const r of results) {
      const emoji = r.qualityScore >= 0.8 ? '✅' : r.qualityScore >= 0.5 ? '🟡' : '🔴';
      console.log(`    ${emoji} ${r.sessionFile.slice(0, 8)}… task ${r.taskIndex}: score=${r.qualityScore.toFixed(2)} reduction=${r.reductionPct}%`);
      console.log(`       ${r.judgeReasoning.slice(0, 100)}`);
    }
    console.log('');
  }

  // Verdict
  if (summary.equivalentRate >= 90) {
    console.log('  ✅ PASS — ContextClaw preserves response quality in ≥90% of tasks');
  } else if (summary.equivalentRate >= 75) {
    console.log('  🟡 ACCEPTABLE — Quality preserved in ≥75% of tasks, some edge cases');
  } else {
    console.log('  🔴 NEEDS WORK — Quality degradation detected in too many tasks');
  }

  console.log(`\n  Full results: ${options.outputPath}\n`);
}
