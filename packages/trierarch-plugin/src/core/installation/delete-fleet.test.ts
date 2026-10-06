import type { FleetId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { memoryFleetSwitches, memoryForgetter, memoryInstallationRequests, plainHasher } from '../../../test/support/memory-installation.js';
import { createDeleteFleet } from './delete-fleet.js';

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OTHER: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';
const AT = new Date('2026-10-04T12:00:00.000Z');

let switches: ReturnType<typeof memoryFleetSwitches>;
let requests: ReturnType<typeof memoryInstallationRequests>;
let forgetter: ReturnType<typeof memoryForgetter>;
let deleteFleet: ReturnType<typeof createDeleteFleet>;

beforeEach(async () => {
  switches = memoryFleetSwitches();
  requests = memoryInstallationRequests();
  forgetter = memoryForgetter({ switches, requests });
  deleteFleet = createDeleteFleet({ forgetter, requests, hasher: plainHasher, clock: { now: () => AT } });
  await switches.set(FLEET, { isEnabled: true, at: AT });
});

describe('deleting a fleet from the trierarch plugin', () => {
  it('forgets everything of the fleet, its switch included, and keeps a request that names nothing of it', async () => {
    await expect(deleteFleet({ requestId: 'r-1', fleetId: FLEET })).resolves.toEqual({ isOk: true, value: {} });

    expect(forgetter.forgotten).toEqual([FLEET]);
    expect(switches.held.has(FLEET)).toBe(false);
    expect(requests.held).toEqual([{ requestId: 'r-1', kind: 'deleteFleet', requestHash: plainHasher.hash(`deleteFleet ${FLEET}`), fleetId: null, isEnabled: null, at: AT }]);
  });

  it('answers a replayed request id with its first answer, forgetting nothing again', async () => {
    await deleteFleet({ requestId: 'r-1', fleetId: FLEET });

    await expect(deleteFleet({ requestId: 'r-1', fleetId: FLEET })).resolves.toEqual({ isOk: true, value: {} });
    expect(forgetter.forgotten).toEqual([FLEET]);
  });

  it('refuses a request id used for another request', async () => {
    await deleteFleet({ requestId: 'r-1', fleetId: FLEET });

    await expect(deleteFleet({ requestId: 'r-1', fleetId: OTHER })).resolves.toMatchObject({ isOk: false, error: { kind: 'REQUEST_ID_USED' } });
    expect(forgetter.forgotten).toEqual([FLEET]);
  });
});
