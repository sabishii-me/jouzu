param([Parameter(Mandatory=$true)][string]$Directory,[string]$Version)
$ErrorActionPreference = 'Stop'
if (-not $Version) { $Version = (Get-Content (Join-Path (Resolve-Path "$PSScriptRoot/../..").Path 'apps/launcher/package.json') -Raw | ConvertFrom-Json).version }
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid launcher version' }
$repository = $env:GITHUB_REPOSITORY
if ($repository -notmatch '^[\w.-]+/[\w.-]+$') { throw 'Invalid repository' }
# The full package serves first install and repair; the launcher-only package is what the
# in-app updater installs, so the feed must point at the launcher-only artifact.
$fullSetup = Join-Path $Directory "Jouzu Launcher_${Version}_x64-setup.exe"
$updateSetup = Join-Path $Directory "Jouzu Launcher_${Version}_x64-update.exe"
foreach ($file in @($fullSetup,$updateSetup,"$updateSetup.sig","$Directory/build.json","$Directory/source.json")) {
 if (-not (Test-Path -LiteralPath $file)) { throw "Missing release output: $file" }
}
$tag = "launcher-v$Version"
# Version releases are immutable; only the discovery feed is replaceable.
& gh release create $tag $fullSetup $updateSetup "$updateSetup.sig" "$Directory/build.json" "$Directory/source.json" --repo $repository --target $env:GITHUB_SHA --prerelease --title "Jouzu Launcher $Version" --notes 'Windows Launcher test release. The x64-setup asset installs everything; the x64-update asset updates an existing launcher without rewriting the Jouzu payload.'
if ($LASTEXITCODE) { throw 'Version release creation failed; feed unchanged' }
$url = "https://github.com/$repository/releases/download/$tag/" + [Uri]::EscapeDataString([IO.Path]::GetFileName($updateSetup))
$probe = Join-Path $env:RUNNER_TEMP 'published-update.exe'
Invoke-WebRequest $url -OutFile $probe
if ((Get-FileHash $probe -Algorithm SHA256).Hash -ne (Get-FileHash $updateSetup -Algorithm SHA256).Hash) { throw 'Published update integrity mismatch; feed unchanged' }
$feed = @{version=$Version;notes='Launcher updates install only launcher-owned files and no longer rewrite the Jouzu payload or require closing a Jouzu session.';pub_date=[DateTime]::UtcNow.ToString('o');platforms=@{'windows-x86_64'=@{url=$url;signature=(Get-Content "$updateSetup.sig" -Raw).Trim()}}}
$feedFile = Join-Path $Directory 'latest.json'
$feed | ConvertTo-Json -Depth 5 | Set-Content $feedFile -Encoding utf8
& gh release view launcher-update --repo $repository *> $null
if ($LASTEXITCODE) {
 & gh release create launcher-update --repo $repository --target $env:GITHUB_SHA --prerelease --title 'Launcher test updates' --notes 'Launcher test update feed.'
 if ($LASTEXITCODE) { throw 'Cannot create update feed release' }
}
& gh release upload launcher-update $feedFile --repo $repository --clobber
if ($LASTEXITCODE) { throw 'Cannot publish update feed' }
