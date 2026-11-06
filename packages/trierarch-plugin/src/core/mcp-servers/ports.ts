import type { Result } from '../shared/result.js';

/**
 * Outbound port: seals a value to a trierarch's public key so that only the
 * holder of its private key opens it (decision M5): the NaCl anonymous sealed
 * box, the value as UTF-8, the public key (as `readSealingKey` read it) and
 * the sealed box as standard base64. A key no box can be sealed to, such as a
 * low-order point, is KEY_REFUSED.
 */
export interface Sealer {
  seal(value: string, publicKey: string): Promise<Result<string, { kind: 'KEY_REFUSED' }>>;
}
