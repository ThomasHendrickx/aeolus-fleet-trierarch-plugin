import { idSchema } from '@aeolus-fleet/common';

import type { McpDelivery } from '../../core/mcp-configuration/mcp-delivery.js';
import type { McpDeliveries } from '../../core/mcp-configuration/ports.js';
import type { Db } from './client.js';

interface Row {
  trierarchShipId: string;
  attemptVersion: number | null;
  attemptPublicKey: string | null;
  attemptIdempotencyKey: string | null;
  attemptPayload: string | null;
  attemptSentAt: Date | null;
  appliedVersion: number | null;
  appliedPublicKey: string | null;
  isRequested: boolean;
}

function deliveryOf(row: Row): McpDelivery {
  const { attemptVersion, attemptPublicKey, attemptIdempotencyKey, attemptPayload, appliedVersion, appliedPublicKey } = row;
  return {
    trierarchShipId: idSchema('ship').parse(row.trierarchShipId),
    attempt:
      attemptVersion === null || attemptPublicKey === null || attemptIdempotencyKey === null || attemptPayload === null
        ? null
        : { version: attemptVersion, publicKey: attemptPublicKey, idempotencyKey: attemptIdempotencyKey, payload: attemptPayload, sentAt: row.attemptSentAt },
    applied: appliedVersion === null || appliedPublicKey === null ? null : { version: appliedVersion, publicKey: appliedPublicKey },
    isRequested: row.isRequested,
  };
}

/**
 * Each fleet's deliveries of its MCP configuration, one row per trierarch
 * ship. Every change is one upsert or update of its own columns, so the
 * assignment pass recording an attempt and the inbox round recording a
 * confirmation or a request at the same time both stand.
 */
export function createPrismaMcpDeliveries(db: Db): McpDeliveries {
  const upsert = ({ fleetId, trierarchShipId }: { fleetId: string; trierarchShipId: string }, data: Partial<Omit<Row, 'trierarchShipId'>>) =>
    db.mcpDelivery.upsert({ where: { fleetId_trierarchShipId: { fleetId, trierarchShipId } }, create: { fleetId, trierarchShipId, ...data }, update: data, select: { fleetId: true } });
  return {
    list: async (fleetId) => (await db.mcpDelivery.findMany({ where: { fleetId }, orderBy: { trierarchShipId: 'asc' } })).map(deliveryOf),
    recordAttempt: async (fleetId, { trierarchShipId, attempt }) => {
      await upsert({ fleetId, trierarchShipId }, {
        attemptVersion: attempt.version,
        attemptPublicKey: attempt.publicKey,
        attemptIdempotencyKey: attempt.idempotencyKey,
        attemptPayload: attempt.payload,
        attemptSentAt: attempt.sentAt,
        isRequested: false,
      });
    },
    markSent: async (fleetId, { trierarchShipId, idempotencyKey, at }) => {
      await db.mcpDelivery.updateMany({ where: { fleetId, trierarchShipId, attemptIdempotencyKey: idempotencyKey }, data: { attemptSentAt: at } });
    },
    recordApplied: async (fleetId, { trierarchShipId, applied }) => {
      await upsert({ fleetId, trierarchShipId }, { appliedVersion: applied.version, appliedPublicKey: applied.publicKey });
    },
    markRequested: async (fleetId, trierarchShipId) => {
      await upsert({ fleetId, trierarchShipId }, { isRequested: true });
    },
    forget: async (fleetId, trierarchShipIds) => {
      await db.mcpDelivery.deleteMany({ where: { fleetId, trierarchShipId: { in: [...trierarchShipIds] } } });
    },
  };
}
