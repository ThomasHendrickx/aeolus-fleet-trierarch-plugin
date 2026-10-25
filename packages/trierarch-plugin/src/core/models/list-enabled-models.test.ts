import type { FleetId } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/connection-fakes.js';
import { memoryEnabledModels } from '../../../test/support/memory-models.js';
import { createListEnabledModels } from './list-enabled-models.js';

const OTHER: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';

describe("reading the fleet's enabled models (model governance, M1, M6)", () => {
  it('answers none for a fleet that enabled no model: no rule', async () => {
    await expect(createListEnabledModels({ models: memoryEnabledModels() })(FLEET_ID)).resolves.toEqual([]);
  });

  it("answers the fleet's enabled models by id, never another fleet's", async () => {
    const models = memoryEnabledModels();
    await models.enable(FLEET_ID, 'claude-sonnet-5-5');
    await models.enable(FLEET_ID, 'claude-opus-5-5');
    await models.enable(OTHER, 'gpt-6');

    await expect(createListEnabledModels({ models })(FLEET_ID)).resolves.toEqual(['claude-opus-5-5', 'claude-sonnet-5-5']);
  });
});
