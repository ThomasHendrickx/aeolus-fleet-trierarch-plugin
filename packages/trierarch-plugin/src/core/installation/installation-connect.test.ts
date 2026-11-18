import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, OTHER_FLEET_ID, SHIP_ID, OTHER_ASSIGNEE, fakePluginFleet, memoryConnectionStore } from '../../../test/support/connection-fakes.js';
import { memoryInstallationRequests, plainHasher } from '../../../test/support/memory-installation.js';
import { createConnect } from '../connection/connect.js';
import { createDeclareScopes } from '../scopes/declare-scopes.js';
import { createInstallationConnect } from './installation-connect.js';

const AT = new Date('2026-11-18T12:00:00Z');
const INPUT = { requestId: 'connect-one', fleetId: FLEET_ID, shipId: SHIP_ID, secret: 'aeolus_sk_v1_good' };
let fleet: ReturnType<typeof fakePluginFleet>;
let store: ReturnType<typeof memoryConnectionStore>;
let requests: ReturnType<typeof memoryInstallationRequests>;
let isEnabled: boolean;

function connect() {
  return createInstallationConnect({ requests, hasher: plainHasher, clock: { now: () => AT }, isServed: () => Promise.resolve(isEnabled), connect: createConnect({ door: fleet.door, store, clock: { now: () => AT }, declareScopes: createDeclareScopes({ door: fleet.door, connections: store }) }) });
}

beforeEach(() => {
  fleet = fakePluginFleet();
  store = memoryConnectionStore();
  requests = memoryInstallationRequests();
  isEnabled = true;
});

describe('installation hand-over', () => {
  it('records only operation, fleet and ship, then replays without registering even after recreating the use case', async () => {
    await expect(connect()(INPUT)).resolves.toEqual({ isOk: true, value: { isEnabled: true, isConnected: true } });
    expect(requests.held).toEqual([{ requestId: 'connect-one', kind: 'connect', requestHash: `hash(connect ${FLEET_ID} ${SHIP_ID})`, fleetId: FLEET_ID, isEnabled: null, at: AT }]);
    await store.drop(FLEET_ID);
    await expect(connect()({ ...INPUT, secret: 'a-fresh-secret' })).resolves.toEqual({ isOk: true, value: { isEnabled: true, isConnected: true } });
    expect(fleet.state.registers).toBe(1);
  });

  it('checks off before replay and retains the connection over off/on', async () => {
    await connect()(INPUT);
    isEnabled = false;
    await expect(connect()(INPUT)).resolves.toMatchObject({ isOk: false, error: { kind: 'OFF' } });
    await expect(store.find(FLEET_ID)).resolves.toMatchObject({ shipId: SHIP_ID });
    isEnabled = true;
    await expect(connect()(INPUT)).resolves.toMatchObject({ isOk: true });
    expect(fleet.state.registers).toBe(1);
  });

  it.each([{ fleetId: OTHER_FLEET_ID }, { shipId: OTHER_ASSIGNEE }])('refuses a request id reused for another fleet or ship: %j', async (change) => {
    await connect()(INPUT);
    await expect(connect()({ ...INPUT, ...change })).resolves.toMatchObject({ isOk: false, error: { kind: 'REQUEST_ID_USED' } });
    expect(fleet.state.registers).toBe(1);
  });

  it.each(['setEnabled', 'deleteFleet'] as const)('refuses an id used by %s', async (kind) => {
    await requests.record({ requestId: INPUT.requestId, kind, requestHash: 'another-operation', fleetId: FLEET_ID, isEnabled: null, at: AT });
    await expect(connect()(INPUT)).resolves.toMatchObject({ isOk: false, error: { kind: 'REQUEST_ID_USED' } });
    expect(fleet.state.registers).toBe(0);
  });

  it('records no refusal and accepts a fresh secret with the same id', async () => {
    await expect(connect()({ ...INPUT, secret: 'wrong' })).resolves.toMatchObject({ isOk: false, error: { kind: 'SECRET_REFUSED' } });
    expect(requests.held).toEqual([]);
    await expect(connect()(INPUT)).resolves.toMatchObject({ isOk: true });
  });

  it('refuses another fleet and releases its crew without a receipt or connection', async () => {
    fleet.state.fleetId = OTHER_FLEET_ID;
    await expect(connect()(INPUT)).resolves.toMatchObject({ isOk: false, error: { kind: 'OTHER_FLEET' } });
    expect(requests.held).toEqual([]);
    expect(store.held.size).toBe(0);
    expect(fleet.state.liveTokens.size).toBe(0);
  });

  it.each(['fleet:read', 'fleet:commission', 'crew:assign', 'crew:run'])('requires %s and releases refused crew', async (scope) => {
    fleet.state.scopes = fleet.state.scopes.filter((held) => held !== scope);
    await expect(connect()(INPUT)).resolves.toMatchObject({ isOk: false, error: { kind: 'MISSING_SCOPES' } });
    expect(requests.held).toEqual([]);
    expect(store.held.size).toBe(0);
    expect(fleet.state.liveTokens.size).toBe(0);
  });

  it('retains one connection during concurrent hand-overs', async () => {
    const handOver = connect();
    const answers = await Promise.all([handOver(INPUT), handOver({ ...INPUT, requestId: 'connect-two' })]);
    expect(answers.filter((answer) => answer.isOk)).toHaveLength(1);
    expect(store.held.size).toBe(1);
    expect(fleet.state.liveTokens.size).toBe(1);
    expect(requests.held).toHaveLength(1);
  });

  it('preserves already connected instead of recording another success', async () => {
    await connect()(INPUT);
    await expect(connect()({ ...INPUT, requestId: 'connect-two' })).resolves.toMatchObject({ isOk: false, error: { kind: 'ALREADY_CONNECTED' } });
    expect(requests.held).toHaveLength(1);
  });

  it('saves before declaring scopes and retains the connection for a later declaration retry', async () => {
    await expect(connect()(INPUT)).resolves.toMatchObject({ isOk: true });
    expect(fleet.state.namespaces).toEqual([]);
    await expect(store.find(FLEET_ID)).resolves.toMatchObject({ shipId: SHIP_ID });
    fleet.state.scopes.push('scopes:declare');
    await createDeclareScopes({ door: fleet.door, connections: store })(FLEET_ID);
    expect(fleet.state.namespaces.map((entry) => entry.namespace)).toEqual(['trierarch']);
  });
});
