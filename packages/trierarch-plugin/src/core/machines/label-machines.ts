import { MACHINE_ARCH, MACHINE_OS, trierarchReportDetailsSchema, type FleetId, type LabelValueId, type TrierarchReportDetails } from '@aeolus-fleet/common';

import type { ConnectionStore, FleetDoor, FleetRefusal, ListedLabel, ListedShip, PluginCrew } from '../connection/ports.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { TRIERARCH_TYPE } from './join-machine.js';

/** What a pass did: the labels it defined and the values it put on and took off trierarch ships; why it labelled nothing, when it did not. */
export interface LabelOutcome {
  defined: number;
  assigned: number;
  unassigned: number;
  skipped?: string;
}

export type LabelMachines = (fleetId: FleetId) => Promise<Result<LabelOutcome, DomainError<'NOT_CONNECTED' | 'FLEET_UNAVAILABLE'>>>;

type Machine = NonNullable<TrierarchReportDetails['machine']>;

/**
 * The label every trierarch ship carries as `machine`, whatever its machine
 * reports, and the trierarch plugin's own ship as `plugin`: its network rules
 * select them by it (#573).
 */
export const TRIERARCH_LABEL = { key: 'trierarch', machine: 'machine', plugin: 'plugin' } as const;

/** A ship the trierarch plugin labels: its own ship, or a trierarch ship with the machine it reports. */
type Labelled = { isOwnShip: true } | { isOwnShip: false; machine: Machine | undefined };

/** The labels the trierarch plugin owns: each key, its values, and the value a ship it labels carries. */
const OWNED_LABELS: readonly { key: string; values: readonly string[]; valueOf: (ship: Labelled) => string | undefined }[] = [
  { key: 'os', values: MACHINE_OS, valueOf: (ship) => (ship.isOwnShip ? undefined : ship.machine?.os) },
  { key: 'arch', values: MACHINE_ARCH, valueOf: (ship) => (ship.isOwnShip ? undefined : ship.machine?.arch) },
  { key: TRIERARCH_LABEL.key, values: [TRIERARCH_LABEL.machine, TRIERARCH_LABEL.plugin], valueOf: (ship) => (ship.isOwnShip ? TRIERARCH_LABEL.plugin : TRIERARCH_LABEL.machine) },
];

const LABEL_SCOPES = ['labels:define', 'labels:assign'];

/** The refusals that mean the fleet changed since it was read (a key taken, a ship or value gone): read again on the next pass. */
const CHANGED = new Set(['CONFLICT', 'NOT_FOUND']);

const NO_LABEL_SCOPES = 'its ship holds no label scopes, and scopes never change: retire its ship and connect the trierarch plugin again to label machines';

/**
 * Use case: one pass of machine labels for a fleet (docs/trierarch.md,
 * "Machine labels"). The trierarch plugin defines os, arch and trierarch,
 * which it owns, labels its own ship trierarch=plugin, and each trierarch ship
 * trierarch=machine and with the values its machine reports: the value it
 * reports now goes on first, then any other value of that label comes off. A
 * key another ship owns is left alone. Without the label scopes it labels
 * nothing and says why. Placement reads the labels; a request already
 * assigned stays where it is when they change.
 */
export function createLabelMachines(deps: { door: FleetDoor; connections: ConnectionStore }): LabelMachines {
  const unavailable = (refusal: FleetRefusal) => refuse('FLEET_UNAVAILABLE', `The fleet did not answer the machine labels: ${refusal.message}`);
  return async (fleetId) => {
    const crew = await deps.connections.find(fleetId);
    if (!crew) {
      return refuse('NOT_CONNECTED', 'The trierarch plugin is not connected to this fleet: connect it in the console');
    }
    const own = await deps.door.getShip(crew.crewToken, { shipId: crew.shipId });
    if (!own.isOk) {
      return unavailable(own.error);
    }
    if (!LABEL_SCOPES.every((scope) => own.value.scopes.includes(scope))) {
      return ok({ defined: 0, assigned: 0, unassigned: 0, skipped: NO_LABEL_SCOPES });
    }
    const done = await labelPass(deps.door, crew);
    return done.isOk ? done : unavailable(done.error);
  };
}

/** A call's answer; undefined when the fleet changed since it was read, which the next pass reads again. */
type Settled<T> = Result<T | undefined, FleetRefusal>;

async function settle<T>(done: Promise<Result<T, FleetRefusal>>): Promise<Settled<T>> {
  const result = await done;
  return result.isOk || !CHANGED.has(result.error.code) ? result : ok(undefined);
}

async function labelPass(door: FleetDoor, crew: PluginCrew): Promise<Result<LabelOutcome, FleetRefusal>> {
  const outcome: LabelOutcome = { defined: 0, assigned: 0, unassigned: 0 };
  const listed = await settle(door.listLabels(crew.crewToken));
  if (!listed.isOk) {
    return listed;
  }
  const labels = new Map<string, ListedLabel>();
  for (const { key, values } of OWNED_LABELS) {
    const label = listed.value?.find((each) => each.key === key);
    if (label !== undefined) {
      if (label.ownerShipId === crew.shipId) {
        labels.set(key, label);
      }
      continue;
    }
    const defined = await settle(door.defineLabel(crew.crewToken, { key, values: [...values] }));
    if (!defined.isOk) {
      return defined;
    }
    if (defined.value !== undefined) {
      labels.set(key, { ...defined.value, key, ownerShipId: crew.shipId });
      outcome.defined += 1;
    }
  }

  const ships = await settle(door.listShips(crew.crewToken));
  if (!ships.isOk) {
    return ships;
  }
  for (const ship of (ships.value ?? []).filter((each) => each.shipId === crew.shipId || (each.type === TRIERARCH_TYPE && each.status !== 'retired'))) {
    const labelled = await labelledOf(door, { crew, ship });
    if (!labelled.isOk) {
      return labelled;
    }
    for (const { key, valueOf } of OWNED_LABELS) {
      const label = labels.get(key);
      if (label === undefined) {
        continue;
      }
      const relabelled = await relabel(door, {
        crewToken: crew.crewToken,
        ship,
        wanted: label.values.find((each) => each.value === valueOf(labelled.value))?.valueId,
        carried: ship.labels.filter((each) => each.labelId === label.labelId).map((each) => each.valueId),
      });
      if (!relabelled.isOk) {
        return relabelled;
      }
      outcome.assigned += relabelled.value.assigned;
      outcome.unassigned += relabelled.value.unassigned;
    }
  }
  return ok(outcome);
}

/** What the pass labels a ship as: its own ship, or a trierarch ship with the machine its last report names. */
async function labelledOf(door: FleetDoor, { crew, ship }: { crew: PluginCrew; ship: ListedShip }): Promise<Result<Labelled, FleetRefusal>> {
  if (ship.shipId === crew.shipId) {
    return ok({ isOwnShip: true });
  }
  const read = await settle(door.getShip(crew.crewToken, { shipId: ship.shipId }));
  if (!read.isOk) {
    return read;
  }
  const details = trierarchReportDetailsSchema.safeParse(read.value?.report?.details);
  return ok({ isOwnShip: false, machine: details.success ? details.data.machine : undefined });
}

/** Puts the wanted value on first, so the ship is never without the label while it changes; then takes every other value of the label off. */
async function relabel(
  door: FleetDoor,
  change: { crewToken: string; ship: ListedShip; wanted: LabelValueId | undefined; carried: LabelValueId[] },
): Promise<Result<{ assigned: number; unassigned: number }, FleetRefusal>> {
  const { crewToken, ship, wanted, carried } = change;
  const counted = { assigned: 0, unassigned: 0 };
  if (wanted !== undefined && !carried.includes(wanted)) {
    const assigned = await door.assignLabel(crewToken, { shipId: ship.shipId, valueId: wanted });
    if (!assigned.isOk && !CHANGED.has(assigned.error.code)) {
      return assigned;
    }
    counted.assigned += assigned.isOk ? 1 : 0;
  }
  for (const valueId of carried.filter((each) => each !== wanted)) {
    const unassigned = await door.unassignLabel(crewToken, { shipId: ship.shipId, valueId });
    if (!unassigned.isOk && !CHANGED.has(unassigned.error.code)) {
      return unassigned;
    }
    counted.unassigned += unassigned.isOk ? 1 : 0;
  }
  return ok(counted);
}
