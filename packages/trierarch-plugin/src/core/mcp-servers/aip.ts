/**
 * The AIP every trierarch is sent (aeolus-fleet-trierarch-plugin#63): the
 * server's URL, which holds no credential, and the secret of the store that
 * holds its token, by name. The token itself leaves only sealed, as one of the
 * secrets.
 */
import { trierarchNameSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import { err, ok, type Result } from '../shared/result.js';

export interface Aip {
  readonly server: string;
  readonly tokenSecret: string;
}

/** The content type of the message that carries the AIP to a trierarch. */
export const AIP_CONTENT_TYPE = 'application/vnd.aeolus.trierarch.aip+json';

/** Whether the URL is http(s) with no user, query or fragment, so it carries no credential. */
function isCredentialFree(url: string): boolean {
  if (!URL.canParse(url)) {
    return false;
  }
  const parsed = new URL(url);
  return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && parsed.hostname !== '' && parsed.username === '' && parsed.password === '' && parsed.search === '' && parsed.hash === '';
}

const aipSchema = z.strictObject({
  server: z.string().refine(isCredentialFree),
  tokenSecret: trierarchNameSchema,
});

/** The AIP from the configuration's `{ server, tokenSecret }`, or why not; the reason names a field, never a value. */
export function readAip(listed: unknown): Result<Aip, { reason: string }> {
  const read = aipSchema.safeParse(listed);
  if (!read.success) {
    const field = read.error.issues[0]?.path[0];
    return err({ reason: typeof field === 'string' ? `${field} is missing or not valid` : 'is { server, tokenSecret }, with a server URL that is http:// or https:// with no user, query or fragment' });
  }
  return ok({ server: read.data.server, tokenSecret: read.data.tokenSecret });
}

/** The AIP as a trierarch receives it: `{ "server", "tokenSecret" }`. */
export function aipPayload(aip: Aip): string {
  return JSON.stringify({ server: aip.server, tokenSecret: aip.tokenSecret });
}
