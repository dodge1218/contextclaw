/**
 * 🧠 ContextClaw Status Extension
 *
 * Reads ~/.openclaw/.contextclaw-stats.json after each turn
 * and displays lifetime savings in the TUI footer via setStatus().
 *
 * This is a proper OpenClaw extension (not a context engine plugin),
 * so it survives updates without needing to patch footer.js.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const STATS_PATH = join(homedir(), '.openclaw', '.contextclaw-stats.json');

function formatNumber(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function readStats() {
  try {
    const raw = readFileSync(STATS_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function updateStatus(ctx) {
  if (!ctx.hasUI) return;
  const stats = readStats();
  if (!stats) return;

  const saved = stats.saved || 0;
  const truncated = stats.truncated || 0;

  // Estimate $ saved: ~4 chars/token, $3/M input tokens (Claude Sonnet pricing)
  const estimatedTokensSaved = Math.floor(saved / 4);
  const dollarsSaved = (estimatedTokensSaved / 1_000_000) * 3;

  const label = `🧠 ${formatNumber(saved)} chars saved · ~$${dollarsSaved.toFixed(2)} · ${formatNumber(truncated)} truncations`;
  ctx.ui.setStatus(label);
}

/**
 * Extension factory — called by OpenClaw's extension loader.
 */
export default function(api) {
  // Update status after each turn completes
  api.on('turn_end', (_event, ctx) => {
    updateStatus(ctx);
  });

  // Also update on session start
  api.on('session_start', (_event, ctx) => {
    updateStatus(ctx);
  });
}
