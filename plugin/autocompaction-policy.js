/**
 * ContextClaw Autocompaction Policy MVP
 *
 * Pure, deterministic policy layer:
 * - label context on ingress
 * - resolve current task/lane from recent items and corrections
 * - reevaluate labels before each pass
 * - plan compaction actions
 * - assemble a compact working set
 *
 * This module intentionally does not register an OpenClaw plugin or mutate config.
 */

import { createHash } from 'node:crypto';
import { classify, TYPES } from './classifier.js';

const BULKY_CHAR_THRESHOLD = 4_000;
const EXTREME_CHAR_THRESHOLD = 20_000;

const ACTIONS = {
  KEEP_RAW: 'KEEP_RAW',
  KEEP_SUMMARY: 'KEEP_SUMMARY',
  PIN: 'PIN',
  COLD_STORE: 'COLD_STORE',
  DROP_FROM_WINDOW: 'DROP_FROM_WINDOW',
  REHYDRATE_IF_ASKED: 'REHYDRATE_IF_ASKED',
  REHYDRATE_NOW: 'REHYDRATE_NOW',
};

const LANE_KEYWORDS = [
  { lane: 'websites', project: 'dsb', terms: ['website', 'websites', 'site', 'dsb', 'turf', 'turfrank', 'manayunk', 'roxborough', 'instant cash', 'pawn', 'salon', 'wellness', 'booking', 'prospect', 'audit'] },
  { lane: 'security-research', project: 'bounty', terms: ['bounty', 'security research', 'immunefi', 'sherlock', 'code4rena', 'cantina', 'vulnerability', 'poc', 'submission', 'finding'] },
  { lane: 'contextclaw', project: 'contextclaw', terms: ['contextclaw', 'autocompaction', 'compaction', 'context', 'policy', 'label', 'sticker', 'rehydrate'] },
  { lane: 'kairos', project: 'kairos', terms: ['kairos', 'chatport', 'corpus tool'] },
];

function textOf(item) {
  const content = item?.content ?? item?.text ?? item?.message ?? '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === 'string') return part;
      if (part?.text) return part.text;
      if (part?.content) return typeof part.content === 'string' ? part.content : JSON.stringify(part.content);
      return '';
    }).join('\n');
  }
  if (content && typeof content === 'object') return JSON.stringify(content);
  return '';
}

function stableId(item, text) {
  if (item?.id) return String(item.id);
  if (item?._label?.id) return String(item._label.id);
  const hash = createHash('sha1').update(`${item?.role || 'unknown'}\n${text}`).digest('hex').slice(0, 16);
  return `ctx_${hash}`;
}

function estimateTokens(text) {
  return Math.ceil((text || '').length / 3.2);
}

function inferLaneProject(text, fallback = {}) {
  const lower = (text || '').toLowerCase();
  let best = null;
  for (const candidate of LANE_KEYWORDS) {
    const score = candidate.terms.reduce((n, term) => n + (lower.includes(term) ? 1 : 0), 0);
    if (score > 0 && (!best || score > best.score)) best = { ...candidate, score };
  }
  return {
    lane: fallback.lane ?? best?.lane,
    project: fallback.project ?? best?.project,
  };
}

function isCorrectionText(text) {
  const lower = (text || '').toLowerCase();
  return /\b(no|nah)\b.*\b(actually|were|wrong)\b/.test(lower) ||
    /\bbruh\b/.test(lower) ||
    /\bstop\b.*\b(wrong|direction|task)\b/.test(lower) ||
    /\bwrong (direction|task|context|lane)\b/.test(lower) ||
    /\bwe were actually\b/.test(lower);
}

function detectPrivacy(text, contentType) {
  const secretPattern = /(?:api[_-]?key|secret|token|password|bearer|private[_-]?key|resend[_-]?api[_-]?key)\s*[:=]\s*['\"]?[A-Za-z0-9_./+\-=]{12,}/i;
  if (secretPattern.test(text)) return 'secret-risk';
  if (contentType === TYPES.CONFIG_DUMP && /\.env|token|secret|password/i.test(text)) return 'secret-risk';
  return 'normal';
}

function inferContentType(item, text) {
  if (item?.contentType) return item.contentType;
  if (item?._type) return item._type;
  if (/browser snapshot|<html|<body|document\.querySelector|screenshot/i.test(text) && text.length > 1000) return 'browser-snapshot';
  if (/SPRINT_STATUS|STATUS|NEXT_TICKET|READY-FOR-RYAN|CURRENT TASK/i.test(text)) return 'status-ledger';
  if (isCorrectionText(text)) return 'conversation-correction';
  return classify({ role: item?.role || 'tool', content: text });
}

function summarize(text, max = 320) {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}…`;
}

function coldPointerFor(label) {
  return label.coldPointer || `cold://${label.id}`;
}

function isBulky(label) {
  return label.tokenEstimate > estimateTokens('x'.repeat(BULKY_CHAR_THRESHOLD)) || label.costRisk === 'high' || label.costRisk === 'extreme';
}

function actionPriority(action) {
  return {
    [ACTIONS.PIN]: 0,
    [ACTIONS.REHYDRATE_NOW]: 1,
    [ACTIONS.KEEP_RAW]: 2,
    [ACTIONS.KEEP_SUMMARY]: 3,
    [ACTIONS.REHYDRATE_IF_ASKED]: 4,
    [ACTIONS.COLD_STORE]: 5,
    [ACTIONS.DROP_FROM_WINDOW]: 6,
  }[action] ?? 9;
}

export function labelContextItem(item, state = {}) {
  const text = textOf(item);
  const contentType = inferContentType(item, text);
  const inferred = inferLaneProject(`${item?.source || ''}\n${text}`, state);
  const tokenEstimate = item?.tokenEstimate ?? estimateTokens(text);
  const chars = text.length;
  const privacy = item?.privacy || detectPrivacy(text, contentType);
  const bulky = chars > BULKY_CHAR_THRESHOLD || ['browser-snapshot', TYPES.FILE_READ, TYPES.CMD_OUTPUT, TYPES.JSON_BLOB, TYPES.CONFIG_DUMP].includes(contentType);

  const label = {
    id: stableId(item, text),
    createdAt: item?.createdAt || new Date(0).toISOString(),
    role: item?.role || 'tool',
    project: item?.project || inferred.project,
    task: item?.task || state.task,
    lane: item?.lane || inferred.lane,
    contentType,
    source: item?.source || item?.name || item?.toolName,
    tokenEstimate,
    importance: item?.importance ?? (contentType === 'conversation-correction' ? 5 : contentType === 'status-ledger' ? 4 : item?.role === 'user' ? 3 : 2),
    lifespan: item?.lifespan || (contentType === TYPES.SYSTEM ? 'forever' : contentType === 'conversation-correction' ? 'task' : contentType === 'status-ledger' ? 'task' : bulky ? 'turn' : 'session'),
    privacy,
    costRisk: item?.costRisk || (chars > EXTREME_CHAR_THRESHOLD ? 'extreme' : chars > BULKY_CHAR_THRESHOLD ? 'high' : chars > 1200 ? 'medium' : 'low'),
    stale: Boolean(item?.stale),
    summary: item?.summary || summarize(text),
    coldPointer: item?.coldPointer,
  };

  return label;
}

export function resolveCurrentTaskState(items = []) {
  const labels = items.map((item) => item?._label || labelContextItem(item));
  const latestCorrectionIndex = labels.map((l) => l.contentType).lastIndexOf('conversation-correction');
  const searchStart = latestCorrectionIndex >= 0 ? latestCorrectionIndex : Math.max(0, labels.length - 8);
  const relevant = labels.slice(searchStart);

  const laneScores = new Map();
  const projectScores = new Map();
  for (const label of relevant) {
    if (label.lane) laneScores.set(label.lane, (laneScores.get(label.lane) || 0) + 1 + label.importance);
    if (label.project) projectScores.set(label.project, (projectScores.get(label.project) || 0) + 1 + label.importance);
  }

  const top = (map) => [...map.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const latestCorrection = latestCorrectionIndex >= 0 ? labels[latestCorrectionIndex] : null;

  return {
    lane: top(laneScores),
    project: top(projectScores),
    task: relevant.findLast?.((l) => l.task)?.task || labels.findLast?.((l) => l.task)?.task,
    correctionId: latestCorrection?.id,
    hasCorrection: Boolean(latestCorrection),
  };
}

export function reevaluateLabels(labels = [], state = {}) {
  const effectiveState = state.lane || state.project ? state : resolveCurrentTaskState(labels.map((label) => ({ _label: label, role: label.role, content: label.summary || '' })));

  return labels.map((label) => {
    const next = { ...label };
    const conflictsLane = effectiveState.lane && next.lane && next.lane !== effectiveState.lane;
    const conflictsProject = effectiveState.project && next.project && next.project !== effectiveState.project;
    const matchesLane = effectiveState.lane && next.lane === effectiveState.lane;
    const matchesProject = effectiveState.project && next.project === effectiveState.project;

    if (effectiveState.hasCorrection && (conflictsLane || conflictsProject)) {
      next.stale = true;
      next.importance = Math.max(0, next.importance - 1);
    }

    if (effectiveState.hasCorrection && (matchesLane || matchesProject)) {
      next.stale = false;
      next.importance = Math.min(5, next.importance + 2);
    }

    if (next.contentType === 'conversation-correction') {
      next.importance = 5;
      next.lifespan = 'task';
    }

    return next;
  });
}

export function planCompactionActions(labels = [], state = {}) {
  const nowTurn = state.turn ?? labels.length;
  const actions = new Map();

  for (const label of labels) {
    let action = ACTIONS.KEEP_RAW;
    const age = typeof label.turn === 'number' ? nowTurn - label.turn : undefined;

    if (label.lifespan === 'forever' || label.contentType === TYPES.SYSTEM || label.contentType === 'conversation-correction') {
      action = ACTIONS.PIN;
    } else if (label.privacy === 'secret-risk' || label.privacy === 'credential') {
      action = ACTIONS.KEEP_SUMMARY;
    } else if (label.stale) {
      action = label.summary || label.coldPointer ? ACTIONS.REHYDRATE_IF_ASKED : ACTIONS.DROP_FROM_WINDOW;
    } else if (label.contentType === 'status-ledger') {
      action = ACTIONS.KEEP_SUMMARY;
    } else if (label.contentType === TYPES.ERROR_TRACE && label.resolved !== true) {
      action = ACTIONS.KEEP_SUMMARY;
    } else if (isBulky(label)) {
      action = age === undefined || age > 0 || label.coldPointer ? ACTIONS.KEEP_SUMMARY : ACTIONS.KEEP_RAW;
    }

    actions.set(label.id, action);
  }

  return actions;
}

function redactSecrets(text) {
  return (text || '').replace(/((?:api[_-]?key|secret|token|password|bearer|private[_-]?key|resend[_-]?api[_-]?key)\s*[:=]\s*['\"]?)[A-Za-z0-9_./+\-=]{8,}/gi, '$1[REDACTED]');
}

function renderItem(item, label, action) {
  const raw = textOf(item);
  if (action === ACTIONS.DROP_FROM_WINDOW) return null;
  if (action === ACTIONS.REHYDRATE_IF_ASKED) {
    return `[ContextClaw stale pointer] ${label.summary || label.contentType} (${coldPointerFor(label)})`;
  }
  if (action === ACTIONS.KEEP_SUMMARY || action === ACTIONS.COLD_STORE) {
    const summary = label.privacy === 'secret-risk'
      ? `${label.contentType} contained secret-risk content; raw value redacted. Source: ${label.source || 'unknown'}.`
      : (label.summary || summarize(raw));
    return `[ContextClaw summary:${label.contentType}] ${redactSecrets(summary)}${label.coldPointer ? ` (${label.coldPointer})` : ''}`;
  }
  return redactSecrets(raw);
}

export function assembleWorkingSet(items = [], actions, options = {}) {
  const labels = items.map((item) => item?._label || labelContextItem(item, options.state || {}));
  const actionMap = actions || planCompactionActions(labels, options.state || {});
  const rows = items.map((item, index) => {
    const label = labels[index];
    const action = actionMap instanceof Map ? actionMap.get(label.id) : actionMap[label.id];
    return { item, label, action: action || ACTIONS.KEEP_RAW };
  }).sort((a, b) => actionPriority(a.action) - actionPriority(b.action));

  const parts = [];
  if (options.state?.hasCorrection) {
    const lane = options.state.lane || 'unknown';
    const project = options.state.project || 'unknown';
    parts.push(`CURRENT TASK CORRECTION: active lane is ${lane} / ${project}. Treat conflicting context as stale unless explicitly requested.`);
  }

  for (const row of rows) {
    const rendered = renderItem(row.item, row.label, row.action);
    if (rendered) parts.push(rendered);
  }

  return parts.join('\n\n');
}

export { ACTIONS };
