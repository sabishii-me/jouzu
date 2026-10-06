# Launcher changelog

One section per released Launcher version. The update feed shows the section for the released
version verbatim, so a release without a section is refused.

## 0.3.5

- The installers and the Launcher report Shisa, Inc. as their publisher, which is the organization the
  published files are signed under. The account area names the service Shisa.AI.

## 0.3.4

- Windows 10 draws the console window incorrectly with the standard console host, so Jouzu installs the
  Windows Terminal it ships before it starts on such a machine, and only starts once that is done. The
  update package downloads that copy, because it carries no archives.
- System names the copy of each component that is in use and offers installing the one Jouzu ships. A
  Git Bash already installed on the machine keeps working.

## 0.3.3

- The console window is hosted by Windows Terminal, which redraws the interface correctly where the
  standard console host damages it. The full package carries Windows Terminal, and a machine that has
  its own keeps using it.
- System lists the components the launcher manages. Git Bash shows which Git Bash Jouzu uses, installs
  the bundled one when it is missing, and keeps the one installed on this PC when asked. Windows
  Terminal shows the same way.
- Jouzu uses its own Git Bash by default, so the Git installed on a machine no longer decides how Jouzu
  runs. An installation that predates these components receives the bundled copies when it updates.

## 0.3.2

- Rebuilt from the current packaging tree. Installing, updating and uninstalling are unchanged, and
  the 0.3.1 uninstall fixes are included.

## 0.3.1

- Uninstalling no longer reports "User-data deletion is incomplete" when a running Jouzu is what
  holds a program file. The message now names the cause and says what to close.
- The uninstaller closes Jouzu and the Launcher, so uninstall no longer deletes files from under a
  running Launcher.

## 0.3.0

- Windows launcher packages are now built and signed by CI, not on a workstation.
- Every update item shows what changed: the Launcher changelist here, and the Jouzu changelog
  of the version being installed.

## 0.2.0

- Launcher updates install only launcher-owned files. An update no longer rewrites the Jouzu
  application payload and no longer requires closing a running Jouzu session.
- The full package (Jouzu application included) remains the download for a first install or repair.

## 0.1.25

- First-run setup appears only when no usable model is configured: choose the interface language
  and whether to prefer Japanese, then sign in to Shisa or add another provider.
- The Launcher version comes from one committed source; the update panel reports real state.

## 0.1.24

- Fixed a startup failure after a Jouzu update caused by Windows verbatim paths handed to Node.
- Git Bash is prepared quietly during installation instead of at launch.
- The Launcher, console, uninstaller and setup are signed so Smart App Control stops blocking them,
  and a recovery action restores a working bundled application without deleting user data.
