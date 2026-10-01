# Built-in tools

The `core` and `ja` profiles load the same tools.

| Tool | Purpose |
| --- | --- |
| `schedule_prompt` | One-time and recurring prompts |
| `bg_task` | Run and monitor shell processes without blocking |
| `web_fetch`, `batch_web_fetch` | Fetch readable HTTP content. See [Web tools](web.md). |
| `tff-fetch_url`, `tff-search_web` | Browser-rendered fetch and search. See [Web tools](web.md). |
| `TaskCreate` and related task tools | Track finite work |
| `get_goal`, `update_goal` | Work toward a goal you set with `/goal` |
| `multiloop_*` | Record approved measured-improvement loops |
| `subagent` | Run child agents. See [Agents and runs](subagents.md). |
| `vcc_recall` | Search earlier session history, including compacted entries |

Also included:

- Code previews for supported tool calls and results.
- Skill suggestions when you type `$` at the start of a word.

## Goals and loops

| Command | Effect |
| --- | --- |
| `/goal` | List running and paused goals with command hints |
| `/goal pause [lane/run-tag]` | Pause a goal |
| `/goal stop [lane/run-tag]` | Stop a goal |
| `/goal resume [lane/run-tag]` | Resume a goal |
| `/multiloop` | Show all loops |

- Without a target, pause and stop act on the attached goal, or the only matching one.
- Resume picks the only saved goal directly. With several goals, the agent uses the conversation and saved goals to find the one you mean.
- Resume prompts the agent immediately when idle, or queues the request while it works.
- The Session Line shows running, paused, stopped, and completed counts for goals and loops in the session.

## Compaction

[pi-vcc](https://github.com/sting8k/pi-vcc), based on [VCC](https://github.com/lllyasviel/VCC), compacts the conversation without a model call when it nears or exceeds the context window.

- Compaction shortens the active transcript. Running work continues.
- `vcc_recall` retrieves details from the current session, including entries removed from the active transcript. It cannot start compaction.

## Bundled and added packages

- Bundled tools and their dependencies ship inside the `jouzu` package. A normal launch installs nothing from npm or Git.
- Exception: the browser client installs on first use. See [Web tools](web.md#browser-runtime).
- Packages you add yourself are separate, user-managed state. Jouzu release testing does not cover them, and they run with your user permissions.
