import type { FleetId } from '@aeolus-fleet/common';

import type { UsageReading } from './usage-reading.js';

/**
 * Outbound port: each fleet's usage history (0030, the usage design). Recording
 * a reading keeps, per hour row, the newest reading of it, so a reading handed
 * again or arriving late changes nothing; each subscription reading is kept once.
 */
export interface UsageHistory {
  record(fleetId: FleetId, reading: UsageReading): Promise<void>;
}
