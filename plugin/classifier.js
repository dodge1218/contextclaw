/**
 * 🏷️ ContextClaw Classifier
 *
 * Tags every context message with a content type.
 * No scoring, no relevance — just "what kind of thing is this?"
 *
 * The classifier is the foundation. Policy decides what to do with each type.
 */

// Content types
export const TYPES = {
  SYSTEM:       'system-prompt',
  USER:         'user-message',
  ASSISTANT:    'assistant-reply',
  FILE_READ:    'tool-file-read',
  CMD_OUTPUT:   'tool-cmd-output',
  SEARCH_RESULT:'tool-search-result',
  IMAGE_MEDIA:  'image-media',
  CONFIG_DUMP:  'config-dump',
  ERROR_TRACE:  'error-trace',
  JSON_BLOB:    'json-schema-blob',
  TOOL_GENERIC: 'tool-generic',
};

// -------------------------------------------------------
// Helpers
// -------------------------------------------------------

function text(msg) {
  const c = msg.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(b => (typeof b === 'string' ? b : b.text || '')).join('\n');
  if (c && typeof c === 'object') return JSON.stringify(c);
  return '';
}

function len(msg) {
  return text(msg).length;
}

// -------------------------------------------------------
// Pattern matchers — ordered from most specific to generic
// -------------------------------------------------------

const FILE_PATTERNS = [
  /^Successfully read \d+ lines?/i,
  /^\d+ lines? \| /,
  /^```[\w]*\n/,
  /^\/[\w/.-]+\.(ts|js|py|md|json|yaml|yml|toml|sh|css|html|tsx|jsx|rs|go|rb|sql)/m,
  /\[\d+ more lines in file/,
  /^import\s+{/m,
  /^(?:export\s+)?(?:function|class|const|let|var|interface|type)\s+/m,
  /^---\ntitle:/,
  /^#\s+\w/m,  // markdown heading as first content
];

const CMD_PATTERNS = [
  /^\$\s+/m,
  /^>\s+/m,
  /Process exited with code \d/,
  /^(?:total|drwx|lrwx|-rw)/m,                 // ls output
  /^(?:npm|pnpm|yarn)\s+(?:install|run|test)/m,
  /added \d+ packages/,
  /^PASS\s|^FAIL\s|^✓|^✗|^✔|^✘/m,
  /^Compiling|^Building|^Bundling/m,
  /^\s*\d+\s+\/[\w/.-]+$/m,                    // wc -l output
  /^(?:Session|Command)\s.*(?:pid|exit)/i,
];

// ReDoS-resistant: bounded quantifiers on every variable-length segment.
// Original `^{\s*"[\w.]+"\s*:/` is exponential under crafted input
// (e.g. `{` + 100k spaces + `"` with no closing colon). The bounded forms
// below cap each repeat so worst-case match time is linear in input length.
const CONFIG_PATTERNS = [
  /^\{[ \t]{0,4}"[\w.]{1,128}"[ \t]{0,4}:/,    // JSON config (bounded)
  /^[\w.]{1,128}:[ \t]{1,4}/m,                  // YAML-style (bounded)
  /^\[[\w.]{1,128}\][ \t]{0,4}$/m,              // TOML section (bounded)
  /configSchema|pluginApi|minGatewayVersion/,
];

// Pre-match guard: config-dump-class detection refuses to even attempt
// regex matching against payloads above this size. Above the threshold,
// the input is almost certainly a config-dump regardless of regex shape,
// and refusing to scan it eliminates ReDoS exposure entirely.
const CONFIG_PATTERN_MAX_INPUT = 5000;

const ERROR_PATTERNS = [
  /Error:|TypeError:|ReferenceError:|SyntaxError:/,
  /Traceback \(most recent call last\)/,
  /^\s+at\s+[\w.]+\s+\(/m,                     // JS stack frame
  /ENOENT|ECONNREFUSED|EACCES|EISDIR|EPERM/,
  /panic:|fatal:|FATAL/,
  /^\d{4}-\d{2}-\d{2}.*ERROR/m,
];

const IMAGE_PATTERNS = [
  /\[media attached:/,
  /data:image\//,
  /base64,/,
  /\.(?:jpg|jpeg|png|gif|webp|svg|bmp)\b/i,
  /MEDIA:/,
];

const SEARCH_PATTERNS = [
  /memory_search|web_search|web_fetch/i,
  /^\s*\d+\.\s+\*\*/m,                         // numbered bold results
  /snippet|citation|score.*0\.\d/,
];

// -------------------------------------------------------
// Classify a single message
// -------------------------------------------------------

/**
 * @param {Object} msg - { role, content, ... }
 * @returns {string} One of TYPES.*
 */
export function classify(msg) {
  if (!msg || !msg.role) return TYPES.TOOL_GENERIC;

  // System is system
  if (msg.role === 'system') return TYPES.SYSTEM;

  // User is user
  if (msg.role === 'user') return TYPES.USER;

  // Assistant is assistant
  if (msg.role === 'assistant') return TYPES.ASSISTANT;

  // Everything below is tool/toolResult territory
  const content = text(msg);
  const size = content.length;

  // Images/media — check early, they can appear in any role
  if (IMAGE_PATTERNS.some(p => p.test(content))) return TYPES.IMAGE_MEDIA;

  // Errors — check before file/cmd because errors can appear inside those
  if (ERROR_PATTERNS.some(p => p.test(content))) {
    // Only classify as error if it's primarily an error (not a file that mentions "Error")
    const errorLineCount = content.split('\n').filter(l => ERROR_PATTERNS.some(p => p.test(l))).length;
    const totalLines = content.split('\n').length;
    if (errorLineCount / totalLines > 0.1 || size < 2000) return TYPES.ERROR_TRACE;
  }

  // Large JSON/schema blobs
  if (size > 2000) {
    const trimmed = content.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      return TYPES.JSON_BLOB;
    }
  }

  // Config dumps — bounded input length to defeat ReDoS on adversarial payloads.
  // Above CONFIG_PATTERN_MAX_INPUT we skip the regex pass entirely and let
  // downstream classification (file/cmd/generic) handle it.
  if (size > 500 && size <= CONFIG_PATTERN_MAX_INPUT && CONFIG_PATTERNS.some(p => p.test(content))) {
    const lines = content.split('\n').filter(l => l.trim());
    const configLines = lines.filter(l => /^[ \t]*"?[\w][\w.-]{0,128}"?[ \t]{0,4}[:=]/.test(l)).length;
    if (configLines / lines.length > 0.25) return TYPES.CONFIG_DUMP;
  }

  // File reads — usually large, structured content
  if (FILE_PATTERNS.some(p => p.test(content))) return TYPES.FILE_READ;

  // Command output
  if (CMD_PATTERNS.some(p => p.test(content))) return TYPES.CMD_OUTPUT;

  // Search results
  if (SEARCH_PATTERNS.some(p => p.test(content))) return TYPES.SEARCH_RESULT;

  // Fallback
  return TYPES.TOOL_GENERIC;
}

/**
 * Classify all messages in a list. Returns same structure with `_type` added.
 */
export function classifyAll(messages) {
  return messages.map(msg => ({
    ...msg,
    _type: classify(msg),
    _chars: len(msg),
  }));
}
