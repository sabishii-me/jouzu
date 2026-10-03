# Launcher changelog

One section per released Launcher version. The section titled `## <version>` is what the
update feed shows for that version, so every release must have one.

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
