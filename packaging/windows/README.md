# Windows installer preview

The installer bundles Jouzu, Node.js/npm, Git Bash, Windows Terminal, ripgrep,
fd, and the Visual C++ runtime DLLs. Users do not need to install these tools
or run a terminal command. The target is Windows 10 build 19041 or later on
x64 hardware.

Download the **unsigned v0.1.10 preview** from the
[GitHub release page](https://github.com/shisa-ai/jouzu/releases/tag/v0.1.10).
Windows may show an unknown-publisher warning. Native acceptance tests passed
on Windows Server 2025 x64; clean Windows 10/11 testing remains pending.
Code signing is planned for v0.2.0.

This page describes installers built from this source. The working-folder screen
and JZ icon described below are not included in the published v0.1.10 installer.

## Use

1. Run `JouzuSetup-…-x64-unsigned.exe` as your normal Windows user.
2. Open Jouzu from the desktop or Start menu.
3. Select **Choose folder…**, choose a **Working folder**, then select **Open**.
   Jouzu opens a terminal and presents first-launch setup, including Shisa AI sign-in.

The working folder is where commands start and relative file paths are resolved.
It can be any folder, not only a Git repository. It does not restrict access to
other files and is separate from Jouzu's settings and credentials.

Select **Remember this folder** to show it on the next launch. The launcher still
shows the path before you select **Open**; **Choose another folder…** changes it.
Uncheck **Remember this folder** and select **Open** to forget the saved path.
Canceling leaves the preference unchanged. If the folder is unavailable, choose
another one; Jouzu does not silently open a different folder.

The launcher stores this preference in `%LOCALAPPDATA%\JouzuDesktop\launcher.json`,
independently of `JOUZU_HOME`. `Jouzu.exe --project <folder>` opens an explicit
working folder without changing the saved preference.

The default installation directory is `%LOCALAPPDATA%\Programs\Jouzu`. Desktop
settings, credentials, sessions, and caches live in
`%LOCALAPPDATA%\JouzuDesktop\data`. `JOUZU_HOME` overrides that location;
`JouzuConsole.exe` also accepts `--jouzu-home`. Keep user data and projects
outside the installation directory, which the uninstaller removes.

The launcher uses an installed Windows Terminal when available and includes
its own copy. Paths containing a semicolon use the Windows console host.
The bundled tools are added only to Jouzu's child-process environment; the
installer does not change the system PATH or install a background service.
Custom `shellPath` and `npmCommand` settings are preserved.

## Updates and repair

Run a newer installer to install another version. Activation verifies every
payload file and probes the bundled CLI before changing `current.json`.
The previous version remains available through the Start menu's **Restore
previous Jouzu version** shortcut or `JouzuConsole.exe --rollback`.

`JouzuConsole.exe --verify` checks the full active payload. Ordinary launches
check the manifest and startup files. Run the same installer again to repair missing or changed program files. Uninstalling keeps user
data and project folders outside the installation directory.

Automatic npm updates are disabled for desktop launches. Checksums in this
unsigned preview detect damage; they do not authenticate a publisher.

The launchers and installer use a transparent JZ dot icon. Its colors preserve
the J and Z positions in the terminal logo's cyan-to-pink gradient. The `.ico`
contains 16, 20, 24, 32, 40, 48, 64, 128, and 256 pixel images. Regenerate the icon
and its SVG source with `python3 packaging/windows/generate-icon.py`; use
`--check` to verify the committed files. Python is not needed to install or run Jouzu.

## Build

Build on x64 Windows with Windows PowerShell 5.1. The script uses the Windows
.NET Framework compiler and downloads the pinned Inno Setup compiler into
the build cache. Internet access is required to download the inputs and
resolve the npm package's dependencies.

Supply a qualified Jouzu npm tarball, its independently recorded SHA-256,
and the full commit that produced it:

```powershell
.\packaging\windows\build.ps1 `
  -JouzuTarball C:\artifacts\jouzu.tgz `
  -TarballSha256 <64-character-sha256> `
  -SourceCommit <40-character-commit> `
  -OutputDirectory C:\artifacts\windows-build `
  -CacheDirectory C:\artifacts\windows-cache `
  -Unsigned
```

The output directory must be new. `dependencies.json` pins the external
archives by SHA-256. The resulting image retains its npm lockfile and
per-file hashes in `manifest.json`. `build-result.json` records the installer
path, SHA-256, payload size, and release identifier. The source commit is
caller-supplied provenance; the builder verifies the tarball's checksum.

## Native acceptance

Run from a non-elevated Windows PowerShell session with a new test directory:

```powershell
.\packaging\windows\test.ps1 `
  -Installer C:\artifacts\windows-build\JouzuSetup-…-x64-unsigned.exe `
  -TestDirectory C:\Users\me\AppData\Local\JouzuAcceptance
```

The test installs to a path containing Japanese characters and spaces,
hides system Node/Git from PATH, runs the bundled tools and doctor, exercises
Pi file tools with Windows paths, checks custom settings, activates a test version, restores the original, rejects
a corrupt version, and checks uninstall data preservation. It writes
`result.json` and installer/doctor logs. `-KeepInstalled` leaves the test
installation for manual inspection instead of testing uninstall.

Also open the desktop shortcut and check the working-folder screen and first-launch
screen in the terminal. Check Tab navigation, Enter to open, Escape to cancel,
remembering and forgetting a folder, and reopening after the saved folder is deleted
or a removable drive is disconnected. Canceling either dialog must preserve the
saved preference. Check the icon in Explorer, shortcuts, and the launch window at
100%, 150%, and 200% display scaling. Clean Windows 10 and Windows 11 testing remains
pending for the v0.1.10 preview; a Windows Server run alone does not qualify
those desktop versions. Provider sign-in and microphone access require
separate interactive checks.
