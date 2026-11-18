import { readTrustedRepositories } from './trusted-repositories.js';
import { err, ok, type Result } from '../shared/result.js';

export interface RepositoryList {
  readonly version: number;
  readonly repositories: readonly { readonly name: string; readonly url: string }[];
}

type Change = { readonly kind: 'add'; readonly name: string; readonly url: string; readonly expectedVersion: number } | { readonly kind: 'remove'; readonly name: string; readonly expectedVersion: number };

/** Validates a change against the current version before it can be stored. */
export function changeRepositoryList(current: RepositoryList, change: Change): Result<RepositoryList, { reason: string }> {
  if (change.expectedVersion !== current.version) return err({ reason: 'version conflict' });
  const existing = current.repositories.find((entry) => entry.name === change.name);
  if (change.kind === 'add' && existing && existing.url !== change.url) return err({ reason: 'name conflict' });
  if ((change.kind === 'add' && existing) || (change.kind === 'remove' && !existing)) return ok(current);
  const entries = current.repositories.filter((entry) => entry.name !== change.name);
  if (change.kind === 'add') entries.push({ name: change.name, url: change.url });
  const validated = readTrustedRepositories(Object.fromEntries(entries.map(({ name, url }) => [name, url])));
  if (!validated.isOk) return validated;
  return ok({ version: current.version + 1, repositories: validated.value.repositories });
}
