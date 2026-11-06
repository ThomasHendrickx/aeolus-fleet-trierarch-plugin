import type { ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import type { ListedShip } from '../connection/ports.js';
import { FLEET_ID, SHIP_ID, fakePluginFleet, memoryConnectionStore } from '../../../test/support/connection-fakes.js';
import { readMcpServers } from './mcp-servers.js';
import { err, ok } from '../shared/result.js';
import { readSecrets, type Secrets } from './secrets.js';
import { createShareSecrets } from './share-secrets.js';

const AT = new Date('2026-11-06T08:00:00.000Z');
const MAC: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h2a';
const STUDIO: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h3a';
const SCOUT: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h4a';
const CONTENT_TYPE = 'application/vnd.aeolus.trierarch.secrets+json';
/** Public keys shaped as the scheme's (32 bytes as base64), plainly not real ones. */
const MAC_KEY = `${'mac'.padEnd(43, 'A')}=`;
const STUDIO_KEY = `${'studio'.padEnd(43, 'A')}=`;
const NEW_MAC_KEY = `${'macnew'.padEnd(43, 'A')}=`;

let fleet: ReturnType<typeof fakePluginFleet>;
let connections: ReturnType<typeof memoryConnectionStore>;
let keys: number;

beforeEach(async () => {
  fleet = fakePluginFleet();
  connections = memoryConnectionStore();
  keys = 0;
  fleet.state.liveTokens.add('aeolus_ct_v1_plugin');
  await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'trierarch-plugin', crewToken: 'aeolus_ct_v1_plugin', crewedAt: AT });
});

function aShip(shipId: ShipId, at: { type?: string; status?: ListedShip['status']; sealingKey?: unknown } = {}): void {
  fleet.state.ships.push({ shipId, name: shipId, type: at.type ?? 'trierarch', status: at.status ?? 'crewed', lastSeenAt: AT, model: null, crewRequest: null, labels: [] });
  if ('sealingKey' in at) {
    fleet.state.reports.set(shipId, { state: 'idle', note: null, reportedAt: AT, details: { sealingKey: at.sealingKey } });
  }
}

const sealedTo = (publicKey: string) => ({ scheme: 'nacl-sealed-box', publicKey });

function aStore(listed: Record<string, string>): Secrets {
  const servers = readMcpServers({});
  const read = readSecrets(listed, servers.isOk ? servers.value : { servers: [] });
  return read.isOk ? read.value : { secrets: [] };
}

const STORE = aStore({ 'graph-token': 'test-value-one', atlas: 'test-value-two' });

/** A key the sealer refuses, as libsodium refuses a low-order point. */
const REFUSED_KEY = `${'refused'.padEnd(43, 'A')}=`;

/** A sealer that shows what it sealed to which key, as only a test may, and refuses REFUSED_KEY. */
const sealer = {
  seal: (value: string, publicKey: string) =>
    Promise.resolve(publicKey === REFUSED_KEY ? err({ kind: 'KEY_REFUSED' as const }) : ok(`sealed(${value})to(${publicKey.slice(0, 6)})`)),
};

const shareWith = (sealed: Map<ShipId, string>, store: Secrets = STORE) =>
  createShareSecrets({ door: fleet.door, connections, keys: { next: () => `key-${String(keys++)}` }, secrets: store, sealer, sealed });
const share = (store?: Secrets) => shareWith(new Map(), store)(FLEET_ID);

describe('sharing the secret store with the trierarchs', () => {
  it('sends every trierarch that states a key the whole store sealed to that key', async () => {
    aShip(MAC, { sealingKey: sealedTo(MAC_KEY) });
    aShip(STUDIO, { sealingKey: sealedTo(STUDIO_KEY) });

    await expect(share()).resolves.toEqual({ isOk: true, value: { shared: 2, unsealable: [] } });
    expect(fleet.state.sent).toEqual([
      {
        shipId: MAC,
        contentType: CONTENT_TYPE,
        payload: `{"publicKey":"${MAC_KEY}","secrets":[{"name":"atlas","sealed":"sealed(test-value-two)to(macAAA)"},{"name":"graph-token","sealed":"sealed(test-value-one)to(macAAA)"}]}`,
        idempotencyKey: 'key-0',
      },
      {
        shipId: STUDIO,
        contentType: CONTENT_TYPE,
        payload: `{"publicKey":"${STUDIO_KEY}","secrets":[{"name":"atlas","sealed":"sealed(test-value-two)to(studio)"},{"name":"graph-token","sealed":"sealed(test-value-one)to(studio)"}]}`,
        idempotencyKey: 'key-1',
      },
    ]);
  });

  it('sends an empty store too, so a trierarch forgets what left it', async () => {
    aShip(MAC, { sealingKey: sealedTo(MAC_KEY) });

    await share(aStore({}));

    expect(fleet.state.sent.map((each) => each.payload)).toEqual([`{"publicKey":"${MAC_KEY}","secrets":[]}`]);
  });

  it.each([
    ['no report', undefined],
    ['no key', null],
    ['a scheme it does not know', { scheme: 'rsa-oaep', publicKey: MAC_KEY }],
    ['a key that is not base64', sealedTo(`${'mac!'.padEnd(43, 'A')}=`)],
    ['a key that is not 32 bytes', sealedTo('bWFj')],
    ['the all-zero key', sealedTo(`${'A'.repeat(43)}=`)],
  ])('sends nothing to a trierarch whose report states %s', async (_label, sealingKey) => {
    aShip(MAC, sealingKey === undefined ? {} : { sealingKey });

    await expect(share()).resolves.toEqual({ isOk: true, value: { shared: 0, unsealable: [] } });
    expect(fleet.state.sent).toEqual([]);
  });

  it('sends a trierarch the store once across passes while its key stays', async () => {
    aShip(MAC, { sealingKey: sealedTo(MAC_KEY) });
    const sealed = new Map<ShipId, string>();

    await shareWith(sealed)(FLEET_ID);
    await expect(shareWith(sealed)(FLEET_ID)).resolves.toEqual({ isOk: true, value: { shared: 0, unsealable: [] } });

    expect(fleet.state.sent).toHaveLength(1);
  });

  it('sends a trierarch the store again, sealed to its new key, when its report states another key', async () => {
    aShip(MAC, { sealingKey: sealedTo(MAC_KEY) });
    const sealed = new Map<ShipId, string>();
    await shareWith(sealed)(FLEET_ID);
    fleet.state.reports.set(MAC, { state: 'idle', note: null, reportedAt: AT, details: { sealingKey: sealedTo(NEW_MAC_KEY) } });

    await shareWith(sealed)(FLEET_ID);

    expect(fleet.state.sent.map((each) => each.payload.slice(0, '{"publicKey":"'.length + MAC_KEY.length + 1))).toEqual([`{"publicKey":"${MAC_KEY}"`, `{"publicKey":"${NEW_MAC_KEY}"`]);
  });

  it('sends a trierarch that states its key later the store on the next pass', async () => {
    aShip(MAC);
    const sealed = new Map<ShipId, string>();
    await shareWith(sealed)(FLEET_ID);
    fleet.state.reports.set(MAC, { state: 'idle', note: null, reportedAt: AT, details: { sealingKey: sealedTo(MAC_KEY) } });

    await shareWith(sealed)(FLEET_ID);

    expect(fleet.state.sent.map((each) => each.shipId)).toEqual([MAC]);
  });

  it('sends every trierarch the store again after a restart of the trierarch plugin, under a new key', async () => {
    aShip(MAC, { sealingKey: sealedTo(MAC_KEY) });

    await share();
    await share();

    expect(fleet.state.sent.map((each) => each.idempotencyKey)).toEqual(['key-0', 'key-1']);
  });

  it('sends nothing to a retired trierarch or a ship of another type', async () => {
    aShip(MAC, { status: 'retired', sealingKey: sealedTo(MAC_KEY) });
    aShip(SCOUT, { type: 'implementer', sealingKey: sealedTo(STUDIO_KEY) });

    await share();

    expect(fleet.state.sent).toEqual([]);
  });

  it('sends a trierarch whose send was refused the store again on the next pass, and the others meanwhile', async () => {
    aShip(MAC, { sealingKey: sealedTo(MAC_KEY) });
    aShip(STUDIO, { sealingKey: sealedTo(STUDIO_KEY) });
    fleet.state.refusingSends.add(MAC);
    const sealed = new Map<ShipId, string>();

    await expect(shareWith(sealed)(FLEET_ID)).resolves.toEqual({ isOk: true, value: { shared: 1, unsealable: [] } });
    fleet.state.refusingSends.clear();
    await shareWith(sealed)(FLEET_ID);

    expect(fleet.state.sent.map((each) => each.shipId)).toEqual([STUDIO, MAC]);
  });

  it('sends nothing to a trierarch whose key the sealer refuses, names it with its key, and goes on to the others', async () => {
    aShip(MAC, { sealingKey: sealedTo(REFUSED_KEY) });
    aShip(STUDIO, { sealingKey: sealedTo(STUDIO_KEY) });

    await expect(share()).resolves.toEqual({ isOk: true, value: { shared: 1, unsealable: [{ shipId: MAC, publicKey: REFUSED_KEY }] } });
    expect(fleet.state.sent.map((each) => each.shipId)).toEqual([STUDIO]);
  });

  it('tries a trierarch whose key the sealer refused again on the next pass', async () => {
    aShip(MAC, { sealingKey: sealedTo(REFUSED_KEY) });
    const sealed = new Map<ShipId, string>();

    await shareWith(sealed)(FLEET_ID);

    await expect(shareWith(sealed)(FLEET_ID)).resolves.toEqual({ isOk: true, value: { shared: 0, unsealable: [{ shipId: MAC, publicKey: REFUSED_KEY }] } });
  });

  it('refuses while the trierarch plugin is not connected to the fleet', async () => {
    await connections.drop(FLEET_ID);

    await expect(share()).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_CONNECTED' } });
  });

  it('refuses while the fleet does not answer', async () => {
    aShip(MAC, { sealingKey: sealedTo(MAC_KEY) });
    fleet.state.isAnswering = false;

    await expect(share()).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE' } });
  });

  it('never puts a value in a refusal', async () => {
    aShip(MAC, { sealingKey: sealedTo(MAC_KEY) });
    fleet.state.isAnswering = false;

    const shared = await share();

    expect(JSON.stringify(shared)).not.toContain('test-value');
  });
});
