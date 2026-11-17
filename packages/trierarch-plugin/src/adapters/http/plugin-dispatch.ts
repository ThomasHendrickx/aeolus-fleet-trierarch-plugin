import { pluginCallContextSchema, type FleetId, type ShipId } from '@aeolus-fleet/common';
import { createPluginBoundary, type PluginDispatchReservations } from '@aeolus-fleet/common/plugin-server';

type Options = Parameters<typeof createPluginBoundary>[0];
interface DispatchOptions {
  secrets: readonly string[];
  now(): Date;
  connected(fleetId: FleetId): Promise<ShipId | undefined>;
  isServed(fleetId: FleetId): Promise<boolean>;
  reservations: PluginDispatchReservations;
  procedures: Options['procedures'];
}

/** Binds each dispatch to the plugin ship currently connected to its fleet. */
export function createPluginDispatch(options: DispatchOptions) {
  return async (body: unknown, secret: string | undefined) => {
    const parsed = pluginCallContextSchema.safeParse(body);
    const preliminary = createPluginBoundary({ ...options, pluginShipId: parsed.success ? parsed.data.pluginShipId : 'shp_invalid', serves: () => Promise.resolve(false) });
    const checked = await preliminary({ body, secret, isInternal: true, isPublic: false });
    if ('error' in checked && checked.error.data.code !== 'PRECONDITION_FAILED') return checked;
    if (!parsed.success) return { error: { data: { code: 'BAD_REQUEST' as const } } };
    const pluginShipId = await options.connected(parsed.data.fleetId);
    if (pluginShipId === undefined) return { error: { data: { code: 'PRECONDITION_FAILED' as const } } };
    const boundary = createPluginBoundary({ ...options, pluginShipId, serves: (fleetId) => options.isServed(fleetId) });
    return boundary({ body, secret, isInternal: true, isPublic: false });
  };
}
