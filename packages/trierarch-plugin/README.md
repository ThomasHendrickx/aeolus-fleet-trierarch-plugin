# @aeolus-fleet/trierarch-plugin

Brings your machines into the fleet and places each crew request on a machine that fits. It is the trierarchs' plugin on the server side (decision 0030). Optional: a fleet works without it. Aeolus knows nothing about it beyond its ship, which holds `fleet:read`, `fleet:commission`, `crew:assign`, `crew:run`, `labels:define`, `labels:assign` and `scopes:declare` and reaches the fleet only through its public API. What it does is in [docs/trierarch.md](https://github.com/ThomasHendrickx/aeolus-fleet-trierarch/blob/main/docs/trierarch.md).

So far: its own process and small database (each fleet's connection, switch, enabled models and MCP configuration), the connection the operator makes as its ship, a machine joining, the machines with their trierarchs' reports, assignment (docs/trierarch.md, "Assignment"), the installation procedures, `/api/health` and `/api/version`.

Each pass also sends every trierarch the trusted repositories (`TRUSTED_REPOSITORIES`) once per process, in a message of type `application/vnd.aeolus.trierarch.trusted-repositories+json` whose payload is `{"repositories":[{"name","url"}]}`. A restart sends them again, so a changed list reaches every trierarch. A trierarch that asks, with a message of type `application/vnd.aeolus.trierarch.trusted-repositories-request+json`, gets them again on the next pass: one does as it starts knowing the trierarch plugin's ship.

Each fleet keeps its own crew-time MCP configuration: the remote MCP servers (Streamable HTTP) a session of that fleet may be crewed with, and the secrets their credentials name (the fleet crew MCP design in aeolus-fleet's `docs/design/fleet-crew-mcp`). A manager reads and replaces it through `mcp.get` and `mcp.replace`. Each pass sends every crewed trierarch of the fleet that is not silent and states a sealing key (`details.sealingKey`, `{"scheme":"nacl-sealed-box","publicKey"}`) the complete set, an empty one too, in a message of type `application/vnd.aeolus.trierarch.mcp-configuration+json` whose payload is `{"fleetId","pluginShipId","version","publicKey","servers":[{"name","url","transport","tools","credential"}],"secrets":[{"name","sealed"}]}`: `transport` is always `streamable-http`, `credential` (`{"secret","header"}`) only on a server that has one, and each secret's value sealed to that key with the NaCl anonymous sealed box, as standard base64. The fleet stores only what it cannot read. A trierarch without a key is sent nothing and takes no request naming MCP servers.

Sending is not applying. A trierarch confirms with `application/vnd.aeolus.trierarch.mcp-configuration-applied+json`, `{"fleetId","pluginShipId","version","publicKey"}`; the plugin counts it only from a crewed trierarch, for this fleet and plugin ship, the current version and the key it was last sent. Until then, each pass sends it the set again: an attempt the fleet did not take goes again under the same idempotency key, kept in the database before the send, so a restart sends the very same message; one the fleet took without a confirmation gets a new copy under a new key at most every 5 minutes. A new version, a new key, or a trierarch seen not crewed gets a fresh copy. A trierarch that asks with `application/vnd.aeolus.trierarch.mcp-configuration-request+json`, `{"fleetId","pluginShipId"}`, gets a new copy on the next pass. A request naming MCP servers is placed only on a trierarch whose confirmed version and key are the current ones; one naming none needs no MCP configuration.

Assignment runs as a pass for every fleet it serves and is connected to. Each pass reads the fleet whole: the unassigned requests of ships that await crew, and the trierarchs that report details and are not silent; with them, the fleet's enabled models from its own database (decision 0063). It claims each request it places, by optimistic claim, and writes the reason on each it cannot. A claim the fleet refuses because the request changed (another pass won it, or the ship was crewed or its request removed) is read again on the next pass. Run more than one process if you like: the fleet stores exactly one assignment per request.

## Running

1. Give it its own database and set its environment. No ship and no secret: the operator connects it.

| Variable | Required | What |
| --- | --- | --- |
| `DATABASE_URL` | yes | Its own Postgres database (`postgres://...`); it may share the Postgres server with the fleet and squadrons |
| `FLEET_URL` | yes | The fleet's public URL; it calls the ship API at `<FLEET_URL>/api/v1`, checks console sessions there, and names it in each joining machine's setup line. Not a secret; fixed here, so no caller can point it at another fleet |
| `CONSOLE_ORIGIN` | no | The console's origin, such as `https://console.example.com`: `mcp.replace` takes a change only with this exact `Origin`. The origin of `FLEET_URL` by default |
| `HOST`, `PORT` | no | Where it listens; `127.0.0.1:4200` by default |
| `LOG_LEVEL` | no | `info` by default |
| `INSTALLATION_TOKEN` | no | The token a hosting service presents to its installation procedures, at least 32 characters (decision 0021). Unset: they do not exist and every fleet is served, as a self-hosted install needs |
| `TRIERARCH_SILENT_AFTER_SECONDS` | no | A trierarch whose last seen is older than this is silent: it gets no new requests. `300` by default |
| `TRIERARCH_PASS_INTERVAL_SECONDS` | no | How often assignment runs a pass for each fleet. `10` by default |
| `TRUSTED_REPOSITORIES` | no | The repositories every trierarch may clone on demand, as JSON of names to git URLs, such as `{"hemma":"git@github.com:ThomasHendrickx/hemma.git"}` (aeolus-fleet#384). A crew request names one by its name as its workspace's repository. A URL is `https://` without a user, or ssh (`ssh://` or `user@host:path`) without a password. It is never a path, a file URL or a credential: a machine clones with its own access. The list applies to every fleet it serves. None by default |

2. `aeolus-trierarch-plugin start` migrates the database, serves, and runs an assignment pass every interval. Every fleet it serves whose kept crew token its fleet still takes is connected again; any other fleet is not connected. `aeolus-trierarch-plugin migrate` migrates alone.
3. Each fleet's operator connects it: commission its ship with `fleet:read`, `fleet:commission`, `crew:assign`, `crew:run`, `labels:define` and `labels:assign`, and hand the ship's secret to `connection.connect`, server to server. It registers as a server and keeps only the crew token; the secret is never stored or logged.

## API

One tRPC router at `/trpc`, called with the console's session cookie, which the fleet checks through `console.session`. Every procedure but the installation's works on the session's fleet.

| Procedure | What |
| --- | --- |
| `connection.status` | Whether it serves the fleet and is connected, as which ship, and the ship it was last connected as |
| `connection.connect` | Connects with its ship's id and secret (`fleet:manage` session). Refused while connected (CONFLICT), for a ship of another fleet or without the three scopes (BAD_REQUEST) |
| `machines.join` | Brings a machine in, by name (`trierarch:join`, or argo; otherwise FORBIDDEN): commissions a ship of type `trierarch` with `crew:run` and answers its starting prompt, crew lines, secret and setup line, `curl -fsSL https://raw.githubusercontent.com/ThomasHendrickx/aeolus-fleet-trierarch/main/install.sh \| sh -s -- --fleet-url <url> --ship-id <id> --plugin-ship-id <its own ship> --secret <secret>`, each shown once; the trierarch takes the trusted repositories only from the ship `--plugin-ship-id` names. A name an active ship holds: CONFLICT |
| `machines.list` | The fleet's active ships of type `trierarch`, each with its trierarch's last report and details (null until it reports), and whether it is silent |
| `requests.check` | Whether crew settings would be placed now, by assignment's rules, before a crew is requested with them: `fits`; `refused` with the settings field at fault and why; or `noRoom` when they fit but no trierarch has room (a request would wait). Writes nothing |
| `mcp.get` | The fleet's MCP configuration (`fleet:manage` session; otherwise FORBIDDEN): `{ version, servers, secrets }`, `secrets` the names only, never a value. Version 0 with nothing before the first replacement |
| `mcp.replace` | Replaces it whole (`fleet:manage` session and the console's `Origin`; otherwise FORBIDDEN, before any write): `{ expectedVersion, servers: [{ name, url, tools, credential? }], secrets: [names retained], secretValues: { name: value } }`, answering `{ version }`, one more. A server is a name, an `http://` or `https://` URL with no user, query or fragment, the tools a session may call (at least one, each once) and optionally `credential: { secret, header }`: a retained secret by name and the HTTP header the trierarch's proxy sets to its value (an HTTP field name, never `Host`, `Content-Length`, `Transfer-Encoding`, `Connection`, `Upgrade`, `TE`, `Trailer`, `Keep-Alive`, `Proxy-*`, `Cookie`, `Content-Type`, `Accept`, `Accept-Encoding`, `Last-Event-ID`, `Mcp-Session-Id` or `Mcp-Protocol-Version`). A retained secret keeps its value unless `secretValues` gives a new one, and needs one until it holds one; a secret left out is deleted; a value is 1 to 8192 bytes of UTF-8 with no CR, LF or NUL, stored as the header takes it (so a bearer token is `Bearer <token>`). The set, sealed, must fit one 256 KB message. A version other than the current one: CONFLICT, nothing written; a set that breaks a rule: BAD_REQUEST, its reason naming no value. Success means saved, not applied: read the version before trying again when unsure whether a write committed |
| `installation.setEnabled`, `get`, `delete` | With `x-aeolus-installation-token`: switches a fleet on or off, reads it, forgets it (decision 0021) |

While it is off for the fleet, every procedure but `connection.status` answers FORBIDDEN; until it is connected, `machines.*` answer PRECONDITION_FAILED.

### Replacing the MCP configuration from a terminal

There is no page for it. Use a local HTTP client on your own trusted computer, signed in to the console:

1. Keep the session cookie in a file only you can read (mode 600), and write the request body with an editor into another mode-600 file, or pass it on stdin. Only these file paths go on the command line, never the cookie or a value.
2. Call `mcp.replace` (`POST <console>/api/trierarch-plugin/mcp.replace`) with the cookie from its file, `content-type: application/json`, `Origin: <console origin>` and the body from its file, with shell tracing, verbose HTTP output and request logging off.
3. Read `mcp.get` (`GET <console>/api/trierarch-plugin/mcp.get`) with the cookie from its file, to check the version and names, then remove both files.

The plugin has no public route: only the console's server calls it, so these calls go to the console, never to the plugin directly.

The plugin's database holds the values readable to the service and its database administrators, its backups included: protect its access and backups as you protect the crew tokens it keeps.
