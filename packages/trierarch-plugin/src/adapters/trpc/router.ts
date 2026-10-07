/**
 * The trierarch plugin's API: one tRPC router, which the console's server
 * calls with the console's session cookie, as squadrons' (decision 0030).
 * Every procedure but the installation's is the operator's: the cookie must
 * be a signed-in console session of a fleet at the fleet's URL, and the
 * procedure works on that fleet. A fleet the trierarch plugin does not serve
 * (switched off) gets only `connection.status`; only `connection` works
 * before the trierarch plugin is connected to the fleet. The installation
 * procedures take the installation token instead (decision 0021).
 */
import { timingSafeEqual } from 'node:crypto';

import { crewLineSchema, idempotencyKeySchema, idSchema, shipHandleSchema, trierarchReportDetailsSchema, type FleetId } from '@aeolus-fleet/common';
import { initTRPC, TRPCError } from '@trpc/server';
import { z } from 'zod';

import type { Connect } from '../../core/connection/connect.js';
import type { ReadConnection } from '../../core/connection/read-connection.js';
import type { DeleteFleet } from '../../core/installation/delete-fleet.js';
import type { InstallationMode } from '../../core/installation/ports.js';
import type { ReadFleet } from '../../core/installation/read-fleet.js';
import type { IsServed } from '../../core/installation/served.js';
import type { SetFleetEnabled } from '../../core/installation/set-fleet-enabled.js';
import type { CheckCrewSettings } from '../../core/assignment/check-crew-settings.js';
import type { JoinMachine } from '../../core/machines/join-machine.js';
import type { ListMachines } from '../../core/machines/list-machines.js';
import type { AuthenticateOperator } from '../../core/operator/authenticate-operator.js';

export interface Context {
  /** The Cookie header the console's server forwarded. */
  cookie: string | undefined;
  authenticateOperator: AuthenticateOperator;
  /** Whether the trierarch plugin is connected to the fleet. */
  isConnected: (fleetId: FleetId) => Promise<boolean>;
  isServed: IsServed;
  /** The fleet's connection as the trierarch plugin holds it, without asking the fleet: what a fleet that is off reads. */
  heldConnection: ReadConnection;
  /** The installation token header the caller sent, if any. */
  installationTokenSent: string | undefined;
  installation: { mode: InstallationMode; token: string | undefined };
  setFleetEnabled: SetFleetEnabled;
  readFleet: ReadFleet;
  deleteFleet: DeleteFleet;
  readConnection: ReadConnection;
  connect: Connect;
  joinMachine: JoinMachine;
  listMachines: ListMachines;
  checkCrewSettings: CheckCrewSettings;
}

/** What a caller reads of a failure: nothing of it, so no crew token, secret or query ever leaves; the log holds it whole. */
export const INTERNAL_ERROR_MESSAGE = 'Internal error';

const t = initTRPC.context<Context>().create({
  isDev: false,
  errorFormatter: ({ shape, error }) => (error.code === 'INTERNAL_SERVER_ERROR' ? { ...shape, message: INTERNAL_ERROR_MESSAGE } : shape),
});

const operatorProcedure = t.procedure.use(async ({ ctx, next }) => {
  const operator = await ctx.authenticateOperator(ctx.cookie);
  if (!operator.isOk) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: operator.error.message });
  }
  return next({ ctx: { fleetId: operator.value.fleetId, scopes: operator.value.scopes } });
});

/**
 * What changes the fleet needs the session's ship to hold fleet:manage: the
 * operator does, a viewer session (fleet:read only, decision 0022) does not,
 * so it is served reads only. Checked before the input is read.
 */
function managing(procedure: typeof operatorProcedure) {
  return procedure.use(({ ctx, next }) => {
    if (!ctx.scopes.includes('fleet:manage')) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Needs fleet:manage: a viewer session only reads' });
    }
    return next();
  });
}

/** Whether the token sent is the installation token, compared in constant time. */
function isInstallationToken(sent: string | undefined, token: string): boolean {
  const expected = Buffer.from(token);
  const given = Buffer.from(sent ?? '');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * The installation's procedures (decision 0021): with no installation token
 * configured they do not exist (NOT_FOUND); with one, the caller presents it
 * in `x-aeolus-installation-token` or is refused (UNAUTHORIZED).
 */
const installationProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (ctx.installation.mode === 'open' || ctx.installation.token === undefined) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'No such procedure' });
  }
  if (!isInstallationToken(ctx.installationTokenSent, ctx.installation.token)) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'The installation token is missing or wrong' });
  }
  return next();
});

/** The operator's procedures that need the trierarch plugin to serve their fleet: while it is off, FORBIDDEN. */
const servedProcedure = operatorProcedure.use(async ({ ctx, next }) => {
  if (!(await ctx.isServed(ctx.fleetId))) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'The trierarch plugin is off for this fleet' });
  }
  return next();
});

/** The operator's procedures that need the trierarch plugin connected to their fleet: until then, PRECONDITION_FAILED. */
const connectedProcedure = servedProcedure.use(async ({ ctx, next }) => {
  if (!(await ctx.isConnected(ctx.fleetId))) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'The trierarch plugin is not connected to this fleet: connect it in the console' });
  }
  return next();
});

/** The refusals of connecting, as the API states them. */
const CONNECT_CODES = {
  ALREADY_CONNECTED: 'CONFLICT',
  SECRET_REFUSED: 'BAD_REQUEST',
  OTHER_FLEET: 'BAD_REQUEST',
  MISSING_SCOPES: 'BAD_REQUEST',
} as const satisfies Record<string, TRPCError['code']>;

/** The refusals of joining a machine, as the API states them. */
const JOIN_CODES = {
  NOT_CONNECTED: 'PRECONDITION_FAILED',
  NAME_TAKEN: 'CONFLICT',
  FLEET_UNAVAILABLE: 'BAD_GATEWAY',
} as const satisfies Record<string, TRPCError['code']>;

/** The refusals of reading the fleet (listing the machines, checking settings), as the API states them. */
const LIST_CODES = {
  NOT_CONNECTED: 'PRECONDITION_FAILED',
  FLEET_UNAVAILABLE: 'BAD_GATEWAY',
} as const satisfies Record<string, TRPCError['code']>;

/** The connection as the console reads it: whether the trierarch plugin serves the fleet, and its connection. */
const connectionStatusOutputSchema = z.object({
  enabled: z.boolean(),
  state: z.enum(['not-connected', 'connected']),
  ship: z.object({ shipId: z.string(), name: z.string() }).nullable(),
  lastShipId: z.string().nullable(),
});

/** What checking crew settings answers: a trierarch fits, none takes them (naming the settings field at fault), or none has room now. */
export const checkedSettingsOutputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fits') }),
  z.object({ kind: z.literal('refused'), field: z.string(), reason: z.string() }),
  z.object({ kind: z.literal('noRoom'), reason: z.string() }),
]);

/** A joined machine: its trierarch's ship, its starting prompt (decision 0019) and its setup line, each shown once. */
export const joinedMachineOutputSchema = z.object({
  shipId: idSchema('ship'),
  name: z.string(),
  prompt: z.string(),
  crewLines: z.array(crewLineSchema),
  secret: z.string(),
  setupLine: z.string(),
});

/** A machine as the console reads it (ISO 8601 in UTC): its trierarch's ship, its last report and the details it reported. */
export const machineOutputSchema = z.object({
  shipId: idSchema('ship'),
  name: z.string(),
  status: z.enum(['awaitingCrew', 'crewed']),
  lastSeenAt: z.iso.datetime().nullable(),
  /** Its trierarch's last seen is older than the threshold: it gets no new requests, and keeps those it holds. */
  isSilent: z.boolean(),
  report: z.object({ state: z.string(), note: z.string().nullable(), reportedAt: z.iso.datetime() }).nullable(),
  details: trierarchReportDetailsSchema.nullable(),
});

export const trierarchPluginRouter = t.router({
  connection: t.router({
    /** Whether the trierarch plugin is connected to the operator's fleet, as which ship, and the ship it was last connected as. */
    status: operatorProcedure.output(connectionStatusOutputSchema).query(async ({ ctx }) => {
      // A fleet that is off is read from what the trierarch plugin holds: it asks its fleet nothing then.
      const isServed = await ctx.isServed(ctx.fleetId);
      const connection = isServed ? await ctx.readConnection(ctx.fleetId) : await ctx.heldConnection(ctx.fleetId);
      return { enabled: isServed, ...connection };
    }),
    /**
     * Connects the trierarch plugin with its ship's secret, which the
     * console's server hands over server to server: it registers with it and
     * keeps only the crew token. Only while not connected, and while the
     * trierarch plugin serves the fleet.
     */
    connect: managing(servedProcedure)
      .input(z.object({ shipId: idSchema('ship'), secret: z.string().min(1) }))
      .output(connectionStatusOutputSchema)
      .mutation(async ({ ctx, input }) => {
        const connected = await ctx.connect({ operatorFleetId: ctx.fleetId, ...input });
        if (!connected.isOk) {
          throw new TRPCError({ code: CONNECT_CODES[connected.error.kind], message: connected.error.message });
        }
        // Answered as connection.status answers: connect works only while the trierarch plugin serves the fleet.
        return { enabled: true, ...connected.value };
      }),
  }),
  machines: t.router({
    /** Brings a machine into the fleet: commissions its trierarch's ship and answers its starting prompt and setup line, once. */
    join: managing(connectedProcedure)
      .input(z.strictObject({ name: shipHandleSchema }))
      .output(joinedMachineOutputSchema)
      .mutation(async ({ ctx, input }) => {
        const joined = await ctx.joinMachine({ fleetId: ctx.fleetId, name: input.name });
        if (!joined.isOk) {
          throw new TRPCError({ code: JOIN_CODES[joined.error.kind], message: joined.error.message });
        }
        return joined.value;
      }),
    /** The fleet's machines, each with its trierarch's last report and details, read from the fleet. */
    list: connectedProcedure.output(z.array(machineOutputSchema)).query(async ({ ctx }) => {
      const listed = await ctx.listMachines(ctx.fleetId);
      if (!listed.isOk) {
        throw new TRPCError({ code: LIST_CODES[listed.error.kind], message: listed.error.message });
      }
      return listed.value.map((machine) => ({
        ...machine,
        lastSeenAt: machine.lastSeenAt?.toISOString() ?? null,
        report: machine.report && { ...machine.report, reportedAt: machine.report.reportedAt.toISOString() },
      }));
    }),
  }),
  requests: t.router({
    /**
     * Whether crew settings would be placed now, by assignment's rules, before
     * the console requests a crew with them (#245). It writes nothing.
     */
    check: connectedProcedure
      .input(z.object({ settings: z.unknown() }))
      .output(checkedSettingsOutputSchema)
      .query(async ({ ctx, input }) => {
        const checked = await ctx.checkCrewSettings(ctx.fleetId, input.settings);
        if (!checked.isOk) {
          throw new TRPCError({ code: LIST_CODES[checked.error.kind], message: checked.error.message });
        }
        return checked.value;
      }),
  }),
  installation: t.router({
    /** Switches the trierarch plugin on or off for a fleet; off keeps everything of it. A replayed request id answers its first answer. */
    setEnabled: installationProcedure
      .input(z.strictObject({ requestId: idempotencyKeySchema, fleetId: idSchema('fleet'), enabled: z.boolean() }))
      .output(z.object({ fleetId: z.string(), enabled: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const set = await ctx.setFleetEnabled({ requestId: input.requestId, fleetId: input.fleetId, isEnabled: input.enabled });
        if (!set.isOk) {
          throw new TRPCError({ code: 'CONFLICT', message: set.error.message });
        }
        return { fleetId: set.value.fleetId, enabled: set.value.isEnabled };
      }),
    /** Whether the trierarch plugin serves the fleet, and whether it is connected to it. */
    get: installationProcedure
      .input(z.strictObject({ fleetId: idSchema('fleet') }))
      .output(z.object({ enabled: z.boolean(), connected: z.boolean() }))
      .query(async ({ ctx, input }) => {
        const fleet = await ctx.readFleet({ fleetId: input.fleetId });
        return { enabled: fleet.isEnabled, connected: fleet.isConnected };
      }),
    /** Forgets everything the trierarch plugin holds of the fleet. A replayed request id answers its first answer. */
    delete: installationProcedure
      .input(z.strictObject({ requestId: idempotencyKeySchema, fleetId: idSchema('fleet') }))
      .output(z.strictObject({}))
      .mutation(async ({ ctx, input }) => {
        const deleted = await ctx.deleteFleet(input);
        if (!deleted.isOk) {
          throw new TRPCError({ code: 'CONFLICT', message: deleted.error.message });
        }
        return {};
      }),
  }),
});

export type TrierarchPluginRouter = typeof trierarchPluginRouter;
