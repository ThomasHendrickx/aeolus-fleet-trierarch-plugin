import type { ResolvedGuardSet } from './ports.js';

const MAX_RULE_SETS_BYTES = 64 * 1024;

export function areGuardSetsWithinLimit(sets: readonly ResolvedGuardSet[]): boolean {
  // The trierarch measures the encoded array after Go's JSON encoder escapes these characters.
  const encoded = JSON.stringify(sets).replace(/[<>&\u2028\u2029]/gu, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
  return Buffer.byteLength(encoded, 'utf8') <= MAX_RULE_SETS_BYTES;
}
