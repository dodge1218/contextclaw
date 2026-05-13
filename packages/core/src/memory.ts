import { writeFile, mkdir, readFile, readdir, stat, unlink } from 'fs/promises';
import { join } from 'path';
import type { ContextBlock } from './types.js';
import { buildSafeColdPath, redactPaths, sanitizeSegment } from './path-safety.js';

export class MemoryStore {
  private dir: string;
  private maxFiles: number;
  private maxAgeDays: number;

  constructor(dir: string, opts?: { maxFiles?: number; maxAgeDays?: number }) {
    this.dir = dir;
    this.maxFiles = opts?.maxFiles ?? 500;
    this.maxAgeDays = opts?.maxAgeDays ?? 7;
  }

  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  async flush(block: ContextBlock): Promise<string | null> {
    const safeId = sanitizeSegment(block.id);
    try {
      await this.init();
      // Sanitize+resolve to defeat path traversal via attacker-influenced
      // block.id (e.g. "../../etc/passwd") and add per-flush nonce so two
      // concurrent same-ms flushes can't collide.
      const path = buildSafeColdPath(this.dir, 'evicted', block.id, 'md');
      const content = [
        `# Evicted Context Block`,
        `- ID: ${safeId}`,
        `- Type: ${block.type}`,
        `- Source: ${block.source || 'unknown'}`,
        `- Score: ${block.score}`,
        `- Created: ${new Date(block.createdAt).toISOString()}`,
        `- Evicted: ${new Date().toISOString()}`,
        ``,
        `## Content`,
        block.content,
      ].join('\n');

      await writeFile(path, content, 'utf-8');

      // Rotate old evicted files to prevent unbounded accumulation
      await this.rotate();

      return path;
    } catch (err) {
      console.error(`[ContextClaw] Failed to flush block ${safeId}: ${redactPaths(err)}`);
      return null;
    }
  }

  async search(query: string, maxResults = 5): Promise<{ path: string; snippet: string; score: number }[]> {
    await this.init();
    const files = await readdir(this.dir);
    const results: { path: string; snippet: string; score: number }[] = [];
    const queryLower = query.toLowerCase();

    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      const path = join(this.dir, file);
      const content = await readFile(path, 'utf-8');
      const contentLower = content.toLowerCase();

      // Simple keyword scoring — replace with embeddings in v2
      const words = queryLower.split(/\s+/);
      const hits = words.filter(w => contentLower.includes(w)).length;
      if (hits === 0) continue;

      const score = hits / words.length;
      const idx = contentLower.indexOf(words[0]);
      const snippet = content.slice(Math.max(0, idx - 50), idx + 200);

      results.push({ path, snippet, score });
    }

    return results.sort((a, b) => b.score - a.score).slice(0, maxResults);
  }

  /**
   * Rotate old evicted files: remove files older than maxAgeDays,
   * and keep at most maxFiles (oldest first).
   */
  async rotate(): Promise<number> {
    try {
      const files = await readdir(this.dir);
      const evicted = files.filter(f => f.startsWith('evicted-') && f.endsWith('.md'));
      
      if (evicted.length <= this.maxFiles) return 0;
      
      // Get stats and sort oldest first
      const withStats = await Promise.all(
        evicted.map(async f => {
          const path = join(this.dir, f);
          try {
            const s = await stat(path);
            return { file: f, path, mtimeMs: s.mtimeMs };
          } catch {
            return null;
          }
        })
      );
      
      const valid = withStats.filter(Boolean) as { file: string; path: string; mtimeMs: number }[];
      valid.sort((a, b) => a.mtimeMs - b.mtimeMs);
      
      let removed = 0;
      const cutoff = Date.now() - (this.maxAgeDays * 86400000);
      
      for (const entry of valid) {
        // Remove if over max files OR older than maxAgeDays
        const overLimit = (valid.length - removed) > this.maxFiles;
        const expired = entry.mtimeMs < cutoff;
        
        if (overLimit || expired) {
          try {
            await unlink(entry.path);
            removed++;
          } catch {
            // ignore individual delete failures
          }
        }
      }
      
      if (removed > 0) {
        console.log(`[ContextClaw] Memory rotation: removed ${removed} old evicted files`);
      }
      return removed;
    } catch {
      return 0;
    }
  }
}
