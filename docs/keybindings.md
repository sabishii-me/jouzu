# Keybindings

| Key | Action | Behavior |
| --- | --- | --- |
| `Ctrl+Enter` | `app.message.followUp` | Queue the editor text as a follow-up while the agent is working |
| `Ctrl+Up` | `app.message.dequeue` | Restore queued messages to the editor |
| `Ctrl+F` | `jouzu.model.toggleFavorite` | Toggle the selected model's favorite, also while searching |
| `Ctrl+Shift+R` | `jouzu.model.refresh` | Refresh model catalogs and providers, also while searching |

- Rebind any of these by action name in `keybindings.json` in the Jouzu agent directory.
- `/hotkeys` lists every active shortcut.
- `Tab` keeps Pi's autocomplete and selector behavior.

## How defaults are written

- `Ctrl+Enter` and `Ctrl+Up` are written to `keybindings.json` on the first interactive launch, if the file does not exist.
- `Ctrl+F` and `Ctrl+Shift+R` are built in and are not written to the file.
- Jouzu changes only entries it recorded as its own. Your entries are never overwritten.
- If another editor action already uses `Ctrl+Enter`, Jouzu reports the conflict.
- `JOUZU_NO_KEYBINDING_DEFAULTS=1` skips first-run defaults for one launch.

```bash
jz keybindings status
jz keybindings plan     # preview, writes nothing
jz keybindings apply    # add missing defaults; backs up the file
jz keybindings reset    # remove Jouzu's entries and stop adding them
```

`apply` refuses to replace a different value of yours or an editor action that competes for the key.

## Terminal support

| Key | Needs |
| --- | --- |
| `Ctrl+F` | Nothing; works in every terminal |
| `Ctrl+Enter` | Modified-Enter reporting: Kitty keyboard protocol or `modifyOtherKeys` |
| `Ctrl+Up` | Modified-arrow reporting |
| `Ctrl+Shift+R` | Kitty keyboard protocol or `modifyOtherKeys`; otherwise it arrives as `Ctrl+R`. Use `R` in Settings / Catalogs instead. |

- In the Models search field, `Ctrl+F` replaces Pi's cursor-right. Use `→` there.
- Windows Terminal supports the Kitty keyboard protocol from version 1.25.
- tmux: set `extended-keys` with `extended-keys-format csi-u`.
- macOS uses `Control+Up` for Mission Control.
- Ghostty on Linux uses `Ctrl+Enter` for fullscreen. Pass it to Jouzu:

```ini
# ~/.config/ghostty/config
keybind = ctrl+enter=csi:13;5u
```

`jz keybindings plan` does not inspect terminal, desktop, or multiplexer settings. The [key collision map](key-collisions.md) lists known conflicts and how to test your terminal.
