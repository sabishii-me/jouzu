# Windows launcher CI

## Validation

`Launcher Windows checks` can be dispatched manually or run for launcher pull requests. It builds the frontend and Windows binaries, runs packaging and Rust tests, and exercises the UI with mocked IPC. It does not sign, publish, or install an update. A green check is not installed upgrade acceptance.

## Signed distribution prerequisites

Before adding a signing job, configure a protected GitHub Environment and restrict it to reviewed branches. Do not expose signing credentials to pull-request code. Prefer Azure OIDC federation scoped to the repository and Environment; grant only the required certificate-profile signing role.

Required nonsecret configuration:

- Regional Artifact Signing endpoint, account and certificate profile.
- Expected certificate subject.
- Qualified Windows runtime recipe with frozen lockfile, customized dependency artifacts and integrity records.
- Pinned Node, pnpm and PortableGit inputs with verified hashes.
- Reachable HTTPS update endpoints and public verification keys.

Keep updater and recipe private signing keys in protected secrets. They are separate from Azure Authenticode. Do not commit local login caches, private keys, machine-specific build paths or temporary HTTP update settings.

`sign-windows.ps1` accepts explicit SignTool, signing-client DLL and metadata paths, then verifies Authenticode, expected subject and timestamp. Provision those tools from trusted pinned sources. The job must establish its own working identity before invoking the script.

Signing order:

1. Build and sign launcher-owned executables.
2. Bundle using the tracked installer template and hooks, retaining product identity and paths.
3. Sign and verify the final installer.
4. Generate the Tauri updater signature over the final installer bytes.
5. Generate checksums and update metadata; do not modify signed artifacts afterward.

Initially retain output as CI artifacts for review. Publishing a release/feed is a separate authorized operation. Actions artifact download pages are not installer download URLs. Private release assets also require a supported authentication mechanism; do not assume an unauthenticated client can download them.

Validate both independent update paths with installed builds: launcher replacement must retain the selected Jouzu version; Jouzu update must retain user configuration and use the qualified patched runtime. Test normal uninstall/reinstall separately from launcher upgrade. Use the normal product identity and installation paths for acceptance.
