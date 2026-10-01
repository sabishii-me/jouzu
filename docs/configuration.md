# Configuration

Jouzu keeps its configuration, state, and cache apart from a stock Pi installation. Default locations are listed in the README's [State and isolation](../README.md#state-and-isolation) table.

- Move all roots together with `--jouzu-home <path>` or `JOUZU_HOME`:

```bash
JOUZU_HOME="$PWD/.jouzu" jz doctor
```

- The Windows installer stores everything under `%LOCALAPPDATA%\JouzuDesktop\data`.

## Importing from Pi

On the first interactive setup, Jouzu looks for Pi files in `PI_CODING_AGENT_DIR`, then `~/.pi/agent`.

| Offered for import | Not imported |
| --- | --- |
| Custom `models.json` | `settings.json`, keybindings |
| Saved provider credentials from `auth.json` | Packages, extensions, skills, prompts, themes |
| | Sessions, caches, trust decisions |

- Jouzu asks separately for each file. Both prompts default to no.
- Source files are not changed, and an existing Jouzu file is never replaced.
- Rejected: symbolic links, non-regular files, oversized files, and files whose top-level JSON value is not an object.
- Non-interactive commands never read Pi state.
- `JOUZU_NO_PI_IMPORT=1` skips the offer for one launch.

Pi resources that still apply:

- Trusted project `.pi` resources, through Pi's project-trust rules.
- `~/.agents/skills`, Pi's shared cross-tool skills directory.

## Environment variables

| Variable | Effect |
| --- | --- |
| `JOUZU_HOME` | Root for all Jouzu configuration, state, and cache |
| `JOUZU_PROFILE` | Profile for this launch: `core` or `ja`. See [Profiles](profiles.md). |
| `SHISA_API_KEY` | Shisa API key; overrides the saved login. See [Shisa AI account](shisa.md). |
| `JOUZU_MODEL_CATALOG_URL`, `JOUZU_MODEL_CATALOG_TOKEN` | Single catalog source when `catalogs.json` does not exist. See [Model catalogs](catalogs.md). |
| `JOUZU_FLOW_CONTROL=0` | Disable flow control. See [Flow control](flow-control.md). |
| `JOUZU_CAMOUFOX_IDLE_STOP_MS` | Browser idle shutdown delay. See [Web tools](web.md). |
| `JOUZU_CAMOUFOX_LIBRARY_PATH` | NSS library directory for the browser. See [Web tools](web.md). |
| `JOUZU_NO_UPDATE=1` | Skip the update check. See [Updates](updates.md). |
| `JOUZU_UPDATE_POLICY` | `auto-restart`, `notify`, or `off` for this process |
| `JOUZU_UPDATE_INTERVAL_HOURS` | Hours between successful update checks |
| `JOUZU_NO_KEYBINDING_DEFAULTS=1` | Skip first-run keybinding defaults. See [Keybindings](keybindings.md). |
| `JOUZU_NO_PI_IMPORT=1` | Skip the Pi import offer |
| `JOUZU_NO_CLEAR=1` | Keep terminal output at startup |
| `NO_COLOR` | Turn off header color |
| `PI_CODING_AGENT_DIR` | Pi directory checked for import |
