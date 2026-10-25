import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/connection-fakes.js';
import { memoryEnabledModels } from '../../../test/support/memory-models.js';
import { createSetModelEnabled } from './set-model-enabled.js';

const OPUS = 'claude-opus-5-5';
const SONNET = 'claude-sonnet-5-5';

let models: ReturnType<typeof memoryEnabledModels>;
let setModelEnabled: ReturnType<typeof createSetModelEnabled>;

beforeEach(() => {
  models = memoryEnabledModels();
  setModelEnabled = createSetModelEnabled({ models });
});

describe('enabling and disabling a model (model governance, M6)', () => {
  it("enabling a model answers the fleet's enabled models with it, by id", async () => {
    await models.enable(FLEET_ID, SONNET);

    await expect(setModelEnabled({ fleetId: FLEET_ID, model: OPUS, isEnabled: true })).resolves.toEqual([OPUS, SONNET]);
    expect(models.held.get(FLEET_ID)).toEqual([SONNET, OPUS]);
  });

  it("disabling a model answers the fleet's enabled models without it", async () => {
    await models.enable(FLEET_ID, OPUS);
    await models.enable(FLEET_ID, SONNET);

    await expect(setModelEnabled({ fleetId: FLEET_ID, model: OPUS, isEnabled: false })).resolves.toEqual([SONNET]);
  });

  it('enabling a model already enabled changes nothing', async () => {
    await models.enable(FLEET_ID, OPUS);

    await expect(setModelEnabled({ fleetId: FLEET_ID, model: OPUS, isEnabled: true })).resolves.toEqual([OPUS]);
  });

  it('disabling a model not enabled changes nothing', async () => {
    await models.enable(FLEET_ID, OPUS);

    await expect(setModelEnabled({ fleetId: FLEET_ID, model: SONNET, isEnabled: false })).resolves.toEqual([OPUS]);
  });
});
