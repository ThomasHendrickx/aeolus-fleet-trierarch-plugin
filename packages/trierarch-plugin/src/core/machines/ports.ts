/** Outbound port: a new idempotency key for each commission the trierarch plugin makes. */
export interface IdempotencyKeys {
  next(): string;
}
