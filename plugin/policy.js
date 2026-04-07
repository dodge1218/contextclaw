/**
 * 📋 ContextClaw Retention Policies
 *
 * Each content type has a policy that determines:
 * - How long it stays in full form
 * - What it gets truncated to
 * - Whether it gets cold-stored
 *
 * No relevance scoring. Just: what type is it, how old is it, how big is it.
 */

import { randomBytes } from 'node:crypto';
import { TYPES } from './classifier.js';

function formatTruncationMarker(message) {
  const nonce = randomBytes(4).toString('hex');
  return `[ContextClaw:${nonce} ${message}]`;
}

// -------------------------------------------------------
// Default policies (user-configurable via plugin config)
// -------------------------------------------------------

export const DEFAULT_POLICIES = {
  [TYPES.SYSTEM]: {
    keep: 'forever',
    truncate: false,
    coldStore: false,
    description: 'System prompt — never touch',
  },

  [TYPES.USER]: {
    keepTurns: 5,         // keep last 5 verbatim
    truncateOlder: true,  // older ones: strip metadata envelope, keep core text
    maxCharsOlder: 300,   // truncate older user msgs to this
    coldStore: true,
    description: 'User messages — recent verbatim, older stripped',
  },

  [TYPES.ASSISTANT]: {
    keepTurns: 3,
    truncateOlder: true,
    maxCharsOlder: 500,
    coldStore: true,
    description: 'Assistant replies — recent verbatim, older trimmed',
  },

  [TYPES.FILE_READ]: {
    keepTurns: 1,          // full content for 1 turn only
    truncateAfter: true,
    maxCharsAfter: 200,    // after 1 turn: first 100 + last 100 chars
    extractPattern: 'bookends',  // first N + last N chars
    coldStore: true,
    description: 'File reads — full for 1 turn, then bookends',
  },

  [TYPES.CMD_OUTPUT]: {
    keepTurns: 1,
    truncateAfter: true,
    maxCharsAfter: 400,
    extractPattern: 'tail',     // exit code + last 20 lines
    tailLines: 20,
    coldStore: true,
    description: 'Command output — full for 1 turn, then tail',
  },

  [TYPES.SEARCH_RESULT]: {
    keepTurns: 1,
    truncateAfter: true,
    maxCharsAfter: 300,
    extractPattern: 'bookends',
    coldStore: true,
    description: 'Search results — full for 1 turn, then summary',
  },

  [TYPES.IMAGE_MEDIA]: {
    keepTurns: 0,           // immediately reduce
    truncateAfter: true,
    maxCharsAfter: 100,
    extractPattern: 'pointer',  // just "[image: filename.jpg]"
    coldStore: false,           // binary doesn't belong in cold storage
    description: 'Images/media — pointer only, drop binary',
  },

  [TYPES.CONFIG_DUMP]: {
    keepTurns: 1,
    truncateAfter: true,
    maxCharsAfter: 200,
    extractPattern: 'bookends',
    coldStore: true,
    description: 'Config dumps — full for 1 turn, then key fields only',
  },

  [TYPES.ERROR_TRACE]: {
    keepTurns: 2,           // keep a bit longer — might need for debugging
    truncateAfter: true,
    maxCharsAfter: 300,
    extractPattern: 'error_line', // extract just the error message line
    coldStore: true,
    description: 'Error traces — keep 2 turns, then error line only',
  },

  [TYPES.JSON_BLOB]: {
    keepTurns: 1,
    truncateAfter: true,
    maxCharsAfter: 500,
    extractPattern: 'bookends',
    coldStore: true,
    description: 'JSON/schema blobs — full for 1 turn, then truncate',
  },

  [TYPES.TOOL_GENERIC]: {
    keepTurns: 2,
    truncateAfter: true,
    maxCharsAfter: 500,
    extractPattern: 'bookends',
    coldStore: true,
    description: 'Generic tool output — keep 2 turns, then truncate',
  },
};

// -------------------------------------------------------
// Truncation extractors
// -------------------------------------------------------

function extractBookends(content, maxChars) {
  if (content.length <= maxChars) return content;
  const half = Math.floor(maxChars / 2);
  const head = content.slice(0, half);
  const tail = content.slice(-half);
  const dropped = content.length - maxChars;
  const marker = formatTruncationMarker(`truncated ${dropped} chars`);
  return `${head}\n\n${marker}\n\n${tail}`;
}

function extractTail(content, tailLines = 20) {
  const lines = content.split('\n');
  if (lines.length <= tailLines + 2) return content;
  const kept = lines.slice(-tailLines);
  const dropped = lines.length - tailLines;
  const marker = formatTruncationMarker(`truncated ${dropped} lines`);
  return `${marker}\n${kept.join('\n')}`;
}

function extractPointer(content) {
  // Try to find a filename or media reference
  const fileMatch = content.match(/\/([\w.-]+\.(?:jpg|jpeg|png|gif|webp|svg|pdf|mp4|mp3))/i);
  if (fileMatch) return formatTruncationMarker(`media pointer: ${fileMatch[1]}`);

  const mediaMatch = content.match(/MEDIA:([\S]+)/);
  if (mediaMatch) return formatTruncationMarker(`media pointer: ${mediaMatch[1]}`);

  return formatTruncationMarker(`media attachment — ${content.length} chars, binary dropped`);
}

function extractErrorLine(content, maxChars = 300) {
  const lines = content.split('\n');
  // Find the actual error message (not stack frames)
  const errorLine = lines.find(l =>
    /^(?:Error|TypeError|ReferenceError|SyntaxError|ENOENT|ECONNREFUSED|panic|fatal|FATAL)/.test(l.trim()) ||
    /Error:/.test(l)
  );

  if (errorLine) {
    const trimmedError = errorLine.trim().slice(0, maxChars);
    return `[ContextClaw: error summary]\n${trimmedError}`;
  }

  // Fallback: bookends
  return extractBookends(content, maxChars);
}

const EXTRACTORS = {
  bookends: extractBookends,
  tail: extractTail,
  pointer: extractPointer,
  error_line: extractErrorLine,
};

// -------------------------------------------------------
// Apply policy to a single message
// -------------------------------------------------------

/**
 * @param {Object} msg - classified message with _type, _chars
 * @param {number} turnsAgo - how many turns since this message (0 = current turn)
 * @param {Object} [customPolicies] - override default policies
 * @returns {{ msg: Object, action: string, originalChars: number }}
 *   action: 'keep' | 'truncate' | 'evict'
 */
export function applyPolicy(msg, turnsAgo, customPolicies = {}) {
  const type = msg._type || TYPES.TOOL_GENERIC;
  const policy = { ...DEFAULT_POLICIES[type], ...customPolicies[type] };
  const contentIsArray = Array.isArray(msg.content);
  const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || '');
  const originalChars = content.length;

  // Sacred — never touch
  if (policy.keep === 'forever') {
    return { msg, action: 'keep', originalChars };
  }

  // Within keepTurns — full content
  const keepTurns = policy.keepTurns ?? 0;
  if (keepTurns > 0 && turnsAgo <= keepTurns) {
    return { msg, action: 'keep', originalChars };
  }

  // Past keepTurns — apply truncation or eviction
  if (policy.truncateOlder || policy.truncateAfter) {
    const maxChars = policy.maxCharsOlder || policy.maxCharsAfter || 500;
    const extractFn = EXTRACTORS[policy.extractPattern] || extractBookends;

    let truncated;
    if (policy.extractPattern === 'tail') {
      truncated = extractTail(content, policy.tailLines || 20);
    } else if (policy.extractPattern === 'pointer') {
      truncated = extractPointer(content);
    } else if (policy.extractPattern === 'error_line') {
      truncated = extractErrorLine(content, maxChars);
    } else {
      truncated = extractBookends(content, maxChars);
    }

    // Only truncate if it actually saves something meaningful (>20%)
    if (truncated.length < originalChars * 0.8) {
      // If original content was an array (e.g. assistant content blocks),
      // wrap the truncated string in a text block to preserve the array contract.
      // The gateway expects assistant .content to always be an array.
      let truncatedContent;
      if (msg.role === 'assistant' || contentIsArray) {
        truncatedContent = [{ type: 'text', text: truncated }];
      } else {
        truncatedContent = truncated;
      }
      return {
        msg: { ...msg, content: truncatedContent, _truncated: true, _originalChars: originalChars },
        action: 'truncate',
        originalChars,
        savedChars: originalChars - truncated.length,
      };
    }

    // Not worth truncating — keep as-is
    return { msg, action: 'keep', originalChars };
  }

  // No truncation policy — keep
  return { msg, action: 'keep', originalChars };
}
