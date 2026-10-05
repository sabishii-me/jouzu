# Launcher bundle components

Jouzu is distributed under Apache-2.0. The application payload contains LICENSE and
THIRD_PARTY_NOTICES.md with notices for the agent and its extensions.

The Windows launcher packages also include these unmodified upstream components, and each bundle
retains the licence and copyright files shipped inside it. Preserve them when redistributing.

- Node.js and npm: https://nodejs.org/ and https://github.com/npm/cli
- PortableGit and Git Bash: https://gitforwindows.org/ (includes GPL-licensed Git, Bash and supporting tools; source releases are available from https://github.com/git-for-windows/git/releases)
- pnpm: https://github.com/pnpm/pnpm (MIT)
- Windows Terminal: https://github.com/microsoft/terminal (MIT); the portable archive is included unmodified and keeps its own licence files

The Tauri bundler produces the installers with NSIS: https://nsis.sourceforge.io/.

Versions and digests are pinned in `prepare-windows-bundle.ps1` and `prepare-starter.mjs`: Node
24.19.0, PortableGit 2.55.0.5, pnpm 10.21.0, Windows Terminal 1.25.2733.0.
