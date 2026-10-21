# Handoff

Updated: 2026-10-21  
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

## Validated on Windows

```text
cd apps/launcher
npm test                 # 61 passed
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
```

The Windows installer, WebView2, and native tray paths must be validated on
Windows; do not infer them from macOS results.
