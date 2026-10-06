import { refuse, type DomainError } from '../shared/errors.js';
import type { Err } from '../shared/result.js';
import type { InstallationRequest, InstallationRequests } from './ports.js';

/** What a request id already answered: the earlier request when it is the same one, a refusal when it was another. */
export async function earlierAnswer(
  requests: InstallationRequests,
  request: { requestId: string; requestHash: string },
): Promise<InstallationRequest | Err<DomainError<'REQUEST_ID_USED'>> | undefined> {
  const earlier = await requests.find(request.requestId);
  if (!earlier) {
    return undefined;
  }
  return earlier.requestHash === request.requestHash ? earlier : refuse('REQUEST_ID_USED', `The request id ${request.requestId} was used for another request`);
}
