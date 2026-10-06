import type { FleetId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { memoryFleetSwitches, memoryInstallationRequests, plainHasher } from '../../../test/support/memory-installation.js';
import { createSetFleetEnabled } from './set-fleet-enabled.js';

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const AT = new Date('2026-10-04T12:00:00.000Z');

let switches: ReturnType<typeof memoryFleetSwitches>;
let requests: ReturnType<typeof memoryInstallationRequests>;
let setEnabled: ReturnType<typeof createSetFleetEnabled>;

beforeEach(() => {
  switches = memoryFleetSwitches();
  requests = memoryInstallationRequests();
  setEnabled = createSetFleetEnabled({ switches, requests, hasher: plainHasher, clock: { now: () => AT } });
});

describe("switching the trierarch plugin on or off for a fleet", () => {
  it('turns it on, and off again', async () => {
    await expect(setEnabled({ requestId: 'r-1', fleetId: FLEET, isEnabled: true })).resolves.toEqual({ isOk: true, value: { fleetId: FLEET, isEnabled: true } });
    expect(switches.held.get(FLEET)).toBe(true);

    await expect(setEnabled({ requestId: 'r-2', fleetId: FLEET, isEnabled: false })).resolves.toEqual({ isOk: true, value: { fleetId: FLEET, isEnabled: false } });
    expect(switches.held.get(FLEET)).toBe(false);
  });

  it('answers a replayed request id with its first answer, and changes nothing again', async () => {
    await setEnabled({ requestId: 'r-1', fleetId: FLEET, isEnabled: true });
    await setEnabled({ requestId: 'r-2', fleetId: FLEET, isEnabled: false });

    await expect(setEnabled({ requestId: 'r-1', fleetId: FLEET, isEnabled: true })).resolves.toEqual({ isOk: true, value: { fleetId: FLEET, isEnabled: true } });
    expect(switches.held.get(FLEET)).toBe(false);
  });

  it('refuses a request id used for another request', async () => {
    await setEnabled({ requestId: 'r-1', fleetId: FLEET, isEnabled: true });

    await expect(setEnabled({ requestId: 'r-1', fleetId: FLEET, isEnabled: false })).resolves.toMatchObject({ isOk: false, error: { kind: 'REQUEST_ID_USED' } });
    expect(switches.held.get(FLEET)).toBe(true);
  });
});
