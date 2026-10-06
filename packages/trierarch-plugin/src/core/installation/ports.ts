import type { FleetId } from '@aeolus-fleet/common';

/**
 * Whether the installation has an installation token (decision 0021): open
 * without one, as a self-hosted trierarch plugin runs, and every fleet is served;
 * enabled with one, and a fleet is served only once the hosting service
 * switched it on.
 */
export type InstallationMode = 'open' | 'enabled';

/** Outbound port: each fleet's switch, as the hosting service set it. */
export interface FleetSwitches {
  /** Whether the fleet was switched on; undefined when it never was switched. */
  find(fleetId: FleetId): Promise<boolean | undefined>;
  set(fleetId: FleetId, change: { isEnabled: boolean; at: Date }): Promise<void>;
}

/**
 * A request the installation answered, by the caller's request id. A switch
 * names its fleet and what it set, and goes with its fleet; a delete names
 * nothing of the fleet, only the request's hash.
 */
export interface InstallationRequest {
  requestId: string;
  kind: 'setEnabled' | 'deleteFleet';
  requestHash: string;
  fleetId: FleetId | null;
  isEnabled: boolean | null;
  at: Date;
}

/** Outbound port: the installation's requests, so a replay answers what the first call answered. */
export interface InstallationRequests {
  find(requestId: string): Promise<InstallationRequest | undefined>;
  record(request: InstallationRequest): Promise<void>;
}

/**
 * Outbound port: forgets everything the trierarch plugin holds of a fleet,
 * in one go: its connection, its switch and the requests that name it.
 */
export interface FleetForgetter {
  forget(fleetId: FleetId): Promise<void>;
}

/** Outbound port: a one-way hash of a request's text, kept instead of the request. */
export interface RequestHasher {
  hash(text: string): string;
}
