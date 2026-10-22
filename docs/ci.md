# CI runs

Pushes to `main` and pull requests run a required tier on Ubuntu unless they change something that needs full Linux and macOS qualification (see [Required tier](#required-tier)). Manual runs with `platform=all` always run full qualification. Releases also require native local Windows qualification of the exact CI-built package, with matching source and artifact identities, test results, and unchanged Defender protection settings. The publisher rejects missing or failed Windows evidence.

## Hosted jobs

| Job | Runs on | Checks |
| --- | --- | --- |
| `node` | Ubuntu and macOS, Node 22 | Source-checkout build, static checks, runner tests, Session UI and CLI suites; in full qualification, Ubuntu also runs the networked extension check |
| `endurance` | Ubuntu, Node 22 | Flow-control cases that cross exact production storage limits (`@endurance`) |
| `legacy-linux-static-fetch` | Rocky Linux 8 (glibc 2.28), Node 22.23.4 | Build, default dependency loading, and isolated optional browser-client imports without the unused IP-discovery transport; no browser launch |
| `release-artifacts` | Ubuntu, Node 22 | Locked install, build, static checks, release-metadata and package-content tests, then the candidate package and updater fixtures |
| `packed-install` | Ubuntu and macOS | Local, `npm exec`, and global installation from the candidate, one step per scope |
| `automatic-update` | Ubuntu and macOS | Update success, then rollback from a broken package, one step each |
| `published-upgrade` | Ubuntu and macOS | Upgrade from the published prior version, restart, and rollback |
| `optional-camoufox` | Ubuntu and macOS | First-use browser runtime installation |
| `python` | Ubuntu and macOS | Python 3.10, 3.11, 3.12, 3.13, and 3.14, one step each; Ubuntu also builds and checks the package |

Package consumers start when `release-artifacts` uploads the candidate. Each later step in a consolidated job runs even when an earlier step fails, so one run reports every failing scope.

The Python package declares `requires-python >=3.10`. Hosted CI tests every supported CPython minor, 3.10 through 3.14. Add a new minor to the `python` job when it is released.

## Required tier

Hosted CI tests Node 22, the minimum version Jouzu supports. Windows runs also test Node 24, the runtime the Windows launcher bundles.

A push or pull request runs:

- `node (ubuntu-latest, 22)`: the canonical CLI suite and the test duration budgets;
- `legacy-linux-static-fetch`: the glibc 2.28 floor and Node 22.23.4;
- `python (ubuntu-latest)`; and
- `endurance` when the change touches flow control.

It runs full qualification instead when it changes dependencies, packaging, installation, updates, the bundled Python package, `upstream/`, workflows, or release and packaging scripts. A pull request with the `full-ci` label also runs full qualification, and so does a push whose changed files cannot be listed completely. `scripts/ci-changes.mjs` classifies the changed files in the `changes` job. A release commit changes the package versions, so its push runs full qualification.

`ci-result` is the check for branch protection. It passes when every job passed or was skipped by the required tier or Windows-only diagnostics. Publication requires a full-qualification run on the release commit. To run one on any commit:

```sh
gh workflow run ci.yml --ref main -f platform=all
```

Pushes and manual runs queue per commit; a later push does not cancel another commit's run. A newer push to a pull request cancels that pull request's earlier run.

To run hosted Windows diagnostics manually:

```sh
gh workflow run ci.yml --ref main -f platform=windows -f npm-cache=warm -f fixture-drive=runner
```

This runs Windows Node 22/24, Python 3.10 through 3.14, packed local/global/npm-exec installation, update success/rollback, published-version upgrades, and first-use Camoufox. One Ubuntu job builds and checks the shared release artifacts before the Windows consumers start.

`npm-cache=warm` restores npm archives and lets the updater reuse the job's cache. The first run can miss the cache. `npm-cache=cold` skips restoration and gives the updater a fresh cache. Both modes install fresh dependency trees. Compare repeated runs at the same commit to measure cache effects.

`fixture-drive=runner` uses the runner's temp directory. `C` and `D` select a job-owned directory on that volume for temporary test installations; npm archives remain under the runner temp directory. Use the same cache mode when comparing volumes. Fixture placement does not depend on Defender state. Jobs preserve image protection settings and remove only exclusions they add.

The `windows-npm-*` artifacts contain npm timing/debug logs and the selected paths. `windows-defender-*` records protection state and exclusion cleanup. If an image with protection disabled stops answering Defender queries and the job added no exclusions, cleanup records `not-required` with unknown final state and the query error. Other query failures fail the job. Compare elapsed time from the first Windows job start to the last Windows job finish, and inspect the artifact producer's duration separately. Adding parallel job durations measures runner usage, not elapsed time.

Source compatibility jobs use `node scripts/install-source-dependencies.mjs` followed by `JOUZU_BUILD_SOURCE_ONLY=1 npm run build`. The install temporarily removes workspace bundle declarations so npm installs the locked source dependencies, then restores the manifest and lock bytes even on failure. The build reuses those dependencies through package-directory links. Release artifact production uses `npm ci --ignore-scripts` and `npm run build` to prepare the nested distributable bundle.
