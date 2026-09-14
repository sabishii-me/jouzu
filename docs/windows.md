# Windows prerequisites for Jouzu v0.1

Published Jouzu v0.1 releases use npm. A [Windows installer preview](../packaging/windows/README.md) can also be built locally; it bundles Node/npm, Git Bash, Windows Terminal, and the runtime DLLs.

Jouzu v0.1.5's bundled extension set passed the full Linux, macOS, and Windows qualification matrix with Node 22 and 24. The prerequisites below describe the v0.1 npm environment.

## npm installation requirements

- Windows 10 or Windows 11 on x64
- Node.js 22.19 or newer, including npm
- Git for Windows, including Git Bash
- [Microsoft Visual C++ Redistributable (x64)](https://aka.ms/vc14/vc_redist.x64.exe)
- Windows Terminal or another UTF-8-capable terminal

Install Jouzu from a PowerShell or Git Bash session with npm. Pi's coding tools execute Bash commands, so Git Bash must remain installed even when `jouzu` itself is launched from PowerShell or Windows Terminal.

Install the Microsoft Visual C++ Redistributable before launching Jouzu. The bundled `wreq-js` HTTP transport requires `VCRUNTIME140.dll`. If startup reports `Failed to load native module for win32-x64-msvc` and `The specified module could not be found`, a missing runtime is one possible cause. Install or repair the redistributable, then run `jouzu doctor` again. The npm installation does not install this runtime automatically.

Run the following after installation:

```powershell
jouzu --version
jouzu doctor
jouzu profile plan --profile core
jouzu profile plan --profile ja
jouzu
```

The first interactive launch asks before enabling the optional Japanese-support profile; declining or pressing Enter uses Core. `jouzu doctor` reports missing Git or Bash as an actionable problem. The npm installation uses the shell installed by the user.

When the isolated Jouzu agent root has no `keybindings.json`, the first interactive launch seeds `Ctrl+Enter` for follow-up and `Ctrl+Up` for dequeue; `Tab` retains Pi autocomplete. On upgrade from v0.1.0, Jouzu backs up and replaces only an exact Jouzu-owned `Tab` follow-up entry. User-owned or modified bindings remain unchanged. Use `jouzu keybindings plan` for the effective plan and portability notes; Windows Terminal must deliver modified Enter and arrow keys to the application.

For real global npm installations, the first eligible interactive launch checks for a newer Jouzu package before entering Pi. Jouzu uses the npm client on `PATH`, verifies the exact tarball SHA-512 and installed runtime, restores the previous locally packed version on a failed verification, and relaunches the original command after success. Project-local, source, and ephemeral `npx` invocations are not rewritten. Use `jouzu self-update status` for classification or `JOUZU_NO_UPDATE=1` for a one-run opt-out.

## Paths and text

Jouzu uses `%APPDATA%\Jouzu\agent` for configuration and `%LOCALAPPDATA%\Jouzu` for state and cache by default. `--jouzu-home <path>` or `JOUZU_HOME` can select one portable root. The compatibility suite covers spaces, Japanese characters, full-width spaces, UTF-8, UTF-8 BOM, CRLF, and normalization-sensitive names without rewriting user files.

The installer preview uses `%LOCALAPPDATA%\JouzuDesktop\data` for configuration, sessions, and caches unless `JOUZU_HOME` or `--jouzu-home` overrides it. Desktop launches disable automatic npm updates; run a newer installer to update.

CP932/Shift-JIS is not a managed-profile encoding. If an existing profile target is not valid UTF-8, Jouzu reports an `unsupported-encoding` conflict and leaves its bytes unchanged.

## v0.1 limitations

- npm installations require separately installed Node.js/npm, Git Bash, a terminal, and Visual C++ runtime.
- The installer preview bundles those dependencies for x64 Windows. It is unsigned and unpublished; native testing used Windows Server 2025, with clean Windows 10/11 qualification still pending.
- The installer adds bundled tools to Jouzu child processes only; it does not change the system PATH.
- No claim that all third-party Pi extensions support native Windows.
- Console behavior outside Windows Terminal and Git Bash is not part of the v0.1 support claim.
