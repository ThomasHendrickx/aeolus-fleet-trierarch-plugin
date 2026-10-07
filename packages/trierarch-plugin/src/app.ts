import type { FleetId } from '@aeolus-fleet/common';
import { fastifyTRPCPlugin, type FastifyTRPCPluginOptions } from '@trpc/server/adapters/fastify';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

import { randomIdempotencyKeys } from './adapters/crypto/idempotency-keys.js';
import { sha256RequestHasher } from './adapters/crypto/request-hasher.js';
import { createFleetConsoleSessions } from './adapters/fleet/console-sessions.js';
import { createRestFleetDoor } from './adapters/fleet/rest-fleet-door.js';
import { runningVersion } from './adapters/http/version.js';
import { checkDatabase, createPrismaClient, latestMigration } from './adapters/prisma/client.js';
import { createPrismaConnectionStore } from './adapters/prisma/connection-store.js';
import { createPrismaFleetForgetter } from './adapters/prisma/fleet-forgetter.js';
import { createPrismaFleetSwitches } from './adapters/prisma/fleet-switches.js';
import { createPrismaInstallationRequests } from './adapters/prisma/installation-requests.js';
import { trierarchPluginRouter, type TrierarchPluginRouter } from './adapters/trpc/router.js';
import { createConnect } from './core/connection/connect.js';
import { createReadConnection, type ReadConnection } from './core/connection/read-connection.js';
import { createDeleteFleet } from './core/installation/delete-fleet.js';
import type { InstallationMode } from './core/installation/ports.js';
import { createReadFleet } from './core/installation/read-fleet.js';
import { createIsServed } from './core/installation/served.js';
import { createSetFleetEnabled } from './core/installation/set-fleet-enabled.js';
import { createAssignCrews, type AssignOutcome } from './core/assignment/assign-crews.js';
import { createCheckCrewSettings } from './core/assignment/check-crew-settings.js';
import { createJoinMachine } from './core/machines/join-machine.js';
import { createListMachines } from './core/machines/list-machines.js';
import { createAuthenticateOperator } from './core/operator/authenticate-operator.js';
import type { Clock } from './core/shared/clock.js';

export const systemClock: Clock = { now: () => new Date() };

export interface TrierarchPluginApp {
  /** The HTTP server: `/api/health` and `/api/version` for whoever operates the installation. */
  server: FastifyInstance;
  /**
   * At start: reads every served fleet's kept connection, dropping a crew
   * token its fleet no longer takes; answers each fleet still connected, as
   * which ship.
   */
  restoreConnections: () => Promise<{ fleetId: FleetId; ship: string }[]>;
  /** One assignment pass for every fleet it serves and is connected to; each fleet's refusal is logged, never thrown. */
  assignOnce: () => Promise<{ fleetId: FleetId; outcome: AssignOutcome }[]>;
  /** Runs an assignment pass every interval until the app closes. */
  startAssigning: (intervalMs: number) => void;
  /** Stops the server and disconnects the database. */
  close(): Promise<void>;
}

/** A trierarch is silent once its last seen is older than this, unless the configuration says otherwise. */
const DEFAULT_SILENT_AFTER_MS = 300_000;

/**
 * The trierarch plugin wired to its own database and to the fleet's public
 * API. A pure API: the console's server calls it, with the console's session
 * cookie; it needs no public address of its own.
 */
export function createTrierarchPluginApp(options: {
  databaseUrl: string;
  fleetUrl: string;
  clock?: Clock;
  logger?: FastifyServerOptions['logger'];
  /** The installation token (decision 0021): unset, the installation is open and every fleet is served. */
  installationToken?: string;
  /** A trierarch whose last seen is older than this is silent; five minutes unless given. */
  silentAfterMs?: number;
}): TrierarchPluginApp {
  const prisma = createPrismaClient(options.databaseUrl);
  const server = Fastify({ logger: options.logger ?? true });
  const connections = createPrismaConnectionStore(prisma);
  const installation: InstallationMode = options.installationToken === undefined ? 'open' : 'enabled';
  const switches = createPrismaFleetSwitches(prisma);
  const isServed = createIsServed({ installation, switches });
  // From what the trierarch plugin holds, without asking any fleet: health and version stay quick.
  const connectedFleets = async (): Promise<number> => (await connections.connected()).length;

  // The version this process runs and its database's latest migration. No authentication, no fleet data.
  const version = runningVersion();
  server.get('/api/version', async () => {
    let migration: string | null = null;
    try {
      migration = await latestMigration(prisma);
    } catch (error) {
      server.log.error({ err: error }, 'latest migration unknown');
    }
    return { trierarchPlugin: version, migration, connectedFleets: await connectedFleets(), installation };
  });

  // Up and its database reachable.
  server.get('/api/health', async (_request, reply) => {
    try {
      await checkDatabase(prisma);
      return { status: 'ok', connectedFleets: await connectedFleets(), installation };
    } catch (error) {
      server.log.error({ err: error }, 'database unreachable');
      return reply.code(503).send({ status: 'unavailable' });
    }
  });

  const clock = options.clock ?? systemClock;
  const door = createRestFleetDoor(options.fleetUrl);
  const readConnection = createReadConnection({ door, store: connections });
  // A fleet's connection as the trierarch plugin holds it, asking the fleet nothing: what a fleet that is off reads.
  const heldConnection: ReadConnection = async (fleetId) => {
    const crew = await connections.find(fleetId);
    if (crew) {
      return { state: 'connected', ship: { shipId: crew.shipId, name: crew.name }, lastShipId: crew.shipId };
    }
    return { state: 'not-connected', ship: null, lastShipId: (await connections.binding(fleetId))?.shipId ?? null };
  };
  const requests = createPrismaInstallationRequests(prisma);
  const setFleetEnabled = createSetFleetEnabled({ switches, requests, hasher: sha256RequestHasher, clock });
  const readFleet = createReadFleet({ isServed, connections });
  const deleteFleet = createDeleteFleet({ forgetter: createPrismaFleetForgetter(prisma), requests, hasher: sha256RequestHasher, clock });
  const connect = createConnect({ door, store: connections, clock });
  const joinMachine = createJoinMachine({ door, connections, keys: randomIdempotencyKeys, fleetUrl: options.fleetUrl });
  const silentAfterMs = options.silentAfterMs ?? DEFAULT_SILENT_AFTER_MS;
  const listMachines = createListMachines({ door, connections, clock, silentAfterMs });
  const assignCrews = createAssignCrews({ door, connections, clock, silentAfterMs });
  const checkCrewSettings = createCheckCrewSettings({ door, connections, clock, silentAfterMs });
  const assignOnce = async (): Promise<{ fleetId: FleetId; outcome: AssignOutcome }[]> => {
    const done: { fleetId: FleetId; outcome: AssignOutcome }[] = [];
    for (const crew of await connections.connected()) {
      if (!(await isServed(crew.fleetId))) {
        continue;
      }
      const assigned = await assignCrews(crew.fleetId);
      if (assigned.isOk) {
        done.push({ fleetId: crew.fleetId, outcome: assigned.value });
      } else {
        server.log.warn({ fleet: crew.fleetId, refusal: assigned.error }, 'assignment pass refused; the next pass tries again');
      }
    }
    return done;
  };
  let assigning: NodeJS.Timeout | undefined;

  const trpc: FastifyTRPCPluginOptions<TrierarchPluginRouter> = {
    prefix: '/trpc',
    trpcOptions: {
      router: trierarchPluginRouter,
      onError: ({ error, path }) => {
        if (error.code === 'INTERNAL_SERVER_ERROR') {
          server.log.error({ err: error.cause ?? error, path }, 'procedure failed');
        }
      },
      createContext: ({ req }) => ({
        cookie: req.headers.cookie,
        authenticateOperator: createAuthenticateOperator({ sessions: createFleetConsoleSessions(options.fleetUrl) }),
        isConnected: async (fleetId: FleetId) => (await connections.find(fleetId)) !== undefined,
        isServed,
        heldConnection,
        installationTokenSent: typeof req.headers['x-aeolus-installation-token'] === 'string' ? req.headers['x-aeolus-installation-token'] : undefined,
        installation: { mode: installation, token: options.installationToken },
        setFleetEnabled,
        readFleet,
        deleteFleet,
        readConnection,
        connect,
        joinMachine,
        listMachines,
        checkCrewSettings,
      }),
    },
  };
  void server.register(fastifyTRPCPlugin, trpc);

  server.addHook('onClose', async () => {
    clearInterval(assigning);
    await prisma.$disconnect();
  });

  return {
    server,
    restoreConnections: async () => {
      const restored: { fleetId: FleetId; ship: string }[] = [];
      for (const crew of await connections.connected()) {
        // A fleet that is off rests: its connection waits, unread, for it to be on again.
        if (!(await isServed(crew.fleetId))) {
          continue;
        }
        const connection = await readConnection(crew.fleetId);
        if (connection.state === 'connected') {
          restored.push({ fleetId: crew.fleetId, ship: connection.ship?.name ?? crew.name });
        }
      }
      return restored;
    },
    assignOnce,
    startAssigning: (intervalMs) => {
      // One pass at a time: a pass that outlasts the interval makes the next one wait.
      let isPassing = false;
      assigning = setInterval(() => {
        if (isPassing) {
          return;
        }
        isPassing = true;
        assignOnce()
          .then((done) => {
            for (const { fleetId, outcome } of done) {
              if (outcome.assigned + outcome.explained + outcome.lost > 0) {
                server.log.info({ fleet: fleetId, ...outcome }, 'assignment pass');
              }
            }
          })
          .catch((error: unknown) => {
            server.log.error({ err: error }, 'assignment pass failed; the next pass tries again');
          })
          .finally(() => {
            isPassing = false;
          });
      }, intervalMs);
    },
    close: () => server.close(),
  };
}
