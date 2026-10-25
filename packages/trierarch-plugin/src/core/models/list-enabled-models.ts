import type { FleetId } from '@aeolus-fleet/common';

import type { EnabledModels } from './ports.js';

export type ListEnabledModels = (fleetId: FleetId) => Promise<string[]>;

/** Use case: the fleet's enabled models by id (model governance, M6); none while the fleet has no rule. */
export function createListEnabledModels(deps: { models: EnabledModels }): ListEnabledModels {
  return async (fleetId) => (await deps.models.list(fleetId)).toSorted();
}
