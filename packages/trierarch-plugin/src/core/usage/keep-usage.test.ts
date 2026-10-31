import { TRIERARCH_USAGE_CONTENT_TYPE } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/connection-fakes.js';
import { recordingUsageHistory } from '../../../test/support/memory-usage.js';
import type { PluginDelivery } from '../connection/ports.js';
import { createKeepUsage } from './keep-usage.js';

// The trierarch plugin keeps the usage its trierarchs send its ship (the usage
// design, "What the trierarch plugin stores"): from a trierarch ship and as
// common's schema, kept; anything else not handled.

const MACHINE = 'shp_01m3tbfspe96yf1rnr4ank9mac';
const SHIP = 'shp_01m3tbfspe96yf1rnr4ank9sc0';

const MESSAGE = {
  hours: [
    {
      hour: '2026-10-28T09:00:00Z',
      ships: [
        {
          shipId: SHIP,
          harness: 'claude-code',
          folderMadeAt: '2026-10-27T14:02:11Z',
          login: null,
          models: [
            { model: 'claude-opus-5-5', tokens: { input: 1200, output: 300, cacheRead: 40_000, cacheWrite: 2000 }, estimatedCostUsd: { input: 0.006, output: 0.0075, cacheRead: 0.02, cacheWrite: 0.0125 } },
            { model: 'claude-mystery-1', tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 }, estimatedCostUsd: null },
          ],
        },
      ],
    },
  ],
  subscriptions: [{ harness: 'claude-code', readAt: '2026-10-28T09:31:02Z', windows: [{ windowMinutes: 300, usedPercent: 42, resetsAt: '2026-10-28T12:00:00Z' }] }],
  readAt: '2026-10-28T10:00:40Z',
};

function aUsageDelivery(overrides: Partial<PluginDelivery> = {}): PluginDelivery {
  return {
    deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank9use',
    contentType: TRIERARCH_USAGE_CONTENT_TYPE,
    senderShipId: MACHINE,
    senderType: 'trierarch',
    payload: JSON.stringify(MESSAGE),
    ...overrides,
  };
}

describe('the trierarch plugin keeps the usage its trierarchs send', () => {
  it("keeps a trierarch's usage as its machine's: each ship's hour per model, and its subscription readings", async () => {
    const usage = recordingUsageHistory();

    await expect(createKeepUsage({ usage })(FLEET_ID, aUsageDelivery())).resolves.toEqual({ kind: 'kept' });
    const opusHour = {
      hour: new Date('2026-10-28T09:00:00Z'),
      shipId: SHIP,
      folderMadeAt: new Date('2026-10-27T14:02:11Z'),
      harness: 'claude-code',
      login: null,
    };
    expect(usage.recorded).toEqual([
      {
        fleetId: FLEET_ID,
        reading: {
          machineShipId: MACHINE,
          readAt: new Date('2026-10-28T10:00:40Z'),
          hours: [
            { ...opusHour, model: 'claude-opus-5-5', tokens: { input: 1200, output: 300, cacheRead: 40_000, cacheWrite: 2000 }, estimatedCostUsd: { input: 0.006, output: 0.0075, cacheRead: 0.02, cacheWrite: 0.0125 } },
            { ...opusHour, model: 'claude-mystery-1', tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 }, estimatedCostUsd: null },
          ],
          subscriptions: [{ harness: 'claude-code', readAt: new Date('2026-10-28T09:31:02Z'), windows: [{ windowMinutes: 300, usedPercent: 42, resetsAt: new Date('2026-10-28T12:00:00Z') }] }],
        },
      },
    ]);
  });

  it('keeps the login a trierarch names for a ship', async () => {
    const usage = recordingUsageHistory();
    const named = { ...MESSAGE, hours: [{ ...MESSAGE.hours[0], ships: [{ ...MESSAGE.hours[0]?.ships[0], login: 'apiKey' }] }] };

    await createKeepUsage({ usage })(FLEET_ID, aUsageDelivery({ payload: JSON.stringify(named) }));

    expect(usage.recorded[0]?.reading.hours.map((hour) => hour.login)).toEqual(['apiKey', 'apiKey']);
  });

  it('does not handle usage from a ship that is not a trierarch, and keeps none of it', async () => {
    const usage = recordingUsageHistory();

    await expect(createKeepUsage({ usage })(FLEET_ID, aUsageDelivery({ senderType: 'agent' }))).resolves.toEqual({ kind: 'notHandled', reason: 'its sender is not a trierarch ship' });
    expect(usage.recorded).toEqual([]);
  });

  it('does not handle usage that is not JSON', async () => {
    const usage = recordingUsageHistory();

    await expect(createKeepUsage({ usage })(FLEET_ID, aUsageDelivery({ payload: '{"hours": [' }))).resolves.toMatchObject({ kind: 'notHandled' });
    expect(usage.recorded).toEqual([]);
  });

  it("does not handle usage that is not common's usage message", async () => {
    const usage = recordingUsageHistory();
    const offHour = { ...MESSAGE, hours: [{ ...MESSAGE.hours[0], hour: '2026-10-28T09:30:00Z' }] };

    await expect(createKeepUsage({ usage })(FLEET_ID, aUsageDelivery({ payload: JSON.stringify(offHour) }))).resolves.toMatchObject({ kind: 'notHandled' });
    expect(usage.recorded).toEqual([]);
  });

  it('leaves any other message to the rest of the ship', async () => {
    const usage = recordingUsageHistory();

    await expect(createKeepUsage({ usage })(FLEET_ID, aUsageDelivery({ contentType: 'application/vnd.aeolus.answer+json' }))).resolves.toEqual({ kind: 'notUsage' });
    expect(usage.recorded).toEqual([]);
  });
});
