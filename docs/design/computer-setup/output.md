# Computer setup: plugin output

The plugin returns a setup line to the console; it does not render the terminal wizard. The console introduction is aeolus-fleet PR 1907. Terminal screens A1 to A6 are implemented and captured by the trierarch repository.

## Approved inputs beside built output

The [approved design](https://github.com/ThomasHendrickx/aeolus-fleet/blob/main/docs/design/computer-setup/README.md#parts-and-prompts) adds `--service yes|no`, repeated `--folder <name> <path>` pairs, and `--no-folders`, mutually exclusive with folder pairs. A supplied value answers its question; an omitted value remains for setup to resolve. The [approved A3](https://github.com/ThomasHendrickx/aeolus-fleet/blob/main/docs/design/computer-setup/after.md#a3-explain-and-ask-both-limits) retains independent positive limits, with fresh values of 4 ships and 2 simultaneous sessions.

| Approved input | Built line below |
| --- | --- |
| Repeated named folders, positive limits, service consent | `--folder 'shared' '/srv/shared notes' --folder 'notes' '~/notes' --max-ships 4 --max-running 2 --service yes` |
| No folders, service declined | `--no-folders --service no` |
| Choices omitted | No corresponding flags |

Captured from the compiled `dist/core/machines/setup-line.js` after `npm run build`. All identity values are fabricated fixtures. No setup command was executed and no computer was registered.

```text
Supplied folders, limits and service consent
curl -fsSL https://raw.githubusercontent.com/ThomasHendrickx/aeolus-fleet-trierarch/main/install.sh | sh -s -- --fleet-url https://fleet.example --ship-id shp_fixture --plugin-ship-id shp_plugin_fixture --secret FIXTURE_ONLY --harnesses codex --no-repositories --folder 'shared' '/srv/shared notes' --folder 'notes' '~/notes' --max-ships 4 --max-running 2 --service yes

Explicit no folders and declined service
curl -fsSL https://raw.githubusercontent.com/ThomasHendrickx/aeolus-fleet-trierarch/main/install.sh | sh -s -- --fleet-url https://fleet.example --ship-id shp_fixture --plugin-ship-id shp_plugin_fixture --secret FIXTURE_ONLY --no-folders --service no

Omitted choices
curl -fsSL https://raw.githubusercontent.com/ThomasHendrickx/aeolus-fleet-trierarch/main/install.sh | sh -s -- --fleet-url https://fleet.example --ship-id shp_fixture --plugin-ship-id shp_plugin_fixture --secret FIXTURE_ONLY

```

Before this change, the API refused these additional options and the setup-line generator had no corresponding flags. The affected API and generation tests prove forwarding, omission, quoting and validation before commissioning. Folder names follow the existing trierarch format and 100-character limit. Folder-as-is selection stays distinct from a folder containing repositories.
