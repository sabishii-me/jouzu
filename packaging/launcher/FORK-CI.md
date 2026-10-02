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

## Administrator responsibilities

The signing administrator manages Azure. The GitHub repository administrator does not need Azure access and must not disable signing-service controls.

| Owner | Configuration |
| --- | --- |
| Signing administrator | Azure application/service principal, certificate-profile signer role, and federated identity |
| Repository administrator | Protected GitHub Environment, required reviewers, permitted deployment branches/tags, Environment variables and secrets |
| Release maintainer | Review the source commit, approve the protected job, inspect artifacts and authorize publication |

For OIDC, use issuer `https://token.actions.githubusercontent.com`, audience `api://AzureADTokenExchange`, and subject `repo:OWNER/REPOSITORY:environment:ENVIRONMENT`. The repository and Environment names must match exactly. Use a separate federation for the fork. Do not export a developer's Azure login cache or create a client secret as a substitute for federation.

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
signing job logs into Azure with GitHub OIDC, bundles and signs the declared own
executables, and signs the NSIS-generated uninstaller. Vendor resources are not
re-signed; their hashes are checked for changes. The Tauri callback executes after
bundle-type patching so the Launcher signature covers its final bytes.

Publication creates `launcher-vVERSION` before replacing the `launcher-update`
feed. Existing version assets are never overwritten. A failed signing or
publication step must be diagnosed and corrected before retrying; it must not be
bypassed by publishing unsigned output. The workflow requires initial fork
integration qualification before being used for production releases.
