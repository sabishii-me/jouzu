param([Parameter(Mandatory=$true)][string]$InstallRoot)
$ErrorActionPreference = 'Stop'
try {
    $root = [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\') + '\'
    $expected = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Shisa.ai\Jouzu')).TrimEnd('\') + '\'
    if (-not $root.Equals($expected, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected installation root; refusing to terminate processes.' }
    # Select by executable location, never by the generic name node.exe.
    for ($attempt = 0; $attempt -lt 3; $attempt++) {
        $owned = @(Get-CimInstance Win32_Process | Where-Object {
            $_.ExecutablePath -and $_.ExecutablePath.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -and
            $_.Name -notmatch '^(uninstall|.*setup).*\.exe$'
        })
        if ($owned.Count -eq 0) { exit 0 }
        foreach ($process in $owned) {
            # Stop descendants as well (agent tools may run outside the install directory).
            $id = [int]$process.ProcessId
            if (Get-Process -Id $id -ErrorAction SilentlyContinue) {
                & "$env:SystemRoot\System32\taskkill.exe" /PID $id /T /F | Out-Null
            }
        }
        Start-Sleep -Milliseconds 500
    }
    $remaining = @(Get-CimInstance Win32_Process | Where-Object {
        $_.ExecutablePath -and $_.ExecutablePath.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -and
        $_.Name -notmatch '^(uninstall|.*setup).*\.exe$'
    })
    if ($remaining.Count) { throw 'Jouzu processes are still running. Close them and retry setup.' }
    exit 0
} catch {
    Write-Output $_.Exception.Message
    exit 1
}
