# Models

Open the Models view with `/model` or `Ctrl+L`. Your prompt draft is kept.

## Models view keys

| Key | Action |
| --- | --- |
| Type a character, or press `/` | Search provider/model IDs and display names |
| `↑` / `↓` | Move through the list. While the search field is focused, the first press leaves it and keeps the query. |
| `Esc` | Clear a search, leave the search field, or close the view, in that order |
| `Tab` / `Shift+Tab` | Switch Palette section: Models, Workflow, Settings |
| `Enter` | Select the model and save it as this project's default |
| `Ctrl+F` | Toggle favorite (also while searching) |
| `Ctrl+Shift+R` | Refresh catalogs and providers |

`Esc` clears a non-empty search and returns the cursor to the model you were on before searching. With an empty, focused search field, it leaves the field. Otherwise, it closes the Models view.

- `Ctrl+P` outside the Palette cycles your favorites within the current model scope.
- The header shows the number of matching models and the total you can select.
- To rebind `Ctrl+F` or `Ctrl+Shift+R`, see [Keybindings](keybindings.md). If you bind an action to a printable key, press `↑` or `↓` to move into the search results before using it; the query stays in place.

## Model list

With an empty search, the list shows models in this order:

1. The current model (`●`)
2. Models used earlier in this session, most recent first (`↺`)
3. Favorites (`★`), in the order you added them
4. Models that sent a request recently, with this project's models first
5. Every other model, alphabetically by name

Typing ranks the whole list by how well each model matches and moves the cursor to the best match. Models that match equally keep the order above. Clearing the search, with `Esc` or by deleting the text, returns the cursor to where it was before you started typing.

Each row shows the model name, its provider, and its context window. `◆` marks this project's default. The line above the list shows the selected model's exact provider/model ID and catalog. When two catalogs offer the same provider/model ID, the Provider column also names the catalog. Narrow terminals hide the Context column first, then Provider.

## Which model a new session uses

Jouzu uses the first of these that applies:

1. `--model`
2. The model recorded in a resumed session
3. The project default (set with `Enter` in the Models view)
4. The last model that sent a request
5. Jouzu's user-wide default, then its fallback

- Restoring a model from step 3 or 4 also restores its saved thinking level, unless you pass `--thinking`.
- Resume, continue, session, model, and scoped-model arguments skip steps 3 and 4.

## Thinking levels

- Each model remembers the thinking level you set for it. The choice is saved immediately.
- Without a saved choice, Jouzu uses the catalog's `defaultThinkingLevel`, then Pi's configured default.
- These override a saved choice: startup thinking arguments, a resumed session's level, and scoped-model thinking pins.
- If a catalog declares `supportedThinkingLevels`, only those levels are shown. An unsupported choice moves up to the next supported level, or to the highest one if none is higher. `off` appears only when listed.

## Recents, favorites, and saved state

- A model joins the recently used models after it sends its first request.
- Clearing recents keeps your thinking-level choices.
- Project defaults, favorites, recents, thinking levels, and the last-used model are stored in local Jouzu state. They contain no prompts, tool results, credentials, or raw project paths.

## Switching to a model with a smaller context window

- Jouzu blocks a switch when the current context plus a 4,096-token margin exceeds the target model's window.
- When the Models view marks a model `context-small`, Jouzu asks first:
  - `Enter` compacts the conversation into a brief, rechecks the size, and switches.
  - `Esc` cancels.
- Jouzu does not judge cache compatibility, cost, routing, privacy, data retention, or region. Those depend on the provider you select.

## Context ceiling

A global ceiling caps every model's usable context window. Set it in Settings / Catalogs (`/catalogs`): press `↑` from the first source row, then `←` / `→`.

- Values: 128K, 192K, 256K, 384K, 512K, 768K, 1M, or off.
- Compaction, the footer percentage, and the Models view fit check use the smaller of the model's window and the ceiling. Example: a 1M-token model under a 384K ceiling compacts as if its window were 384K.
- For local provider models, a `models.json` `modelOverrides.contextWindow` value overrides the ceiling.
- Authenticated gateway catalog models use their catalog windows, capped by the ceiling. A local provider `modelOverrides.contextWindow` value does not change them.
- Turning the ceiling off restores the declared windows in the current session.
- Stored in `context-policy.json` next to `catalogs.json`.
