import type { ShipId, TrierarchReportDetails } from '@aeolus-fleet/common';
import { z } from 'zod';

/** What a joined machine's trierarch offers, as its configuration and the harnesses it trusts give it. */
export interface MachineSetup {
  caps: { ships: number; running: number };
  flags: readonly string[];
  version: string;
  machine?: TrierarchReportDetails['machine'];
}

/**
 * The details a trierarch reports with no session running: one claude-code
 * harness with no options, trusting the aeolus-fleet repository, nothing kept
 * or found, on the host.
 */
export function trierarchDetails(setup: MachineSetup): TrierarchReportDetails {
  return {
    harnesses: [{ harness: 'claude-code', options: { type: 'object', properties: {}, additionalProperties: false }, flags: [...setup.flags], riskyFlags: [] }],
    workspaces: { repositories: ['aeolus-fleet'], folders: [] },
    caps: setup.caps,
    kept: [],
    orphans: [],
    ...(setup.machine === undefined ? {} : { machine: setup.machine }),
    runtime: 'host',
    version: setup.version,
  };
}

async function shipCall(fleetUrl: string, request: { path: string; crewToken?: string; body: unknown }): Promise<unknown> {
  const response = await fetch(`${fleetUrl}/api/v1${request.path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(request.crewToken === undefined ? {} : { authorization: `Bearer ${request.crewToken}` }) },
    body: JSON.stringify(request.body),
  });
  const answer: unknown = await response.json();
  if (!response.ok) {
    throw new Error(`the fleet refused ${request.path}: ${JSON.stringify(answer)}`);
  }
  return answer;
}

/**
 * A joined machine's trierarch, as the fleet sees it once init and run made
 * it: registered with the secret the join answered, as a device in the
 * aeolus-trierarch harness, then reporting as its own ship, idle, with its details.
 */
export async function reportAsTrierarch(fleetUrl: string, machine: { shipId: ShipId; secret: string; setup: MachineSetup }): Promise<void> {
  const registered = await shipCall(fleetUrl, {
    path: '/ship/register',
    body: { shipId: machine.shipId, secret: machine.secret, location: { kind: 'DEVICE' }, harness: 'aeolus-trierarch' },
  });
  const { crewToken } = z.object({ crewToken: z.string() }).parse(registered);
  await shipCall(fleetUrl, {
    path: '/ship/report',
    crewToken,
    body: { state: 'idle', note: `0 of ${String(machine.setup.caps.ships)} running`, details: trierarchDetails(machine.setup) },
  });
}

/**
 * What waits for a joined machine's trierarch, as it receives once registered
 * with the secret the join answered: each delivery's sender, content type and payload.
 */
export async function receiveAsTrierarch(fleetUrl: string, machine: { shipId: ShipId; secret: string }): Promise<{ senderShipId: string; contentType: string; payload: string }[]> {
  const registered = await shipCall(fleetUrl, {
    path: '/ship/register',
    body: { shipId: machine.shipId, secret: machine.secret, location: { kind: 'DEVICE' }, harness: 'aeolus-trierarch' },
  });
  const { crewToken } = z.object({ crewToken: z.string() }).parse(registered);
  const received = await shipCall(fleetUrl, { path: '/ship/receive', crewToken, body: { max: 10 } });
  const deliveries = z.object({ deliveries: z.array(z.object({ senderShipId: z.string(), contentType: z.string(), payload: z.string() })) }).parse(received).deliveries;
  return deliveries.map(({ senderShipId, contentType, payload }) => ({ senderShipId, contentType, payload }));
}

/**
 * A joined machine's trierarch registered with the secret the join answered:
 * it receives and acks what waits for it, and sends as its own ship.
 */
export async function crewAsTrierarch(fleetUrl: string, machine: { shipId: ShipId; secret: string }) {
  const registered = await shipCall(fleetUrl, {
    path: '/ship/register',
    body: { shipId: machine.shipId, secret: machine.secret, location: { kind: 'DEVICE' }, harness: 'aeolus-trierarch' },
  });
  const { crewToken } = z.object({ crewToken: z.string() }).parse(registered);
  const deliveriesSchema = z.object({ deliveries: z.array(z.object({ deliveryId: z.string(), contentType: z.string(), payload: z.string() })) });
  return {
    receive: async (): Promise<{ contentType: string; payload: string }[]> => {
      const { deliveries } = deliveriesSchema.parse(await shipCall(fleetUrl, { path: '/ship/receive', crewToken, body: { max: 10 } }));
      for (const { deliveryId } of deliveries) {
        await shipCall(fleetUrl, { path: '/ship/ack', crewToken, body: { deliveryId } });
      }
      return deliveries.map(({ contentType, payload }) => ({ contentType, payload }));
    },
    send: async (message: { shipId: ShipId; contentType: string; payload: string }): Promise<void> => {
      await shipCall(fleetUrl, {
        path: '/ship/send',
        crewToken,
        body: { selector: { kind: 'ship', shipId: message.shipId }, contentType: message.contentType, payload: message.payload, idempotencyKey: crypto.randomUUID(), model: 'claude-opus-5-5' },
      });
    },
  };
}
