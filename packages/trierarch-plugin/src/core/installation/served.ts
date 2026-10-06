import type { FleetId } from '@aeolus-fleet/common';

import type { FleetSwitches, InstallationMode } from './ports.js';

/** Whether the trierarch plugin serves the fleet now: off, it does nothing for that fleet. */
export type IsServed = (fleetId: FleetId) => Promise<boolean>;

/**
 * Policy: the trierarch plugin serves every fleet of an open installation, and a fleet of
 * an enabled one only once the hosting service switched it on (decision 0021).
 */
export function createIsServed(deps: { installation: InstallationMode; switches: FleetSwitches }): IsServed {
  return async (fleetId) => deps.installation === 'open' || (await deps.switches.find(fleetId)) === true;
}
