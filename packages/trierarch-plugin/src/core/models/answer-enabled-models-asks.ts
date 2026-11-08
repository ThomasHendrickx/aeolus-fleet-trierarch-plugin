import { ENABLED_MODELS_ASK_CONTENT_TYPE, ENABLED_MODELS_CONTENT_TYPE, enabledModelsSchema } from '@aeolus-fleet/common';

import type { AnswerAsk } from '../connection/answer-pings.js';
import type { FleetDoor } from '../connection/ports.js';
import type { IsServed } from '../installation/served.js';
import type { EnabledModels } from './ports.js';

const ALREADY_ANSWERED = 'CONFLICT';

/**
 * Use case: any ship asks the plugin's ship for the fleet's enabled models
 * (the enabled models design, R1). The reply is sent inReplyTo the ask with the
 * fleet's set as it is now, sorted; an empty list is no rule (decision 0063).
 * The key is made from the ask's message id, so a crash after the reply answers
 * again and the fleet stores the reply once; a reply it holds already, whatever the set was then, is the answer. A fleet the plugin does not serve
 * leaves the ask waiting (R6). A store that fails rejects, so the ask is not
 * acked and is handed again.
 */
export function createAnswerEnabledModelsAsks(deps: { door: FleetDoor; models: EnabledModels; isServed: IsServed }): AnswerAsk {
  return async (crew, delivery) => {
    if (delivery.contentType !== ENABLED_MODELS_ASK_CONTENT_TYPE) {
      return { kind: 'notAsk' };
    }
    if (!(await deps.isServed(crew.fleetId))) {
      return { kind: 'left' };
    }
    const models = (await deps.models.list(crew.fleetId)).toSorted();
    const sent = await deps.door.send(crew.crewToken, {
      shipId: delivery.senderShipId,
      contentType: ENABLED_MODELS_CONTENT_TYPE,
      payload: JSON.stringify(enabledModelsSchema.parse({ models })),
      idempotencyKey: `trierarch-plugin:enabled-models:${delivery.messageId}`,
      inReplyTo: delivery.messageId,
    });
    // CONFLICT: the fleet holds a reply under this key already, sent before a crash or a lost ack, when the set was another; it is answered.
    return { kind: sent.isOk || sent.error.code === ALREADY_ANSWERED ? 'answered' : 'refused' };
  };
}
