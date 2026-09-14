param(
    [Parameter(Mandatory=$true)][string]$JouzuTarball,
    [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{64}$')][string]$TarballSha256,
    [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{40}$')][string]$SourceCommit,
    [Parameter(Mandatory=$true)][string]$OutputDirectory,
    [Parameter(Mandatory=$true)][string]$CacheDirectory,
    [switch]$Unsigned
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if (-not $Unsigned) { throw 'This preview builder requires -Unsigned. Public signing is not configured.' }
if (Test-Path $OutputDirectory) { throw 'OutputDirectory must not exist; retain prior builds separately' }
$JouzuTarball = (Resolve-Path $JouzuTarball).Path
if ((Get-FileHash -LiteralPath $JouzuTarball -Algorithm SHA256).Hash.ToLowerInvariant() -ne $TarballSha256) { throw 'Jouzu tarball digest differs' }
New-Item -ItemType Directory -Force $OutputDirectory,$CacheDirectory | Out-Null
$OutputDirectory = (Resolve-Path $OutputDirectory).Path
$CacheDirectory = (Resolve-Path $CacheDirectory).Path
$lock = Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot 'dependencies.json') | ConvertFrom-Json
$inputs = @{}
foreach ($entry in $lock.downloads.PSObject.Properties) {
    $path = Join-Path $CacheDirectory $entry.Value.file
    if (-not (Test-Path $path)) {
        $temporary = "$path.download"
        Invoke-WebRequest -UseBasicParsing -Uri $entry.Value.url -OutFile $temporary
        if ((Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.Value.sha256) { throw "Downloaded digest differs: $($entry.Name)" }
        Move-Item $temporary $path
    }
    if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.Value.sha256) { throw "Cached digest differs: $($entry.Name)" }
    $inputs[$entry.Name] = $path
}
function Run([string]$Command, [string[]]$Arguments) {
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Command exited $LASTEXITCODE" }
}
function Extract-Zip([string]$Archive, [string]$Destination) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::ExtractToDirectory($Archive, $Destination)
}
function Flatten-Zip([string]$Name, [string]$Destination) {
    $temporary = Join-Path $OutputDirectory ("extract-" + $Name)
    Extract-Zip $inputs[$Name] $temporary
    $children = @(Get-ChildItem $temporary -Directory)
    if ($children.Count -ne 1) { throw "Unexpected archive layout: $Name" }
    Move-Item $children[0].FullName $Destination
    Remove-Item $temporary
}
$stage = Join-Path $OutputDirectory 'image'
$payload = Join-Path $OutputDirectory 'payload'
New-Item -ItemType Directory $stage,$payload | Out-Null
Flatten-Zip 'node' (Join-Path $payload 'node')
Flatten-Zip 'terminal' (Join-Path $payload 'terminal')
$gitExtraction = Start-Process -FilePath $inputs.git -ArgumentList @('-y',('-o"' + (Join-Path $payload 'git') + '"')) -Wait -PassThru
if ($gitExtraction.ExitCode -ne 0) { throw 'PortableGit extraction failed' }
$tools = Join-Path $payload 'tools'
New-Item -ItemType Directory $tools,(Join-Path $tools 'components') | Out-Null
foreach ($name in @('rg','fd')) { Flatten-Zip $name (Join-Path $tools "components\$name"); Copy-Item (Join-Path $tools "components\$name\$name.exe") $tools }
$vclibs = Join-Path $payload 'vclibs'
Extract-Zip $inputs.vclibs $vclibs
Copy-Item (Join-Path $vclibs '*.dll') (Join-Path $payload 'node')
Copy-Item (Join-Path $vclibs '*.dll') (Join-Path $payload 'terminal')
$node = Join-Path $payload 'node\node.exe'
$npm = Join-Path $payload 'node\node_modules\npm\bin\npm-cli.js'
$env:PATH = (Join-Path $payload 'node') + ';' + (Join-Path $payload 'git\cmd') + ';' + $env:PATH
$env:npm_config_cache = Join-Path $CacheDirectory 'npm'
$env:JOUZU_NO_UPDATE = '1'
Run $node @($npm,'install','--prefix',(Join-Path $payload 'app'),'--ignore-scripts','--omit=dev','--no-audit','--no-fund',$JouzuTarball)
Copy-Item (Join-Path $PSScriptRoot 'bootstrap.mjs') $payload
Copy-Item (Join-Path $PSScriptRoot 'dependencies.json') $payload
Copy-Item (Join-Path $PSScriptRoot 'NOTICES.md') $payload
$package = Get-Content -Raw -Encoding UTF8 (Join-Path $payload 'app\node_modules\jouzu\package.json') | ConvertFrom-Json
if ($package.version -notmatch '^\d+\.\d+\.\d+$') { throw 'Jouzu version must be a release version' }
# npm records the build machine's absolute tarball path. Keep a portable
# input name in the shipped metadata; manifest.json records its digest.
Run $node @((Join-Path $PSScriptRoot 'prepare-metadata.mjs'),$payload)
Run $node @((Join-Path $payload 'app\node_modules\jouzu\dist\cli.js'),'--version')
$entries = @(Get-ChildItem $payload -Recurse -File | Sort-Object FullName | ForEach-Object {
    if ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Linked payload file: $($_.Name)" }
    [ordered]@{ path=$_.FullName.Substring($payload.Length + 1).Replace('\','/'); size=$_.Length; sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
})
$content = $entries | ConvertTo-Json -Depth 4 -Compress
$sha = [Security.Cryptography.SHA256]::Create()
try { $identity = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($content)))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
$releaseId = "$($package.version)-" + $identity.Substring(0,16)
$manifest = [ordered]@{ schemaVersion=1; releaseId=$releaseId; version=$package.version; sourceCommit=$SourceCommit; tarballSha256=$TarballSha256; signing='unsigned-development'; components=$lock.downloads; files=$entries }
$manifestPath = Join-Path $payload 'manifest.json'
[IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
$versionDirectory = Join-Path $stage "versions\$releaseId"
New-Item -ItemType Directory (Split-Path $versionDirectory) | Out-Null
Move-Item $payload $versionDirectory
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
foreach ($kind in @('console','gui')) {
    $exe = Join-Path $stage $(if ($kind -eq 'gui') {'Jouzu.exe'} else {'JouzuConsole.exe'})
    Copy-Item (Join-Path $PSScriptRoot 'Jouzu.config') ($exe + '.config')
    $target = if ($kind -eq 'gui') {'/target:winexe'} else {'/target:exe'}
    $define = if ($kind -eq 'gui') {'/define:GUI'} else {'/define:CONSOLE'}
    Run $csc @('/nologo','/optimize+','/platform:x64',$target,$define,('/out:' + $exe),'/reference:System.Web.Extensions.dll','/reference:System.Windows.Forms.dll','/reference:System.Security.dll','/reference:System.Core.dll',(Join-Path $PSScriptRoot 'Jouzu.cs'))
}
Run (Join-Path $stage 'JouzuConsole.exe') @('--activate',$releaseId)
Run (Join-Path $stage 'JouzuConsole.exe') @('--verify')
# Exercise the desktop bootstrap and settings before producing an installer.
$previousHome = $env:JOUZU_HOME
try {
    $env:JOUZU_HOME = Join-Path $OutputDirectory 'smoke-data'
    Run (Join-Path $stage 'JouzuConsole.exe') @('--version')
} finally { $env:JOUZU_HOME = $previousHome }
$inno = Join-Path $CacheDirectory 'inno\ISCC.exe'
if (-not (Test-Path $inno)) {
    $setup = Start-Process -FilePath $inputs.inno -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/CURRENTUSER',('/DIR="' + (Join-Path $CacheDirectory 'inno') + '"')) -Wait -PassThru
    if ($setup.ExitCode -ne 0) { throw 'Inno Setup compiler installation failed' }
}
$arguments = @('/Qp',('/DPayload=' + $stage),('/DReleaseId=' + $releaseId),('/DProductVersion=' + $package.version),('/DOutput=' + $OutputDirectory))
Run $inno ($arguments + (Join-Path $PSScriptRoot 'Jouzu.iss'))
$setupFile = Join-Path $OutputDirectory "JouzuSetup-$releaseId-x64-unsigned.exe"
[ordered]@{ releaseId=$releaseId; version=$package.version; installer=$setupFile; sha256=(Get-FileHash -LiteralPath $setupFile -Algorithm SHA256).Hash.ToLowerInvariant(); signing=$manifest.signing; payloadFiles=$entries.Count; payloadBytes=($entries | ForEach-Object { $_.size } | Measure-Object -Sum).Sum } | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $OutputDirectory 'build-result.json')
Get-Content (Join-Path $OutputDirectory 'build-result.json')
