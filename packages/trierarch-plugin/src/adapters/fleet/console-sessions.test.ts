import { createServer } from 'node:http';

import { describe, expect, it } from 'vitest';

import { COMMISSIONED_SHIP_ID, FLEET_ID, FLEET_URL, SHIP_ID, fakePluginFleet, memoryConnectionStore } from '../../../test/support/connection-fakes.js';
import { createAuthenticateOperator } from '../../core/operator/authenticate-operator.js';
import { createJoinMachine } from '../../core/machines/join-machine.js';
import { createFleetConsoleSessions } from './console-sessions.js';

const AT = new Date('2026-10-26T07:00:00.000Z');

/** A fleet answering `console.session` with a viewer session whose ship holds the given scopes. */
async function aFleetWithSessionScopes(scopes: readonly string[], run: (fleetUrl: string) => Promise<void>): Promise<void> {
  const server = createServer((_request, response) => {
    const data = { fleetId: FLEET_ID, fleetName: 'staging', expiresAt: '2026-10-27T07:00:00.000Z', kind: 'viewer', scopes };
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ result: { data } }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  try {
    await run(`http://127.0.0.1:${String(port)}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => {
        resolve();
      }));
  }
}

describe('a session holding a plugin scope', () => {
  it('joins a machine when its ship holds trierarch:join (aeolus-fleet#1258)', async () => {
    const fleet = fakePluginFleet();
    const connections = memoryConnectionStore();
    fleet.state.liveTokens.add('aeolus_ct_v1_plugin');
    await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'trierarch-plugin', crewToken: 'aeolus_ct_v1_plugin', crewedAt: AT });
    const joinMachine = createJoinMachine({ door: fleet.door, connections, keys: { next: () => 'join-1' }, fleetUrl: FLEET_URL });

    await aFleetWithSessionScopes(['fleet:read', 'trierarch:join'], async (fleetUrl) => {
      const authenticated = await createAuthenticateOperator({ sessions: createFleetConsoleSessions(fleetUrl) })('aeolus_session=viewer');
      if (!authenticated.isOk) {
        throw new Error('the session was refused');
      }
      const joined = await joinMachine({ fleetId: authenticated.value.fleetId, name: 'mac-studio', actor: { kind: authenticated.value.kind, scopes: authenticated.value.scopes } });

      expect(joined).toMatchObject({ isOk: true, value: { shipId: COMMISSIONED_SHIP_ID } });
    });
  });
});
