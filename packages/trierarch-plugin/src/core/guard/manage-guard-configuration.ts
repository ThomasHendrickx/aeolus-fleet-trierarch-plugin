/** Serializes each fleet's replacements and refreshes; catalogue reads have a five-minute staleness bound. */
import type { FleetId } from '@aeolus-fleet/common';

import type { Clock } from '../shared/clock.js';
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
  clock: Clock;
  refresh: (fleetId: FleetId, configuration: GuardConfiguration) => Promise<GuardCatalogueRead>;
}): ManageGuardConfiguration {
  const catalogues = new Map<FleetId, { at: number; read: GuardCatalogueRead }>();
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
  const readCatalogue = async (fleetId: FleetId, canUseCache: boolean): Promise<GuardCatalogueRead> => {
    const configuration = await deps.configurations.readConfiguration(fleetId);
    const cached = catalogues.get(fleetId);
    if (canUseCache && cached?.read.catalogue.version === configuration.version && deps.clock.now().getTime() - cached.at < GUARD_REFRESH_INTERVAL_MS) {
      return cached.read;
    }
    const read = await deps.refresh(fleetId, { version: configuration.version, repositories: configuration.repositories, floor: configuration.floor });
    catalogues.set(fleetId, { at: deps.clock.now().getTime(), read });
    return read;
  };
  return {
    get: async (fleetId) => (await exclusive(fleetId, () => readCatalogue(fleetId, true))).catalogue,
    readForAssignment: (fleetId) => exclusive(fleetId, () => readCatalogue(fleetId, true)),
    refresh: async (fleetId) => (await exclusive(fleetId, () => readCatalogue(fleetId, false))).catalogue,
    replace: (fleetId, replacement) => exclusive(fleetId, async () => {
      const current = await deps.configurations.readConfiguration(fleetId);
      const changed = replaceGuardConfiguration(current, replacement);
      if (!changed.isOk) { return changed; }
      const saved = await deps.configurations.replace(fleetId, { expectedVersion: current.version, configuration: changed.value });
      if (saved === 'conflict') { return refuse('VERSION_CONFLICT', 'The guard configuration changed: read it again before replacing it'); }
      await readCatalogue(fleetId, false);
      return ok({ version: changed.value.version });
    }),
  };
}
