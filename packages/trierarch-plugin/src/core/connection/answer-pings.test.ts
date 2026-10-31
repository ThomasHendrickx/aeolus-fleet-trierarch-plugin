import { TRIERARCH_USAGE_CONTENT_TYPE, type DeliveryId } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { FLEET_ID, memoryConnectionStore, SHIP_ID } from '../../../test/support/connection-fakes.js';
import { recordingUsageHistory } from '../../../test/support/memory-usage.js';
import { err, ok } from '../shared/result.js';
import type { UsageHistory } from '../usage/ports.js';
import { createKeepUsage } from '../usage/keep-usage.js';
import { createAnswerPings } from './answer-pings.js';
import type { PluginDelivery, PluginInbox } from './ports.js';

// The trierarch plugin's ship answers argo's ping with pong, as any crewed
// ship does (blueprint, "Ping"; aeolus-fleet#1113), and acks what else reaches
// it: it handles no messages of its own, and the fleet keeps them in its history.

const PING: PluginDelivery = { deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank9png', contentType: 'application/vnd.aeolus.ping', senderShipId: 'shp_01m3tbfspe96yf1rnr4ank9arg', senderType: 'operator', payload: '' };
const USAGE: PluginDelivery = {
  deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank9use',
  contentType: TRIERARCH_USAGE_CONTENT_TYPE,
  senderShipId: 'shp_01m3tbfspe96yf1rnr4ank9mac',
  senderType: 'trierarch',
  payload: JSON.stringify({ hours: [], subscriptions: [{ harness: 'codex', readAt: '2026-10-28T09:31:02Z', windows: [{ windowMinutes: 300, usedPercent: 42, resetsAt: '2026-10-28T12:00:00Z' }] }], readAt: '2026-10-28T10:00:40Z' }),
};
const ANSWER: PluginDelivery = { deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank9ans', contentType: 'application/vnd.aeolus.answer+json', senderShipId: 'shp_01m3tbfspe96yf1rnr4ank9chr', senderType: 'agent', payload: '{}' };

function anInbox(waiting: PluginDelivery[] | 'refused', onAck: () => void = () => undefined): PluginInbox & { ponged: DeliveryId[]; acked: DeliveryId[] } {
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
      onAck();
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

/** Answering pings with the usage kept in the history given. */
function answerPings(deps: { connections: Awaited<ReturnType<typeof connected>>; inbox: PluginInbox; usage?: UsageHistory }) {
  return createAnswerPings({ connections: deps.connections, inbox: deps.inbox, keepUsage: createKeepUsage({ usage: deps.usage ?? recordingUsageHistory() }) });
}

describe("the trierarch plugin's ship takes what waits for it", () => {
  it("answers argo's ping with pong, never an ack", async () => {
    const inbox = anInbox([PING]);

    await expect(answerPings({ connections: await connected(), inbox })()).resolves.toEqual({ ponged: 1, acked: [], keptUsage: 0, notHandled: [], refused: 0 });
    expect({ ponged: inbox.ponged, acked: inbox.acked }).toEqual({ ponged: [PING.deliveryId], acked: [] });
  });

  it('acks any other delivery, saying which it was', async () => {
    const inbox = anInbox([ANSWER]);

    await expect(answerPings({ connections: await connected(), inbox })()).resolves.toEqual({ ponged: 0, acked: [ANSWER], keptUsage: 0, notHandled: [], refused: 0 });
    expect(inbox.acked).toEqual([ANSWER.deliveryId]);
  });

  it('counts a fleet that does not answer, and takes nothing there', async () => {
    const inbox = anInbox('refused');

    await expect(answerPings({ connections: await connected(), inbox })()).resolves.toEqual({ ponged: 0, acked: [], keptUsage: 0, notHandled: [], refused: 1 });
  });

  it('takes nothing for a fleet it is not connected to', async () => {
    const inbox = anInbox([PING]);

    await expect(answerPings({ connections: memoryConnectionStore(), inbox })()).resolves.toEqual({ ponged: 0, acked: [], keptUsage: 0, notHandled: [], refused: 0 });
    expect(inbox.ponged).toEqual([]);
  });

  it("keeps a trierarch's usage before it acks the delivery", async () => {
    const usage = recordingUsageHistory();
    const keptAtAck: number[] = [];
    const inbox = anInbox([USAGE], () => keptAtAck.push(usage.recorded.length));

    await expect(answerPings({ connections: await connected(), inbox, usage })()).resolves.toEqual({ ponged: 0, acked: [], keptUsage: 1, notHandled: [], refused: 0 });
    expect({ acked: inbox.acked, keptAtAck }).toEqual({ acked: [USAGE.deliveryId], keptAtAck: [1] });
  });

  it('leaves usage it could not store unacked, so the fleet hands it again', async () => {
    const usage: UsageHistory = { ...recordingUsageHistory(), record: () => Promise.reject(new Error('the database does not answer')) };
    const inbox = anInbox([USAGE]);

    await expect(answerPings({ connections: await connected(), inbox, usage })()).resolves.toEqual({ ponged: 0, acked: [], keptUsage: 0, notHandled: [], refused: 1 });
    expect(inbox.acked).toEqual([]);
  });

  it('acks usage from a ship that is not a trierarch as not handled, saying why', async () => {
    const usage = recordingUsageHistory();
    const fromAgent = { ...USAGE, senderType: 'agent' };
    const inbox = anInbox([fromAgent]);

    await expect(answerPings({ connections: await connected(), inbox, usage })()).resolves.toEqual({
      ponged: 0,
      acked: [],
      keptUsage: 0,
      notHandled: [{ delivery: fromAgent, reason: 'its sender is not a trierarch ship' }],
      refused: 0,
    });
    expect({ acked: inbox.acked, recorded: usage.recorded }).toEqual({ acked: [USAGE.deliveryId], recorded: [] });
  });
});
