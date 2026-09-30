# Launcher application staging

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

This is a build primitive, not a complete installer. A real release recipe, native-feature checks, relocation/offline acceptance, starter import into the managed installation, and updater integration are still required. A version check alone does not qualify all features.
