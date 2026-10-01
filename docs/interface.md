# Session interface

| Surface | Shows |
| --- | --- |
| Prompt Frame | Pi's editor with Jouzu borders and a `❯` prompt |
| Work dashboard | Running, waiting, and finished work, above the prompt |
| Session Line | Goal, loop, and agent activity on the left; provider, model, and thinking level on the right |
| Status Bar | Workspace, Git, project runtime, context, and branch token counts |

## Prompt Frame

Keeps Pi's editor behavior: actions, history, paste, autocomplete, cursor, and input-method (IME) composition.

## Work dashboard

- Child agents, tasks, background jobs, and flow alerts appear here. Loops keep their own panels.
- Each source has a section whose divider shows its counts and route.
- Each row shows a state marker, kind, elapsed time, and detail.
- A finished child agent whose result the model has not read gets an attention row and count. Both clear when the model reads the result.
- Settings switches between compact (five lines) and expanded (ten lines).
- `/bg` or `Alt+Shift+H` opens the background-job manager. `/bg watch <task>` opens it on one job.

## Session Line

- Left side: an animated marker while work runs; a static marker with paused, stopped, or completed counts; a count of results the model has not read.
- Activity replaces the shortcut hint and the hint returns when nothing is running.
- Activity text shortens to fit, and disappears before it would overlap the model name.

## Status Bar

- Fields shorten, then drop by priority on narrow terminals.
- Provider quota and session cost are not shown.

## Startup header

- Interactive launches clear the screen and show the Jouzu header.
- `JOUZU_NO_CLEAR=1` keeps existing terminal output.
- `NO_COLOR` turns off header color.

## Text width

All surfaces measure terminal display columns, not string length. Tests cover Chinese, Japanese, and Korean (CJK) text, full-width spaces, combining marks, emoji, ANSI color, and no-color output.

## Related commands

| Command | Shows |
| --- | --- |
| `/status` | Session, workspace, model, thinking level, context usage, profile, runtime |
| `/about` | Running and installed Jouzu builds, Pi version, startup time |
| `/session` | Session details, ending with a runtime line |
| `/labels` | Automatic session naming. See [Session labels](session-labels.md). |
