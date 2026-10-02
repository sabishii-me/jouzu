param(
 [Parameter(Mandatory=$true)][string]$File,
 [Parameter(Mandatory=$true)][string]$Policy
)
$ErrorActionPreference = 'Stop'
$config = Get-Content -LiteralPath $Policy -Raw | ConvertFrom-Json
$path = (Resolve-Path -LiteralPath $File).Path
$temp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
if (-not $path.StartsWith($temp,[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($path) -notmatch '^nst[0-9a-f]+\.tmp$') {
 throw 'Expected the NSIS-generated temporary uninstaller'
}
& "$PSScriptRoot/sign-windows.ps1" -File $path -SignTool $config.signTool -Dlib $config.dlib -Metadata $config.metadata -ExpectedSubject $config.expectedSubject
Copy-Item -LiteralPath $path -Destination $config.uninstallerEvidence
