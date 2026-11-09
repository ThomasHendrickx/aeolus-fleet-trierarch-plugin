/**
 * The delivery of a fleet's MCP configuration to one of its trierarchs (the
 * fleet crew MCP design, section 5): the attempt last made, under the
 * idempotency key it keeps until the fleet took it, and the version and key
 * the trierarch confirmed it applied. Reconciliation converges on the latest
 * set: confirmed application, never a send or its acknowledgement, ends it.
 */
import type { ShipId } from '@aeolus-fleet/common';

/** A sealed copy of one version for one key: what it carried, under which key, and when the fleet took it; null while that is not known. */
export interface McpAttempt {
  readonly version: number;
  readonly publicKey: string;
  readonly idempotencyKey: string;
  /** The message as sent: a retry under its key sends the very same, as the fleet takes a key only for one message. */
  readonly payload: string;
  readonly sentAt: Date | null;
}

/** A version and key a trierarch confirmed it applied. */
export interface McpApplied {
  readonly version: number;
  readonly publicKey: string;
}

/** One trierarch's delivery: its last attempt, its confirmation, and whether it asked for the set since. */
export interface McpDelivery {
  readonly trierarchShipId: ShipId;
  readonly attempt: McpAttempt | null;
  readonly applied: McpApplied | null;
  readonly isRequested: boolean;
}

/** What a trierarch needs: the fleet's current version, sealed to the key its report states. */
export interface McpTarget {
  readonly version: number;
  readonly publicKey: string;
}

/** What a pass does for a trierarch: nothing; the attempt it made again, under its key; or a new attempt under a new key. */
export type McpSend = { readonly kind: 'none' } | { readonly kind: 'retry'; readonly attempt: McpAttempt } | { readonly kind: 'new' };

/** How long after a copy the fleet took, with no confirmation since, a pass sends another: a lost delivery or confirmation is made up for, without a copy every pass. */
export const RESEND_UNCONFIRMED_AFTER_MS = 5 * 60_000;

/** Whether the trierarch confirmed the version for the key: what placement and the next send rely on. */
export function isMcpConfigurationCurrent(delivery: McpDelivery | undefined, target: McpTarget): boolean {
  return delivery?.applied?.version === target.version && delivery.applied.publicKey === target.publicKey;
}

/**
 * Policy: what a pass sends a trierarch. Confirmed for the version and its
 * key, and not asked since: nothing. Asked: a new attempt, even if one was
 * sent. An attempt of the version and key the fleet has not taken yet: the
 * same again, under its key. One the fleet took: nothing until
 * RESEND_UNCONFIRMED_AFTER_MS passed without a confirmation, then a new
 * attempt. Any other version or key: a new attempt.
 */
export function nextMcpSend(delivery: McpDelivery | undefined, at: { target: McpTarget; now: Date }): McpSend {
  const { target, now } = at;
  if (delivery?.isRequested === true) {
    return { kind: 'new' };
  }
  if (isMcpConfigurationCurrent(delivery, target)) {
    return { kind: 'none' };
  }
  const attempt = delivery?.attempt;
  if (attempt?.version !== target.version || attempt.publicKey !== target.publicKey) {
    return { kind: 'new' };
  }
  if (attempt.sentAt === null) {
    return { kind: 'retry', attempt };
  }
  return now.getTime() - attempt.sentAt.getTime() >= RESEND_UNCONFIRMED_AFTER_MS ? { kind: 'new' } : { kind: 'none' };
}
