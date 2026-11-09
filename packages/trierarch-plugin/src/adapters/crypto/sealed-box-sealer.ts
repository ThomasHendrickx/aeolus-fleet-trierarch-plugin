import sodium from 'libsodium-wrappers';

import type { Sealer } from '../../core/mcp-configuration/ports.js';
import { err, ok } from '../../core/shared/result.js';

/**
 * The NaCl anonymous sealed box (`crypto_box_seal`: X25519 and
 * XSalsa20-Poly1305 with a fresh ephemeral key per value), as a trierarch
 * opens it with `box.OpenAnonymous`. Keys and sealed boxes are standard base64
 * with padding. libsodium refuses a low-order key by throwing; that is the
 * key's fault, not the system's, so it is KEY_REFUSED.
 */
export const sealedBoxSealer: Sealer = {
  seal: async (value, publicKey) => {
    await sodium.ready;
    let sealed: Uint8Array;
    try {
      sealed = sodium.crypto_box_seal(sodium.from_string(value), sodium.from_base64(publicKey, sodium.base64_variants.ORIGINAL));
    } catch {
      return err({ kind: 'KEY_REFUSED' });
    }
    return ok(sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL));
  },
};
