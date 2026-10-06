import { randomUUID } from 'node:crypto';

import type { IdempotencyKeys } from '../../core/machines/ports.js';

/** A random UUID per commission: never the same twice. */
export const randomIdempotencyKeys: IdempotencyKeys = { next: () => randomUUID() };
