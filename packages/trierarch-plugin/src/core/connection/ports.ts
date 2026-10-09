import type { CrewLine, FleetId, LabelId, LabelValueId, ShipId } from '@aeolus-fleet/common';

import type { Result } from '../shared/result.js';

/**
 * Why the fleet refused a ship call: its code (CONFLICT, UNAUTHORIZED,
 * LEASE_ENDED, ...) and its message. UNAVAILABLE: no answer came, so the call
 * may or may not have been carried out.
 */
export interface FleetRefusal {
  code: string;
  message: string;
}

/** A ship's starting prompt as the fleet issues it once: the prompt, its crew lines and the secret they hold. */
export interface IssuedPrompt {
  prompt: string;
  crewLines: CrewLine[];
  secret: string;
}

/** A ship as `fleet.list` lists it: what the trierarch plugin reads of it. */
export interface ListedShip {
  shipId: ShipId;
  name: string;
  type: string;
  status: 'awaitingCrew' | 'crewed' | 'retired';
  /** When its session last called the fleet; null while no session crews it. */
  lastSeenAt: Date | null;
  /** The model its crew last stated (decision 0018); null until one states any. */
  model: { id: string; statedAt: Date } | null;
  /**
   * Its crew request, without its settings: their version, when the session
   * its trierarch runs now started, or null while none runs, and the
   * trierarchs that gave it back, oldest first (#382); null when it holds none.
   */
  crewRequest: {
    settingsVersion: number;
    requestedAt: Date;
    assignedTo: ShipId | null;
    reason: string | null;
    startedAt: Date | null;
    givenBack: { trierarchShipId: ShipId; reason: string }[];
  } | null;
  /** The label values it carries, every owner's, with their labels (#102). */
  labels: { labelId: LabelId; valueId: LabelValueId }[];
}

/** A ship as `fleet.ship` shows it: what the trierarch plugin reads of it. */
export interface FleetShip {
  status: 'awaitingCrew' | 'crewed' | 'retired';
  scopes: string[];
  commissionedAt: Date;
  /** Its crew's last report, details included as the fleet holds them; null until its crew reports. */
  report: { state: string; note: string | null; reportedAt: Date; details: unknown } | null;
  /** Its crew request's settings, unread; null when it holds no crew request. */
  crewSettings: unknown;
}

/** A label of the fleet as `fleet.labels` lists it: its key, its values and the ship that owns it (#102). */
export interface ListedLabel {
  labelId: LabelId;
  key: string;
  values: { valueId: LabelValueId; value: string }[];
  ownerShipId: ShipId;
}

/**
 * Outbound port: the fleet's public ship calls, as the trierarch plugin makes
 * them for its own ship. The trierarch plugin is a ship like any other
 * (decision 0030).
 */
export interface FleetDoor {
  register(claim: { shipId: ShipId; secret: string }): Promise<Result<{ crewToken: string }, FleetRefusal>>;
  whoami(crewToken: string): Promise<Result<{ shipId: ShipId; fleetId: FleetId; name: string; type: string }, FleetRefusal>>;
  /** A ship of the fleet, retired ones included; needs fleet:read. */
  getShip(crewToken: string, ship: { shipId: ShipId }): Promise<Result<FleetShip, FleetRefusal>>;
  /** Ends this session's crew of its ship: the lease and the secret it claimed with. */
  deregister(crewToken: string): Promise<Result<undefined, FleetRefusal>>;
  /**
   * Commissions a ship as the crew token's ship (fleet:manage) under a new
   * idempotency key, with the fleet scopes given beside the send and receive
   * every agent ship has: its id and its starting prompt, issued once.
   */
  commission(
    crewToken: string,
    ship: { name: string; type: string; fleetScopes: string[]; idempotencyKey: string },
  ): Promise<Result<{ shipId: ShipId } & IssuedPrompt, FleetRefusal>>;
  /** Every ship of the fleet, retired ones included (fleet:read). */
  listShips(crewToken: string): Promise<Result<ListedShip[], FleetRefusal>>;
  /** Claims a ship's crew request for a trierarch (crew:assign), only while it is unassigned: a lost claim is CONFLICT. */
  assignCrew(crewToken: string, claim: { shipId: ShipId; trierarchShipId: ShipId }): Promise<Result<undefined, FleetRefusal>>;
  /** Every label of the fleet, with its owner (fleet:read). */
  listLabels(crewToken: string): Promise<Result<ListedLabel[], FleetRefusal>>;
  /** Defines a label the crew token's ship owns (labels:define); a key the fleet has already is CONFLICT. */
  defineLabel(crewToken: string, label: { key: string; values: string[] }): Promise<Result<{ labelId: LabelId; values: { valueId: LabelValueId; value: string }[] }, FleetRefusal>>;
  /** Puts one of its own label values on a ship (labels:assign). */
  assignLabel(crewToken: string, assignment: { shipId: ShipId; valueId: LabelValueId }): Promise<Result<undefined, FleetRefusal>>;
  /** Takes one of its own label values off a ship (labels:assign). */
  unassignLabel(crewToken: string, assignment: { shipId: ShipId; valueId: LabelValueId }): Promise<Result<undefined, FleetRefusal>>;
  /** Writes why no trierarch can take a ship's unassigned crew request (crew:assign). */
  explainCrewRequest(crewToken: string, explanation: { shipId: ShipId; reason: string | null }): Promise<Result<undefined, FleetRefusal>>;
  /** Sends argo, the operator, plain text, stored once under its idempotency key. */
  tellArgo(crewToken: string, notice: { text: string; idempotencyKey: string }): Promise<Result<undefined, FleetRefusal>>;
}

/** The crew token the trierarch plugin holds for its ship in a fleet, and when it got it. */
export interface PluginCrew {
  /** The fleet the ship belongs to: the fleet the trierarch plugin serves. */
  fleetId: FleetId;
  shipId: ShipId;
  /** The ship's name when the trierarch plugin connected, shown while the fleet does not answer. */
  name: string;
  crewToken: string;
  crewedAt: Date;
}

/** The fleet and ship the trierarch plugin was last connected as; kept when its crew token is dropped. */
export interface PluginBinding {
  fleetId: FleetId;
  shipId: ShipId;
}

/**
 * Outbound port: where the trierarch plugin keeps each fleet's crew token
 * across restarts. One install serves many fleets, one connection each.
 */
export interface ConnectionStore {
  /** The fleet's crew, while the trierarch plugin holds a crew token for it: while it is connected to that fleet. */
  find(fleetId: FleetId): Promise<PluginCrew | undefined>;
  /** The fleet's last connection, with or without a crew token; none before its first. */
  binding(fleetId: FleetId): Promise<PluginBinding | undefined>;
  /** Every fleet's crew the trierarch plugin holds a crew token for: the fleets it is connected to. */
  connected(): Promise<PluginCrew[]>;
  save(crew: PluginCrew): Promise<void>;
  /** Forgets the fleet's crew token, keeping its binding: the trierarch plugin is not connected to that fleet. */
  drop(fleetId: FleetId): Promise<void>;
}

/**
 * Whether the trierarch plugin holds a working crew token for its ship, as
 * which ship, and the ship it was last connected as.
 */
export interface ConnectionStatus {
  state: 'not-connected' | 'connected';
  ship: { shipId: ShipId; name: string } | null;
  lastShipId: ShipId | null;
}
