param([Parameter(Mandatory=$true)][string]$InputDirectory,[string]$Version)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path "$PSScriptRoot/../..").Path
# The launcher version is committed in the application package; nothing injects it.
if (-not $Version) { $Version = (Get-Content (Join-Path $repo 'apps/launcher/package.json') -Raw | ConvertFrom-Json).version }
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid launcher version' }
$inputRoot = (Resolve-Path $InputDirectory).Path
$output = Join-Path $env:RUNNER_TEMP 'launcher-release'
New-Item -ItemType Directory $output -Force | Out-Null

# Signing tools follow the Artifact Signing SignTool integration: nuget.exe installs the Windows
# SDK build tools and the signing client, and .NET 8 (present on the runner image) runs the dlib.
$tools = Join-Path $env:RUNNER_TEMP 'signing-tools'
New-Item -ItemType Directory $tools -Force | Out-Null
$nuget = Join-Path $tools 'nuget.exe'
Invoke-WebRequest -Uri 'https://dist.nuget.org/win-x86-commandline/latest/nuget.exe' -OutFile $nuget
if (-not (Test-Path $nuget)) { throw 'Cannot download nuget.exe' }
# nuget can keep package contents in its global folder, so both locations are searched.
$packageRoots = @($tools, (Join-Path $env:USERPROFILE '.nuget\packages'))
$sdkRoots = @("${env:ProgramFiles(x86)}\Windows Kits\10\bin", "$env:ProgramFiles\Windows Kits\10\bin")
function Find-Tool([string]$Name,[string[]]$Roots) {
 $roots = @($Roots | Where-Object { $_ -and (Test-Path $_) })
 if (-not $roots.Count) { return $null }
 $found = Get-ChildItem $roots -Recurse -Filter $Name -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match '[\\/]x64[\\/]' } | Sort-Object FullName -Descending | Select-Object -First 1
 if ($found) { return $found.FullName }
 return $null
}
$signTool = Find-Tool 'signtool.exe' (@($sdkRoots) + $packageRoots)
if (-not $signTool) {
 & $nuget install Microsoft.Windows.SDK.BuildTools -ExcludeVersion -OutputDirectory $tools -NonInteractive
 if ($LASTEXITCODE) { throw 'Cannot install the Windows SDK build tools' }
 $signTool = Find-Tool 'signtool.exe' $packageRoots
}
if (-not $signTool) { throw 'signtool.exe not found' }
& $nuget install Microsoft.ArtifactSigning.Client -ExcludeVersion -OutputDirectory $tools -NonInteractive
if ($LASTEXITCODE) { throw 'Cannot install the Artifact Signing client' }
$dlib = Find-Tool 'Azure.CodeSigning.Dlib.dll' $packageRoots
if (-not $dlib) { throw 'Artifact Signing client library not found' }
$metadata = Join-Path $tools 'metadata.json'
@{Endpoint=$env:AZURE_SIGNING_ENDPOINT;CodeSigningAccountName=$env:AZURE_SIGNING_ACCOUNT;CertificateProfileName=$env:AZURE_SIGNING_PROFILE;ExcludeCredentials=@('EnvironmentCredential','WorkloadIdentityCredential','ManagedIdentityCredential','SharedTokenCacheCredential','VisualStudioCredential','VisualStudioCodeCredential','AzurePowerShellCredential','AzureDeveloperCliCredential','InteractiveBrowserCredential')} | ConvertTo-Json | Set-Content $metadata

$target = Join-Path $repo 'apps/launcher/src-tauri/target/release'
New-Item -ItemType Directory $target -Force | Out-Null
Copy-Item "$inputRoot/bin/*" $target
Copy-Item "$inputRoot/dist" "$repo/apps/launcher/dist" -Recurse -Force
$setupPath = Join-Path $target "bundle/nsis/Jouzu Launcher_${Version}_x64-setup.exe"

# The bundler calls this for every own binary, every resource it considers signable and the
# NSIS uninstaller; each call runs the documented signtool command and verifies the result.
$signCommand = @{cmd='powershell.exe';args=@('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',"$PSScriptRoot/sign-windows.ps1",'-SignTool',$signTool,'-Dlib',$dlib,'-Metadata',$metadata,'-ExpectedSubject',$env:EXPECTED_SIGNER,'-File','%1')}
# Only the package mode differs between the two builds; the launcher-only define is prepended
# because the bundler offers no way to pass a define into the template it compiles.
function New-Template([string]$Extra) {
 $name = if ($Extra) { 'template-lo.nsi' } else { 'template-full.nsi' }
 $path = Join-Path $tools $name
 $prefix = if ($Extra) { $Extra + "`n" } else { '' }
 [IO.File]::WriteAllText($path, $prefix + (Get-Content (Join-Path $PSScriptRoot 'installer.nsi') -Raw))
 $path
}
function New-Config([string]$Template,[bool]$Full) {
 $resources = [ordered]@{}
 if ($Full) { $resources["$inputRoot/app/"]='app/'; $resources["$inputRoot/runtime/"]='runtime/' }
 $resources["$repo/packaging/launcher/"]='runtime/launcher-update/'
 $resources["$target/console.exe"]='console.exe'
 $resources["$inputRoot/update-config/jouzu-update.json"]='jouzu-update.json'
 $config = @{plugins=(Get-Content "$inputRoot/update-config/tauri-updater.json" -Raw | ConvertFrom-Json).plugins;bundle=@{active=$true;targets=@('nsis');resources=$resources;icon=@('icons/icon.ico');windows=@{signCommand=$signCommand;nsis=@{installMode='currentUser';template=$Template;installerHooks="$PSScriptRoot/installer-hooks.nsh"}}}}
 $name = if ($Full) { 'bundle-full.json' } else { 'bundle-lo.json' }
 $path = Join-Path $tools $name
 $config | ConvertTo-Json -Depth 12 | Set-Content $path
 $path
}

Push-Location "$repo/apps/launcher"
try {
 npm ci
 if ($LASTEXITCODE) { throw 'Cannot install bundler' }

 npm run tauri -- bundle --config (New-Config (New-Template '') $true)
 if ($LASTEXITCODE) { throw 'Full package bundling failed' }
 $fullSetup = Join-Path $output "Jouzu Launcher_${Version}_x64-setup.exe"
 Copy-Item -LiteralPath $setupPath -Destination $fullSetup -Force

 npm run tauri -- bundle --config (New-Config (New-Template '!define JOUZU_LAUNCHER_ONLY 1') $false)
 if ($LASTEXITCODE) { throw 'Launcher-only package bundling failed' }
 $updateSetup = Join-Path $output "Jouzu Launcher_${Version}_x64-update.exe"
 Copy-Item -LiteralPath $setupPath -Destination $updateSetup -Force

 foreach ($file in @("$target/launcher.exe","$target/console.exe",$fullSetup,$updateSetup)) {
  $signature = Get-AuthenticodeSignature -LiteralPath $file
  if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -ne $env:EXPECTED_SIGNER -or -not $signature.TimeStamperCertificate) { throw "Invalid final signature: $file" }
 }

 # The updater signature covers the final installer bytes. The key arrives in
 # TAURI_SIGNING_PRIVATE_KEY, which `signer sign` reads itself, so it never reaches a file.
 npm run tauri -- signer sign --app-version $Version $updateSetup
 if ($LASTEXITCODE) { throw 'Updater signing failed' }

 Copy-Item "$inputRoot/source.json" $output
 @{version=$Version;commit=$env:GITHUB_SHA;run=$env:GITHUB_RUN_ID;setup=(Get-FileHash $fullSetup -Algorithm SHA256).Hash;update=(Get-FileHash $updateSetup -Algorithm SHA256).Hash} | ConvertTo-Json | Set-Content "$output/build.json"
} finally { Pop-Location }
