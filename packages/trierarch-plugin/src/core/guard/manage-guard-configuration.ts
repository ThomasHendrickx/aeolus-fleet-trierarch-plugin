/** Serializes each fleet's replacements and updates. */
import type { FleetId } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { replaceGuardConfiguration, type GuardReplacement } from './guard-configuration.js';
import type { GuardCatalogue, GuardCatalogueRead, GuardConfiguration, GuardConfigurations } from './ports.js';

export const GUARD_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

export interface ManageGuardConfiguration {
  get(fleetId: FleetId): Promise<GuardCatalogue>;
  readForAssignment(fleetId: FleetId): Promise<GuardCatalogueRead>;
  refresh(fleetId: FleetId): Promise<GuardCatalogue>;
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
  const readCatalogue = async (fleetId: FleetId, isUpdate: boolean): Promise<GuardCatalogueRead> => {
    const configuration = await deps.configurations.readConfiguration(fleetId);
    const input = { version: configuration.version, repositories: configuration.repositories, floor: configuration.floor };
    return isUpdate ? deps.refresh(fleetId, input) : deps.read(fleetId, input);
  };
  return {
    get: async (fleetId) => (await exclusive(fleetId, () => readCatalogue(fleetId, false))).catalogue,
    readForAssignment: (fleetId) => exclusive(fleetId, () => readCatalogue(fleetId, false)),
    refresh: async (fleetId) => (await exclusive(fleetId, () => readCatalogue(fleetId, true))).catalogue,
    replace: (fleetId, replacement) => exclusive(fleetId, async () => {
      const current = await deps.configurations.readConfiguration(fleetId);
      const changed = replaceGuardConfiguration(current, replacement);
      if (!changed.isOk) { return changed; }
      const saved = await deps.configurations.replace(fleetId, { expectedVersion: current.version, configuration: changed.value });
      if (saved === 'conflict') { return refuse('VERSION_CONFLICT', 'The guard configuration changed: read it again before replacing it'); }
      await readCatalogue(fleetId, true);
      return ok({ version: changed.value.version });
    }),
  };
}
