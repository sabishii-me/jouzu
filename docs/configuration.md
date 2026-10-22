# Configuration

Jouzu keeps its configuration, state, and cache apart from a stock Pi installation. Default locations are listed in the README's [State and isolation](../README.md#state-and-isolation) table.

- Move all roots together with `--jouzu-home <path>` or `JOUZU_HOME`:

```bash
JOUZU_HOME="$PWD/.jouzu" jz doctor
```

- The Windows launcher uses `%LOCALAPPDATA%\Shisa.ai\Jouzu\data` unless `JOUZU_HOME` overrides it.

## Terminal display

The interactive terminal defaults to full-screen mode. To use the terminal's normal scrollback, set `"tuiMode": "regular"` in `settings.json` under the [agent/config directory](../README.md#state-and-isolation). Set `"tuiMode": "fullscreen"` to select full-screen mode explicitly. Jouzu preserves an existing setting.

## Transcript scrollback

Run `/scrollback` in fullscreen mode while the agent and shell commands are idle to print the active conversation branch on the terminal's normal screen. Use terminal search and selection, or tmux copy mode (`Ctrl+B`, then `[` with tmux's default bindings). Exit copy mode, then press Enter or Escape to return to Jouzu. Ctrl+C also returns. The export does not change the display setting, and the prompt draft stays intact. `Ctrl+O` keeps its tool-expansion action.

The export is a plain-text snapshot of stored conversation entries, not a screenshot or a file export. Terminal control sequences are removed. Images have text placeholders. Only the active branch is included; tool output already truncated when stored cannot be recovered by this command. Terminal and tmux history limits can discard the oldest exported lines. Exported text remains in that history after returning to Jouzu, so treat it like other terminal output containing conversation or code.

The command requires an interactive fullscreen terminal and is unavailable with `TERM=dumb`.

## Copying inside tmux

Jouzu preserves native clipboard copying and also sends copied text to tmux's paste buffer. It asks tmux to forward the text to a terminal client attached to the current pane's session. This works with tmux's default `set-clipboard external`; you do not need to set `set-clipboard on`. Jouzu does not change your tmux configuration.

If tmux forwarding fails, Jouzu tries a tmux-wrapped terminal clipboard request (OSC 52) when the pane's effective `allow-passthrough` setting permits it. With `on`, the pane must be visible; `all` also permits hidden panes. A successful tmux buffer write or terminal request cannot confirm that the desktop clipboard changed, so the UI reports a copy request. Terminal clipboard restrictions and nested multiplexers can still prevent forwarding; the tmux paste buffer and the desktop clipboard are separate destinations.

When multiple clients are attached to the pane's session, Jouzu selects the most recently active client. Client selection and forwarding are separate tmux commands: moving a pane or switching a client to another session during a copy can change where the request arrives.

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
| `PI_CLIPBOARD_TMUX=0` | Disable Jouzu's tmux clipboard forwarding and use Pi's ordinary clipboard paths |
| `PI_CODING_AGENT_DIR` | Pi directory checked for import |
