# Flow control

Flow control coordinates background jobs, goals, loops, and tasks in one session. It is on by default.

- Background results arrive in batches after the current reply and any queued messages.
- Tasks can wait for your input or for another job before continuing.
- Ask Jouzu to show, reorder, pause, or continue tasks.

## Commands

| Command | Effect |
| --- | --- |
| `/flow` | Show why automatic work stopped and how to resume it |
| `/flow pause` | Pause automatic replies. Background jobs keep running. |
| `/flow resume` | Allow automatic replies again |
| `/flow off` | Turn flow control off for this session. Messages run as ordinary turns; jobs, tasks, and loops send their own notifications. |
| `/flow on` | Turn flow control back on |
| `/flow reset` | Turn flow control off and on again, resetting queued and held delivery |
| `/flow clear` | Release a stuck turn. Run while Jouzu is idle. |
| `/flow resolve <attempt> retry` or `discard` | Settle a model request with an unknown outcome, using the attempt ID shown by `/flow` |
| `/flow runtime` | Show startup package paths and hashes |

- Interrupting a reply also pauses automatic work until your next message or `/flow resume`.
- `off`, `on`, `reset`, and `clear` keep the session, its records, and running jobs.
- `retry` may repeat a request the model already answered.
- Set `JOUZU_FLOW_CONTROL=0` before starting Jouzu to disable flow control for that process.

## Branches and resuming

| Action | Result |
| --- | --- |
| Return to where you left a recent branch | Its unfinished work resumes, including tasks waiting for background jobs |
| Rewind to an earlier point | Starts a new branch; unfinished work does not resume. File changes are not undone. |
| Reopen a session | Continues from its last saved position, which may differ from the branch you last viewed |

## Missing tool results

- If a branch lacks a tool result, Jouzu tells the model the outcome is unknown. It does not rerun the tool, copy a result from another branch, or edit the saved conversation.
- If Jouzu cannot match tool calls to their results, it stops the request.
