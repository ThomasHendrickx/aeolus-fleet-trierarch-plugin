import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { UsageGrain } from './token-usage.js';

/** The longest range read in hours; anything longer is read in UTC days. */
const HOURS_UP_TO_MS = 7 * 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * The grain a range of usage is read in (the usage design, U15): hours up to 7
 * days, UTC days past that. A range starts before it ends, and starts and ends
 * on its grain: a whole hour, or a UTC midnight.
 */
export function usageGrain(range: { readonly from: Date; readonly to: Date }): Result<UsageGrain, DomainError<'INVALID_RANGE'>> {
  const length = range.to.getTime() - range.from.getTime();
  if (length <= 0) {
    return refuse('INVALID_RANGE', 'A range ends after it starts');
  }
  const grain: UsageGrain = length <= HOURS_UP_TO_MS ? 'hour' : 'day';
  const unit = grain === 'hour' ? HOUR_MS : DAY_MS;
  if (range.from.getTime() % unit !== 0 || range.to.getTime() % unit !== 0) {
    return refuse('INVALID_RANGE', grain === 'hour' ? 'A range of hours starts and ends on a whole hour' : 'A range of days starts and ends at a UTC midnight');
  }
  return ok(grain);
}
