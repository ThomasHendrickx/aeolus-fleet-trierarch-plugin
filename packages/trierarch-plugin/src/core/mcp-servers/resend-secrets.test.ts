import type { DeliveryId, ShipId } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { createResendSecrets } from './resend-secrets.js';

const MAC: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h2a';
const STUDIO: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h3a';
const MAC_KEY = `${'mac'.padEnd(43, 'A')}=`;
const DELIVERY: DeliveryId = 'dlv_01m3tbfspe96yf1rnr4ank9h5a';

const aDelivery = (contentType: string) => ({ deliveryId: DELIVERY, contentType, senderShipId: MAC, senderType: 'trierarch', payload: '{}' });

describe('a trierarch asking for the secret store again', () => {
  it('forgets what its sender was sent, so the next pass seals the store to it again', () => {
    const sealed = new Map<ShipId, string>([[MAC, MAC_KEY], [STUDIO, MAC_KEY]]);

    expect(createResendSecrets({ sealed })(aDelivery('application/vnd.aeolus.trierarch.secrets-request+json'))).toBe(true);
    expect([...sealed.keys()]).toEqual([STUDIO]);
  });

  it('leaves any other delivery to the others', () => {
    const sealed = new Map<ShipId, string>([[MAC, MAC_KEY]]);

    expect(createResendSecrets({ sealed })(aDelivery('application/vnd.aeolus.trierarch.mcp-servers-request+json'))).toBe(false);
    expect([...sealed.keys()]).toEqual([MAC]);
  });
});
