# CJK width, input, and terminal checks

These procedures check Chinese, Japanese, and Korean (CJK) character handling
in the four catalogs (`en`, `ja`, `zh-Hans`, `zh-Hant`). They are test
instructions, not a record of completed native qualification.

Only English and Japanese are offered as interface languages. Test Chinese
catalog rendering by loading the drafts directly; do not treat a draft render
as an interactive Chinese-language session.

## Deterministic checks

From the repository root, run:

```bash
npm run build
npm run test:node -- packages/cli/test/cjk.test.mjs packages/cli/test/terminal-layout.test.mjs packages/cli/test/locale-catalog.test.mjs packages/cli/test/palette-golden.test.mjs packages/cli/test/zh-hant-catalog.test.mjs
node scripts/check-locales.mjs
```

The tests cover fixed catalog text and Palette frames at 48, 80, and 120
columns, color removal, combining characters, full-width spaces, emoji, and
mixed-width text. They do not establish input method editor (IME) or screen
reader behavior on a native terminal.

## Render draft catalogs

After building, render messages that need no arguments at each width:

```bash
for locale in zh-Hans zh-Hant; do
  for columns in 48 80 120; do
    node scripts/cjk-catalog-render.mjs "$locale" "$columns"
  done
done
```

The final summary reports message IDs, rendered messages, messages skipped
because they need arguments, line count, and text mismatches. Skipped messages
need separate checks with representative argument values. Do not count them as
passes.

For one draft message:

```bash
node -e "const {loadCatalog}=require('./packages/cli/dist/locale-catalog.js'); const b=loadCatalog('zh-Hant'); console.log(b.render('jouzu.cli.error.profileState.recovery', undefined, { columns: 48 }).join('\n'));"
```

## Environment details

For each manual result, record:

- Jouzu build, Pi version, OS version, and locale settings.
- Terminal program and version, columns, and rows.
- Whether the run used SSH, tmux, or another multiplexer, with their versions.
- IME or screen reader and version, when used.
- Catalog locale, version, and digest.
- The exact steps, expected result, observed result, and date.

A result applies only to that environment. Remove credentials, private paths,
conversation content, and host identities before sharing diagnostic output.

## Manual checks

Repeat the applicable checks at 48, 80, and 120 columns. Use an interactive
UTF-8-capable terminal. Check Linux, macOS, and Windows separately rather than
inferring one platform's behavior from another.

### Interface and locale resolution

1. Launch `jz --jouzu-ui-locale en`, then `jz --jouzu-ui-locale ja`.
2. Open Models and Settings in the Palette using the effective bindings.
3. Check that required labels remain readable, selection and cancel work, and
   rendered lines fit the terminal. Exercise long model IDs and paths as well
   as ordinary text.
4. Run `jz doctor --json` and compare the requested locale, effective locale,
   and loaded catalog fields described in [Localization](localization.md).
5. Repeat with `auto` under English and Japanese locale environments. Record
   whether the OS locale is installed or only `LANG`/`LC_ALL` was changed.
6. Request each Chinese locale and check that the interface uses English
   fallback. Inspect draft text with the direct renderer, separately.

### SSH and multiplexers

1. Repeat the interface checks over SSH and inside tmux or the multiplexer you
   use. Record both client and remote locale settings.
2. Resize the pane through all three widths and open the Palette.
3. Check for split wide glyphs, clipped labels, and unintended terminal wrapping.
   Compare long protected values with their source bytes; a visual line break
   must not be mistaken for a changed identifier.
4. Confirm that both floating and in-place Palette presentations preserve the
   same actions and cancel behavior. See [Palette layout](palette-ux.md#layout-and-terminal-behavior).

### IME input

1. In an English or Japanese session, compose text with a Japanese or Chinese
   IME in the prompt and in a searchable Palette field.
2. Confirm and cancel compositions, and switch input methods while editing.
3. Check that composition reaches the focused text field, is not interpreted
   as a shortcut, and does not lose confirmed text.
4. Exercise language controls while a composition or confirmation is active.
   Check for unintended submission, lost text, or a changed confirmation.

### No color

1. Run `NO_COLOR=1 jz --jouzu-ui-locale ja doctor`.
2. Run `TERM=dumb jz --jouzu-ui-locale ja doctor`.
3. Check that neither output contains escape sequences and that text and markers
   carry the same meaning as the color output. `TERM=dumb` is a command-output
   check, not an interactive keyboard test.

### Screen reader

1. Run with the screen reader used on the target OS, such as NVDA, VoiceOver,
   or Orca.
2. Read messages with CJK punctuation, brackets, backticks, and protected values.
3. Check whether labels, focused rows, and recovery actions are understandable
   without color. Record pronunciation or navigation failures separately from
   terminal-width failures.

Keep unrun checks marked unrun. A deterministic pass or captured pane is not
proof of native IME operation, screen reader usability, or translation quality.
