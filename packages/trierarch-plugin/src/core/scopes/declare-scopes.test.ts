import type { ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, SHIP_ID, fakePluginFleet, memoryConnectionStore } from '../../../test/support/connection-fakes.js';
import { createDeclareScopes } from './declare-scopes.js';

const AT = new Date('2026-10-20T12:00:00.000Z');
const OTHER_SHIP: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h4a';

let fleet: ReturnType<typeof fakePluginFleet>;
let connections: ReturnType<typeof memoryConnectionStore>;

beforeEach(async () => {
  fleet = fakePluginFleet();
  fleet.state.scopes.push('scopes:declare');
  connections = memoryConnectionStore();
  fleet.state.liveTokens.add('aeolus_ct_v1_plugin');
  await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'trierarch-plugin', crewToken: 'aeolus_ct_v1_plugin', crewedAt: AT });
});

function declare() {
  return createDeclareScopes({ door: fleet.door, connections })(FLEET_ID);
}

describe('the trierarch plugin declaring its scopes', () => {
  it('declares the namespace trierarch-plugin with trierarch-plugin:join while its ship does not hold it', async () => {
    await expect(declare()).resolves.toEqual({ isOk: true, value: { isDeclared: true } });

    expect(fleet.state.namespaces).toEqual([
      { namespace: 'trierarch-plugin', declaredBy: SHIP_ID, scopes: [{ scope: 'trierarch-plugin:join', description: 'Add a computer: join its trierarch to the fleet' }] },
    ]);
  });

  it('declares nothing once its own ship holds the namespace', async () => {
    await declare();

    await expect(declare()).resolves.toEqual({ isOk: true, value: { isDeclared: false } });
    expect(fleet.state.namespaces).toHaveLength(1);
  });

  it('declares nothing while another ship holds the namespace, and tells argo once', async () => {
    fleet.state.namespaces.push({ namespace: 'trierarch-plugin', declaredBy: OTHER_SHIP, scopes: [] });

    await expect(declare()).resolves.toEqual({ isOk: true, value: { isDeclared: false } });
    await declare();

    expect(fleet.state.namespaces).toHaveLength(1);
    expect(fleet.state.told.map((notice) => notice.text)).toEqual([
      'The trierarch plugin cannot declare its scopes: another ship holds trierarch-plugin\n\n' +
        `- The trierarch plugin's ship: trierarch-plugin\n- Held by: ${OTHER_SHIP}\n\n` +
        'Until that ship is retired, no ship holds trierarch-plugin:join, so only argo adds a computer.',
    ]);
  });

  it('is refused while its ship cannot declare scopes, as one connected before it needed scopes:declare', async () => {
    fleet.state.scopes = fleet.state.scopes.filter((scope) => scope !== 'scopes:declare');

    await expect(declare()).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE' } });
    expect(fleet.state.namespaces).toEqual([]);
  });

  it('is refused while the fleet does not answer', async () => {
    fleet.state.isAnswering = false;

    await expect(declare()).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE' } });
  });

  it('is refused while the trierarch plugin is not connected to the fleet', async () => {
    await connections.drop(FLEET_ID);

    await expect(declare()).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_CONNECTED' } });
  });
});
