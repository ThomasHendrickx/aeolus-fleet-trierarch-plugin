import { ENABLED_MODELS_ASK_CONTENT_TYPE, ENABLED_MODELS_CONTENT_TYPE, type ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, SHIP_ID, fakePluginFleet, memoryConnectionStore } from '../../../test/support/connection-fakes.js';
import { memoryEnabledModels } from '../../../test/support/memory-models.js';
import type { PluginCrew, PluginDelivery } from '../connection/ports.js';
import { createAnswerEnabledModelsAsks } from './answer-enabled-models-asks.js';

// R1 of the enabled models design: any ship asks the plugin's ship, which
// answers as a reply with the fleet's set, sorted, as it is when answered.

const AT = new Date('2026-11-08T08:00:00.000Z');
const ASKER: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h4a';
const ASK: PluginDelivery = {
  deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank9ask',
  messageId: 'msg_01m3tbfspe96yf1rnr4ank9ask',
  contentType: ENABLED_MODELS_ASK_CONTENT_TYPE,
  senderShipId: ASKER,
  senderType: 'implementer',
  payload: '{}',
};
const CREW: PluginCrew = { fleetId: FLEET_ID, shipId: SHIP_ID, name: 'trierarch-plugin', crewToken: 'aeolus_ct_v1_plugin', crewedAt: AT };

let fleet: ReturnType<typeof fakePluginFleet>;
let models: ReturnType<typeof memoryEnabledModels>;

beforeEach(async () => {
  fleet = fakePluginFleet();
  models = memoryEnabledModels();
  fleet.state.liveTokens.add(CREW.crewToken);
  await memoryConnectionStore().save(CREW);
});

const answer = (delivery: PluginDelivery = ASK, isServed = true) => createAnswerEnabledModelsAsks({ door: fleet.door, models, isServed: () => Promise.resolve(isServed) })(CREW, delivery);

describe('the plugin answers a ship asking for the enabled models', () => {
  it("replies to the ask with the fleet's models, sorted", async () => {
    await models.enable(FLEET_ID, 'gpt-5.5');
    await models.enable(FLEET_ID, 'claude-opus-5-5');

    await expect(answer()).resolves.toEqual({ kind: 'answered' });
    expect(fleet.state.sent).toEqual([
      {
        shipId: ASKER,
        contentType: ENABLED_MODELS_CONTENT_TYPE,
        payload: JSON.stringify({ models: ['claude-opus-5-5', 'gpt-5.5'] }),
        idempotencyKey: 'trierarch-plugin:enabled-models:msg_01m3tbfspe96yf1rnr4ank9ask',
        inReplyTo: ASK.messageId,
      },
    ]);
  });

  it('replies with an empty list when the fleet has no rule', async () => {
    await answer();

    expect(fleet.state.sent.map(({ payload }) => payload)).toEqual(['{"models":[]}']);
  });

  it('answers an ask handed again under the same key, so the fleet stores the reply once', async () => {
    await answer();
    await answer();

    expect(new Set(fleet.state.sent.map(({ idempotencyKey }) => idempotencyKey)).size).toBe(1);
  });

  it('leaves a delivery that is no ask to the rest of the ship', async () => {
    await expect(answer({ ...ASK, contentType: 'text/plain' })).resolves.toEqual({ kind: 'notAsk' });
    expect(fleet.state.sent).toEqual([]);
  });

  it('rejects when the database fails, so the ask is not acked', async () => {
    models.list = () => Promise.reject(new Error('the database does not answer'));

    await expect(answer()).rejects.toThrow('the database does not answer');
    expect(fleet.state.sent).toEqual([]);
  });

  it('leaves the ask unanswered when the fleet does not answer the reply', async () => {
    fleet.state.isAnswering = false;

    await expect(answer()).resolves.toEqual({ kind: 'refused' });
  });

  it('leaves the ask waiting for a fleet the plugin does not serve', async () => {
    await expect(answer(ASK, false)).resolves.toEqual({ kind: 'left' });
    expect(fleet.state.sent).toEqual([]);
  });
});
