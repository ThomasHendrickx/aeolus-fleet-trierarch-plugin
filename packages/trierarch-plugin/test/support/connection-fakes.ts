import type { FleetId, ShipId } from '@aeolus-fleet/common';

import type { ConnectionStore, FleetDoor, FleetRefusal, ListedShip, PluginBinding, PluginCrew } from '../../src/core/connection/ports.js';
import { err, ok, type Result } from '../../src/core/shared/result.js';

export const SHIP_ID: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h1a';
export const FLEET_ID: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
export const OTHER_FLEET_ID: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';
export const FLEET_URL = 'https://fleet.example.com';

/** When a ship was commissioned, unless a test says otherwise. */
const EPOCH = new Date(0);

/** The trierarch another assigner claims for when the fake fleet loses a claim. */
export const OTHER_ASSIGNEE: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h9z';

/** The ship id the fake fleet gives the next ship it commissions. */
export const COMMISSIONED_SHIP_ID: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h2b';

/** A ship the fake fleet commissioned: what the trierarch plugin asked for. */
export interface CommissionedShip {
  name: string;
  type: string;
  fleetScopes: string[];
  idempotencyKey: string;
}

/**
 * A fleet that knows the trierarch plugin's ship: its secret claims it once,
 * its crew tokens work while their lease holds, and it has the scopes it was
 * given. It commissions ships by name, refusing a name an active ship holds,
 * and holds each ship's last report.
 */
export function fakePluginFleet() {
  const state = {
    secret: 'aeolus_sk_v1_good',
    fleetId: FLEET_ID,
    scopes: ['messages:send', 'messages:receive', 'fleet:read', 'fleet:manage', 'crew:assign'],
    isCrewed: false,
    isAnswering: true,
    liveTokens: new Set<string>(),
    registers: 0,
    deregistered: new Array<string>(),
    commissioned: new Array<CommissionedShip>(),
    ships: new Array<ListedShip>(),
    reports: new Map<ShipId, { state: string; note: string | null; reportedAt: Date; details: unknown }>(),
    /** Each ship's crew request settings, by ship. */
    settings: new Map<ShipId, unknown>(),
    /** When each ship was commissioned; the epoch when not set. */
    commissionedAt: new Map<ShipId, Date>(),
    /** Set to lose the next claims: another assigner wins each first, as in a race. */
    isLosingClaims: false,
    /** The reasons written, in order, by ship. */
    explained: new Array<{ shipId: ShipId; reason: string | null }>(),
  };
  const unavailable = () => Promise.resolve(err({ code: 'UNAVAILABLE', message: 'The fleet did not answer' }));
  const released = () => Promise.resolve(err({ code: 'LEASE_ENDED', message: 'This ship was released; this session no longer crews it.' }));
  const door: FleetDoor = {
    register: ({ shipId, secret }): Promise<Result<{ crewToken: string }, FleetRefusal>> => {
      state.registers += 1;
      if (shipId !== SHIP_ID || secret !== state.secret) {
        return Promise.resolve(err({ code: 'UNAUTHORIZED', message: 'Wrong ship id or secret' }));
      }
      if (state.isCrewed) {
        return Promise.resolve(err({ code: 'CONFLICT', message: 'The ship is crewed by another session' }));
      }
      state.isCrewed = true;
      const crewToken = `aeolus_ct_v1_${String(state.registers)}`;
      state.liveTokens.add(crewToken);
      return Promise.resolve(ok({ crewToken }));
    },
    whoami: (crewToken) => (state.liveTokens.has(crewToken) ? Promise.resolve(ok({ shipId: SHIP_ID, fleetId: state.fleetId, name: 'trierarch-plugin', type: 'trierarch-plugin' })) : released()),
    getShip: (crewToken, { shipId }) => {
      if (!state.isAnswering) {
        return unavailable();
      }
      if (!state.liveTokens.has(crewToken)) {
        return released();
      }
      if (!state.scopes.includes('fleet:read')) {
        return Promise.resolve(err({ code: 'FORBIDDEN', message: 'Needs fleet:read' }));
      }
      if (shipId === SHIP_ID) {
        return Promise.resolve(ok({ status: 'crewed', scopes: [...state.scopes], commissionedAt: EPOCH, report: null, crewSettings: null }));
      }
      const ship = state.ships.find((each) => each.shipId === shipId);
      return Promise.resolve(
        ship
          ? ok({
              status: ship.status,
              scopes: ['messages:send', 'messages:receive'],
              commissionedAt: state.commissionedAt.get(shipId) ?? EPOCH,
              report: state.reports.get(shipId) ?? null,
              crewSettings: ship.crewRequest === null ? null : (state.settings.get(shipId) ?? {}),
            })
          : err({ code: 'NOT_FOUND', message: 'No such ship' }),
      );
    },
    deregister: (crewToken) => {
      state.liveTokens.delete(crewToken);
      state.isCrewed = false;
      state.deregistered.push(crewToken);
      return Promise.resolve(ok(undefined));
    },
    commission: (crewToken, ship) => {
      if (!state.isAnswering) {
        return unavailable();
      }
      if (!state.liveTokens.has(crewToken)) {
        return released();
      }
      if (state.ships.some((each) => each.name === ship.name && each.status !== 'retired')) {
        return Promise.resolve(err({ code: 'CONFLICT', message: `An active ship is already named ${ship.name}` }));
      }
      state.commissioned.push({ ...ship });
      state.ships.push({ shipId: COMMISSIONED_SHIP_ID, name: ship.name, type: ship.type, status: 'awaitingCrew', lastSeenAt: null, crewRequest: null });
      const secret = 'aeolus_sk_v1_machine';
      return Promise.resolve(
        ok({
          shipId: COMMISSIONED_SHIP_ID,
          prompt: `You crew the Aeolus ship ${ship.name}. Register with ship id ${COMMISSIONED_SHIP_ID} and secret ${secret}.`,
          crewLines: [{ harness: 'claude-code', line: `/aeolus:crew ${FLEET_URL} ${COMMISSIONED_SHIP_ID} ${secret}` }],
          secret,
        }),
      );
    },
    listShips: (crewToken) => {
      if (!state.isAnswering) {
        return unavailable();
      }
      return state.liveTokens.has(crewToken) ? Promise.resolve(ok(state.ships.map((ship) => ({ ...ship, crewRequest: ship.crewRequest && { ...ship.crewRequest } })))) : released();
    },
    assignCrew: (crewToken, { shipId, trierarchShipId }) => {
      if (!state.liveTokens.has(crewToken)) {
        return released();
      }
      const ship = state.ships.find((each) => each.shipId === shipId);
      if (ship?.crewRequest == null) {
        return Promise.resolve(err({ code: 'NOT_FOUND', message: 'No crew request' }));
      }
      if (state.isLosingClaims && ship.crewRequest.assignedTo === null) {
        ship.crewRequest = { ...ship.crewRequest, assignedTo: OTHER_ASSIGNEE, reason: null };
      }
      if (ship.crewRequest.assignedTo !== null) {
        return Promise.resolve(err({ code: 'CONFLICT', message: 'The crew request is assigned already' }));
      }
      if (ship.status === 'crewed') {
        return Promise.resolve(err({ code: 'CONFLICT', message: 'The ship is crewed' }));
      }
      ship.crewRequest = { ...ship.crewRequest, assignedTo: trierarchShipId, reason: null };
      return Promise.resolve(ok(undefined));
    },
    explainCrewRequest: (crewToken, { shipId, reason }) => {
      if (!state.liveTokens.has(crewToken)) {
        return released();
      }
      const ship = state.ships.find((each) => each.shipId === shipId);
      if (ship?.crewRequest == null) {
        return Promise.resolve(err({ code: 'NOT_FOUND', message: 'No crew request' }));
      }
      ship.crewRequest = { ...ship.crewRequest, reason };
      state.explained.push({ shipId, reason });
      return Promise.resolve(ok(undefined));
    },
  };
  return { state, door };
}

/** A connection the store holds for one fleet: the binding stays when the crew token is dropped. */
interface HeldConnection {
  binding: PluginBinding;
  name: string;
  crewToken: string | null;
  crewedAt: Date;
}

/** The connection store in memory, one connection per fleet. */
export function memoryConnectionStore(): ConnectionStore & { held: Map<FleetId, HeldConnection> } {
  const held = new Map<FleetId, HeldConnection>();
  const crewOf = (connection: HeldConnection): PluginCrew | undefined =>
    connection.crewToken ? { ...connection.binding, name: connection.name, crewToken: connection.crewToken, crewedAt: connection.crewedAt } : undefined;
  return {
    held,
    find: (fleetId) => {
      const connection = held.get(fleetId);
      return Promise.resolve(connection ? crewOf(connection) : undefined);
    },
    binding: (fleetId) => {
      const connection = held.get(fleetId);
      return Promise.resolve(connection ? { ...connection.binding } : undefined);
    },
    connected: () => Promise.resolve([...held.values()].flatMap((connection) => crewOf(connection) ?? [])),
    save: (crew: PluginCrew) => {
      held.set(crew.fleetId, { binding: { fleetId: crew.fleetId, shipId: crew.shipId }, name: crew.name, crewToken: crew.crewToken, crewedAt: crew.crewedAt });
      return Promise.resolve();
    },
    drop: (fleetId) => {
      const connection = held.get(fleetId);
      if (connection) {
        held.set(fleetId, { ...connection, crewToken: null });
      }
      return Promise.resolve();
    },
  };
}
