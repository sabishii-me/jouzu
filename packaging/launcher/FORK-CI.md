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

`sign-windows.ps1` runs the documented Artifact Signing SignTool command (`/fd SHA256`, RFC3161
timestamp, `/dlib` and `/dmdf`) and then verifies Authenticode, the expected subject and the
timestamp. The job establishes its own working identity before it runs.

Signing order, all driven by the bundler:

1. Configure `bundle.windows.signCommand` to run `sign-windows.ps1`; the bundler calls it for the
   application binaries, for every bundled `.exe`/`.dll` that is not already signed, and for the
   NSIS-generated uninstaller through the `UNINSTALLERSIGNCOMMAND` define it supplies itself.
2. The bundler compiles each installer and signs it with the same command.
3. Verify the final signatures of the application binaries and both installers.
4. Generate the Tauri updater signature over the final installer bytes; the CLI reads the key from
   its environment, so the key is never written to a file.
5. Generate checksums and update metadata; do not modify signed artifacts afterward.

Binaries that already carry a vendor signature are skipped by the bundler (`signtool verify`), so
third-party tools keep their own publisher.

Initially retain output as CI artifacts for review. Publishing a release/feed is a separate authorized operation. Actions artifact download pages are not installer download URLs. Private release assets also require a supported authentication mechanism; do not assume an unauthenticated client can download them.

Validate both independent update paths with installed builds: launcher replacement must retain the selected Jouzu version; Jouzu update must retain user configuration and use the qualified patched runtime. Test normal uninstall/reinstall separately from launcher upgrade. Use the normal product identity and installation paths for acceptance.

## Administrator responsibilities

The signing administrator manages Azure. The GitHub repository administrator does not need Azure access and must not disable signing-service controls.

| Owner | Configuration |
| --- | --- |
| Signing administrator | Azure application/service principal, certificate-profile signer role, and federated identity |
| Repository administrator | Protected GitHub Environment, required reviewers, permitted deployment branches/tags, Environment variables and secrets |
| Release maintainer | Review the source commit, approve the protected job, inspect artifacts and authorize publication |

For OIDC, use the documented `azure/login` action. Use issuer `https://token.actions.githubusercontent.com`, audience `api://AzureADTokenExchange`, and subject `repo:OWNER@OWNER_ID/REPOSITORY@REPOSITORY_ID:environment:ENVIRONMENT`: GitHub includes the numeric owner and repository IDs, and a federation created without them is rejected with `AADSTS700213`. The repository and Environment names must match exactly. Use a separate federation for the fork. Do not export a developer's Azure login cache or create a client secret as a substitute for federation.

### Environment configuration

| Kind | Name | Purpose |
| --- | --- | --- |
| Variable | `LAUNCHER_PUBLIC_KEY` | Tauri public verification key embedded in the client |
| Secret | `TAURI_SIGNING_PRIVATE_KEY` | Corresponding Tauri signing key |
| Variable | `JOUZU_RECIPE_PUBLIC_KEY` | PEM Ed25519 verification key |
| Secret | `JOUZU_RECIPE_PRIVATE_KEY` | Corresponding PEM Ed25519 private key |
| Variable | `JOUZU_RECIPE_BASE_URL` | HTTPS recipe directory or GitHub Release asset base, ending in `/` |
| Variables | `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` | OIDC signing identity |
| Variables | `AZURE_SIGNING_ENDPOINT`, `AZURE_SIGNING_ACCOUNT`, `AZURE_SIGNING_PROFILE` | Artifact Signing service destination |
| Variable | `EXPECTED_SIGNER` | Exact expected Authenticode certificate subject |

GitHub supplies `GITHUB_REPOSITORY`; do not hardcode the fork in product source. `signing-preflight.mjs` checks component requirements before a build. Jouzu recipe signing does not require Azure credentials or the Launcher private key.

The current recipe workflow uses the protected `launcher-test` Environment. It prepares and signs an update independently of any Launcher build and uploads an artifact for review. It does not publish a Release. A workflow introduced only on a feature branch may need its scoped push trigger before GitHub makes it available for manual dispatch.

GitHub recipe assets use flat names: `artifacts/example.tgz` is uploaded as `artifacts__example.tgz`. Signed manifest paths remain unchanged. The client accepts bounded redirects from GitHub Release URLs only to the HTTPS GitHub release-asset host. Ordinary directory sources cannot redirect. File integrity and recipe signature verification apply after transport.

Keep fork and production update keys separate. Moving the workflow does not move client trust: builds for the main repository embed its configured production public keys and endpoints. Required approval is retained during tests; do not disable it to make a pending run proceed.


### Launcher build and publication

The Launcher workflow separates unsigned compilation inputs from the protected
`sign-publish` job. Repository variables must contain the non-secret Azure
configuration in the table above so the initial configuration check can reject
an unconfigured release before compiling. The protected Environment may provide
the same values; keep both scopes consistent. Private keys remain Environment
secrets only.

The build job runs frontend and Rust tests, compiles the binaries, and uploads
signing inputs. It does not publish an unsigned installer. After approval, the
signing job authenticates through `azure/login` with GitHub OIDC, obtains the signing tools the
way Microsoft documents for Artifact Signing (`nuget.exe install Microsoft.Windows.SDK.BuildTools`
and `Microsoft.ArtifactSigning.Client`), and bundles each package with that sign command, so the
bundler signs the application binaries, the installers and the generated uninstaller. The signature
covers the bytes the bundler patches last.

A Launcher release publishes **two** artifacts from one source tree. The full
`Jouzu Launcher_VERSION_x64-setup.exe` carries the whole product (application,
Node, pnpm, PortableGit) and serves download, first install and repair. The
launcher-only `Jouzu Launcher_VERSION_x64-update.exe` carries launcher-owned
files and is what the in-app updater installs, so an update neither rewrites the
Jouzu payload nor requires closing a running session. `build.json` records both
hashes and the version release carries both; only the launcher-only artifact is
offered by the update feed.

### Release chain

A published npm version and its Windows update artifact must not diverge. After
the npm publish job succeeds, the npm workflow calls the recipe workflow (a
reusable `workflow_call` with `publish: true`) so the official npm version always
gets a signed recipe and a published Jouzu feed. The recipe workflow is the
single source of the Jouzu runtime: it prepares the runtime once from the
official package and uploads the signed recipe plus a reusable
`windows-published-runtime` artifact. A Launcher build takes a `runtime_run_id`
referring to a successful recipe or runtime run and restores that qualified
runtime; it does not prepare, download or re-install the npm package again, so
one npm version causes exactly one Windows runtime preparation.

Launcher publication stays manual (`workflow_dispatch`) because Launcher changes
rarely; the launcher-only artifact is built from the runtime the recipe flow has
already qualified. A scheduled guard re-checks that the published npm version
still has a matching signed recipe and opens an issue when it does not, so a
missed Windows artifact is detected rather than discovered by users.

### Release notes on every update item

An update item must say what changed. The Launcher item shows the section for
the released version in `apps/launcher/CHANGELOG.md`; `launcher-notes.mjs` reads
it and `publish-launcher.ps1` refuses to replace the feed without it. The Jouzu
item is described by the upstream changelog section for the version being
installed, read at the exact commit the registry reports (`gitHead`), so the
notes belong to the published bytes. The published npm package ships no
changelog, so the build reads it from the repository at that commit. The notes
travel inside the signed recipe manifest as `notes`/`notesSource`, which means
the client can show them before downloading and cannot be fed notes that were
not signed; a recipe without a notes record is refused. When the upstream
changelog has no section or cannot be read, the manifest records an explicit
`unavailable` source and the interface says plainly that no description was
published instead of showing an empty item. Wording is shown in the original
English with its source label.

Publication creates `launcher-vVERSION` before replacing the `launcher-update`
feed. Existing version assets are never overwritten. A failed signing or
publication step must be diagnosed and corrected before retrying; it must not be
bypassed by publishing unsigned output. The workflow requires initial fork
integration qualification before being used for production releases.
