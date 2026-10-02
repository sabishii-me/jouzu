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
$dlib = Get-ChildItem $tools -Recurse -Filter Azure.CodeSigning.Dlib.dll | Where-Object { $_.FullName -match '[\\/]x64[\\/]' } | Select-Object -First 1
$signTool = Get-ChildItem 'C:/Program Files (x86)/Windows Kits/10/bin/*/x64/signtool.exe' | Sort-Object FullName -Descending | Select-Object -First 1
if (-not $dlib -or -not $signTool) { throw 'Signing tools unavailable' }
$metadata = Join-Path $tools 'metadata.json'
@{Endpoint=$env:AZURE_SIGNING_ENDPOINT;CodeSigningAccountName=$env:AZURE_SIGNING_ACCOUNT;CertificateProfileName=$env:AZURE_SIGNING_PROFILE;ExcludeCredentials=@('EnvironmentCredential','WorkloadIdentityCredential','ManagedIdentityCredential','SharedTokenCacheCredential','VisualStudioCredential','VisualStudioCodeCredential','AzurePowerShellCredential','AzureDeveloperCliCredential','InteractiveBrowserCredential')} | ConvertTo-Json | Set-Content $metadata
$target = Join-Path $repo 'apps/launcher/src-tauri/target/release'
New-Item -ItemType Directory $target -Force | Out-Null
Copy-Item "$inputRoot/bin/*" $target
Copy-Item "$inputRoot/dist" "$repo/apps/launcher/dist" -Recurse -Force
$setup = Join-Path $target "bundle/nsis/Jouzu Launcher_${Version}_x64-setup.exe"
$policyFile = Join-Path $tools 'policy.json'
@{ownedFiles=@("$target/launcher.exe","$target/console.exe",$setup);vendorRoots=@("$inputRoot/app","$inputRoot/runtime");signTool=$signTool.FullName;dlib=$dlib.FullName;metadata=$metadata;expectedSubject=$env:EXPECTED_SIGNER;uninstallerEvidence="$output/uninstall.exe"} | ConvertTo-Json -Depth 5 | Set-Content $policyFile
$resources = @{}
$resources["$inputRoot/app/"]='app/'
$resources["$inputRoot/runtime/"]='runtime/'
$resources["$repo/packaging/launcher/"]='runtime/launcher-update/'
$resources["$target/console.exe"]='console.exe'
$resources["$inputRoot/update-config/jouzu-update.json"]='jouzu-update.json'
$config = @{plugins=(Get-Content "$inputRoot/update-config/tauri-updater.json" -Raw | ConvertFrom-Json).plugins;bundle=@{active=$true;targets=@('nsis');resources=$resources;icon=@('icons/icon.ico');windows=@{signCommand=@{cmd='powershell.exe';args=@('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',"$PSScriptRoot/sign-bundle-file.ps1",'-Policy',$policyFile,'-File','%1')};nsis=@{installMode='currentUser';template="$PSScriptRoot/installer.nsi";installerHooks="$PSScriptRoot/installer-hooks.nsh"}}}}
$configPath = Join-Path $tools 'bundle.json'
$config | ConvertTo-Json -Depth 12 | Set-Content $configPath
$env:JOUZU_UNINSTALLER_SIGN_COMMAND = 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + "$PSScriptRoot/sign-uninstaller.ps1" + '" -Policy "' + $policyFile + '" -File "%1"'
# Hash every vendor input before Tauri enumerates resources.
$before = @{}
foreach ($root in @("$inputRoot/app","$inputRoot/runtime")) {
 Get-ChildItem -LiteralPath $root -Recurse -File | ForEach-Object { $before[$_.FullName]=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }
}
Push-Location "$repo/apps/launcher"
try {
 npm ci
 if ($LASTEXITCODE) { throw 'Cannot install bundler' }
 npm run tauri -- bundle --config $configPath
 if ($LASTEXITCODE) { throw 'Signed bundle failed' }
 foreach ($file in $before.Keys) {
  if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $before[$file]) { throw "Vendor resource modified: $file" }
 }
 foreach ($file in @("$target/launcher.exe","$target/console.exe","$output/uninstall.exe",$setup)) {
  $signature = Get-AuthenticodeSignature -LiteralPath $file
  if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -ne $env:EXPECTED_SIGNER -or -not $signature.TimeStamperCertificate) { throw "Invalid final signature: $file" }
 }
 Copy-Item -LiteralPath $setup -Destination $output
 $final = Join-Path $output ([IO.Path]::GetFileName($setup))
 $keyFile = Join-Path $tools 'updater.key'
 try {
  [IO.File]::WriteAllText($keyFile,$env:TAURI_SIGNING_PRIVATE_KEY)
  npm run tauri -- signer sign -f $keyFile --app-version $Version $final
  if ($LASTEXITCODE) { throw 'Updater signing failed' }
 } finally { Remove-Item -LiteralPath $keyFile -Force -ErrorAction SilentlyContinue }
 Copy-Item "$inputRoot/source.json" $output
 @{version=$Version;commit=$env:GITHUB_SHA;run=$env:GITHUB_RUN_ID;sha256=(Get-FileHash $final -Algorithm SHA256).Hash} | ConvertTo-Json | Set-Content "$output/build.json"
} finally { Pop-Location }
