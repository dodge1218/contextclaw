/**
 * 💓 ContextClaw Heartbeat Guard
 *
 * Detects stuck tool sessions (dangling tool_use IDs after gateway restarts)
 * and optionally disables the heartbeat hook until sessions reset.
 *
 * Stuck session detection:
 * - Messages with tool_use blocks but no matching tool_result within N turns
 * - tool_use IDs that repeat across assemble() calls without resolution
 * - Sessions that haven't advanced in turns despite heartbeat ticks
 */

import { toggleHook } from './config-patcher.js';

const STUCK_THRESHOLD_TURNS = 3;  // tool_use without result for this many turns = stuck
const MAX_TRACKED_SESSIONS = 50;

const sessionToolState = new Map();

/**
 * Scan messages for dangling tool_use blocks.
 * Returns list of stuck tool_use IDs.
 */
export function detectStuckTools(messages) {
  const toolUseIds = new Set();
  const toolResultIds = new Set();

  for (const msg of messages) {
    if (!msg.content) continue;
    const blocks = Array.isArray(msg.content) ? msg.content : [msg.content];

    for (const block of blocks) {
      if (!block || typeof block !== 'object') continue;

      if (block.type === 'tool_use' && block.id) {
        toolUseIds.add(block.id);
      }
      if (block.type === 'tool_result' && block.tool_use_id) {
        toolResultIds.add(block.tool_use_id);
      }
    }
  }

  // Dangling = tool_use without matching tool_result
  const dangling = [];
  for (const id of toolUseIds) {
    if (!toolResultIds.has(id)) {
      dangling.push(id);
    }
  }

  return dangling;
}

/**
 * Track session tool state across assemble() calls.
 * Returns { stuck: boolean, danglingIds: string[], turnsSinceLastAdvance: number }
 */
export function trackSession(sessionId, messages) {
  const dangling = detectStuckTools(messages);
  const now = Date.now();

  let state = sessionToolState.get(sessionId);
  if (!state) {
    state = {
      danglingIds: [],
      firstSeen: now,
      turnCount: 0,
      lastAdvanceTurn: 0,
      stuckReported: false,
    };
  }

  const prevDangling = new Set(state.danglingIds);
  const currentDangling = new Set(dangling);

  // Check if the same IDs have been dangling for multiple calls
  const persistentDangling = dangling.filter(id => prevDangling.has(id));
  state.turnCount++;

  if (persistentDangling.length === 0 && dangling.length === 0) {
    // Clean — reset
    state.danglingIds = [];
    state.lastAdvanceTurn = state.turnCount;
    state.stuckReported = false;
  } else {
    state.danglingIds = dangling;
  }

  const turnsSinceAdvance = state.turnCount - state.lastAdvanceTurn;
  const isStuck = persistentDangling.length > 0 && turnsSinceAdvance >= STUCK_THRESHOLD_TURNS;

  // Evict old sessions
  if (sessionToolState.size > MAX_TRACKED_SESSIONS) {
    const oldest = [...sessionToolState.entries()]
      .sort((a, b) => a[1].firstSeen - b[1].firstSeen);
    for (let i = 0; i < 10; i++) {
      sessionToolState.delete(oldest[i][0]);
    }
  }

  sessionToolState.set(sessionId, state);

  return {
    stuck: isStuck,
    danglingIds: dangling,
    persistentDanglingIds: persistentDangling,
    turnsSinceLastAdvance: turnsSinceAdvance,
  };
}

/**
 * If stuck tools detected, disable heartbeat hook to prevent spam.
 * Returns action taken or null.
 */
export function guardHeartbeat(sessionId, messages) {
  const result = trackSession(sessionId, messages);

  if (result.stuck) {
    const state = sessionToolState.get(sessionId);
    if (!state.stuckReported) {
      state.stuckReported = true;
      console.warn(
        `[ContextClaw] Stuck tool sessions detected in ${sessionId}: ` +
        `${result.persistentDanglingIds.length} dangling tool_use IDs for ${result.turnsSinceLastAdvance} turns. ` +
        `Consider disabling heartbeat until session resets.`
      );

      // Attempt to disable heartbeat — but don't crash if it fails
      // (the config file might be locked or the hook might not exist)
      try {
        // We don't auto-disable heartbeat by default — just warn.
        // Uncomment to auto-disable:
        // toggleHook('heartbeat', false);
        return {
          action: 'warn',
          sessionId,
          danglingIds: result.persistentDanglingIds,
          turns: result.turnsSinceLastAdvance,
          message: 'Stuck tool_use IDs detected. Heartbeat may loop.',
        };
      } catch (e) {
        console.error(`[ContextClaw] Failed to toggle heartbeat: ${e.message}`);
      }
    }
  }

  return null;
}

/**
 * Force-disable heartbeat hook via config.
 * Call this when you're sure heartbeat is causing loops.
 */
export function disableHeartbeat() {
  return toggleHook('heartbeat', false);
}

/**
 * Re-enable heartbeat hook via config.
 */
export function enableHeartbeat() {
  return toggleHook('heartbeat', true);
}

/**
 * Get current stuck session summary for telemetry.
 */
export function getStuckSessionSummary() {
  const summary = {};
  for (const [sessionId, state] of sessionToolState) {
    if (state.danglingIds.length > 0) {
      summary[sessionId] = {
        danglingCount: state.danglingIds.length,
        turnsSinceAdvance: state.turnCount - state.lastAdvanceTurn,
        stuck: state.stuckReported,
      };
    }
  }
  return summary;
}
