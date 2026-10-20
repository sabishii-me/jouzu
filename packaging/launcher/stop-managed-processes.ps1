param([Parameter(Mandatory=$true)][string]$InstallRoot, [switch]$RefuseActiveSessions)
$ErrorActionPreference = 'Stop'
try {
    $directory = [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
    if ($directory -eq [IO.Path]::GetPathRoot($directory).TrimEnd('\')) { throw 'Drive root is not a valid installation directory.' }
    if (-not (Test-Path -LiteralPath $directory)) { exit 0 }
    $root = $directory + '\'
    $launcher = Join-Path $directory 'launcher.exe'
    # Accept the previous filename when upgrading an existing installation.
    if (-not (Test-Path -LiteralPath $launcher)) {
        $launcher = Join-Path $directory 'jouzu-launcher.exe'
    }
    if (-not (Test-Path -LiteralPath $launcher)) {
        if ((Test-Path -LiteralPath (Join-Path $directory 'app')) -or (Test-Path -LiteralPath (Join-Path $directory 'runtime'))) {
            throw 'Cannot establish ownership of existing files. Choose an empty folder or repair the installation.'
        }
        exit 0
    }
    # Program metadata establishes that the selected directory belongs to Jouzu.
    $product = (Get-Item -LiteralPath $launcher).VersionInfo.ProductName
    if ($product -ne 'Jouzu Launcher') { throw 'Existing executable is not a Jouzu launcher.' }
    if ($RefuseActiveSessions) {
        $sessions = @(Get-CimInstance Win32_Process | Where-Object {
            $_.ExecutablePath -and $_.ExecutablePath.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -and
            $_.Name -match '^(console|jz|jouzu|node)\.exe$'
        })
        if ($sessions.Count -gt 0) { throw 'Close active Jouzu sessions before updating.' }
    }
    for ($attempt = 0; $attempt -lt 3; $attempt++) {
        $owned = @(Get-CimInstance Win32_Process | Where-Object {
            $_.ExecutablePath -and $_.ExecutablePath.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -and
            $_.Name -notmatch '^(uninstall|.*setup).*\.exe$'
        })
        if ($owned.Count -eq 0) { exit 0 }
        foreach ($process in $owned) {
            $id = [int]$process.ProcessId
            if (Get-Process -Id $id -ErrorAction SilentlyContinue) {
                & "$env:SystemRoot\System32\taskkill.exe" /PID $id /T /F | Out-Null
            }
        }
        Start-Sleep -Milliseconds 500
    }
    throw 'Jouzu processes did not stop within the retry limit. Close them and retry setup.'
} catch {
    Write-Output $_.Exception.Message
    exit 1
}
