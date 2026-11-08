import type { DeliveryId, ShipId } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { createResendAip } from './resend-aip.js';

const MAC: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h2a';
const STUDIO: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h3a';
const DELIVERY: DeliveryId = 'dlv_01m3tbfspe96yf1rnr4ank9h2a';
const ASK = 'application/vnd.aeolus.trierarch.mcp-servers-request+json';

describe('a trierarch asking for the MCP servers again', () => {
  it('has the next pass send it the AIP again too', () => {
    const shared = new Set<ShipId>([MAC, STUDIO]);

    expect(createResendAip({ shared })({ deliveryId: DELIVERY, contentType: ASK, senderShipId: MAC, senderType: 'trierarch', payload: '{}' })).toBe(true);

    expect([...shared]).toEqual([STUDIO]);
  });

  it('leaves the AIP as sent for any other message', () => {
    const shared = new Set<ShipId>([MAC]);

    expect(createResendAip({ shared })({ deliveryId: DELIVERY, contentType: 'text/plain', senderShipId: MAC, senderType: 'trierarch', payload: '{}' })).toBe(false);

    expect([...shared]).toEqual([MAC]);
  });
});
