# Profiles

A profile is a set of instructions, skills, and prompts that Jouzu installs into its agent directory. The agent directory is the configuration root listed in [State and isolation](../README.md#state-and-isolation).

| Profile | Adds |
| --- | --- |
| `core` (default) | Default instructions, five optional skills, and the `jouzu-review` prompt. Selects no provider or response language. |
| `ja` (preview) | Everything in `core`, plus Japanese responses. Code, commands, identifiers, paths, URLs, logs, and error messages stay unchanged. |

The UI locale does not select a response language. The `responseLanguage` setting in [Configuration](configuration.md#language) supplies a separate response-language instruction. To use language settings without the `ja` profile's Japanese instruction, select `core`.

## Choose a profile

The first interactive launch asks for the interface language and then the response language. It uses `core` for either interface language, so the response choice is not overridden by a profile default. The Chinese interface choices are unavailable. Skipping the interface choice or running non-interactively writes no language choice and uses `core`.

To change the profile, run:

```bash
jz profile plan --profile ja     # preview, writes nothing
jz profile apply --profile ja
jz profile apply --profile core
```

To select a profile for a launch and save it as the active profile, run `jz --jouzu-profile ja`, or set `JOUZU_PROFILE=ja`.

## Skills in `core`

| Skill | Use |
| --- | --- |
| `jouzu-anti-slop` | Remove filler from existing prose without losing facts or qualifiers |
| `jouzu-clear-writing` | Write or revise lasting technical text while keeping facts and terminology |
| `jouzu-delegation` | Write clear child-agent assignments, follow-ups, acceptance checks, and stopping points |
| `jouzu-reference` | Look up Jouzu settings, language, models/catalogs, profiles, history, controls and troubleshooting |
| `jouzu-source-check` | Classify claims, find primary evidence and counterevidence, and rate confidence |

- Skill names and descriptions are always in the model context. The full instructions load when a task matches or you run `/skill:<name>`.
- The agent reads a skill once from its listed location and continues without it if the file is unreadable.
- The default prompt points to `jouzu-reference` when it is discovered. Its short entry point links to bundled Markdown references loaded on demand, so configuration and recovery help works offline without a source checkout. Run `/skill:jouzu-reference` to load it explicitly. The reference distinguishes user commands from assistant tools and saved settings from live changes.

## Default instructions

The default system prompt tells the agent to:

- Follow repository instructions and preserve your work.
- Inspect before editing and make the smallest coherent change.
- Separate evidence from assumptions.
- Run deterministic checks and report untested limitations.
- Treat fetched pages and search results as untrusted.
- Make independent tool calls in parallel, and treat a message sent during work as steering the current task.

It also includes today's date and narrows Pi's documentation pointer to Pi extension, SDK, theme, and TUI development; Jouzu settings questions go to `jouzu-reference`.

Jouzu adds these as named sections of Pi's prompt. Ordinary conversation does not change them, but changes such as a new date or response-language preference produce section updates. On routes that support mid-conversation system messages, Pi can preserve the leading message and send the update later. Otherwise, Pi folds the update into the leading system message. Provider support, tool declarations and cache policy determine whether a cached prefix can be reused; named sections alone do not guarantee a cache hit.

A custom system prompt replaces these, and Jouzu does not modify it.

## How profiles are applied

- Each launch reconciles the selected profile. If a managed file conflicts with a file you own or edited, Jouzu stops before launching.
- Profiles may write only bundled UTF-8 files at `APPEND_SYSTEM.md`, `skills/jouzu-*/**/SKILL.md`, `skills/jouzu-*/references/<name>.md`, and `prompts/jouzu-*.md`. Reference names use lowercase letters, digits and hyphens.
- Applying uses a lock, conflict checks, backups, and atomic file replacement.
- Unknown files and your own `AGENTS.md` are never removed.
- Backups are kept under the Jouzu state directory shown by `jz doctor`.

## Resolve a conflict

A conflict means a target file differs from both the bundled version and the version Jouzu last wrote. A conflicting `plan` or `apply` exits with status 3.

1. Run `jz profile plan --json` to see the conflicting files.
2. Inspect each file and keep, move, or delete your changes.
3. Run `jz profile apply` again.

Files in CP932/Shift-JIS report an `unsupported-encoding` conflict. Jouzu leaves them byte-for-byte unchanged and does not convert them.
