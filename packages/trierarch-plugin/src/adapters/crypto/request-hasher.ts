import { createHash } from 'node:crypto';

import type { RequestHasher } from '../../core/installation/ports.js';

/** A request's text as its SHA-256, in hex: what the installation keeps instead of the request. */
export const sha256RequestHasher: RequestHasher = { hash: (text) => createHash('sha256').update(text).digest('hex') };
