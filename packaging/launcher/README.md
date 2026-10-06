# Launcher packaging

The launcher packages Jouzu as a native Windows application: a Tauri launcher with its own workspace
screen, a console entry point, the Jouzu application payload, and the runtime that payload needs.
`apps/launcher/` holds the application; everything in this directory builds, verifies, signs and
publishes it.

## Packages

| Artifact | Contents | Purpose |
| --- | --- | --- |
| `Jouzu Launcher_<version>_x64-setup.exe` | launcher, console, application payload, Node/pnpm/PortableGit runtime | download, first install, repair |
| `Jouzu Launcher_<version>_x64-update.exe` | launcher and launcher-owned support files only | in-app launcher update; the update feed serves only this artifact |

Both come from one source tree in one release, and `build.json` records the version, the commit, the
workflow run and both hashes. An update package that reaches a tenth of the full package is refused:
that means the application payload was bundled into it, and an update exists precisely so that
installing it does not rewrite the payload.

## Build inputs

The launcher binaries come from the Tauri CLI (`tauri build --no-bundle`), which is what embeds the
frontend into them; a binary from a plain `cargo build` would load the development URL instead, so the
packaging step runs the launcher's own production build check and refuses to bundle one.

Pinned and hash-verified: Node 24.19.0 from nodejs.org (SHA-256 checked against `SHASUMS256.txt`),
PortableGit 2.55.0.5 from git-for-windows (pinned SHA-256), and pnpm 10.21.0. `NOTICES.md` lists the
bundled components and their licences.

## Components

The full package carries the launcher, the console, the Jouzu payload, and the runtime components those
need: Node, pnpm, PortableGit and Windows Terminal. The launcher-only package carries launcher-owned
files only, so an update never rewrites a component. A component that is missing or unusable is
installed from the launcher: the shipped archive when the package carries one, otherwise the pinned
release, verified by digest (and by publisher for PortableGit) before it is extracted.

Windows Terminal hosts the console window, because the standard console host redraws a high-repaint
interface incorrectly on Windows 10. The launcher installs the copy it ships before Jouzu starts on a
machine that lacks it, and that copy hosts the console; a Windows Terminal the machine already has is
used only when Jouzu's copy is absent. A folder whose path
contains a semicolon keeps the standard console host, because Windows Terminal treats a semicolon as a
command separator.

## Application staging

`stage-application.mjs` copies a **prepared npm installation prefix** into a separate application directory. It does not install dependencies, execute package scripts, download runtimes, or create an installer.

```sh
node packaging/launcher/stage-application.mjs <prepared-prefix> <new-output-directory> <os-arch> <full-source-commit>
```

The prepared prefix must contain `node_modules/jouzu/dist/cli.js`, the Jouzu package metadata, and a root `package-lock.json`. Only `node_modules`, `package.json`, and `package-lock.json` are accepted at its root. The output parent must exist, and the output directory must not exist or be inside the input. Linked entries are rejected. Keep build inputs stable while staging.

Supported target labels are `windows`, `macos`, or `linux`, paired with `x64` or `arm64`, for example `windows-x64`. The label records the caller's target; it does **not** verify native binary compatibility.

Output:

```text
output/
  app/                 # copied prepared installation
  inventory.json       # provenance and unpacked file report
```

The report includes file hashes, unpacked sizes, duplicate-content groups and the largest package trees. File paths in the inventory are relative to `app/`; `entrypoint` is relative to the output directory. Nested dependency bytes are attributed to the closest package tree. Duplicate reports are informational: files are not automatically deduplicated. The application source tree is not modified.

The report is not signed release metadata or a compatibility certificate. When the package supplies `gitHead`, staging rejects a different caller-supplied source commit. Verify startup and native dependencies on the target platform before distributing an application archive. Compression, archive signatures, supporting-tool provisioning and launcher activation are separate operations. The source commit is supplied by the caller, not inferred or authenticated by this tool.

Run focused tests through the repository runner:

```sh
npm run test:node -- packaging/launcher/stage-application.test.mjs
```

## Offline starter preparation

`prepare-starter.mjs` runs at build time, not first launch. It copies the supplied Node distribution and private pnpm package, installs a recipe from a prepopulated store with network fallback disabled, and runs Jouzu's version check before making output available:

```sh
node packaging/launcher/prepare-starter.mjs <recipe> <node-runtime> <pnpm-package> <seeded-store> <new-output>
```

The recipe contains `package.json`, `pnpm-lock.yaml`, and optional `patches/`. Pin `packageManager` to `pnpm@10.21.0`. The supplied pnpm package must match. Build on the target OS/architecture using qualified, authenticated inputs. The script does not download or authenticate those inputs itself.

The resulting directory contains `node/`, `pnpm/`, and installed `app/`. Installation uses a frozen lock, production dependencies, disabled lifecycle scripts, a hoisted layout and copied package content. The source store is not copied: shipping a second copy of package content is not required for startup. Packages requiring build scripts must be explicitly prepared and qualified separately; this command does not silently enable scripts.

## Jouzu updates

A Jouzu update is described by a signed recipe: the npm tarballs, a frozen lock, a manifest and a
signature verified with `JOUZU_RECIPE_PUBLIC_KEY`. The manifest carries the changelog section for the
version being installed as `notes`/`notesSource`, read at the exact commit the registry reports, so the
interface shows text that belongs to the published bytes and a recipe without notes is refused. The
recipe is downloaded from `JOUZU_RECIPE_BASE_URL`, authenticated, staged into
`<managed root>/updates/versions/<slot>` using the installed Node and pnpm, health-checked, and
activated by writing `active.json`; a failed check restores the previous selection. Superseded slots
are pruned after activation, and user data stays in `<managed root>/data`.

The recipe workflow prepares the runtime once per npm version and uploads it for reuse, and a launcher
build restores that qualified runtime instead of preparing the npm package a second time.

## Release signing

Windows Authenticode signatures use Azure Artifact Signing. The tools are obtained the way Microsoft
documents (`nuget.exe install Microsoft.Windows.SDK.BuildTools` for signtool and
`Microsoft.ArtifactSigning.Client` for the signing dlib), and `sign-windows.ps1` runs the documented
command (`/fd SHA256`, RFC3161 timestamp, `/dlib`, `/dmdf`) through the bundler's
`bundle.windows.signCommand`. The bundler calls it for the application binaries, for every bundled
`.exe`/`.dll` that does not already carry a vendor signature, and for the NSIS-generated uninstaller
through the define the bundler supplies. The command reads its configuration from the environment
(`JOUZU_SIGN_SIGNTOOL`, `JOUZU_SIGN_DLIB`, `JOUZU_SIGN_METADATA`, `JOUZU_SIGN_SKIP_ROOTS`,
`JOUZU_SIGN_LOG`) and logs every result, which the release prints when a bundle fails.

The application payload and the runtime are never signed: upstream pins their size and SHA-256 and the
payload re-checks both when it starts a native helper, so signing them would disable that check.
`JOUZU_SIGN_SKIP_ROOTS` carries those directories.

Configuration is checked before a build compiles anything (`signing-preflight.mjs`):

| Kind | Name | Purpose |
| --- | --- | --- |
| Variable | `LAUNCHER_PUBLIC_KEY` | Tauri public verification key embedded in the client |
| Secret | `TAURI_SIGNING_PRIVATE_KEY` | Corresponding Tauri signing key |
| Variable | `JOUZU_RECIPE_PUBLIC_KEY` | Recipe verification key |
| Secret | `JOUZU_RECIPE_PRIVATE_KEY` | Corresponding recipe signing key |
| Variable | `JOUZU_RECIPE_BASE_URL` | HTTPS recipe directory or release asset base, ending in `/` |
| Variables | `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` | OIDC signing identity |
| Variables | `AZURE_SIGNING_ENDPOINT`, `AZURE_SIGNING_ACCOUNT`, `AZURE_SIGNING_PROFILE` | Artifact Signing destination |
| Variable | `EXPECTED_SIGNER` | Exact expected Authenticode certificate subject |

The updater signature over the published installer is verified against `LAUNCHER_PUBLIC_KEY` before
publication, so an installer that no installed launcher could verify is never offered.

A release publishes its version assets once and then replaces the `launcher-update` feed, which is the
only replaceable file: it names the stored artifact, carries the changelog section as `notes` and the
updater signature. A scheduled check re-verifies that the published npm version still has a matching
signed recipe and opens an issue when it does not, and the npm publication workflow calls the recipe
workflow with `publish: true`, so a published version cannot exist without its signed Windows update
artifact.

## Validation

```sh
npm run test:node -- packaging/launcher/*.test.mjs
```

`Launcher Windows checks` builds the frontend and the Windows binaries, runs these packaging tests and
the Rust tests, and exercises the interface with mocked IPC. It does not sign, publish, or install an
update, and a green check is not installed-upgrade acceptance: verify that a launcher replacement
retains the selected Jouzu version and that a Jouzu update retains user configuration, and test
uninstall separately from a launcher upgrade.
