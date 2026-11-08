# Enabled models for ships: read, refused when requested, told when given back

Design for [#57](https://github.com/ThomasHendrickx/aeolus-fleet-trierarch-plugin/issues/57). Docs only. Status: purpose, lessons and questions sent to Thomas for his answer; no rule below is decided until he answers.

## 1. Purpose (for Thomas to agree)

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

- **Q1. Where is a request for a disabled model refused?** 1, core holds a copy: the plugin writes the fleet's enabled models to core through a new call (with `crew:assign`), and `crewRequest` refuses a named model outside a non-empty copy, as it refuses an unknown label value; the set stays the plugin's (pick). 2, the plugin's next pass (within 10 s) writes the reason and the requester is told as in Q3; no core change, but the request is still accepted. 3, core asks the plugin during `crewRequest` (against L3). 4, none of these.
- **Q2. How does a ship read the enabled models?** 1, from core's copy (Q1 option 1), a new call with `fleet:read` (pick). 2, in the plugin ship's statement, read with `discover`. 3, a message to the plugin's ship, answered with the set. 4, none of these.
- **Q3. Who is told when every trierarch that fits gave a request back, and by whom?** 1, core records the requester on the crew request (the ship that last made it) and the plugin's ship sends it a message with the reason, once per settings version, with a declared rule that lets the plugin's ship send to requesters (pick). 2, the plugin's ship tells the ship's owner, which core records already; no core change. 3, core itself sends the requester a message when the reason is written. 4, none of these.
- **Q4. Which reasons are told?** 1, only the give-back one, as #57 asks (pick). 2, every reason placement writes, once per change, which also covers a model disabled after the request (L6, aeolus-fleet#1256). 3, none of these.
- **Q5. Screens.** No console screen changes in outcomes 1 to 3; the console's forms already leave disabled models out. 1, no mockups for this design (pick). 2, the crew request card shows who was told; mockups before and after. 3, none of these.

## 4. Repositories and slices, by the picks

These hold only if Thomas takes the picks; other answers change them.

- **aeolus-fleet (core and common):** the copy of a fleet's enabled models and its write and read calls; `crewRequest` refusing a named model outside it; the requester on the crew request; the message's content type in common; `docs/compatibility.md` listing the new calls for the trierarch plugin; decision 0029 amended.
- **aeolus-fleet-trierarch-plugin:** writing the copy on every change and at connect; sending the requester the reason once per settings version; `MINIMUM_CORE_VERSION` raised; decision 0063 amended.

Slices, each ending on its tests by name:

1. **Core: the copy, the refusal and the read** (aeolus-fleet).
2. **Core: the requester on the crew request and the message's content type** (aeolus-fleet).
3. **The plugin writes the copy** (this repository), after slice 1's release.
4. **The plugin tells the requester** (this repository), after slice 2's release.
