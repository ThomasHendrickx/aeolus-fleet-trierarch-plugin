# @aeolus-fleet/trierarch-plugin

The trierarchs' plugin on the server side (decision 0030): it brings machines into the fleet and assigns crew requests to their trierarchs. Optional: a fleet works without it. Aeolus knows nothing about it beyond its ship, which holds `fleet:read`, `fleet:manage` and `crew:assign` and reaches the fleet only through its public API. What it does is in [docs/trierarch.md](../../docs/trierarch.md).

So far: its own process and small database (each fleet's connection and switch), the connection the operator makes as its ship, a machine joining, the machines with their trierarchs' reports, assignment (docs/trierarch.md, "Assignment"), the installation procedures, `/api/health` and `/api/version`.

Assignment runs as a pass for every fleet it serves and is connected to. Each pass reads the fleet whole: the unassigned requests of ships that await crew, and the trierarchs that report details and are not silent. It claims each request it places, by optimistic claim, and writes the reason on each it cannot. A claim the fleet refuses because the request changed (another pass won it, or the ship was crewed or its request removed) is read again on the next pass. Run more than one process if you like: the fleet stores exactly one assignment per request.

## Running

1. Give it its own database and set its environment. No ship and no secret: the operator connects it.

| Variable | Required | What |
| --- | --- | --- |
| `DATABASE_URL` | yes | Its own Postgres database (`postgres://...`); it may share the Postgres server with the fleet and squadrons |
| `FLEET_URL` | yes | The fleet's public URL; it calls the ship API at `<FLEET_URL>/api/v1`, checks console sessions there, and names it in each joining machine's setup line. Not a secret; fixed here, so no caller can point it at another fleet |
| `HOST`, `PORT` | no | Where it listens; `127.0.0.1:4200` by default |
| `LOG_LEVEL` | no | `info` by default |
| `INSTALLATION_TOKEN` | no | The token a hosting service presents to its installation procedures, at least 32 characters (decision 0021). Unset: they do not exist and every fleet is served, as a self-hosted install needs |
| `TRIERARCH_SILENT_AFTER_SECONDS` | no | A trierarch whose last seen is older than this is silent: it gets no new requests. `300` by default |
| `TRIERARCH_PASS_INTERVAL_SECONDS` | no | How often assignment runs a pass for each fleet. `10` by default |

2. `aeolus-trierarch-plugin start` migrates the database, serves, and runs an assignment pass every interval. Every fleet it serves whose kept crew token its fleet still takes is connected again; any other fleet is not connected. `aeolus-trierarch-plugin migrate` migrates alone.
3. Each fleet's operator connects it: commission its ship with `fleet:read`, `fleet:manage` and `crew:assign`, and hand the ship's secret to `connection.connect`, server to server. It registers as a server and keeps only the crew token; the secret is never stored or logged. The console's screens for it come later.

## API

One tRPC router at `/trpc`, called with the console's session cookie, which the fleet checks through `console.session`. Every procedure but the installation's works on the session's fleet.

| Procedure | What |
| --- | --- |
| `connection.status` | Whether it serves the fleet and is connected, as which ship, and the ship it was last connected as |
| `connection.connect` | Connects with its ship's id and secret (`fleet:manage` session). Refused while connected (CONFLICT), for a ship of another fleet or without the three scopes (BAD_REQUEST) |
| `machines.join` | Brings a machine in, by name (`fleet:manage` session): commissions a ship of type `trierarch` with `crew:run` and answers its starting prompt, crew lines, secret and setup line, `npx @aeolus-fleet/trierarch init --fleet-url <url> --ship-id <id> --secret <secret>`, each shown once. A name an active ship holds: CONFLICT |
| `machines.list` | The fleet's active ships of type `trierarch`, each with its trierarch's last report and details (null until it reports), and whether it is silent |
| `requests.check` | Whether crew settings would be placed now, by assignment's rules, before a crew is requested with them: `fits`; `refused` with the settings field at fault and why; or `noRoom` when they fit but no trierarch has room (a request would wait). Writes nothing |
| `installation.setEnabled`, `get`, `delete` | With `x-aeolus-installation-token`: switches a fleet on or off, reads it, forgets it (decision 0021) |

While it is off for the fleet, every procedure but `connection.status` answers FORBIDDEN; until it is connected, `machines.*` answer PRECONDITION_FAILED.
