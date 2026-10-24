/**
 * The trusted repositories (aeolus-fleet#384): the one list, in the trierarch
 * plugin's configuration, of the repositories a trierarch may clone on demand,
 * each by the name a crew request's workspace gives it and its git URL. It is
 * true across all trierarchs. A URL never holds a credential: a clone uses the
 * access the machine holds.
 */
import { PAYLOAD_MAX_BYTES, payloadBytes, trierarchNameSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import { err, ok, type Result } from '../shared/result.js';

/** The list as read: by name, each URL one a trierarch may clone. Built only by `readTrustedRepositories`. */
export interface TrustedRepositories {
  readonly repositories: readonly { readonly name: string; readonly url: string }[];
}

/** The content type of the message that carries the list to a trierarch. */
export const TRUSTED_REPOSITORIES_CONTENT_TYPE = 'application/vnd.aeolus.trierarch.trusted-repositories+json';

const BYTES_PER_KB = 1024;

const URL_REFUSED = 'a trusted repository is an https:// or ssh URL, never a path, a file URL or a credential';

/**
 * git's scp-like ssh form, `user@host:path`. Neither user, host nor path may
 * start with `-`, which ssh would read as an option.
 */
const SCP_LIKE = /^[A-Za-z0-9_][A-Za-z0-9._-]*@[A-Za-z0-9][A-Za-z0-9.-]*:[^\s-]\S*$/;

/**
 * Whether git may clone from the URL with the machine's own access: https
 * with no user (a user there is a token), or ssh with no password and no user
 * or host that reads as an option. Never a path, a file URL or a remote helper
 * such as `ext::`, which runs a command.
 */
function isCloneable(url: string): boolean {
  if (/\s/.test(url)) {
    return false;
  }
  if (SCP_LIKE.test(url)) {
    return true;
  }
  if (!URL.canParse(url)) {
    return false;
  }
  const parsed = new URL(url);
  const hasRepository = parsed.pathname.length > 1;
  const hasSafeHost = parsed.hostname !== '' && !parsed.hostname.startsWith('-');
  if (parsed.protocol === 'https:') {
    return hasRepository && hasSafeHost && parsed.username === '' && parsed.password === '';
  }
  if (parsed.protocol === 'ssh:') {
    return hasRepository && hasSafeHost && parsed.password === '' && !decodeURIComponent(parsed.username).startsWith('-');
  }
  return false;
}

const listedSchema = z.record(z.string(), z.unknown());

/**
 * The list from the configuration's object of names to git URLs, or why not:
 * each name a trierarch name, each URL one git clones with the machine's
 * access, and the whole small enough to reach a trierarch in one message.
 */
export function readTrustedRepositories(listed: unknown): Result<TrustedRepositories, { reason: string }> {
  const object = listedSchema.safeParse(listed);
  if (!object.success || Array.isArray(listed)) {
    return err({ reason: 'the trusted repositories are an object of names to git URLs' });
  }
  const repositories: { name: string; url: string }[] = [];
  for (const [name, url] of Object.entries(object.data)) {
    const named = trierarchNameSchema.safeParse(name);
    if (!named.success) {
      return err({ reason: `${name}: ${named.error.issues[0]?.message ?? 'not a name'}` });
    }
    if (typeof url !== 'string' || !isCloneable(url)) {
      return err({ reason: `${name}: ${URL_REFUSED}` });
    }
    repositories.push({ name, url });
  }
  repositories.sort((first, second) => first.name.localeCompare(second.name));
  const list: TrustedRepositories = { repositories };
  if (payloadBytes(trustedRepositoriesPayload(list)) > PAYLOAD_MAX_BYTES) {
    return err({ reason: `the trusted repositories do not fit one message of ${String(PAYLOAD_MAX_BYTES / BYTES_PER_KB)} KB` });
  }
  return ok(list);
}

/** The list as a trierarch receives it: `{ "repositories": [{ "name", "url" }] }`. */
export function trustedRepositoriesPayload(list: TrustedRepositories): string {
  return JSON.stringify({ repositories: list.repositories });
}
