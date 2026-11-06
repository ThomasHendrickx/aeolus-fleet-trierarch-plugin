/**
 * Outbound port: seals a value to a trierarch's public key so that only the
 * holder of its private key opens it (decision M5): the NaCl anonymous sealed
 * box, the value as UTF-8, the public key (as `readSealingKey` read it) and
 * the sealed box as standard base64.
 */
export interface Sealer {
  seal(value: string, publicKey: string): Promise<string>;
}
