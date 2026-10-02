param([Parameter(Mandatory=$true)][string]$InstallRoot)
$ErrorActionPreference = 'Stop'

# A launcher-only package replaces launcher-owned executables while Jouzu sessions may be
# running. Windows allows renaming a running image but not deleting it, so a locked file is
# renamed aside for the installer to replace; the running session keeps using the renamed
# file and the leftover is removed on a later launcher start.
function Move-Aside([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return }
    try {
        Remove-Item -LiteralPath $Path -Force -ErrorAction Stop
        return
    } catch {
        # Locked by a running session; rename aside instead.
    }
    $directory = Split-Path -Parent $Path
    $name = Split-Path -Leaf $Path
    try {
        Rename-Item -LiteralPath $Path -NewName ("$name.old-" + [guid]::NewGuid().ToString('N')) -ErrorAction Stop
    } catch {
        throw "Cannot replace $name. Close running Jouzu sessions and retry."
    }
}

try {
    $directory = [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
    if (-not (Test-Path -LiteralPath $directory)) { exit 0 }
    foreach ($name in @('launcher.exe', 'console.exe')) {
        Move-Aside (Join-Path $directory $name)
    }
} catch {
    Write-Output $_.Exception.Message
    exit 1
}
