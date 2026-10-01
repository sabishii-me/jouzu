# Updates

## npm installations

A global npm installation checks npm's `latest` version before an interactive launch.

- After a successful check, the next check waits 24 hours. After a failed or offline check, it waits at least one hour.
- The check contacts your configured npm registry and sends no Jouzu telemetry.
- With `auto-restart`, the update finishes before the session starts.

| Policy | Behavior |
| --- | --- |
| `auto-restart` (default) | Install the update and relaunch your command once under the new version |
| `notify` | Report that an update is available |
| `off` | Do not check at startup |

```bash
jz self-update status
jz self-update check
jz self-update apply
jz self-update policy notify       # or auto-restart, off
```

`status` and `check` accept `--json`.

### How an update installs

1. Read the new version and its SHA-512 checksum through your npm client, registry, proxy, and CA settings.
2. Pack the current version as a rollback copy.
3. Download the new version without running install scripts, and verify its checksum.
4. Install it globally with install scripts, audit, and funding messages disabled.
5. Verify the installed package and `--version`.
6. If verification fails, restore the previous version.
7. Relaunch your command.

### Not updated automatically

- Source checkouts, project-local installs, and `npx` runs. Update them where they were installed.
- Installations where you cannot write to the global npm prefix. Jouzu keeps running the current version and reports the problem in `self-update status` and `jz doctor`.

Only one update runs at a time. A failed check leaves the current version in place.

### Environment variables

| Variable | Effect |
| --- | --- |
| `JOUZU_NO_UPDATE=1` | Skip the check for one launch |
| `JOUZU_UPDATE_POLICY` | Policy for this process. An invalid value acts as `off`. |
| `JOUZU_UPDATE_INTERVAL_HOURS` | Hours between successful checks |

## Windows installer

- The working-folder screen checks GitHub Releases once per 24 hours.
- When a newer stable x64 installer exists, it shows a **Download update** link. Run the downloaded installer to upgrade.
- Desktop launches do not use npm updates.
