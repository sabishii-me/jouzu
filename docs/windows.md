# Windows prerequisites

Install Jouzu with npm, or use the signed Windows launcher from GitHub Releases. See the [launcher guide](../packaging/launcher/README.md).

The launcher packages the Jouzu application, Node, pnpm, and Git Bash. The requirements below apply to npm installations.

## npm installation requirements

- Windows 10 or Windows 11 on x64
- Node.js 22.19 or newer (includes npm)
- Git for Windows (includes Git Bash)
- [Microsoft Visual C++ Redistributable (x64)](https://aka.ms/vc14/vc_redist.x64.exe)
- Windows Terminal or another UTF-8-capable terminal

Install Jouzu from a PowerShell or Git Bash session with npm.

Pi's coding tools execute Bash commands, so Git Bash must remain installed even when you launch `jouzu` from PowerShell or Windows Terminal.

Install the Microsoft Visual C++ Redistributable before launching Jouzu. The bundled `wreq-js` HTTP transport requires `VCRUNTIME140.dll`.

If startup reports `Failed to load native module for win32-x64-msvc` and `The specified module could not be found`, a missing runtime is one possible cause. Install or repair the redistributable, then run `jouzu doctor` again.

The npm installation does not install this runtime automatically.

Run these commands after installation:

```powershell
jouzu --version
jouzu doctor
jouzu profile plan --profile core
jouzu profile plan --profile ja
jouzu
```

The first interactive launch asks before enabling the optional `ja` profile (a preview that adds Japanese responses). Declining or pressing Enter uses `core`.

`jouzu doctor` reports missing Git or Bash as an actionable problem. The npm installation does not bundle Git Bash; it uses the Bash you installed.

When the isolated Jouzu agent root has no `keybindings.json`, the first interactive launch seeds `Ctrl+Enter` for follow-up and `Ctrl+Up` for dequeue; `Tab` retains Pi autocomplete.

On upgrade from v0.1.0, Jouzu backs up and replaces only an exact Jouzu-owned `Tab` follow-up entry. User-owned or modified bindings remain unchanged.

Use `jouzu keybindings plan` for the effective plan and portability notes. Windows Terminal must deliver modified Enter and arrow keys to the application.

For a global npm installation, the first eligible interactive launch checks for a newer Jouzu package before entering Pi. Jouzu uses the npm client on `PATH`, verifies the exact tarball SHA-512 and installed runtime, restores the previous locally packed version on a failed verification, and relaunches the original command after success.

Project-local, source, and ephemeral `npx` invocations are not rewritten. Use `jouzu self-update status` for classification or `JOUZU_NO_UPDATE=1` for a one-run opt-out. See [Updates](updates.md) for policies and environment variables.

## Paths and text

Jouzu uses `%APPDATA%\Jouzu\agent` for configuration and `%LOCALAPPDATA%\Jouzu` for state and cache by default. `--jouzu-home <path>` or `JOUZU_HOME` can select one portable root.

The compatibility suite covers spaces, Japanese characters, full-width spaces, UTF-8, UTF-8 BOM, CRLF, and normalization-sensitive names without rewriting user files.

The launcher keeps configuration, sessions, and caches under `%LOCALAPPDATA%\Shisa.ai\Jouzu\data` unless `JOUZU_HOME` overrides it.

The launcher and the Jouzu application update separately, each from its own signed feed, and neither update needs npm.

CP932/Shift-JIS is not a managed-profile encoding. If an existing profile target is not valid UTF-8, Jouzu reports an `unsupported-encoding` conflict and leaves its bytes unchanged.

## Installation boundaries

- npm installations require separately installed Node.js/npm, Git Bash, a terminal, and Visual C++ runtime.
- The launcher bundles those dependencies for x64 Windows and ships signed. You do not need separate Node.js/npm, Git Bash, or Visual C++ runtime installations.
- The launcher adds bundled tools to Jouzu child processes only; it does not change the system PATH.
- Third-party Pi extensions are not guaranteed to support native Windows.
- The documented Windows environment does not cover console behavior outside Windows Terminal and Git Bash.
