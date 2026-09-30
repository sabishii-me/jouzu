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

The report is not signed release metadata or a compatibility certificate. Verify startup and native dependencies on the target platform before distributing an application archive. Compression, archive signatures, supporting-tool provisioning and launcher activation are separate operations. The source commit is supplied by the caller, not inferred or authenticated by this tool.

Run focused tests through the repository runner:

```sh
npm run test:node -- packaging/launcher/stage-application.test.mjs
```
