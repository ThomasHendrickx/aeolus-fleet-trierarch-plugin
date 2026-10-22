# Timings and limits

Every fixed timing and limit of the trierarch plugin, for debugging. This page holds no rules of its own: each line points to the constant that sets it and the decision, issue or doc that says why. When a value here and its source disagree, the source wins; fix this page. The limits every package shares, from `@aeolus-fleet/common`, are in aeolus-fleet's [timings and limits](https://github.com/ThomasHendrickx/aeolus-fleet/blob/main/docs/timings-and-limits.md).

A default that configuration may change names its setting.

| Value | What it guards | Set in | Behind |
| --- | --- | --- | --- |
| 300 s (default, `TRIERARCH_SILENT_AFTER_SECONDS`) | A machine whose trierarch has no last seen this long is silent | [machines/silent.ts](../packages/trierarch-plugin/src/core/machines/silent.ts) `DEFAULT_SILENT_AFTER_MS` | [0030](decisions/0030-trierarch-plugin.md), [trierarch.md](https://github.com/ThomasHendrickx/aeolus-fleet-trierarch/blob/main/docs/trierarch.md#assignment) |
| 10 s (default, `TRIERARCH_PASS_INTERVAL_SECONDS`) | Between assignment passes per fleet; a pass still running skips the next | [config.ts](../packages/trierarch-plugin/src/config.ts) `DEFAULT_PASS_INTERVAL_SECONDS` | [trierarch plugin README](../packages/trierarch-plugin/README.md) |
| 1 s | Between rounds of the plugin's ship taking what waits for it: argo's ping is answered within about this long; a round still running skips the next | [app.ts](../packages/trierarch-plugin/src/app.ts) `PING_ROUND_MS` | [aeolus-fleet#1113](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1113) |
| 10 s (Prisma's), tried again without end | Prisma Migrate's advisory lock at start | [prisma/migrate.ts](../packages/trierarch-plugin/src/adapters/prisma/migrate.ts) `LOCK_TIMED_OUT` | none recorded |
| at least 32 characters | `INSTALLATION_TOKEN`, when set | [config.ts](../packages/trierarch-plugin/src/config.ts) `INSTALLATION_TOKEN_MIN_LENGTH` | [0020](https://github.com/ThomasHendrickx/aeolus-fleet/blob/main/docs/decisions/0020-installation.md) |
