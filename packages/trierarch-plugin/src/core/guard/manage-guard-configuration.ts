/** Serializes each fleet's replacements and updates. */
import type { FleetId } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { replaceGuardConfiguration, type GuardReplacement } from './guard-configuration.js';
import type { GuardCatalogue, GuardCatalogueRead, GuardConfiguration, GuardConfigurations } from './ports.js';

export interface ManageGuardConfiguration {
  get(fleetId: FleetId): Promise<GuardCatalogue>;
  readForAssignment(fleetId: FleetId): Promise<GuardCatalogueRead>;
  update(fleetId: FleetId, repository?: string): Promise<Result<GuardCatalogue, DomainError<'NOT_FOUND'>>>;
  replace(fleetId: FleetId, replacement: GuardReplacement): Promise<Result<{ version: number }, DomainError<'VERSION_CONFLICT' | 'INVALID_CONFIGURATION'>>>;
}

export function createManageGuardConfiguration(deps: {
  configurations: GuardConfigurations;
  read: (fleetId: FleetId, configuration: GuardConfiguration) => Promise<GuardCatalogueRead>;
  refresh: (fleetId: FleetId, configuration: GuardConfiguration) => Promise<GuardCatalogueRead>;
}): ManageGuardConfiguration {
  const pending = new Map<FleetId, Promise<void>>();
  const exclusive = async <T>(fleetId: FleetId, work: () => Promise<T>): Promise<T> => {
    const previous = pending.get(fleetId);
    let unlock = () => { /* replaced by the queued turn's resolver */ };
    const next = new Promise<void>((resolve) => { unlock = resolve; });
    pending.set(fleetId, next);
    await previous;
    try {
      return await work();
    } finally {
      unlock();
      if (pending.get(fleetId) === next) { pending.delete(fleetId); }
    }
  };
  const readCatalogue = async (fleetId: FleetId): Promise<GuardCatalogueRead> => {
    const configuration = await deps.configurations.readConfiguration(fleetId);
    const input = { version: configuration.version, repositories: configuration.repositories, floor: configuration.floor };
    return deps.read(fleetId, input);
  };
  return {
    get: async (fleetId) => (await exclusive(fleetId, () => readCatalogue(fleetId))).catalogue,
    readForAssignment: (fleetId) => exclusive(fleetId, () => readCatalogue(fleetId)),
    update: (fleetId, repository) => exclusive(fleetId, async () => {
      const configuration = await deps.configurations.readConfiguration(fleetId);
      const repositories = repository === undefined ? configuration.repositories : configuration.repositories.filter((item) => item.repository === repository);
      if (repository !== undefined && repositories.length === 0) { return refuse('NOT_FOUND', 'The guard repository is not configured'); }
      const read = await deps.refresh(fleetId, { version: configuration.version, repositories, floor: configuration.floor });
      const stored = await deps.read(fleetId, { version: configuration.version, repositories: configuration.repositories, floor: configuration.floor });
      return ok({ ...stored.catalogue, errors: [...stored.catalogue.errors, ...read.catalogue.errors.filter((error) => error.file === undefined)] });
    }),
    replace: (fleetId, replacement) => exclusive(fleetId, async () => {
      const current = await deps.configurations.readConfiguration(fleetId);
      const changed = replaceGuardConfiguration(current, replacement);
      if (!changed.isOk) { return changed; }
      const saved = await deps.configurations.replace(fleetId, { expectedVersion: current.version, configuration: changed.value });
      if (saved === 'conflict') { return refuse('VERSION_CONFLICT', 'The guard configuration changed: read it again before replacing it'); }
      const repositories = changed.value.repositories.filter((repository) => !current.repositories.some((old) => old.repository === repository.repository && old.folder === repository.folder));
      if (repositories.length > 0) {
        await deps.refresh(fleetId, { version: changed.value.version, repositories, floor: changed.value.floor });
      }
      return ok({ version: changed.value.version });
    }),
  };
}
