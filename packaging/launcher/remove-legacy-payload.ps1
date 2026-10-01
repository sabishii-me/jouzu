param([Parameter(Mandatory=$true)][string]$InstallRoot)
$ErrorActionPreference = 'Stop'
try {
    $expected = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Shisa.ai\Jouzu')).TrimEnd('\')
    if (-not [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\').Equals($expected, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected root' }
    # These exact directories were program-only payloads from the earlier previews.
    foreach ($name in @('versions\0.1.18-preview3')) {
        $path = Join-Path $expected $name
        if (Test-Path -LiteralPath $path) {
            $item = Get-Item -LiteralPath $path -Force
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Refusing linked legacy payload' }
            Remove-Item -LiteralPath $path -Recurse -Force
        }
    }
    $versions = Join-Path $expected 'versions'
    if ((Test-Path $versions) -and @(Get-ChildItem -LiteralPath $versions -Force).Count -eq 0) { Remove-Item -LiteralPath $versions }
    exit 0
} catch { Write-Output $_.Exception.Message; exit 1 }
