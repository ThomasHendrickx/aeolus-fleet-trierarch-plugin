import type { FleetId } from '@aeolus-fleet/common';

import type { EnabledModels } from '../../src/core/models/ports.js';

/** Each fleet's enabled models in memory, in the order they were enabled. */
export function memoryEnabledModels(): EnabledModels & { held: Map<FleetId, string[]> } {
  const held = new Map<FleetId, string[]>();
  return {
    held,
    list: (fleetId) => Promise.resolve([...(held.get(fleetId) ?? [])]),
    enable: (fleetId, model) => {
      const models = held.get(fleetId) ?? [];
      held.set(fleetId, models.includes(model) ? models : [...models, model]);
      return Promise.resolve();
    },
    disable: (fleetId, model) => {
      held.set(
        fleetId,
        (held.get(fleetId) ?? []).filter((each) => each !== model),
      );
      return Promise.resolve();
    },
  };
}
