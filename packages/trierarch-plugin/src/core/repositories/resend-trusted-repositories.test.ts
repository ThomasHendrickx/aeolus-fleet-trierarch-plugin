import type { DeliveryId, ShipId } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { createResendTrustedRepositories } from './resend-trusted-repositories.js';

const MAC: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h2a';
const STUDIO: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h3a';
const DELIVERY: DeliveryId = 'dlv_01m3tbfspe96yf1rnr4ank9h2a';
const ASK = 'application/vnd.aeolus.trierarch.trusted-repositories-request+json';

describe('a trierarch asking for the trusted repositories again', () => {
  it('has the next pass send them to the trierarch that asks, as to one never sent them', () => {
    const shared = new Set<ShipId>([MAC, STUDIO]);

    expect(createResendTrustedRepositories({ shared })({ deliveryId: DELIVERY, contentType: ASK, senderShipId: MAC })).toBe(true);

    expect([...shared]).toEqual([STUDIO]);
  });

  it('leaves the list as sent for any other message', () => {
    const shared = new Set<ShipId>([MAC]);

    expect(createResendTrustedRepositories({ shared })({ deliveryId: DELIVERY, contentType: 'text/plain', senderShipId: MAC })).toBe(false);

    expect([...shared]).toEqual([MAC]);
  });
});
