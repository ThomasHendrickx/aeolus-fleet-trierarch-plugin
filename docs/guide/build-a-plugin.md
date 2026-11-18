# Building a plugin for Aeolus

This guide is for a developer building a plugin for a fleet. The trierarch plugin brings computers into a fleet and places crew requests on them.

For the general path, start with core's [guide to writing a plugin](https://github.com/ThomasHendrickx/aeolus-fleet/blob/main/docs/guide/write-a-plugin.md). It explains the [plugin](https://github.com/ThomasHendrickx/aeolus-fleet/blob/main/docs/guide/words.md#plugin), its ship, and the minimum core version. This page follows that path using the trierarch plugin's authenticated calls as an example.

## 1. Choose what the plugin does

The [trierarch plugin architecture](../trierarch-plugin.md) shows its division of work; the [core compatibility reference](https://github.com/ThomasHendrickx/aeolus-fleet/blob/main/docs/compatibility.md) lists the fleet calls this plugin uses and its minimum core version. Authenticated plugin calls use core 0.42.0 or later and `@aeolus-fleet/common` for the shared boundary.

## 2. Connect a ship

Have the operator commission a ship of kind `plugin`; connecting it needs `fleet:connect`. Follow core's [plugin guide](https://github.com/ThomasHendrickx/aeolus-fleet/blob/main/docs/guide/write-a-plugin.md) and [Ship contract](https://github.com/ThomasHendrickx/aeolus-fleet/blob/main/docs/guide/ship-contract.md). The trierarch plugin's [running instructions](../../packages/trierarch-plugin/README.md#running) show how its operator connects its ship and how it resumes connections.

## 3. Declare permissions for your operations

The plugin ship needs `scopes:declare` to declare its scopes. See core's [Scopes guide](https://github.com/ThomasHendrickx/aeolus-fleet/blob/main/docs/guide/scopes.md) for the general rules. The trierarch plugin declares `trierarch:repositories` and requires it for all three repository operations. The [scope declaration](../../packages/trierarch-plugin/src/core/scopes/declare-scopes.ts) and [repository use case](../../packages/trierarch-plugin/src/core/repositories/manage-repositories.ts) show this in code.

## 4. Expose authenticated calls

Use core's [plugin calls reference](https://github.com/ThomasHendrickx/aeolus-fleet/blob/main/docs/plugin-calls.md) to configure core's target and build the private boundary with `createPluginBoundary`. It covers the listener, shared secrets, verified context, durable replay reservations, operation map and secret rotation. Expose only the operations you intend to support. Validate each input and effective scope, use the verified fleet and actor, and keep a change and its actor event together in a transaction.

The trierarch plugin mounts `POST /dispatch` on a separate private listener. Its [dispatch adapter](../../packages/trierarch-plugin/src/adapters/http/plugin-dispatch.ts) binds the context to the connected ship; its [repository procedures](../../packages/trierarch-plugin/src/adapters/http/repository-procedures.ts) expose `repositories.list`, `repositories.add` and `repositories.remove`. They keep a versioned list per fleet: read the list before a change and supply its version; on a conflict, read again before deciding what to do. These calls store the list but do not yet distribute it or use it for placement; `TRUSTED_REPOSITORIES` still supplies distribution.

## 5. Run and check your plugin

Start your plugin and connect its ship. Configure core with the complete private endpoint and matching secret as described in the [plugin calls reference](https://github.com/ThomasHendrickx/aeolus-fleet/blob/main/docs/plugin-calls.md#deployment). Call an exposed read operation through `fleet.callPlugin` as an actor with the needed scope, then try a permitted change and read it back. Check that an actor without the scope is refused and that a stale version cannot overwrite a newer change. If the answer to a write is uncertain, read the state before making a new call.

For the trierarch plugin's listener settings and deployment steps, see its [running instructions](../../packages/trierarch-plugin/README.md#running). For the call shapes, admission and failure semantics, use [core's plugin calls reference](https://github.com/ThomasHendrickx/aeolus-fleet/blob/main/docs/plugin-calls.md) and the actor contract linked from it.
