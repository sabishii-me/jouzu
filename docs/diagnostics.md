# Diagnostics

```bash
jz doctor
jz doctor --json
jz --version
```

`jz doctor` changes nothing and reports:

- Install and update channel, update policy, and keybinding defaults
- Pi version and commit
- Platform and runtime prerequisites
- Configuration, state, and cache locations
- Profile hashes and package count
- Whether credentials exist (never their values), proxy and CA status
- Shared skill directories
- Catalog sources and catalog gaps
- Warnings and problems with suggested fixes

It exits `1` when it reports a problem.

`--json` prints the same report for scripts. The format is experimental and marked `"experimental": true`; fields may change.

## In a session

| Command | Shows |
| --- | --- |
| `/status` | Session, workspace, model, thinking level, context, profile, runtime |
| `/about` | Running and installed Jouzu builds, Pi version, startup time. If they differ, restart Jouzu. |
| `/flow runtime` | Startup package paths and hashes |
| `/bug` | Draft a bug report. See [Report a Jouzu bug](bug-reporting.md). |

## Passing arguments to Pi

Jouzu forwards most arguments to Pi unchanged. When a Pi argument has the same name as a Jouzu command, use `pi` or `--`:

```bash
jz pi --help
jz -- --version
```

- Pi's own self-update is blocked because Jouzu pins its Pi version.
- `jz update --extensions` and `jz update --models` work and use Jouzu's state.
