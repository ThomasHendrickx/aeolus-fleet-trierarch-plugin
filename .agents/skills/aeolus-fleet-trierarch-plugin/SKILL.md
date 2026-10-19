---
name: aeolus-fleet-trierarch-plugin
description: Mandatory with test-driven-development for every code change in this repository. Layout, the fleet door, testing and what lint and CI enforce.
---

# The trierarch plugin

Load with `test-driven-development`; with `domain-modelling` for `src/core` and `src/adapters`; with `typescript` for every `.ts`.

Layout (`packages/trierarch-plugin/src`):
- `core/{assignment,connection,installation,machines,network,operator,shared}`: pure domain, use cases and ports. A use case is a file in `core` that exports a factory named `create<Name>` (like `createConnect`).
- `adapters/{fleet,prisma,trpc,http,crypto}`, wired in `app.ts`; the command in `bin/`; environment in `config.ts`.
- `testing/`: what other trains test against, published as `@aeolus-fleet/trierarch-plugin/testing`.

The fleet door:
- Core only over `/api/v1`, through `adapters/fleet`, with `@aeolus-fleet/common` for the shapes. Only the calls aeolus-fleet's `docs/compatibility.md` lists for the trierarch plugin.
- A call core added later raises `MINIMUM_CORE_VERSION` (`adapters/fleet/core-version.ts`) in the same PR.

Testing (decision 0014, strict):
- A `test(<context>): <rule> (red)` commit with only tests, then the `feat` or `fix` that makes it pass.
- Unit: beside the file, with hand-written in-memory fakes of the ports (`test/support`); assert outcomes and stored state.
- Integration: `test/*.integration.test.ts`, against a real core in process through `@aeolus-fleet/core/testing`, on Testcontainers Postgres from core's global setup.

Enforced by lint/CI (`eslint.config.js`, `scripts/`): a `feat` or `fix` commit touching `src` comes right after a `(red)` commit with only tests (every other commit type passes), a test beside every use case, every test in a Vitest project, npm only, no em dash; in `src/core` no Prisma, pg, Fastify, tRPC, adapter or `@aeolus-fleet/core` import, no clock, crypto, `Math.random` or `throw`; Prisma only in `adapters/prisma`; no `vi.mock` anywhere, no `vi.fn` or `vi.spyOn` in `src/core`; casts, exhaustive switches, parameter count, boolean names, default exports, file names.
