import type { FleetId } from '@aeolus-fleet/common';

import type { FleetForgetter, FleetSwitches, InstallationRequest, InstallationRequests, RequestHasher } from '../../src/core/installation/ports.js';

/** Each fleet's switch in memory. */
export function memoryFleetSwitches(): FleetSwitches & { held: Map<FleetId, boolean> } {
  const held = new Map<FleetId, boolean>();
  return {
    held,
    find: (fleetId) => Promise.resolve(held.get(fleetId)),
    set: (fleetId, { isEnabled }) => {
      held.set(fleetId, isEnabled);
      return Promise.resolve();
    },
  };
}

/** The installation's requests in memory, by request id. */
export function memoryInstallationRequests(): InstallationRequests & { held: InstallationRequest[] } {
  const held: InstallationRequest[] = [];
  return {
    held,
    find: (requestId) => Promise.resolve(held.find((request) => request.requestId === requestId)),
    record: (request) => {
      held.push(request);
      return Promise.resolve();
    },
  };
}

/** Forgets a fleet in memory: records which fleets were forgotten, and drops their switches and requests. */
export function memoryForgetter(parts: { switches: ReturnType<typeof memoryFleetSwitches>; requests: ReturnType<typeof memoryInstallationRequests> }): FleetForgetter & { forgotten: FleetId[] } {
  const forgotten: FleetId[] = [];
  return {
    forgotten,
    forget: (fleetId) => {
      forgotten.push(fleetId);
      parts.switches.held.delete(fleetId);
      const kept = parts.requests.held.filter((request) => request.fleetId !== fleetId);
      parts.requests.held.splice(0, parts.requests.held.length, ...kept);
      return Promise.resolve();
    },
  };
}

/** A hasher whose hash shows what it hashed: enough to tell requests apart. */
export const plainHasher: RequestHasher = { hash: (text) => `hash(${text})` };
