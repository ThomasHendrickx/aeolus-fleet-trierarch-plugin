import { err, type Err } from './result.js';

/** Every reason the trierarch plugin's core refuses a request. */
export type DomainErrorKind =
  | 'ALREADY_CONNECTED'
  | 'SECRET_REFUSED'
  | 'OTHER_FLEET'
  | 'MISSING_SCOPES'
  | 'NOT_THE_OPERATOR'
  | 'REQUEST_ID_USED'
  | 'NOT_CONNECTED'
  | 'NAME_TAKEN'
  | 'FLEET_UNAVAILABLE';

/** Why the core refused a request. Adapters map the kind to their own error shape; the message is safe to show. */
export interface DomainError<K extends DomainErrorKind = DomainErrorKind> {
  readonly kind: K;
  readonly message: string;
}

/** A refusal: the error result of the given kind. */
export function refuse<K extends DomainErrorKind>(kind: K, message: string): Err<DomainError<K>> {
  return err({ kind, message });
}
