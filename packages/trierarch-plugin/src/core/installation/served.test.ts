import type { FleetId } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { memoryFleetSwitches } from '../../../test/support/memory-installation.js';
import { createIsServed } from './served.js';

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const AT = new Date('2026-10-04T12:00:00.000Z');

describe('whether the trierarch plugin serves a fleet', () => {
  it('serves every fleet in an open installation, one with no installation token: a self-hosted trierarch plugin sees no switch', async () => {
    const switches = memoryFleetSwitches();
    await switches.set(FLEET, { isEnabled: false, at: AT });

    await expect(createIsServed({ installation: 'open', switches })(FLEET)).resolves.toBe(true);
  });

  it('serves a fleet of an enabled installation only once it was turned on: off until then', async () => {
    const switches = memoryFleetSwitches();
    const isServed = createIsServed({ installation: 'enabled', switches });

    await expect(isServed(FLEET)).resolves.toBe(false);
    await switches.set(FLEET, { isEnabled: true, at: AT });
    await expect(isServed(FLEET)).resolves.toBe(true);
    await switches.set(FLEET, { isEnabled: false, at: AT });
    await expect(isServed(FLEET)).resolves.toBe(false);
  });
});
