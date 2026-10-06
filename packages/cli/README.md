# Jouzu

Jouzu is Shisa AI's terminal coding agent, built on [Pi coding agent](https://pi.dev/).

- **Goals, loops, and scheduled work.** Track tasks, work toward a goal, run measured improvement loops, and schedule prompts.
- **Background jobs.** Run shell jobs while you keep working; completions arrive as batched summaries.
- **Child agents.** Give each agent its own model, tools, instructions, and workspace.
- **Web search and fetch.** Fetch pages directly or through a browser that installs on first use.
- **Local content scanning.** TextGuard checks skills and web results before they reach the model.
- **Compaction with searchable history.** Defaults to [VCC](https://github.com/lllyasviel/VCC) for instant, deterministic compaction with agent-searchable history.
- **Japanese text support.** Correct layout for Japanese, Chinese, Korean, and emoji widths, plus an optional Japanese profile.
- **Voice dictation.** Speak into the prompt with Shisa realtime transcription.
- **Model picker.** Search providers and models, keep favorites, and save per-project defaults. Sign into [Shisa AI's API service](https://platform.shisa.ai/) for the latest open coding models.

Jouzu v0.1.x is **alpha** software. Expect frequent updates and changes.

## Requirements

- Node.js 22.19 or newer and npm
- Git
- Bash (Git Bash on Windows)

See [Windows prerequisites](https://github.com/shisa-ai/jouzu/blob/main/docs/windows.md).

## Install

```bash
npm install -g jouzu
jz doctor
```

`jz` is an alias for `jouzu`. Try it without installing with `npx --yes jouzu`.

A signed Windows x64 launcher that bundles its requirements is available from [GitHub Releases](https://github.com/shisa-ai/jouzu/releases).

## Quick start

```bash
jz
```

The first launch asks whether to enable the Japanese profile and offers to connect a Shisa AI account. New Shisa accounts receive USD 10 in credits.

| Command or key | Action |
| --- | --- |
| `/login shisa` | Connect a Shisa account (`/login` for other providers) |
| `/model` or `Ctrl+L` | Choose a model |
| `Ctrl+P` | Cycle favorite models |
| `/workflow` | Configure agents and inspect child runs |
| `/goal`, `/multiloop` | Manage goals and loops |
| `/bg` | Manage background jobs |
| `/flow` | Show why automatic work stopped and how to resume it |
| `/voice` or `Ctrl+\` | Start or stop dictation |
| `/textguard` | Review flagged content |
| `/status` | Show session, model, and context usage |
| `/bug` | Draft a bug report |
| `Ctrl+/` or `/hotkeys` | Help and shortcuts |

## Profiles

`core` is the default. `ja` adds Japanese responses while leaving code, commands, and paths unchanged.

```bash
jz profile apply --profile ja
jz profile apply --profile core
```

## State and isolation

Default roots for npm installations are:

| Platform | Agent/config | State and sessions | Cache |
| --- | --- | --- | --- |
| Linux | `${XDG_CONFIG_HOME:-~/.config}/jouzu/agent` | `${XDG_STATE_HOME:-~/.local/state}/jouzu` | `${XDG_CACHE_HOME:-~/.cache}/jouzu` |
| macOS | `~/Library/Application Support/Jouzu/agent` | `~/Library/Application Support/Jouzu/state` | `~/Library/Caches/Jouzu` |
| Windows | `%APPDATA%\Jouzu\agent` | `%LOCALAPPDATA%\Jouzu\state` | `%LOCALAPPDATA%\Jouzu\cache` |

The Windows launcher stores everything under `%LOCALAPPDATA%\Shisa.ai\Jouzu`. Override all roots with `--jouzu-home <path>` or `JOUZU_HOME`.

On first setup, Jouzu offers to copy `models.json` and provider credentials from an existing Pi installation. Both prompts default to no.

## Model catalogs

Add model catalogs in Settings / Catalogs (`/catalogs`). Shisa AI's catalog is built in and activates when you sign in. Check sources with `jouzu catalog status`.

| Platform | Catalog configuration |
| --- | --- |
| Linux | `${XDG_CONFIG_HOME:-~/.config}/jouzu/catalogs.json` |
| macOS | `~/Library/Application Support/Jouzu/catalogs.json` |
| Windows | `%APPDATA%\Jouzu\catalogs.json` |

## Keybindings

Default keybindings, rebindable in `keybindings.json`:

| Key | Action | Behavior |
| --- | --- | --- |
| `Ctrl+Enter` | `app.message.followUp` | Queue the editor text as a follow-up while the agent is working |
| `Ctrl+Up` | `app.message.dequeue` | Restore queued messages to the editor |
| `Ctrl+F` | `jouzu.model.toggleFavorite` | Toggle the selected model's favorite status |
| `Ctrl+Shift+R` | `jouzu.model.refresh` | Refresh model catalogs and providers |

Modified keys such as `Ctrl+Enter` need terminal support. See the [key collision map](https://github.com/shisa-ai/jouzu/blob/main/docs/key-collisions.md) for terminal and tmux setup.

## Updates

Global npm installations update automatically at launch. Change this with `jz self-update policy notify` or `jz self-update policy off`.

## Development

```bash
npm run dev:setup                     # install, check, build, and smoke-test
node packages/cli/dist/cli.js         # run this checkout
npm run dev:link                      # optional: point global jz/jouzu at this checkout
```

Building also requires Go (for [textguard-go](https://github.com/shisa-ai/textguard-go)).

## Documentation

More documentation is in [`docs/`](https://github.com/shisa-ai/jouzu/tree/main/docs):

- [Agents and runs](https://github.com/shisa-ai/jouzu/blob/main/docs/subagents.md)
- [TextGuard](https://github.com/shisa-ai/jouzu/blob/main/docs/textguard.md)
- [Voice input](https://github.com/shisa-ai/jouzu/blob/main/docs/voice.md)
- [Session labels](https://github.com/shisa-ai/jouzu/blob/main/docs/session-labels.md)
- [Windows](https://github.com/shisa-ai/jouzu/blob/main/docs/windows.md)
- [Bug reporting](https://github.com/shisa-ai/jouzu/blob/main/docs/bug-reporting.md)
- [Architecture](https://github.com/shisa-ai/jouzu/blob/main/docs/architecture.md)
- [Testing](https://github.com/shisa-ai/jouzu/blob/main/docs/testing.md)

## License

Apache-2.0. See [LICENSE](https://github.com/shisa-ai/jouzu/blob/main/LICENSE).
