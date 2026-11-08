# Enabled models for ships: read, refused by the plugin, told why a request waits

Design for [#57](https://github.com/ThomasHendrickx/aeolus-fleet-trierarch-plugin/issues/57). Docs only. Status: purpose agreed by Thomas (8 Nov); Q1 to Q3 answered; Q4 and Q5 wait for his answers, and no rule below is decided until he answers.

## 1. Purpose (agreed by Thomas, 8 Nov)

A ship that asks for crews learns, without a person, what the fleet lets it ask for and why a request of its own is not crewed (Thomas, 8 Nov: "That is a trierarchs plugin issue to fix").

For whom: every ship that makes crew requests (an orchestrator, squadrons forming a squadron, a session through MCP or REST). Second: the operator, who today is the only one who sees why, by reading the console.

A good outcome:
1. A ship with crew rights reads the fleet's enabled models (decision [0063](../decisions/0063-model-governance.md)) through the fleet, as the console does with `models.list`.
2. A crew request that names a model the fleet does not enable is refused when it is made, with the reason, never answered OK and left at awaitingCrew (seen 7 and 8 Nov with `gpt-5.6-terra`).
3. When every trierarch that fits gives a request back, the ship that made the request gets a message with the reason, rather than the request sitting at awaitingCrew with the reason only on the console.
4. A fleet with no enabled models behaves as today (0063: an empty set is no rule).

Not the purpose: changing what placement picks or the rules of 0063; stopping or moving a running or assigned crew (0063, 0030); the console's crew forms, which already leave disabled models out; telling argo when the enabled models change ([aeolus-fleet#1256](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1256)), unless Thomas widens outcome 3 (Q4).

## 2. Lessons to check against

| # | Lesson | Source |
| --- | --- | --- |
| L1 | Core already refuses, at `crewRequest`, a request no trierarch could ever take (settings that are not crew settings, an unknown label value): "a request no trierarch could ever take must not be answered OK and then wait unseen". Outcome 2 is the same promise for a disabled model. | aeolus-fleet 0029; aeolus-fleet#809, #811 |
| L2 | Core never acts on crew settings and accepts a request naming any model; the trierarch plugin, which alone places, is the one guard. 0063 rejected the enabled models as a fleet setting in core. A refusal made by core at the call touches that rejection, so it is a question (Q1), not a choice made here. | 0063; aeolus-fleet 0029 |
| L3 | Aeolus knows nothing about the trierarch plugin beyond its ship, and plugins that know each other were rejected. Core cannot ask the plugin during `crewRequest`. | [0030](../decisions/0030-trierarch-plugin.md) |
| L4 | Crew state in a plugin's own database was rejected because requesters would have to know the plugin. Requests stay with core; a read of the models that goes to the plugin's ship makes requesters know the plugin. | aeolus-fleet 0029, Rejected |
| L5 | A request that names no model fits only a trierarch whose reported default for the harness is enabled; only placement knows the reports. A refusal at the call can cover a named model only: a request naming none still waits with `model disabled: no enabled default model for <harness>`. | 0063; `core/assignment/placement.ts` |
| L6 | Only placing is checked, and a change takes effect at the next assignment pass. A request accepted before its model is disabled still waits with `model disabled: <id>`, so a refusal at the call never covers every case. | 0063 |
| L7 | The crew request records no requester: the settings, version, assignment, status, reason and give-backs only. "The ship that made the request" exists in the event log at most. Who crewed it is derived, never stored. The ship's owner is recorded (0045). | common `schemas/crew-request.ts`; aeolus-fleet 0029 |
| L8 | With network rules applied, a send needs a rule or a built-in. The plugin's ship declares only `trierarch=*` to `trierarch=*`; the answer built-in covers only a reply (inReplyTo); argo and the owner built-ins cover only those ships. A message from the plugin's ship to any requester can be refused `NOT_REACHABLE`. | aeolus-fleet 0034, 0037 |
| L9 | No human passes messages or watches flags: the operator is not the fail-safe. Today only the console's needs-crew to-do shows why a request waits. | blueprint, promise 2 |
| L10 | When every trierarch that fits gave a request back, placement writes `given back by every trierarch that fits; last: <reason>` (`CrewRequestExplained`), rewritten only when it changes. The give-back records are cleared on every new settings version. | `core/assignment/placement.ts`; aeolus-fleet 0029, #382 |
| L11 | The plugin already tells argo once per ship, settings version and stated model when a stated model differs from the request's, storing the notice once under its idempotency key, so a restart tells nothing again. | `core/assignment/tell-model-mismatches.ts` |
| L12 | Requests reach core through the console, MCP, REST and squadron templates (`crew.model`): squadrons is a requester too. | 0063 design L10; aeolus-fleet 0004 |
| L13 | The plugin calls only what aeolus-fleet's `docs/compatibility.md` lists; a new call is listed there and `MINIMUM_CORE_VERSION` is raised in the same PR. Before 1.0.0, no compatibility work. | CLAUDE.md; aeolus-fleet 0013 |
| L14 | Every signed-in session reads the set, viewer included (`models.list`); only changing it takes `fleet:manage`. | 0063 |

## 3. Questions

Sent to Thomas on Bridge, each with a pick and a "none of these" option. The rules, flows, repositories and slices follow from his answers.

- **Q1. Where is a request for a disabled model refused?** Answered (Thomas, 8 Nov): option 2, by the plugin, never in core. The request is accepted; the plugin's next assignment pass (within 10 s) writes the reason and tells the requester (Q3). Why: "Writing models to core would mean the plugin logic leaks into core plus the plugin needs to update core and we get 2 sources of truth. A model can change both due to selection changing and by the updates of the harnesses on the different trierarchs. That would introduce race conditions." So outcome 2 reads: refused by the plugin's next pass, with the reason told to the ship that asked.
- **Q2. How does a ship read the enabled models?** Answered (Thomas, 8 Nov): a message to the plugin's ship, answered as a reply with the exact set as it is now; a content type in common for each. With network rules applied, the requester needs a rule that lets it reach the plugin's ship; the reply goes back by the answer built-in.
- **Q3. Who is told, and by whom?** Answered (Thomas, 8 Nov): option 1. Core records the requester on the crew request (the ship that last made it), and the plugin's ship sends it the reason once per settings version, with a declared rule that lets the plugin's ship send to requesters.
- **Q4. Which reasons are told?** (replaced after Q1) 1, `model disabled` and the give-back reason, each once per settings version (pick). 2, every reason placement writes, once per change, which also covers aeolus-fleet#1256. 3, none of these.
- **Q5. Screens.** No console screen changes in outcomes 1 to 3; the console's forms already leave disabled models out. 1, no mockups for this design (pick). 2, the crew request card shows who was told; mockups before and after. 3, none of these.

## 4. Repositories and slices, by the picks

These hold only if Thomas takes the open picks; other answers change them.

- **aeolus-fleet (core and common):** the requester on the crew request (Q3); the content types in common for asking the plugin's ship for the set and for telling a requester why its request waits; `docs/compatibility.md` listing what the plugin newly calls; decision 0029 amended. No enabled models in core (Q1).
- **aeolus-fleet-trierarch-plugin:** answering a ship that asks for the set; telling the requester `model disabled` and the give-back reason once per settings version; declaring the send rules it needs; `MINIMUM_CORE_VERSION` raised; decision 0063 amended.

Slices, each ending on its tests by name:

1. **Core and common: the requester on the crew request and the content types** (aeolus-fleet).
2. **The plugin answers a ship that asks for the enabled models** (this repository), after slice 1's release.
3. **The plugin tells the requester why its request waits** (this repository), after slice 1's release.
