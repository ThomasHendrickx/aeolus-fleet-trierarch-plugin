import type { FleetId } from '@aeolus-fleet/common';

import type { EnabledModels } from './ports.js';

export type SetModelEnabled = (input: { fleetId: FleetId; model: string; isEnabled: boolean }) => Promise<string[]>;

/**
 * Use case: enables or disables one model for the fleet (model governance,
 * M6) and answers the fleet's enabled models by id. Already so changes
 * nothing; the next assignment pass places by the new set (M5).
 */
export function createSetModelEnabled(deps: { models: EnabledModels }): SetModelEnabled {
  return async ({ fleetId, model, isEnabled }) => {
    await (isEnabled ? deps.models.enable(fleetId, model) : deps.models.disable(fleetId, model));
    return (await deps.models.list(fleetId)).toSorted();
  };
}
