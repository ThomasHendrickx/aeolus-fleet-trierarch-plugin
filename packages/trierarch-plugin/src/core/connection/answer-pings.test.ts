import type { DeliveryId } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { FLEET_ID, memoryConnectionStore, SHIP_ID } from '../../../test/support/connection-fakes.js';
import { err, ok } from '../shared/result.js';
import { createAnswerPings } from './answer-pings.js';
import type { PluginDelivery, PluginInbox } from './ports.js';

// The trierarch plugin's ship answers argo's ping with pong, as any crewed
// ship does (blueprint, "Ping"; aeolus-fleet#1113), and acks what else reaches
// it: it handles no messages of its own, and the fleet keeps them in its history.

const PING: PluginDelivery = { deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank9png', contentType: 'application/vnd.aeolus.ping', senderShipId: 'shp_01m3tbfspe96yf1rnr4ank9arg' };
const ANSWER: PluginDelivery = { deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank9ans', contentType: 'application/vnd.aeolus.answer+json', senderShipId: 'shp_01m3tbfspe96yf1rnr4ank9chr' };

function anInbox(waiting: PluginDelivery[] | 'refused'): PluginInbox & { ponged: DeliveryId[]; acked: DeliveryId[] } {
  const ponged: DeliveryId[] = [];
  const acked: DeliveryId[] = [];
  return {
    ponged,
    acked,
    receive: () => Promise.resolve(waiting === 'refused' ? err({ code: 'UNAVAILABLE', message: 'The fleet did not answer' }) : ok(waiting.splice(0))),
    pong: (_crewToken, deliveryId) => {
      ponged.push(deliveryId);
      return Promise.resolve(ok(undefined));
    },
    ack: (_crewToken, deliveryId) => {
      acked.push(deliveryId);
      return Promise.resolve(ok(undefined));
    },
  };
}

async function connected() {
  const connections = memoryConnectionStore();
  await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'trierarch-plugin', crewToken: 'aeolus_ct_v1_plugin', crewedAt: new Date('2026-10-22T10:00:00Z') });
  return connections;
}

describe("the trierarch plugin's ship takes what waits for it", () => {
  it("answers argo's ping with pong, never an ack", async () => {
    const inbox = anInbox([PING]);

    await expect(createAnswerPings({ connections: await connected(), inbox })()).resolves.toEqual({ ponged: 1, acked: [], refused: 0 });
    expect({ ponged: inbox.ponged, acked: inbox.acked }).toEqual({ ponged: [PING.deliveryId], acked: [] });
  });

  it('acks any other delivery, saying which it was', async () => {
    const inbox = anInbox([ANSWER]);

    await expect(createAnswerPings({ connections: await connected(), inbox })()).resolves.toEqual({ ponged: 0, acked: [ANSWER], refused: 0 });
    expect(inbox.acked).toEqual([ANSWER.deliveryId]);
  });

  it('counts a fleet that does not answer, and takes nothing there', async () => {
    const inbox = anInbox('refused');

    await expect(createAnswerPings({ connections: await connected(), inbox })()).resolves.toEqual({ ponged: 0, acked: [], refused: 1 });
  });

  it('takes nothing for a fleet it is not connected to', async () => {
    const inbox = anInbox([PING]);

    await expect(createAnswerPings({ connections: memoryConnectionStore(), inbox })()).resolves.toEqual({ ponged: 0, acked: [], refused: 0 });
    expect(inbox.ponged).toEqual([]);
  });
});
