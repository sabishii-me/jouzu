param(
 [Parameter(Mandatory=$true)][string]$Prepared,
 [Parameter(Mandatory=$true)][string]$Pnpm,
 [Parameter(Mandatory=$true)][string]$Output,
 [string]$UpdateConfigDirectory
)
$ErrorActionPreference = 'Stop'
$repo = (Split-Path (Split-Path $PSScriptRoot)).Replace('\','/')
$Prepared = (Resolve-Path $Prepared).Path.Replace('\','/')
$Pnpm = (Resolve-Path $Pnpm).Path
if (Test-Path $Output) { throw 'Output must not exist' }
New-Item -ItemType Directory -Path $Output | Out-Null
$Output = (Resolve-Path $Output).Path
$runtime = (Join-Path $Output 'runtime').Replace('\','/')
New-Item -ItemType Directory -Path "$runtime/git" -Force | Out-Null
# NSIS cannot open paths over MAX_PATH. The npm-installed app has deeply nested
# dependencies, so ship it as one archive and extract it in the installer.
$appArchive = (Join-Path $Output 'app.tgz')
& "$env:SystemRoot\System32\tar.exe" -czf $appArchive -C "$Prepared" app
if ($LASTEXITCODE) { throw 'Cannot archive the application payload' }
$nodeVersion = '24.22.1'
$nodeDigest = 'd2046d28c2c3dcd211ac5145c0bf30e2047ef9dfb306693c8c6e2eccd8b95fa5'
$archive = "node-v$nodeVersion-win-x64.zip"
Invoke-WebRequest "https://nodejs.org/dist/v$nodeVersion/SHASUMS256.txt" -OutFile "$Output/node-shasums.txt"
Invoke-WebRequest "https://nodejs.org/dist/v$nodeVersion/$archive" -OutFile "$Output/$archive"
$record = @(Get-Content "$Output/node-shasums.txt" | Where-Object { $_ -match "^[a-f0-9]{64}\s+$([regex]::Escape($archive))$" })
if ($record.Count -ne 1 -or ($record[0] -split '\s+')[0] -ne $nodeDigest) { throw 'Unexpected Node archive digest' }
if ((Get-FileHash "$Output/$archive" -Algorithm SHA256).Hash.ToLowerInvariant() -ne $nodeDigest) { throw 'Node archive integrity mismatch' }
Expand-Archive "$Output/$archive" -DestinationPath $Output
Move-Item "$Output/node-v$nodeVersion-win-x64" "$runtime/node"
Copy-Item $Pnpm "$runtime/pnpm" -Recurse
$pnpmMetadata = Get-Content "$runtime/pnpm/package.json" -Raw | ConvertFrom-Json
if ($pnpmMetadata.name -ne 'pnpm' -or $pnpmMetadata.version -ne '10.34.7') { throw 'Wrong private pnpm package' }
$terminalVersion = '1.25.2733.0'
$terminalArchive = "$runtime/terminal/WindowsTerminal.zip"
New-Item -ItemType Directory -Path "$runtime/terminal" -Force | Out-Null
Invoke-WebRequest "https://github.com/microsoft/terminal/releases/download/v$terminalVersion/Microsoft.WindowsTerminal_${terminalVersion}_x64.zip" -OutFile $terminalArchive
if ((Get-FileHash $terminalArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne 'bf3ef2012f6c44d8340a4c58125acc9498d19b580f9890dc043cdf831852e796') { throw 'Windows Terminal archive integrity mismatch' }
$gitUrl = 'https://github.com/git-for-windows/git/releases/download/v2.56.0.windows.2/PortableGit-2.56.0.2-64-bit.7z.exe'
$gitArchive = "$runtime/git/PortableGit.exe"
Invoke-WebRequest $gitUrl -OutFile $gitArchive
if ((Get-FileHash $gitArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne '075e158ef8e1f0ab80b347e245405d3eca735c2dc88fd8e032e137d0ca61f61b') { throw 'PortableGit integrity mismatch' }
$resources = @{}
$resources[$appArchive] = 'app.tgz'
$resources["$runtime/"] = 'runtime/'
$resources["$repo/packaging/launcher/"] = 'runtime/launcher-update/'
$resources["$repo/apps/launcher/src-tauri/target/release/console.exe"] = 'console.exe'
$config = @{
 bundle = @{
  active = $true
  targets = @('nsis')
  icon = @('icons/icon.ico')
  resources = $resources
  windows = @{ nsis = @{
   installMode = 'currentUser'
   installerHooks = "$repo/packaging/launcher/installer-hooks.nsh"
   template = "$repo/packaging/launcher/installer.nsi"
  }}
 }
}
if ($UpdateConfigDirectory) {
 $updater = Get-Content (Join-Path $UpdateConfigDirectory 'tauri-updater.json') -Raw | ConvertFrom-Json
 $jouzuConfig = (Resolve-Path (Join-Path $UpdateConfigDirectory 'jouzu-update.json')).Path.Replace('\','/')
 $config.plugins = $updater.plugins
 $resources[$jouzuConfig] = 'jouzu-update.json'
}
$config | ConvertTo-Json -Depth 12 | Set-Content "$Output/tauri-build.json" -Encoding utf8
