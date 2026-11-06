import sodium from 'libsodium-wrappers';

import type { Sealer } from '../../core/mcp-servers/ports.js';

/**
 * The NaCl anonymous sealed box (`crypto_box_seal`: X25519 and
 * XSalsa20-Poly1305 with a fresh ephemeral key per value), as a trierarch
 * opens it with `box.OpenAnonymous`. Keys and sealed boxes are standard base64
 * with padding.
 */
export const sealedBoxSealer: Sealer = {
  seal: async (value, publicKey) => {
    await sodium.ready;
    const sealed = sodium.crypto_box_seal(sodium.from_string(value), sodium.from_base64(publicKey, sodium.base64_variants.ORIGINAL));
    return sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL);
  },
};
