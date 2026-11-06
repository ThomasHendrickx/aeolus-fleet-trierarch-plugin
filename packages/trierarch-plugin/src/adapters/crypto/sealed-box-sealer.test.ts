import sodium from 'libsodium-wrappers';
import { beforeAll, describe, expect, it } from 'vitest';

import { sealedBoxSealer } from './sealed-box-sealer.js';

/** A key pair as libsodium gives it. */
interface KeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

const STANDARD_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

beforeAll(async () => {
  await sodium.ready;
});

/** A trierarch's key pair, made here as `aeolus-trierarch init` makes one. */
function aKeyPair(): { publicKey: string; pair: KeyPair } {
  const pair = sodium.crypto_box_keypair();
  return { publicKey: sodium.to_base64(pair.publicKey, sodium.base64_variants.ORIGINAL), pair };
}

function opened(sealed: string, pair: KeyPair): string {
  return sodium.to_string(sodium.crypto_box_seal_open(sodium.from_base64(sealed, sodium.base64_variants.ORIGINAL), pair.publicKey, pair.privateKey));
}

describe('sealing a value to a trierarch key', () => {
  it('seals so that the trierarch opens the value with its key pair', async () => {
    const { publicKey, pair } = aKeyPair();

    const sealed = await sealedBoxSealer.seal('Bearer test-value-é', publicKey);

    expect(opened(sealed, pair)).toBe('Bearer test-value-é');
  });

  it('gives the sealed box as standard base64 with padding, 48 bytes over the value', async () => {
    const { publicKey } = aKeyPair();

    const sealed = await sealedBoxSealer.seal('x', publicKey);

    expect(sealed).toMatch(STANDARD_BASE64);
    expect(Buffer.from(sealed, 'base64')).toHaveLength(49);
  });

  it('never holds the value readable in what it gives', async () => {
    const { publicKey } = aKeyPair();

    const sealed = await sealedBoxSealer.seal('test-value-readable', publicKey);

    expect(Buffer.from(sealed, 'base64').toString('latin1')).not.toContain('test-value-readable');
  });

  it('seals to one key only: another key pair does not open it', async () => {
    const { publicKey } = aKeyPair();
    const other = aKeyPair();

    const sealed = await sealedBoxSealer.seal('test-value', publicKey);

    expect(() => opened(sealed, other.pair)).toThrow();
  });
});
