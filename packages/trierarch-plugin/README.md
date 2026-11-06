# @aeolus-fleet/trierarch-plugin

Brings your machines into the fleet and places each crew request on a machine that fits. It is the trierarchs' plugin on the server side (decision 0030). Optional: a fleet works without it. Aeolus knows nothing about it beyond its ship, which holds `fleet:read`, `fleet:commission`, `crew:assign`, `crew:run`, `labels:define`, `labels:assign` and `scopes:declare` and reaches the fleet only through its public API. What it does is in [docs/trierarch.md](https://github.com/ThomasHendrickx/aeolus-fleet-trierarch/blob/main/docs/trierarch.md).

So far: its own process and small database (each fleet's connection, switch and enabled models), the connection the operator makes as its ship, a machine joining, the machines with their trierarchs' reports, assignment (docs/trierarch.md, "Assignment"), the installation procedures, `/api/health` and `/api/version`.

Each pass also sends every trierarch the trusted repositories (`TRUSTED_REPOSITORIES`) once per process, in a message of type `application/vnd.aeolus.trierarch.trusted-repositories+json` whose payload is `{"repositories":[{"name","url"}]}`. A restart sends them again, so a changed list reaches every trierarch. A trierarch that asks, with a message of type `application/vnd.aeolus.trierarch.trusted-repositories-request+json`, gets them again on the next pass: one does as it starts knowing the trierarch plugin's ship.

Each pass also sends every trierarch the crew-time MCP servers (`MCP_SERVERS`) once per process, in a message of type `application/vnd.aeolus.trierarch.mcp-servers+json` whose payload is `{"servers":[{"name","url","transport","tools"}]}`. A restart sends them again; a trierarch that asks, with a message of type `application/vnd.aeolus.trierarch.mcp-servers-request+json`, gets them again on the next pass.

Each pass also sends every trierarch whose report states a sealing key (`details.sealingKey`, `{"scheme":"nacl-sealed-box","publicKey"}`) the secret store (`MCP_SECRETS`), each value sealed to that key with the NaCl anonymous sealed box, in a message of type `application/vnd.aeolus.trierarch.secrets+json` whose payload is `{"publicKey","secrets":[{"name","sealed"}]}`, `sealed` the box as standard base64. The fleet stores only what it cannot read. The store goes whole, an empty one too, once per process for each key a trierarch states: a trierarch that states another key gets it again, and so does one that asks, with a message of type `application/vnd.aeolus.trierarch.secrets-request+json`. A trierarch without a key is sent none.

Assignment runs as a pass for every fleet it serves and is connected to. Each pass reads the fleet whole: the unassigned requests of ships that await crew, and the trierarchs that report details and are not silent; with them, the fleet's enabled models from its own database (decision 0063). It claims each request it places, by optimistic claim, and writes the reason on each it cannot. A claim the fleet refuses because the request changed (another pass won it, or the ship was crewed or its request removed) is read again on the next pass. Run more than one process if you like: the fleet stores exactly one assignment per request.

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
| `TRUSTED_REPOSITORIES` | no | The repositories every trierarch may clone on demand, as JSON of names to git URLs, such as `{"hemma":"git@github.com:ThomasHendrickx/hemma.git"}` (aeolus-fleet#384). A crew request names one by its name as its workspace's repository. A URL is `https://` without a user, or ssh (`ssh://` or `user@host:path`) without a password. It is never a path, a file URL or a credential: a machine clones with its own access. The list applies to every fleet it serves. None by default |
| `MCP_SERVERS` | no | The remote MCP servers (Streamable HTTP) a session may be crewed with, as JSON of names to `{ "url", "tools" }`, such as `{"company-graph":{"url":"https://graph.example.invalid/mcp","tools":["read_neo4j_cypher"]}}` (aeolus-fleet-trierarch#120). `tools` are the only tools a session may call. A URL is `http://` or `https://` with no user, query or fragment: the list holds no credential. A server that needs a credential names it with `"credential":{"secret","header"}`: a secret of `MCP_SECRETS` by name, and the HTTP header the trierarch's proxy sets to its value verbatim (an HTTP field name, never `Host`, `Content-Length`, `Transfer-Encoding`, `Connection`, `Upgrade`, `TE`, `Trailer`, `Keep-Alive`, `Proxy-*`, `Cookie`, `Mcp-Session-Id` or `Mcp-Protocol-Version`). A list that is not valid refuses to start the trierarch plugin. The list applies to every fleet it serves. None by default |
| `MCP_SECRETS` | no | The secret store the MCP servers' credentials come from, as JSON of names to values, such as `{"graph-token":"Bearer <token>"}` (decision M5 of aeolus-fleet-trierarch#120). A name is as a server's; a value is 1 to 8192 bytes of UTF-8 with no CR, LF or NUL, stored as the header takes it (so a bearer token is `Bearer <token>`). Every secret a server's credential names must be held, and the store, sealed, must fit one message. A store that is not valid refuses to start the trierarch plugin with a reason that names the secret, never its value. A change takes a restart. It applies to every fleet it serves. None by default |

   Set `MCP_SECRETS` so that no value reaches a shell history or a log: write it with an editor into the service's environment file (a systemd `EnvironmentFile=`, or the container's env file or secret), owned by the service's user with mode 600, and never pass it on a command line, through `echo` or `export`, or in a file the repository holds. The trierarch plugin never logs the store, never answers it through its API, and sends a value only sealed.

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
| `installation.setEnabled`, `get`, `delete` | With `x-aeolus-installation-token`: switches a fleet on or off, reads it, forgets it (decision 0021) |

While it is off for the fleet, every procedure but `connection.status` answers FORBIDDEN; until it is connected, `machines.*` answer PRECONDITION_FAILED.
