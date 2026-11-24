/** A fleet's versioned guard configuration. Tokens are retained by repository and never enter catalogue metadata. */
import { trierarchNameSchema } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { GuardConfiguration } from './ports.js';

export interface StoredGuardConfiguration extends GuardConfiguration {
  readonly secrets: readonly { readonly name: string; readonly value: string }[];
}

export interface GuardReplacement extends Omit<GuardConfiguration, 'version'> {
  readonly expectedVersion: number;
  readonly secrets: readonly string[];
  readonly secretValues: Readonly<Record<string, string>>;
}

export const EMPTY_GUARD_CONFIGURATION: StoredGuardConfiguration = { version: 0, repositories: [], floor: [], secrets: [] };
const TOKEN_MAX_BYTES = 8192;
const invalid = () => refuse('INVALID_CONFIGURATION', 'Invalid guard configuration: repositories, floor and retained private tokens must be valid and unique');

/** Whole replacement: an unavailable floor name remains configured; placement resolves it separately. */
export function replaceGuardConfiguration(current: StoredGuardConfiguration, replacement: GuardReplacement): Result<StoredGuardConfiguration, DomainError<'VERSION_CONFLICT' | 'INVALID_CONFIGURATION'>> {
  if (current.version !== replacement.expectedVersion) {
    return refuse('VERSION_CONFLICT', 'The guard configuration changed: read it again before replacing it');
  }
  const repositories = replacement.repositories;
  if (new Set(repositories.map(({ repository }) => repository)).size !== repositories.length || repositories.some(({ repository, folder, access }) =>
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || folder.startsWith('/') || folder.includes('\\') || folder.split('/').includes('..') || !['public', 'private'].includes(access))) {
    return invalid();
  }
  if (new Set(replacement.floor).size !== replacement.floor.length || replacement.floor.some((name) => !trierarchNameSchema.safeParse(name).success)) {
    return invalid();
  }
  const privateNames = repositories.filter(({ access }) => access === 'private').map(({ repository }) => repository);
  if (new Set(replacement.secrets).size !== replacement.secrets.length || privateNames.length !== replacement.secrets.length || replacement.secrets.some((name) => !privateNames.includes(name)) || Object.keys(replacement.secretValues).some((name) => !replacement.secrets.includes(name))) {
    return invalid();
  }
  const secrets: { name: string; value: string }[] = [];
  for (const name of replacement.secrets) {
    const value = Object.hasOwn(replacement.secretValues, name) ? replacement.secretValues[name] : current.secrets.find((secret) => secret.name === name)?.value;
    if (value === undefined || Buffer.byteLength(value, 'utf8') < 1 || Buffer.byteLength(value, 'utf8') > TOKEN_MAX_BYTES || ['\r', '\n', '\u0000'].some((character) => value.includes(character))) {
      return invalid();
    }
    secrets.push({ name, value });
  }
  return ok({ version: current.version + 1, repositories: repositories.map(({ repository, folder, access }) => ({ repository, folder, access })), floor: [...replacement.floor], secrets });
}
