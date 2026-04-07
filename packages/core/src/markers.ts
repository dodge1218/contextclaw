/**
 * Truncation markers with random nonces to prevent spoofing.
 */

import { randomUUID } from 'crypto';

const MARKER_PATTERN = /\[ContextClaw:TRUNCATED:([a-f0-9]{8}):(\d+)\]/;

/**
 * Generate a truncation marker with a random nonce.
 * Format: [ContextClaw:TRUNCATED:<nonce>:<originalTokens>]
 */
export function generateTruncationMarker(originalTokens: number): string {
  const nonce = randomUUID().slice(0, 8);
  return `[ContextClaw:TRUNCATED:${nonce}:${originalTokens}]`;
}

/**
 * Verify a truncation marker matches the expected pattern.
 * Returns the parsed nonce and original token count, or null if invalid.
 */
export function verifyMarker(text: string): { nonce: string; originalTokens: number } | null {
  const match = text.match(MARKER_PATTERN);
  if (!match) return null;
  return {
    nonce: match[1],
    originalTokens: parseInt(match[2], 10),
  };
}

/**
 * Check if a string contains any truncation markers.
 */
export function containsMarker(text: string): boolean {
  return MARKER_PATTERN.test(text);
}
