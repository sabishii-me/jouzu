# Four-locale glossary for the Jouzu CLI catalog

The `en`, `ja`, `zh-Hans`, and `zh-Hant` catalogs share the protected values
listed here. Keep these values in their original form in every locale. The
Chinese glossaries also list vocabulary and wording rules.

## Catalogs

Only `en` and `ja` are offered as interface languages. The Chinese catalogs are
drafts for contributor use, not additional supported interfaces.

| Locale | Catalog | Vocabulary |
| --- | --- | --- |
| `en` | `packages/cli/locales/en` | English source |
| `ja` | `packages/cli/locales/ja` | `cli.ftl` header |
| `zh-Hans` | `packages/cli/locales/zh-Hans` | [Simplified Chinese glossary](localization-zh-hans-glossary.md) |
| `zh-Hant` | `packages/cli/locales/zh-Hant` | [Traditional Chinese glossary](localization-zh-hant-glossary.md) |

`packages/cli/locales/catalog-status.json` supplies metadata for the diagnostic
support state; see [Localization](localization.md). A catalog's presence does
not establish language quality or terminal qualification.

## Protected values

These stay as written in every locale. A translator never renders them in
another script.

- **Commands and options:** `jz`, `jouzu`, `pi`, `jouzu --help`,
  `jouzu pi --help`, `jz doctor`, `jz doctor --json`, `jz catalog status`,
  `jz keybindings plan`, `jz keybindings apply`, `jz profile plan`,
  `jz profile apply`, `jz update --extensions`, `--json`, `--jouzu-home`,
  `--jouzu-profile`, `--jouzu-ui-locale`, `--profile`, `--yes`.
- **Slash commands:** `/login shisa`, `/logout shisa`, `/reload`, `/textguard`,
  `/voice`, `/flow`, `/subagents`, `/workflow`, `/labels`, `/model`,
  `/catalogs`.
- **Policy and mode values:** `auto`, `auto-restart`, `notify`, `off`, `none`,
  `guarded`, `strict`, `bearer` and `Bearer`.
- **Product names:** `Jouzu`, `Pi`, `Shisa`, `TextGuard`, `Camoufox`.
- **Palette product nouns:** `Jouzu Palette`, `Palette`, `Settings`,
  `Catalogs`, `Models`, `About`, `Dashboard`, `Workflow`, `Session UI`,
  `Jouzu Help`, `Parent Context`, `Subagent`, `Fetch URL`, `Search web`.
- **Profile ids:** `core`, `ja`.
- **Locale tags:** `en`, `ja`, `zh-Hans`, `zh-Hant`.
- **Settings keys and file names:** `schemaVersion`, `uiLocale`,
  `responseLanguage`, `artifactPolicy`, `maxContextTokens`, `settings.json`,
  `keybindings.json`, `localization.json`, `localization.lock`,
  `catalog.lock.json`, `catalog-status.json`, `models.json`, `auth.json`,
  `agents.json`.
- **Environment variables:** `JOUZU_NO_CLEAR`, `JOUZU_UI_LOCALE`,
  `SHISA_API_KEY`, `NO_COLOR`, `TERM`, `LC_ALL`, `LC_MESSAGES`, `LANG`.
- **Tool names and identifiers:** `tff-fetch_url`, `tff-search_web`, and every
  model, provider, source, and offering ID.
- **Key names:** `Ctrl+L`, `Ctrl+C`, `Tab`, `Shift+Tab`, `Enter`, `Control+Up`,
  `ctrl+enter`, `Kitty`, `modifyOtherKeys`.
- **Thinking levels**, **paths**, **URLs**, **HTTP status codes**, **exit
  codes**, **digests**, and **version strings**.

A `Palette` product noun stays English even inside a translated sentence,
because it names a view the user sees in the Palette. A term such as
`catalog`, `session`, or `workflow` is vocabulary, not a product noun, and is
translated; only the exact view names in the list above are protected.

## Catalog notation

A command or identifier in the Simplified Chinese draft may use ASCII double
quotes (`"jouzu --help"`); Japanese and Traditional Chinese use ASCII backticks.
A Traditional Chinese label may end with `:`, while Simplified Chinese uses
`：`. These punctuation differences do not change the protected value inside.

After editing a catalog, run `node scripts/catalog-digest.mjs` to inspect its
digest and `node scripts/check-locales.mjs` to check catalog consistency.
