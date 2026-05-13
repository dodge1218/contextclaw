/**
 * Security regression tests for the 8 PRD Section 7.2 findings.
 *
 * Each `it` validates one finding: a vulnerable input is rejected /
 * sanitized AND a legitimate input still works.
 *
 * Findings 1, 2 (path traversal), 3 (DoS via sync reads), 7 (collision),
 * 8 (info leakage) are the core-side coverage; findings 4 (ReDoS),
 * 5 (marker spoof), 6 (pointer extraction) sit on the plugin side and
 * are exercised by the plugin Node test suite (`plugin/__tests__/security.test.js`).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { rm, writeFile, mkdir, readdir } from 'fs/promises';
import { dirname, sep } from 'path';
import { homedir } from 'os';
import { MemoryStore } from '../memory.js';
import { SessionWatcher } from '../watcher.js';
import {
  buildSafeColdPath,
  redactPaths,
  sanitizePointer,
  sanitizeSegment,
  safeJoin,
} from '../path-safety.js';
import type { ContextBlock } from '../types.js';

const TEST_BASE = '/tmp/contextclaw-security-test';

function makeBlock(id: string): ContextBlock {
  return {
    id,
    type: 'user',
    content: 'fixture',
    tokens: 7,
    createdAt: Date.now(),
    lastReferencedAt: Date.now(),
    score: 0.5,
    pinned: false,
    evictable: false,
  };
}

describe('Finding 1 — HIGH path traversal in memory.ts flush()', () => {
  const dir = `${TEST_BASE}/finding-1`;

  beforeEach(async () => {
    await mkdir(dir, { recursive: true });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('rejects traversal in block.id — output stays under cold-storage dir', async () => {
    const store = new MemoryStore(dir);
    const malicious = makeBlock('../../etc/passwd');
    const path = await store.flush(malicious);
    expect(path).not.toBeNull();
    // Resolved path must live under the configured dir
    expect(path!.startsWith(dir + sep)).toBe(true);
    // Filename portion may retain literal `.` chars, but must not
    // contain a real path separator that would relocate the file.
    const tail = path!.slice(dir.length + 1);
    expect(tail.includes('/')).toBe(false);
    expect(tail.includes('\\')).toBe(false);
    // The literal target outside base must not appear.
    expect(path!).not.toMatch(/\/etc\/passwd/);
  });

  it('rejects absolute paths in block.id', async () => {
    const store = new MemoryStore(dir);
    const malicious = makeBlock('/tmp/contextclaw-PWN');
    const path = await store.flush(malicious);
    expect(path).not.toBeNull();
    expect(path!.startsWith(dir)).toBe(true);
    // The literal target should not exist outside the dir
    expect(path!).not.toContain('/tmp/contextclaw-PWN');
  });

  it('legitimate ids still flush successfully', async () => {
    const store = new MemoryStore(dir);
    const ok = makeBlock('block-abc-123');
    const path = await store.flush(ok);
    expect(path).not.toBeNull();
    expect(path!.startsWith(dir)).toBe(true);
    const files = await readdir(dir);
    expect(files.length).toBeGreaterThan(0);
  });
});

describe('Finding 2 — HIGH path traversal in watcher.ts flushToColdStorage()', () => {
  const dir = `${TEST_BASE}/finding-2`;

  beforeEach(async () => {
    await mkdir(dir, { recursive: true });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('rejects traversal in label parameter', async () => {
    const w = new SessionWatcher({ coldStorageDir: dir });
    const path = await w.flushToColdStorage('content', '../../tmp/PWN');
    expect(path.startsWith(dir + sep)).toBe(true);
    expect(path).not.toContain('/tmp/PWN');
  });

  it('rejects path-separator characters in label', async () => {
    const w = new SessionWatcher({ coldStorageDir: dir });
    const path = await w.flushToColdStorage('content', 'foo/bar/baz');
    expect(path.startsWith(dir + sep)).toBe(true);
    // Slashes are replaced with `_`
    expect(path).not.toMatch(/foo\/bar\/baz/);
  });

  it('legitimate labels still flush', async () => {
    const w = new SessionWatcher({ coldStorageDir: dir });
    const path = await w.flushToColdStorage('content', 'session-summary');
    expect(path.startsWith(dir + sep)).toBe(true);
    expect(path).toContain('session-summary');
  });
});

describe('Finding 3 — HIGH DoS via large session parses', () => {
  const dir = `${TEST_BASE}/finding-3`;

  beforeEach(async () => {
    await mkdir(dir, { recursive: true });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('rejects oversized session files when allowLargeSession=false', async () => {
    const path = `${dir}/big.jsonl`;
    // Write a payload larger than the configured tiny ceiling
    const payload =
      Array.from({ length: 200 })
        .map(() => JSON.stringify({ type: 'message', message: { role: 'user', content: 'x' } }))
        .join('\n') + '\n';
    await writeFile(path, payload);
    const w = new SessionWatcher({ maxSessionBytes: 100, allowLargeSession: false });
    await expect(w.parseSessionAsync(path)).rejects.toThrow(/exceeds limit/);
  });

  it('respects allowLargeSession opt-in', async () => {
    const path = `${dir}/big-ok.jsonl`;
    const payload =
      Array.from({ length: 5 })
        .map(() => JSON.stringify({ type: 'message', message: { role: 'user', content: 'x' } }))
        .join('\n') + '\n';
    await writeFile(path, payload);
    const w = new SessionWatcher({ maxSessionBytes: 10, allowLargeSession: true });
    const turns = await w.parseSessionAsync(path);
    expect(turns.length).toBe(5);
  });

  it('parses ordinary sessions normally', async () => {
    const path = `${dir}/normal.jsonl`;
    await writeFile(
      path,
      JSON.stringify({ type: 'message', message: { role: 'user', content: 'hello' } }) + '\n',
    );
    const w = new SessionWatcher();
    const turns = await w.parseSessionAsync(path);
    expect(turns.length).toBe(1);
    expect(turns[0].role).toBe('user');
  });
});

describe('Finding 7 — LOW filename collision under same-ms flush', () => {
  const dir = `${TEST_BASE}/finding-7`;

  beforeEach(async () => {
    await mkdir(dir, { recursive: true });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('two same-id flushes in the same ms produce distinct files', async () => {
    const store = new MemoryStore(dir);
    const id = 'collision-test';
    const [a, b] = await Promise.all([
      store.flush(makeBlock(id)),
      store.flush(makeBlock(id)),
    ]);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a).not.toBe(b);
    // Verify both files actually exist on disk (no overwrite)
    const files = (await readdir(dir)).filter(f => f.endsWith('.md'));
    expect(files.length).toBe(2);
  });
});

describe('Finding 8 — LOW info leakage via console.error / log emission', () => {
  it('redactPaths replaces homedir absolute paths with <home>', () => {
    const home = homedir();
    const sample = `boom at ${home}/secret/file.ts:123 — failed`;
    const redacted = redactPaths(sample);
    expect(redacted).not.toContain(home);
    expect(redacted).toContain('<home>');
  });

  it('redactPaths replaces non-home absolute POSIX paths', () => {
    const sample = '/etc/passwd /var/log/auth.log /usr/local/bin/x';
    const redacted = redactPaths(sample);
    expect(redacted).not.toContain('/etc/passwd');
    expect(redacted).not.toContain('/var/log/auth.log');
    // Replacement marker must be present
    expect(redacted).toContain('<abs-path>');
  });

  it('redactPaths handles Error instances safely', () => {
    const err = new Error(`failed at ${homedir()}/x.ts`);
    const redacted = redactPaths(err);
    expect(redacted).not.toContain(homedir());
    expect(redacted).toContain('<home>');
  });

  it('redactPaths handles undefined/null safely', () => {
    expect(redactPaths(undefined)).toBe('');
    expect(redactPaths(null)).toBe('');
  });
});

describe('path-safety helpers — direct unit coverage', () => {
  it('sanitizeSegment strips path separators and meta chars', () => {
    // Path separators become `_`; the segment is no longer traversable
    // even though it may retain literal `.` characters (those alone
    // can't traverse without a separator).
    const sanitized = sanitizeSegment('../../passwd');
    expect(sanitized).not.toMatch(/[\/\\]/);
    expect(sanitized.endsWith('passwd')).toBe(true);
    expect(sanitizeSegment('foo/bar')).toBe('foo_bar');
    expect(sanitizeSegment('a$b;c|d`e')).toBe('a_b_c_d_e');
    expect(sanitizeSegment('legit-id_v1.0')).toBe('legit-id_v1.0');
  });

  it('sanitizeSegment refuses bare dots', () => {
    expect(sanitizeSegment('.')).toBe('_');
    expect(sanitizeSegment('..')).toBe('_');
    expect(sanitizeSegment('')).toBe('unknown');
    expect(sanitizeSegment(null)).toBe('unknown');
  });

  it('safeJoin throws on traversal even after sanitization slip', () => {
    expect(() => safeJoin('/tmp/x', '../../etc/passwd')).toThrow(/path traversal/);
    expect(() => safeJoin('/tmp/x', '/absolute/escape')).toThrow(/path traversal/);
  });

  it('safeJoin accepts a clean child filename', () => {
    const out = safeJoin('/tmp/contextclaw-test-x', 'evicted-abc.md');
    expect(out.endsWith('evicted-abc.md')).toBe(true);
  });

  it('buildSafeColdPath always produces a path under baseDir', () => {
    const baseDir = '/tmp/cc-build-test';
    const out = buildSafeColdPath(baseDir, 'evicted', '../../escape', 'md');
    expect(out.startsWith(baseDir + sep)).toBe(true);
    // Path is asserted-anchored under baseDir so even though the
    // sanitized filename may retain literal `.` chars, no traversal
    // segment ever appears as a real path component.
    const tail = out.slice(baseDir.length + 1);
    expect(tail.includes('/')).toBe(false);
    expect(tail.includes('\\')).toBe(false);
  });

  it('sanitizePointer drops directory components and shell meta', () => {
    expect(sanitizePointer('/etc/passwd')).toBe('passwd');
    // basename of `foo\`rm -rf /\`bar` is `\`bar` -> strip backticks -> `bar`
    const out = sanitizePointer('foo`rm -rf /`bar');
    expect(out).toBe('bar');
    expect(out.includes('rm -rf')).toBe(false);
    expect(sanitizePointer('a/b/c/screenshot.png')).toBe('screenshot.png');
    expect(sanitizePointer('')).toBe('unknown');
    expect(sanitizePointer(null)).toBe('unknown');
    // No-dirs payload with shell meta inline
    const evil = 'foo`whoami`bar.png';
    expect(sanitizePointer(evil)).toBe('foowhoamibar.png');
  });
});
