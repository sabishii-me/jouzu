param([Parameter(Mandatory=$true)][string]$InputDirectory,[string]$Version)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path "$PSScriptRoot/../..").Path
# The launcher version is committed in the application package; nothing injects it.
if (-not $Version) { $Version = (Get-Content (Join-Path $repo 'apps/launcher/package.json') -Raw | ConvertFrom-Json).version }
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid launcher version' }
$inputRoot = (Resolve-Path $InputDirectory).Path
$output = Join-Path $env:RUNNER_TEMP 'launcher-release'
New-Item -ItemType Directory $output | Out-Null
$tools = Join-Path $env:RUNNER_TEMP 'signing-tools'
& nuget install Microsoft.Trusted.Signing.Client -Version 1.0.95 -OutputDirectory $tools -NonInteractive
if ($LASTEXITCODE) { throw 'Cannot install signing client' }
$dlib = Get-ChildItem $tools -Recurse -Filter Azure.CodeSigning.Dlib.dll -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match '[\/]x64[\/]' } | Select-Object -First 1
$sdkRoots = @("${env:ProgramFiles(x86)}\Windows Kits\10\bin", "$env:ProgramFiles\Windows Kits\10\bin") | Where-Object { $_ -and (Test-Path $_) }
$signTool = Get-ChildItem $sdkRoots -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match '[\/]x64[\/]' } | Sort-Object FullName -Descending | Select-Object -First 1
# Some runner images ship no Windows SDK; the build-tools package carries signtool for those.
if (-not $signTool) {
 & nuget install Microsoft.Windows.SDK.BuildTools -Version 10.0.26100.1742 -OutputDirectory $tools -NonInteractive
 if ($LASTEXITCODE) { throw 'Cannot install signing tools' }
 $signTool = Get-ChildItem $tools -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match '[\/]x64[\/]' } | Sort-Object FullName -Descending | Select-Object -First 1
}
if (-not $dlib) { throw "Signing client library not found under $tools" }
if (-not $signTool) { throw 'signtool.exe not found; provide the Windows SDK build tools' }
$metadata = Join-Path $tools 'metadata.json'
@{Endpoint=$env:AZURE_SIGNING_ENDPOINT;CodeSigningAccountName=$env:AZURE_SIGNING_ACCOUNT;CertificateProfileName=$env:AZURE_SIGNING_PROFILE;ExcludeCredentials=@('EnvironmentCredential','WorkloadIdentityCredential','ManagedIdentityCredential','SharedTokenCacheCredential','VisualStudioCredential','VisualStudioCodeCredential','AzurePowerShellCredential','AzureDeveloperCliCredential','InteractiveBrowserCredential')} | ConvertTo-Json | Set-Content $metadata
$target = Join-Path $repo 'apps/launcher/src-tauri/target/release'
New-Item -ItemType Directory $target -Force | Out-Null
Copy-Item "$inputRoot/bin/*" $target
Copy-Item "$inputRoot/dist" "$repo/apps/launcher/dist" -Recurse -Force
$setupPath = Join-Path $target "bundle/nsis/Jouzu Launcher_${Version}_x64-setup.exe"
$plugins = Join-Path $target 'nsis'

# The uninstaller signing command is injected through the generated template, so an absent
# value stays a real no-op instead of a literal command.
$dq = '$' + '\' + '"'
function New-Template([string]$Policy,[string]$Extra) {
 $cmd = 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ' + $dq + "$PSScriptRoot/sign-uninstaller.ps1" + $dq + ' -Policy ' + $dq + $Policy + $dq + ' -File ' + $dq + '%1' + $dq
 $define = '!define JOUZU_UNINSTALLER_SIGN_COMMAND "' + $cmd + '"' + "`n"
 $extraDefine = if ($Extra) { $Extra + "`n" } else { '' }
 $name = if ($Extra) { 'template-lo.nsi' } else { 'template-full.nsi' }
 $path = Join-Path $tools $name
 [IO.File]::WriteAllText($path, $extraDefine + $define + (Get-Content (Join-Path $PSScriptRoot 'installer.nsi') -Raw))
 $path
}
function New-Policy([string]$OwnedSetup,[string]$Evidence) {
 $policyFile = Join-Path $tools (($Evidence -replace '.*/','') + '.policy.json')
 @{ownedFiles=@("$target/launcher.exe","$target/console.exe",$OwnedSetup);vendorRoots=@("$inputRoot/app","$inputRoot/runtime",$plugins);signTool=$signTool.FullName;dlib=$dlib.FullName;metadata=$metadata;expectedSubject=$env:EXPECTED_SIGNER;uninstallerEvidence=$Evidence} | ConvertTo-Json -Depth 5 | Set-Content $policyFile
 $policyFile
}
function New-Config([string]$Policy,[string]$Template,[bool]$Full) {
 $resources = [ordered]@{}
 if ($Full) { $resources["$inputRoot/app/"]='app/'; $resources["$inputRoot/runtime/"]='runtime/' }
 $resources["$repo/packaging/launcher/"]='runtime/launcher-update/'
 $resources["$target/console.exe"]='console.exe'
 $resources["$inputRoot/update-config/jouzu-update.json"]='jouzu-update.json'
 $config = @{plugins=(Get-Content "$inputRoot/update-config/tauri-updater.json" -Raw | ConvertFrom-Json).plugins;bundle=@{active=$true;targets=@('nsis');resources=$resources;icon=@('icons/icon.ico');windows=@{signCommand=@{cmd='powershell.exe';args=@('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',"$PSScriptRoot/sign-bundle-file.ps1",'-Policy',$Policy,'-File','%1')};nsis=@{installMode='currentUser';template=$Template;installerHooks="$PSScriptRoot/installer-hooks.nsh"}}}}
 $name = if ($Full) { 'bundle-full.json' } else { 'bundle-lo.json' }
 $path = Join-Path $tools $name
 $config | ConvertTo-Json -Depth 12 | Set-Content $path
 $path
}

Push-Location "$repo/apps/launcher"
try {
 npm ci
 if ($LASTEXITCODE) { throw 'Cannot install bundler' }

 # Evidence files must differ, so each build records its own generated uninstaller.
 $fullEvidence = Join-Path $output 'uninstall-full.exe'
 $loEvidence = Join-Path $output 'uninstall-lo.exe'
 $fullPolicy = New-Policy $setupPath $fullEvidence
 $loPolicy = New-Policy $setupPath $loEvidence

 # Hash every vendor input before Tauri enumerates resources for the full package.
 $before = @{}
 foreach ($root in @("$inputRoot/app","$inputRoot/runtime")) {
  if (Test-Path -LiteralPath $root) { Get-ChildItem -LiteralPath $root -Recurse -File | ForEach-Object { $before[$_.FullName]=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash } }
 }

 npm run tauri -- bundle --config (New-Config $fullPolicy (New-Template $fullPolicy '') $true)
 if ($LASTEXITCODE) { throw 'Full package bundling failed' }
 foreach ($file in $before.Keys) {
  if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $before[$file]) { throw "Vendor resource modified: $file" }
 }
 $fullSetup = Join-Path $output "Jouzu Launcher_${Version}_x64-setup.exe"
 Copy-Item -LiteralPath $setupPath -Destination $fullSetup -Force

 npm run tauri -- bundle --config (New-Config $loPolicy (New-Template $loPolicy '!define JOUZU_LAUNCHER_ONLY 1') $false)
 if ($LASTEXITCODE) { throw 'Launcher-only package bundling failed' }
 $updateSetup = Join-Path $output "Jouzu Launcher_${Version}_x64-update.exe"
 Copy-Item -LiteralPath $setupPath -Destination $updateSetup -Force

 foreach ($file in @("$target/launcher.exe","$target/console.exe",$fullEvidence,$loEvidence,$fullSetup,$updateSetup)) {
  $signature = Get-AuthenticodeSignature -LiteralPath $file
  if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -ne $env:EXPECTED_SIGNER -or -not $signature.TimeStamperCertificate) { throw "Invalid final signature: $file" }
 }

 $keyFile = Join-Path $tools 'updater.key'
 try {
  [IO.File]::WriteAllText($keyFile,$env:TAURI_SIGNING_PRIVATE_KEY)
  npm run tauri -- signer sign -f $keyFile --app-version $Version $updateSetup
  if ($LASTEXITCODE) { throw 'Updater signing failed' }
 } finally { Remove-Item -LiteralPath $keyFile -Force -ErrorAction SilentlyContinue }

 Copy-Item "$inputRoot/source.json" $output
 @{version=$Version;commit=$env:GITHUB_SHA;run=$env:GITHUB_RUN_ID;setup=(Get-FileHash $fullSetup -Algorithm SHA256).Hash;update=(Get-FileHash $updateSetup -Algorithm SHA256).Hash} | ConvertTo-Json | Set-Content "$output/build.json"
} finally { Pop-Location }
