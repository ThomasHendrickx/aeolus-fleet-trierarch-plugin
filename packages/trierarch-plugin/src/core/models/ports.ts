import type { FleetId } from '@aeolus-fleet/common';

/**
 * Outbound port: each fleet's enabled models (model governance, M1, M2), the
 * exact model ids its agent ships may be crewed with; none is no rule.
 * Enabling an enabled id or disabling one not held changes nothing.
 */
export interface EnabledModels {
  list(fleetId: FleetId): Promise<string[]>;
  enable(fleetId: FleetId, model: string): Promise<void>;
  disable(fleetId: FleetId, model: string): Promise<void>;
}
