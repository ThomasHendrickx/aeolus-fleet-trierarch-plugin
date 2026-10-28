import type { ShipId } from '@aeolus-fleet/common';

/** The four kinds of tokens a trierarch reads from a harness's transcripts, each a count. */
export interface TokenCounts {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
}

/** The estimated cost in USD of each kind of tokens, at the trierarch's price table. */
export interface TokenCosts {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
}

/**
 * One ship's tokens of one model in one UTC hour, in one folder of the ship on
 * the machine (the usage design): the hour's total so far, set, never added.
 */
export interface UsageHour {
  /** The start of the UTC hour the tokens were used in, by the transcript's own time. */
  readonly hour: Date;
  readonly shipId: ShipId;
  /** Tells two folders of one ship on one machine apart. */
  readonly folderMadeAt: Date;
  readonly model: string;
  readonly harness: string;
  /** The subscription or API key the ship ran on; null while the trierarch reports none. */
  readonly login: string | null;
  readonly tokens: TokenCounts;
  /** Per kind, at the trierarch's price table when it was read; null for a model it does not price. */
  readonly estimatedCostUsd: TokenCosts | null;
}

/** How full one subscription window of a harness was when the trierarch read it. */
export interface SubscriptionWindow {
  readonly windowMinutes: number;
  readonly usedPercent: number;
  readonly resetsAt: Date;
}

/** One reading of a harness's subscription windows on the machine. */
export interface SubscriptionReading {
  readonly harness: string;
  readonly readAt: Date;
  readonly windows: readonly SubscriptionWindow[];
}

/** What one trierarch sends of its machine's usage: the hours changed since its last send, and its subscription readings since. */
export interface UsageReading {
  /** The trierarch ship of the machine that read it. */
  readonly machineShipId: ShipId;
  readonly readAt: Date;
  readonly hours: readonly UsageHour[];
  readonly subscriptions: readonly SubscriptionReading[];
}
