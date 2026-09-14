# Jouzu Windows components

Jouzu is distributed under Apache-2.0. Its package contains LICENSE and THIRD_PARTY_NOTICES.md with notices for the agent and extensions.

The Windows image also includes these unmodified upstream components. Preserve their accompanying license and copyright files when redistributing the image.

- Node.js and npm: https://nodejs.org/ and https://github.com/npm/cli
- PortableGit and Git Bash: https://gitforwindows.org/ (includes GPL-licensed Git, Bash, and supporting tools; source releases are available from https://github.com/git-for-windows/git/releases)
- Windows Terminal: https://github.com/microsoft/terminal (MIT)
- ripgrep: https://github.com/BurntSushi/ripgrep (MIT or Unlicense)
- fd: https://github.com/sharkdp/fd (MIT or Apache-2.0)
- Microsoft Visual C++ Desktop runtime: https://learn.microsoft.com/cpp/windows/redistributing-visual-cpp-files

Inno Setup produces the installer: https://jrsoftware.org/isinfo.php.

Exact download URLs, versions, and SHA-256 digests are included in dependencies.json. The Windows build retains the Visual C++ package and its metadata, as well as its application-local runtime DLLs.
