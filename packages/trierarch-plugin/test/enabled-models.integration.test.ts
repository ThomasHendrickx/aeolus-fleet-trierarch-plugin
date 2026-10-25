import type { FleetId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaEnabledModels } from '../src/adapters/prisma/enabled-models.js';
import { createPrismaFleetForgetter } from '../src/adapters/prisma/fleet-forgetter.js';
import { createPrismaFleetSwitches } from '../src/adapters/prisma/fleet-switches.js';
import { createPluginDatabase } from '../src/testing/database.js';

// The fleet's enabled models in the trierarch plugin's own database (model
// governance, M2): the table enabled_models, one row per fleet and model id.

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OTHER: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';
const OPUS = 'claude-opus-5-5';
const SONNET = 'claude-sonnet-5-5';
const AT = new Date('2026-10-25T10:00:00.000Z');

let db: PrismaClient;

beforeEach(async () => {
  db = createPrismaClient(await createPluginDatabase());
});

afterEach(async () => {
  await db.$disconnect();
});

describe("the fleet's enabled models in Postgres", () => {
  it("keeps each fleet's enabled models apart: a fleet reads only its own", async () => {
    const models = createPrismaEnabledModels(db);
    await models.enable(FLEET, OPUS);
    await models.enable(OTHER, SONNET);

    await expect(models.list(FLEET)).resolves.toEqual([OPUS]);
    await expect(models.list(OTHER)).resolves.toEqual([SONNET]);
  });

  it('keeps one row per model id: enabling an enabled id changes nothing, and so does disabling one not held', async () => {
    const models = createPrismaEnabledModels(db);
    await models.enable(FLEET, OPUS);
    await models.enable(FLEET, OPUS);
    await models.disable(FLEET, SONNET);

    await expect(db.$queryRaw`SELECT fleet_id, model FROM enabled_models`).resolves.toEqual([{ fleet_id: FLEET, model: OPUS }]);
  });

  it('disables a model by deleting its row, leaving the fleet no rule once the last goes', async () => {
    const models = createPrismaEnabledModels(db);
    await models.enable(FLEET, OPUS);

    await models.disable(FLEET, OPUS);

    await expect(models.list(FLEET)).resolves.toEqual([]);
  });

  it('stores one row when two enable the same model at once, neither failing', async () => {
    const models = createPrismaEnabledModels(db);

    await Promise.all([models.enable(FLEET, OPUS), models.enable(FLEET, OPUS)]);

    await expect(models.list(FLEET)).resolves.toEqual([OPUS]);
  });

  it("forgets a fleet's enabled models with its switch when the fleet is deleted, keeping another fleet's", async () => {
    const models = createPrismaEnabledModels(db);
    await createPrismaFleetSwitches(db).set(FLEET, { isEnabled: true, at: AT });
    await models.enable(FLEET, OPUS);
    await models.enable(OTHER, OPUS);

    await createPrismaFleetForgetter(db).forget(FLEET);

    await expect(models.list(FLEET)).resolves.toEqual([]);
    await expect(createPrismaFleetSwitches(db).find(FLEET)).resolves.toBeUndefined();
    await expect(models.list(OTHER)).resolves.toEqual([OPUS]);
  });

  it('keeps them when the trierarch plugin is switched off for the fleet', async () => {
    const models = createPrismaEnabledModels(db);
    await models.enable(FLEET, OPUS);

    await createPrismaFleetSwitches(db).set(FLEET, { isEnabled: false, at: AT });

    await expect(models.list(FLEET)).resolves.toEqual([OPUS]);
  });
});
