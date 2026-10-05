param(
 [Parameter(Mandatory=$true)][string]$InstallRoot,
 [switch]$Prepare,
 [switch]$Report,
 [switch]$Install,
 [string]$Preferred
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$version = '1.25.2733.0'
$digest = 'bf3ef2012f6c44d8340a4c58125acc9498d19b580f9890dc043cdf831852e796'
$parent = Join-Path $InstallRoot 'runtime\terminal'
$installed = Join-Path $parent 'installed'
$archive = Join-Path $parent 'WindowsTerminal.zip'
$system = if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps\wt.exe' } else { $null }

# A portable Windows Terminal tree is usable when its host executable is there.
function Get-Terminal([string]$Root) {
 if (-not $Root) { return $null }
 foreach ($name in @('WindowsTerminal.exe','wt.exe')) {
  $file = Join-Path $Root $name
  if (Test-Path -LiteralPath $file -PathType Leaf) { return [pscustomobject]@{ path = $file; root = $Root } }
 }
 return $null
}

$preferredInfo = if ($Preferred) { Get-Terminal ([IO.Path]::GetFullPath($Preferred)) } else { $null }
$bundledInfo = Get-Terminal $installed
$systemInfo = if ($system -and (Test-Path -LiteralPath $system -PathType Leaf)) { [pscustomobject]@{ path = $system; root = $null } } else { $null }

if ($Report) {
 $value = [ordered]@{
  bundled = if ($bundledInfo) { [ordered]@{ path = $bundledInfo.path; version = (Get-Item -LiteralPath $bundledInfo.path).VersionInfo.FileVersion } } else { $null }
  system = if ($systemInfo) { [ordered]@{ path = $systemInfo.path; version = (Get-Item -LiteralPath $systemInfo.path).VersionInfo.FileVersion } } else { $null }
  effective = if ($systemInfo) { $systemInfo.path } elseif ($bundledInfo) { $bundledInfo.path } else { $null }
  preferred = if ($preferredInfo) { $preferredInfo.path } else { $null }
  archive = (Test-Path -LiteralPath $archive -PathType Leaf)
  version = $version
 }
 Write-Output ($value | ConvertTo-Json -Compress -Depth 3)
 exit 0
}

# Windows Terminal installed on this PC is kept when it exists, so the user's own settings apply; the
# bundled copy covers machines that have none, which is where the legacy console host damages the TUI.
foreach ($info in @($preferredInfo, $bundledInfo, $systemInfo)) {
 if ($info) { Write-Output $info.path; exit 0 }
}
if (-not ($Prepare -or $Install)) { throw 'Windows Terminal is unavailable. Install it from the launcher.' }

New-Item -ItemType Directory -Path $parent -Force | Out-Null
if (-not (Test-Path -LiteralPath $archive -PathType Leaf)) {
 if (-not $Install) { throw 'The bundled Windows Terminal package is missing. Install it from the launcher.' }
 $url = "https://github.com/microsoft/terminal/releases/download/v$version/Microsoft.WindowsTerminal_${version}_x64.zip"
 Invoke-WebRequest -Uri $url -OutFile $archive
}
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $digest) {
 if ($Install) { Remove-Item -LiteralPath $archive -Force }
 throw 'Windows Terminal archive integrity verification failed'
}
# A downloaded archive carries the mark of the web; remove it before extracting.
Unblock-File -LiteralPath $archive -ErrorAction SilentlyContinue
$stage = Join-Path $parent ('prepare-' + [guid]::NewGuid().ToString('N'))
try {
 Expand-Archive -LiteralPath $archive -DestinationPath $stage
 $inner = Get-ChildItem -LiteralPath $stage -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'WindowsTerminal.exe') } | Select-Object -First 1
 if (-not $inner) { throw 'Windows Terminal archive has no host executable' }
 if (Test-Path -LiteralPath $installed) { Remove-Item -LiteralPath $installed -Recurse -Force }
 Move-Item -LiteralPath $inner.FullName -Destination $installed
 Write-Output (Join-Path $installed 'WindowsTerminal.exe')
} finally {
 if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
}
