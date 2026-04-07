/**
 * Shared JSONL reader — used by watcher.ts and analyzer.ts.
 * Streams line-by-line to avoid OOM on large session files.
 */

import { createReadStream, readFileSync } from 'fs';
import { createInterface } from 'readline';

/**
 * Stream JSONL file line by line. Skips blank lines and parse errors.
 */
export async function* streamJsonl(path: string): AsyncGenerator<any> {
  const rl = createInterface({
    input: createReadStream(path, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      yield JSON.parse(line);
    } catch {
      // Skip unparseable lines
      continue;
    }
  }
}

/**
 * Read entire JSONL file synchronously. Use only for small files (<1MB).
 */
export function readJsonlSync(path: string): any[] {
  const content = readFileSync(path, 'utf-8');
  const results: any[] = [];
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      results.push(JSON.parse(line));
    } catch {
      continue;
    }
  }
  return results;
}
