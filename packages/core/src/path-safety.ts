/**
 * Path-safety utilities for ContextClaw cold-storage and memory operations.
 *
 * Defends against:
 *   - Path traversal via user-influenced filename segments (e.g. `../../etc/passwd`).
 *   - Filename collision under high-frequency concurrent flushes
 *     (millisecond timestamps alone are not unique enough).
 *   - Information leakage through unsanitized error messages and
 *     console.error calls that emit absolute paths.
 *
 * The single rule: every filename written to a cold-storage / memory
 * directory must be (a) constructed via `safeCold*` helpers, and (b)
 * resolved-and-asserted to live under the configured base directory.
 */

import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { resolve, sep } from 'node:path';

/**
 * Whitelist filename charset. Anything outside `[A-Za-z0-9._-]` is replaced
 * with `_`. Empty / falsy input produces `unknown`. Length is capped at
 * 64 chars defensively to keep filename predictable.
 */
export function sanitizeSegment(input: unknown, maxLen = 64): string {
  if (input === null || input === undefined) return 'unknown';
  let s = String(input);
  // Strip path separators and traversal characters explicitly first
  s = s.replace(/[/\\]/g, '_');
  // Whitelist: letters, numbers, dot, underscore, hyphen
  s = s.replace(/[^A-Za-z0-9._-]/g, '_');
  // Collapse leading dots so the segment cannot become `.` or `..` or hidden
  s = s.replace(/^\.+/, '_');
  if (!s) return 'unknown';
  if (s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}

/**
 * Generate an 8-hex-character (32-bit) collision-resistant nonce
 * for filename suffixes. Negligible collision probability under
 * realistic per-second flush rates.
 */
export function fileNonce(): string {
  return randomBytes(4).toString('hex');
}

/**
 * Resolve a candidate filename inside `baseDir` and assert that the
 * resolved path is a child of `baseDir`. Throws a generic Error if
 * the resolved path escapes the base — error message contains NO
 * absolute paths.
 */
export function safeJoin(baseDir: string, filename: string): string {
  const resolvedBase = resolve(baseDir);
  const resolvedPath = resolve(resolvedBase, filename);
  // Must be exactly inside resolvedBase (with separator). Equality is also
  // rejected — a filename should produce a child path, not the dir itself.
  if (
    resolvedPath !== resolvedBase &&
    resolvedPath.startsWith(resolvedBase + sep)
  ) {
    return resolvedPath;
  }
  throw new Error('ContextClaw: refused unsafe filename (path traversal)');
}

/**
 * Build a safe cold-storage filename in the form
 *   `<prefix>-<sanitizedId>-<isoTs>-<nonce>.<ext>`
 * The full path is asserted to live under `baseDir`.
 */
export function buildSafeColdPath(
  baseDir: string,
  prefix: string,
  rawId: unknown,
  ext = 'md',
): string {
  const id = sanitizeSegment(rawId);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const nonce = fileNonce();
  const safeExt = sanitizeSegment(ext, 8) || 'md';
  const filename = `${sanitizeSegment(prefix, 32)}-${id}-${ts}-${nonce}.${safeExt}`;
  return safeJoin(baseDir, filename);
}

/**
 * Redact absolute paths in arbitrary text before it is logged or
 * surfaced to the model. Replaces `<homedir>` with `<home>` and any
 * remaining absolute path with `<abs-path>/`. Used by every `console.error`
 * / `console.warn` site that may incorporate Error.message strings.
 */
export function redactPaths(input: unknown): string {
  if (input === null || input === undefined) return '';
  let s: string;
  if (input instanceof Error) {
    s = input.message ?? String(input);
  } else if (typeof input === 'string') {
    s = input;
  } else {
    try {
      s = String(input);
    } catch {
      return '<unprintable>';
    }
  }

  const home = homedir();
  if (home && home.length > 1) {
    const escapedHome = home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    s = s.replace(new RegExp(escapedHome, 'g'), '<home>');
  }
  // Redact any remaining absolute POSIX paths (/foo/bar... including /etc/x).
  // Bounded quantifiers to stay ReDoS-safe even on adversarial input.
  s = s.replace(/\/(?:[A-Za-z0-9._-]{1,128}\/){1,32}[A-Za-z0-9._-]{0,128}/g, '<abs-path>');
  // Redact Windows-style absolute paths (best effort).
  s = s.replace(/[A-Za-z]:\\(?:[A-Za-z0-9._-]{1,128}\\){1,32}[A-Za-z0-9._-]{0,128}/g, '<abs-path>');
  return s;
}

/**
 * Sanitize a file pointer extracted from untrusted content so it can
 * be embedded in a hint to the model without misleading it into
 * requesting a path the operator did not intend to expose.
 *
 * Rules:
 *   - Only the basename is preserved; directory separators are stripped.
 *   - Shell metacharacters are removed.
 *   - Length capped to 80 chars.
 *   - Empty / unsafe input becomes the literal string `unknown`.
 */
export function sanitizePointer(input: unknown, maxLen = 80): string {
  if (input === null || input === undefined) return 'unknown';
  let s = String(input);
  // Take only the basename — drop any directory component
  const lastSlash = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  if (lastSlash >= 0) s = s.slice(lastSlash + 1);
  // Drop shell metacharacters and control chars
  s = s.replace(/[`$();&|<>"'\r\n\t\0]/g, '');
  // Whitelist: letters, numbers, dot, underscore, hyphen, space
  s = s.replace(/[^A-Za-z0-9._\- ]/g, '_');
  s = s.trim();
  if (!s || s === '.' || s === '..') return 'unknown';
  if (s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}
