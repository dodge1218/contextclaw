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

import { createHmac, randomBytes } from 'node:crypto';
import { TYPES } from './classifier.js';

// Session-scoped HMAC key; regenerated per process. Attacker-supplied
// content from prior sessions cannot forge a marker that verifies against
// the current key.
const SESSION_KEY = randomBytes(32);

// Recognized marker pattern (bounded, no backtracking). Matches the format
// produced by `formatTruncationMarker` and `formatTruncationMarkerHmac`.
const MARKER_REGEX = /\[ContextClaw:([0-9a-f]{8,16})[ \t][^\]]{1,256}\]/;

/**
 * Whitelist+truncate a string before embedding it in a marker. Strips
 * shell metacharacters, control characters, and brackets so the
 * downstream marker pattern stays unambiguous and cannot be hijacked by
 * attacker-supplied newlines or `]` characters that close the wrapper early.
 */
function sanitizeMarkerText(input, maxLen = 80) {
  if (input === null || input === undefined) return '';
  let s = String(input);
  s = s.replace(/[\r\n\t\0]/g, ' ');
  s = s.replace(/[`$();&|<>"'\[\]]/g, '');
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}

/**
 * Build a session-bound truncation marker. The 8-hex tag is an HMAC of the
 * sanitized message under the per-session key — attacker-supplied content
 * cannot predict the tag without the key, so spoofed markers won't verify.
 */
function formatTruncationMarker(message) {
  const safeMessage = sanitizeMarkerText(message);
  const tag = createHmac('sha256', SESSION_KEY)
    .update(safeMessage)
    .digest('hex')
    .slice(0, 8);
  return `[ContextClaw:${tag} ${safeMessage} (Run cc_rehydrate("${tag}") to read full)]`;
}

/**
 * Verify a marker came from THIS engine session by recomputing the HMAC.
 * Returns true only if the marker's tag matches the HMAC of its message
 * payload under the session key. Attacker-supplied markers from chat
 * content will have predictable tags that don't verify.
 */
export function verifyTruncationMarker(text) {
  if (typeof text !== 'string') return false;
  const m = text.match(MARKER_REGEX);
  if (!m) return false;
  const tag = m[1].slice(0, 8);
  // Extract the message payload between the tag and ` (Run cc_rehydrate`
  const inner = m[0].slice(`[ContextClaw:${tag} `.length, m[0].lastIndexOf(' (Run cc_rehydrate'));
  if (!inner) return false;
  const expected = createHmac('sha256', SESSION_KEY)
    .update(inner)
    .digest('hex')
    .slice(0, 8);
  return tag === expected;
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

/**
 * Sanitize a pointer extracted from untrusted content.
 *
 * The pointer becomes part of a hint surfaced to the model. A bad pointer
 * (path traversal sentinels, shell metacharacters, embedded markers) can
 * mislead the model into asking for a file the operator did not intend
 * to expose, or be read by downstream consumers that strip-quote and
 * re-execute. Apply the same whitelist / basename / length-cap rules used
 * elsewhere so the pointer can only be a flat short filename.
 */
function sanitizePointerSegment(input, maxLen = 80) {
  if (input === null || input === undefined) return 'unknown';
  let s = String(input);
  // Take only the basename — drop any directory component
  const lastSlash = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  if (lastSlash >= 0) s = s.slice(lastSlash + 1);
  // Drop shell metacharacters, control chars, and brackets
  s = s.replace(/[`$();&|<>"'\[\]\r\n\t\0]/g, '');
  // Whitelist
  s = s.replace(/[^A-Za-z0-9._\- ]/g, '_');
  s = s.trim();
  if (!s || s === '.' || s === '..') return 'unknown';
  if (s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}

function extractPointer(content) {
  // Try to find a filename or media reference
  const fileMatch = content.match(/\/([\w.-]+\.(?:jpg|jpeg|png|gif|webp|svg|pdf|mp4|mp3))/i);
  if (fileMatch) return formatTruncationMarker(`media pointer: ${sanitizePointerSegment(fileMatch[1])}`);

  const mediaMatch = content.match(/MEDIA:([\S]+)/);
  if (mediaMatch) return formatTruncationMarker(`media pointer: ${sanitizePointerSegment(mediaMatch[1])}`);

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

    // -------------------------------------------------------
    // STRUCTURAL SAFETY: If content is an array containing
    // tool_use or tool_result blocks, truncate INSIDE each
    // block's content/text field — never flatten the structure.
    // This preserves tool_use_id and tool_result pairing.
    // -------------------------------------------------------
    if (contentIsArray && hasStructuralBlocks(msg.content)) {
      return truncateStructuralBlocks(msg, maxChars, policy, originalChars);
    }

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
        savedChars: originalChars - truncated.length, originalContent: content,
      };
    }

    // Not worth truncating — keep as-is
    return { msg, action: 'keep', originalChars };
  }

  // No truncation policy — keep
  return { msg, action: 'keep', originalChars };
}

// -------------------------------------------------------
// Structural block helpers — preserve tool_use/tool_result
// -------------------------------------------------------

/**
 * Check if a content array contains structural blocks that must
 * not be flattened (tool_use, tool_result).
 */
function hasStructuralBlocks(content) {
  if (!Array.isArray(content)) return false;
  return content.some(block =>
    block && typeof block === 'object' &&
    (block.type === 'tool_use' || block.type === 'tool_result')
  );
}

/**
 * Truncate content inside structural blocks while preserving
 * the block wrappers and all structural fields (type, id,
 * tool_use_id, name, input).
 */
function truncateStructuralBlocks(msg, maxChars, policy, originalChars) {
  let totalSaved = 0;
  const newContent = msg.content.map(block => {
    if (!block || typeof block !== 'object') return block;

    // tool_use blocks: preserve id, name, input — truncate only nested text
    if (block.type === 'tool_use') {
      // tool_use blocks are usually small; preserve them entirely
      return { ...block };
    }

    // tool_result blocks: preserve type, tool_use_id — truncate content string
    if (block.type === 'tool_result') {
      const innerContent = typeof block.content === 'string' ? block.content : JSON.stringify(block.content || '');
      if (innerContent.length <= maxChars) return { ...block };

      const truncatedInner = extractBookends(innerContent, maxChars);
      totalSaved += innerContent.length - truncatedInner.length;

      return {
        ...block,
        content: truncatedInner,
      };
    }

    // text blocks: truncate normally
    if (block.type === 'text' && typeof block.text === 'string') {
      if (block.text.length <= maxChars) return { ...block };
      const truncatedText = extractBookends(block.text, maxChars);
      totalSaved += block.text.length - truncatedText.length;
      return { ...block, text: truncatedText };
    }

    // Unknown block types: pass through untouched
    return { ...block };
  });

  // Only report truncation if we actually saved something meaningful
  if (totalSaved > originalChars * 0.2) {
    return {
      msg: { ...msg, content: newContent, _truncated: true, _originalChars: originalChars },
      action: 'truncate',
      originalChars,
      savedChars: totalSaved,
      originalContent: JSON.stringify(msg.content),
    };
  }

  return { msg, action: 'keep', originalChars };
}
