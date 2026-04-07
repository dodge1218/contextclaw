/**
 * ContextClaw Quality Eval — Task Completion Accuracy
 * 
 * Purpose: Prove that ContextClaw's truncation doesn't degrade LLM task completion.
 * This is the #1 ask from both the HN snob and OpenAI exec reviewers.
 * 
 * Methodology:
 *   1. Take real session transcripts (from corpus/)
 *   2. For each session, extract the last N user prompts + the assistant response
 *   3. Run each prompt through:
 *      a) FULL context (no ContextClaw) → get response A
 *      b) ContextClaw-compressed context → get response B
 *   4. Judge: does response B contain the same key facts/actions as response A?
 *   5. Score: % of tasks where compressed response ≥ full response quality
 * 
 * Output: quality-eval-results.json with per-task scores and aggregate
 */

import { createReadStream, statSync } from 'fs';
import { readFile, writeFile, readdir } from 'fs/promises';
import { join } from 'path';
import { createInterface } from 'readline';
import { ContextClaw } from '../orchestrator.js';
import { countTokens } from '../budget.js';
import type { ContextClawConfig, ContextBlock } from '../types.js';

export interface EvalTask {
  sessionFile: string;
  taskIndex: number;
  userPrompt: string;
  /** Full context token count */
  fullContextTokens: number;
  /** Compressed context token count */
  compressedContextTokens: number;
  /** Reduction percentage */
  reductionPct: number;
  /** Messages in full context */
  fullMessageCount: number;
  /** Messages in compressed context */
  compressedMessageCount: number;
}

export interface EvalResult extends EvalTask {
  /** Full-context response */
  fullResponse: string;
  /** Compressed-context response */
  compressedResponse: string;
  /** Judge score 0-1 (1 = compressed is equivalent or better) */
  qualityScore: number;
  /** Judge reasoning */
  judgeReasoning: string;
  /** Key facts preserved (from judge) */
  factsPreserved: number;
  factsTotal: number;
}

export interface EvalSummary {
  totalTasks: number;
  avgQualityScore: number;
  avgReduction: number;
  tasksEquivalentOrBetter: number;
  equivalentRate: number;
  results: EvalResult[];
  runAt: string;
  config: {
    maxContextTokens: number;
    sessionsEvaluated: number;
    tasksPerSession: number;
  };
}

interface SessionMessage {
  role: string;
  content: string;
  tokens: number;
  type?: string;
}

/**
 * Extract messages from a session JSONL file.
 * Handles both OpenClaw native format (type: 'message') and corpus format (user-message, assistant-reply).
 */
async function extractMessages(sessionPath: string): Promise<SessionMessage[]> {
  const messages: SessionMessage[] = [];
  const rl = createInterface({
    input: createReadStream(sessionPath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);

      // OpenClaw native format
      if (entry.type === 'message' && entry.message) {
        const msg = entry.message;
        const content = typeof msg.content === 'string'
          ? msg.content
          : Array.isArray(msg.content)
            ? msg.content.map((c: any) => c.text || c.content || '').join('\n')
            : '';
        if (!content.trim()) continue;
        messages.push({
          role: msg.role || 'unknown',
          content,
          tokens: countTokens(content),
          type: entry.__openclaw?.contentType || msg.role,
        });
        continue;
      }

      // Corpus format: user-message, assistant-reply
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
        if (!content.trim()) continue;
        messages.push({ role: 'user', content, tokens: countTokens(content), type: 'user' });
        continue;
      }

      if (entry.type === 'assistant-reply') {
        let content = '';
        if (typeof entry.content === 'string') {
          // Could be a JSON-stringified content array
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
        if (!content.trim()) continue;
        messages.push({ role: 'assistant', content, tokens: countTokens(content), type: 'assistant' });
        continue;
      }

      // Fallback: entries with role field directly
      if (entry.role === 'user' || entry.role === 'assistant') {
        const content = typeof entry.content === 'string' ? entry.content
          : Array.isArray(entry.content)
            ? entry.content.map((c: any) => c.text || c.content || '').join('\n')
            : '';
        if (!content.trim()) continue;
        messages.push({
          role: entry.role,
          content,
          tokens: countTokens(content),
          type: entry.role,
        });
      }
    } catch {
      continue;
    }
  }

  return messages;
}

/**
 * Find evaluation points in a session — places where the user asked something
 * and the assistant responded (these are testable task completions).
 */
function findEvalPoints(messages: SessionMessage[], maxTasks: number = 5): number[] {
  const points: number[] = [];
  // Find user→assistant pairs, skipping tool-result/system entries in between
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role !== 'user') continue;
    const userLen = messages[i].content.trim().length;
    if (userLen <= 20) continue;
    // Find the next assistant reply (may not be adjacent — tool results in between)
    for (let j = i + 1; j < messages.length && j <= i + 20; j++) {
      if (messages[j].role === 'user') break; // hit next user msg, no assistant reply found
      if (messages[j].role === 'assistant') {
        const assistantLen = messages[j].content.trim().length;
        if (assistantLen > 50) {
          points.push(j); // the assistant index
        }
        break;
      }
    }
  }
  // Take evenly spaced points across the session
  if (points.length <= maxTasks) return points;
  const step = Math.floor(points.length / maxTasks);
  return points.filter((_, idx) => idx % step === 0).slice(0, maxTasks);
}

/**
 * Build full context for a given eval point (all messages before it).
 */
function buildFullContext(messages: SessionMessage[], evalPoint: number): SessionMessage[] {
  return messages.slice(0, evalPoint);
}

/**
 * Build compressed context using ContextClaw for a given eval point.
 */
async function buildCompressedContext(
  messages: SessionMessage[],
  evalPoint: number,
  config: ContextClawConfig
): Promise<SessionMessage[]> {
  const context = messages.slice(0, evalPoint);
  const fullTokens = context.reduce((s, m) => s + m.tokens, 0);

  // Set budget to 50% of full context so eviction actually fires
  const tightConfig = { ...config, maxContextTokens: Math.max(2000, Math.floor(fullTokens * 0.5)) };
  const engine = new ContextClaw(tightConfig);

  // Ingest all messages up to the eval point
  for (let i = 0; i < context.length; i++) {
    await engine.ingest({
      type: (context[i].type || context[i].role) as ContextBlock['type'],
      content: context[i].content,
      tokens: context[i].tokens,
      turnsElapsed: 1,
    });
  }

  // Get the surviving blocks (what ContextClaw kept)
  const surviving = engine.budget.getSorted();
  return surviving.map(b => ({
    role: b.type === 'user' ? 'user' : b.type === 'assistant' ? 'assistant' : 'system',
    content: b.content,
    tokens: b.tokens,
  }));
}

/**
 * Prepare eval tasks from session files (no LLM calls yet — just context pairs).
 */
export async function prepareEvalTasks(
  sessionsDir: string,
  config: ContextClawConfig,
  options: { maxSessions?: number; tasksPerSession?: number } = {}
): Promise<EvalTask[]> {
  const maxSessions = options.maxSessions ?? 5;
  const tasksPerSession = options.tasksPerSession ?? 5;
  const tasks: EvalTask[] = [];

  const files = (await readdir(sessionsDir))
    .filter(f => f.endsWith('.jsonl'))
    .map(f => ({ name: f, size: statSync(join(sessionsDir, f)).size }))
    .sort((a, b) => b.size - a.size) // largest first — more likely to have conversations
    .map(f => f.name)
    .slice(0, maxSessions);

  for (const file of files) {
    const filePath = join(sessionsDir, file);
    const messages = await extractMessages(filePath);
    if (messages.length < 4) continue;

    const evalPoints = findEvalPoints(messages, tasksPerSession);

    for (let idx = 0; idx < evalPoints.length; idx++) {
      const point = evalPoints[idx];
      const fullContext = buildFullContext(messages, point);
      const compressedContext = await buildCompressedContext(messages, point, config);

      const fullTokens = fullContext.reduce((s, m) => s + m.tokens, 0);
      const compTokens = compressedContext.reduce((s, m) => s + m.tokens, 0);

      tasks.push({
        sessionFile: file,
        taskIndex: idx,
        userPrompt: messages[point - 1].content,
        fullContextTokens: fullTokens,
        compressedContextTokens: compTokens,
        reductionPct: fullTokens > 0 ? Math.round((1 - compTokens / fullTokens) * 100) : 0,
        fullMessageCount: fullContext.length,
        compressedMessageCount: compressedContext.length,
      });
    }
  }

  return tasks;
}

/**
 * The judge prompt — asks an LLM to compare full vs compressed responses.
 * This is designed to be called externally (we don't bake in an LLM client).
 */
export function buildJudgePrompt(task: EvalTask, fullResponse: string, compressedResponse: string): string {
  return `You are an impartial quality judge for an AI context management system.

A user asked: "${task.userPrompt.slice(0, 500)}"

Response A was generated with FULL conversation context (${task.fullContextTokens} tokens, ${task.fullMessageCount} messages).
Response B was generated with COMPRESSED context (${task.compressedContextTokens} tokens, ${task.compressedMessageCount} messages — ${task.reductionPct}% reduction).

## Response A (full context):
${fullResponse.slice(0, 2000)}

## Response B (compressed context):
${compressedResponse.slice(0, 2000)}

## Your task:
1. Identify the KEY FACTS and ACTIONS in Response A (list them).
2. Check which of those key facts/actions are preserved in Response B.
3. Rate Response B's quality relative to Response A on a scale of 0.0 to 1.0:
   - 1.0 = equivalent or better
   - 0.8 = minor omissions that don't affect usefulness
   - 0.5 = significant info missing but core answer correct
   - 0.2 = major quality degradation
   - 0.0 = completely wrong or useless

Reply in JSON only:
{
  "factsInA": ["fact1", "fact2", ...],
  "factsPreservedInB": ["fact1", ...],
  "score": 0.0-1.0,
  "reasoning": "one sentence"
}`;
}

/**
 * Parse judge response JSON.
 */
export function parseJudgeResponse(raw: string): { score: number; reasoning: string; factsPreserved: number; factsTotal: number } {
  try {
    // Extract JSON from response (may have markdown wrapping)
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found');
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      score: Math.min(1, Math.max(0, Number(parsed.score) || 0)),
      reasoning: String(parsed.reasoning || ''),
      factsPreserved: Array.isArray(parsed.factsPreservedInB) ? parsed.factsPreservedInB.length : 0,
      factsTotal: Array.isArray(parsed.factsInA) ? parsed.factsInA.length : 0,
    };
  } catch {
    return { score: 0.5, reasoning: 'Judge response parse error — defaulting to 0.5', factsPreserved: 0, factsTotal: 0 };
  }
}

/**
 * Summarize eval results.
 */
export function summarizeResults(results: EvalResult[], config: ContextClawConfig): EvalSummary {
  const avgScore = results.length > 0
    ? results.reduce((s, r) => s + r.qualityScore, 0) / results.length
    : 0;
  const avgReduction = results.length > 0
    ? results.reduce((s, r) => s + r.reductionPct, 0) / results.length
    : 0;
  const equivalent = results.filter(r => r.qualityScore >= 0.8).length;

  return {
    totalTasks: results.length,
    avgQualityScore: Math.round(avgScore * 100) / 100,
    avgReduction: Math.round(avgReduction),
    tasksEquivalentOrBetter: equivalent,
    equivalentRate: results.length > 0 ? Math.round((equivalent / results.length) * 100) : 0,
    results,
    runAt: new Date().toISOString(),
    config: {
      maxContextTokens: config.maxContextTokens,
      sessionsEvaluated: new Set(results.map(r => r.sessionFile)).size,
      tasksPerSession: Math.max(...results.map(r => r.taskIndex + 1), 0),
    },
  };
}
