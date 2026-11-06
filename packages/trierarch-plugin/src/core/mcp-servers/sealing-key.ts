import { z } from 'zod';

/** The one sealing scheme a trierarch states: the NaCl anonymous sealed box. */
const SCHEME = 'nacl-sealed-box';

/** Standard base64 with padding of exactly 32 bytes: 43 characters, the last carrying 4 bits, then one `=`. */
const PUBLIC_KEY_BASE64 = /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/;

/** The all-zero key: the identity point, which no box can be sealed to. */
const ZERO_KEY = `${'A'.repeat(43)}=`;

const detailsSchema = z.object({
  sealingKey: z.object({ scheme: z.literal(SCHEME), publicKey: z.string().regex(PUBLIC_KEY_BASE64).refine((publicKey) => publicKey !== ZERO_KEY) }),
});

/**
 * The public key a trierarch's report states for sealing its secrets to
 * (`details.sealingKey`), or undefined for a trierarch without one or with a
 * key of another scheme or shape, or the all-zero key: it is sent no secret.
 */
export function readSealingKey(details: unknown): string | undefined {
  const read = detailsSchema.safeParse(details);
  return read.success ? read.data.sealingKey.publicKey : undefined;
}
