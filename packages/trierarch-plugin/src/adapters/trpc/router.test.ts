import type { FleetId, ScopeName } from '@aeolus-fleet/common';
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/connection-fakes.js';
import { memoryEnabledModels } from '../../../test/support/memory-models.js';
import { createListEnabledModels } from '../../core/models/list-enabled-models.js';
import { createSetModelEnabled } from '../../core/models/set-model-enabled.js';
import { ok } from '../../core/shared/result.js';
import { trierarchPluginRouter, type Context } from './router.js';

// The models procedures (model governance, M6): reading the fleet's enabled
// models is every signed-in session's, viewer included; enabling and disabling
// take fleet:manage. Each needs the trierarch plugin to serve the fleet and be
// connected to it.

const OPUS = 'claude-opus-5-5';
const SONNET = 'claude-sonnet-5-5';
const OPERATOR: readonly ScopeName[] = ['fleet:read', 'fleet:manage'];
const VIEWER: readonly ScopeName[] = ['fleet:read'];

/** Procedures these tests never reach. */
const notReached = () => Promise.reject(new Error('not reached by the models procedures'));

let models: ReturnType<typeof memoryEnabledModels>;

beforeEach(() => {
  models = memoryEnabledModels();
});

/** The router as the console's server calls it, for a session of the given scopes, on a fleet served and connected unless it says otherwise. */
function caller(session: { kind?: 'operator' | 'viewer'; scopes: readonly ScopeName[]; isServed?: boolean; isConnected?: boolean }) {
  const context: Context = {
    cookie: 'aeolus_session=a-session',
    authenticateOperator: () => Promise.resolve(ok({ fleetId: FLEET_ID, kind: session.kind ?? 'operator', scopes: session.scopes })),
    isConnected: (fleetId: FleetId) => Promise.resolve(fleetId === FLEET_ID && (session.isConnected ?? true)),
    isServed: (fleetId: FleetId) => Promise.resolve(fleetId === FLEET_ID && (session.isServed ?? true)),
    heldConnection: notReached,
    installationTokenSent: undefined,
    installation: { mode: 'open', token: undefined },
    setFleetEnabled: notReached,
    readFleet: notReached,
    deleteFleet: notReached,
    readConnection: notReached,
    connect: notReached,
    joinMachine: notReached,
    listMachines: notReached,
    checkCrewSettings: notReached,
    listEnabledModels: createListEnabledModels({ models }),
    setModelEnabled: createSetModelEnabled({ models }),
  };
  return trierarchPluginRouter.createCaller(context);
}

/** The tRPC code a call is refused with. */
async function refusalOf(call: Promise<unknown>): Promise<string> {
  const error: unknown = await call.then(
    () => undefined,
    (refused: unknown) => refused,
  );
  return error instanceof TRPCError ? error.code : 'NOT_REFUSED';
}

describe("the fleet's enabled models over the API (model governance, M6)", () => {
  it("answers the fleet's enabled models by id to a viewer too", async () => {
    await models.enable(FLEET_ID, SONNET);
    await models.enable(FLEET_ID, OPUS);

    await expect(caller({ kind: 'viewer', scopes: VIEWER }).models.list()).resolves.toEqual([OPUS, SONNET]);
  });

  it("enables a model for an operator and answers the fleet's set", async () => {
    await expect(caller({ scopes: OPERATOR }).models.enable({ model: OPUS })).resolves.toEqual([OPUS]);
  });

  it("disables a model for an operator and answers the fleet's set", async () => {
    await models.enable(FLEET_ID, OPUS);
    await models.enable(FLEET_ID, SONNET);

    await expect(caller({ scopes: OPERATOR }).models.disable({ model: OPUS })).resolves.toEqual([SONNET]);
  });

  it('refuses a viewer enabling or disabling a model, storing nothing: FORBIDDEN', async () => {
    await models.enable(FLEET_ID, OPUS);
    const viewer = caller({ kind: 'viewer', scopes: VIEWER });

    await expect(refusalOf(viewer.models.enable({ model: SONNET }))).resolves.toBe('FORBIDDEN');
    await expect(refusalOf(viewer.models.disable({ model: OPUS }))).resolves.toBe('FORBIDDEN');
    expect(models.held.get(FLEET_ID)).toEqual([OPUS]);
  });

  it('refuses a model id common does not take as a model, storing nothing: BAD_REQUEST', async () => {
    await expect(refusalOf(caller({ scopes: OPERATOR }).models.enable({ model: 'claude opus' }))).resolves.toBe('BAD_REQUEST');
    expect(models.held.get(FLEET_ID)).toBeUndefined();
  });

  it('refuses every models procedure while the trierarch plugin is off for the fleet: FORBIDDEN', async () => {
    const off = caller({ scopes: OPERATOR, isServed: false });

    await expect(refusalOf(off.models.list())).resolves.toBe('FORBIDDEN');
    await expect(refusalOf(off.models.enable({ model: OPUS }))).resolves.toBe('FORBIDDEN');
    await expect(refusalOf(off.models.disable({ model: OPUS }))).resolves.toBe('FORBIDDEN');
    expect(models.held.get(FLEET_ID)).toBeUndefined();
  });

  it('refuses every models procedure while the trierarch plugin is not connected to the fleet: PRECONDITION_FAILED', async () => {
    const notConnected = caller({ scopes: OPERATOR, isConnected: false });

    await expect(refusalOf(notConnected.models.list())).resolves.toBe('PRECONDITION_FAILED');
    await expect(refusalOf(notConnected.models.enable({ model: OPUS }))).resolves.toBe('PRECONDITION_FAILED');
    await expect(refusalOf(notConnected.models.disable({ model: OPUS }))).resolves.toBe('PRECONDITION_FAILED');
    expect(models.held.get(FLEET_ID)).toBeUndefined();
  });
});
