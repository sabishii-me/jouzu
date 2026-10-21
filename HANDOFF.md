# Handoff

Updated: 2026-10-21 17:12 JST  
Branch: `feat/embedded-chat-workspace`  
Fork: `sabishii-me/jouzu`

## Current state

- `upstream/main` has been merged into this branch.
- Upstream product identity is authoritative:
  - product: `Jouzu Launcher`
  - binary: `launcher.exe`
  - identifier: `ai.shisa.jouzu.launcher`
  - package/version: `@shisa-ai/jouzu-launcher` `0.2.1`
- The desktop rename experiment (`jouzu-desktop`, `ai.shisa.jouzu.desktop`) was reverted.
- Installer source is the upstream/origin version: old installation detection and the
  upgrade/remove-old-version prompt are preserved.
- Window sizing remains `1440x900`, minimum `960x640`.
- User-facing launcher features retained:
  - embedded ChatWorkspace
  - streaming thinking/turn footer and session stats
  - Flow control as a session-scoped header menu
  - instant session history preview and cached hover prefetch
  - session rail refresh after turns
  - queued session opens during warm-up
  - runtime update lock release and managed `TEMP`/`TMP`/`TMPDIR`
  - default workspace at `Documents/Jouzu/default-workspace`, labelled
    `Default workspace`
  - onboarding gate: `setup` must load and `modelReady` must be true before
    ChatWorkspace renders
  - session reload: reopen the saved session through `switch_session`, rebind
    extensions/skills/MCP/catalogs, then refresh history and models
  - MCP: header action runs the runtime's `/mcp` extension command
  - Flow panel: always available in a session, spinning live indicator, Flow
    status notice routed into the panel instead of the page banner, and every
    `/flow` command exposed in the UI (status, pause, resume, clear, runtime,
    off, on, details, retry, cancel, reset confirm)
  - Markdown: GFM, highlighted code blocks, language labels and code-aware copy
  - tool results: ANSI/SGR colors, line numbers, Markdown files, grep match
    highlighting, JSON formatting, diff colors, image previews, error metadata,
    copy/download, and expand/collapse for long output

## Validated on Windows

```text
cd apps/launcher
npm test                 # 70 passed
npm run build            # passed
cd src-tauri
cargo check              # passed
cargo test               # 8 + 15 + 53 passed, 1 ignored
```

Runtime update path was tested in `tauri dev` from a 0.1.18 runtime:

```text
check   -> 0.2.1 available
install -> 0.2.1, cleanupPending=false
```

## Running the desktop in development

`tauri dev` does not bundle the runtime. Point it at an installed Jouzu root
that contains `app/bootstrap.mjs` and `runtime/node/node.exe`:

```powershell
$env:JOUZU_LAUNCHER_DEV_RUNTIME="$env:LOCALAPPDATA\Shisa.ai\Jouzu"
cd apps/launcher
npm run tauri dev
```

Do not point `JOUZU_LAUNCHER_DEV_RUNTIME` at a sandbox-extracted runtime whose
`node.exe` has inherited restricted ACLs; that runtime exits with EPERM while
creating its settings lock.

## Remaining work

- visual/e2e fixtures for real-session Flow updates, the full Flow command panel,
  MCP dialogs and reload behavior
- exit-code/duration fixtures when the runtime emits structured metadata
- Windows and macOS rendering regression captures
- signed installer and published launcher feed from the merged tree

## Local environment limitations

`npm run check` reaches one unrelated Windows-only fixture failure:

```text
pi-content-policy.test.mjs
EPERM: operation not permitted, symlink ...
```

The fixture needs Windows symlink/Developer Mode privileges. Full CLI build also
requires Go >= 1.21 for the reviewed TextGuard artifact. These are runner
requirements, not product code failures.

## Packaging and release status

- No signed installer has been produced from this merged tree.
- Local installers under `apps/launcher/src-tauri/target/full-build/release/` are
  development artifacts. Some predate the upstream merge or use the old 0.1.18
  payload; do not publish or send them as a release.
- Update feeds are build-time configuration, not committed:
  - runtime feed: official `shisa-ai/jouzu` signed recipe
  - desktop feed: fork `sabishii-me/jouzu` launcher feed
- A release still needs the signed CI path and published artifacts. Do not hand
  out an unsigned desktop installer.

## Continue on macOS

```bash
git fetch origin
git checkout feat/embedded-chat-workspace
npm ci
npm run build --workspace packages/session-ui
npm run check
npm test
cd apps/launcher
npm ci
npm test
npm run build
```

The Windows installer, WebView2, and native tray paths must be validated on
Windows; do not infer them from macOS results.
