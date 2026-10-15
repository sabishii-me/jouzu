param([Parameter(Mandatory=$true)][string]$Directory,[Parameter(Mandatory=$true)][string]$JouzuVersion,[string]$LauncherVersion)
$ErrorActionPreference = 'Stop'
if (-not $LauncherVersion) { $LauncherVersion = (Get-Content (Join-Path (Resolve-Path "$PSScriptRoot/../..").Path 'apps/launcher/package.json') -Raw | ConvertFrom-Json).version }
if ($LauncherVersion -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid launcher version' }
if ($JouzuVersion -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid Jouzu version' }
$repository = $env:GITHUB_REPOSITORY
if ($repository -notmatch '^[\w.-]+/[\w.-]+$') { throw 'Invalid repository' }
# The Windows artifacts belong on the Jouzu version release, beside the npm package, so the
# installer sits on the page a user opens for that release. There is deliberately no separate
# launcher release: its tag carried a version number unrelated to the release it shipped in, and a
# release created once per launcher version cannot hold an artifact rebuilt for every Jouzu release.
$tag = "v$JouzuVersion"
$assetPrefix = "jouzu-win-x64-v$JouzuVersion"
$fullSetup = Join-Path $Directory "$assetPrefix-setup.exe"
$updateSetup = Join-Path $Directory "$assetPrefix-update.exe"
foreach ($file in @($fullSetup,$updateSetup,"$updateSetup.sig","$Directory/build.json","$Directory/source.json")) {
 if (-not (Test-Path -LiteralPath $file)) { throw "Missing release output: $file" }
}
# `finish` creates the release after npm accepts the version, and this job is usually still
# building at that point, so wait for the release instead of racing it.
$deadline = (Get-Date).AddMinutes(30)
while ($true) {
 & gh release view $tag --repo $repository *> $null
 if ($LASTEXITCODE -eq 0) { break }
 if ((Get-Date) -gt $deadline) { throw "Release $tag is missing; run 'scripts/publish-npm-release.sh finish $JouzuVersion RUN_ID' and dispatch this workflow again" }
 Start-Sleep -Seconds 30
}
# These assets are replaceable: they are not the registry-verified package, and a broken installer
# is repaired by re-running this workflow rather than by publishing another release.
& gh release upload $tag $fullSetup $updateSetup "$updateSetup.sig" "$Directory/build.json" "$Directory/source.json" --repo $repository --clobber
if ($LASTEXITCODE) { throw 'Installer upload failed; feed unchanged' }
# The download URL is built from the name the release stored, not from the local file name.
$assetNames = & gh release view $tag --repo $repository --json assets --jq '.assets[].name'
if ($LASTEXITCODE) { throw 'Cannot read the published release' }
$assetName = @($assetNames) | Where-Object { $_ -eq "$assetPrefix-update.exe" } | Select-Object -First 1
if (-not $assetName) { throw 'Published update asset not found' }
$url = "https://github.com/$repository/releases/download/$tag/$assetName"
$probe = Join-Path $env:RUNNER_TEMP 'published-update.exe'
Invoke-WebRequest $url -OutFile $probe
if ((Get-FileHash $probe -Algorithm SHA256).Hash -ne (Get-FileHash $updateSetup -Algorithm SHA256).Hash) { throw 'Published update integrity mismatch; feed unchanged' }
# The feed version is the launcher's own version, because that is what an installed launcher
# compares against to decide whether an update exists. It moves only when the launcher changes, so
# a Jouzu release that leaves the launcher alone does not offer an update that changes nothing.
$notes = (& node "$PSScriptRoot/launcher-notes.mjs" (Join-Path $PSScriptRoot '../../apps/launcher/CHANGELOG.md') $LauncherVersion) -join "`n"
if ($LASTEXITCODE) { throw 'Missing launcher changelog for this version; feed unchanged' }
$feed = @{version=$LauncherVersion;notes=$notes;pub_date=[DateTime]::UtcNow.ToString('o');platforms=@{'windows-x86_64'=@{url=$url;signature=(Get-Content "$updateSetup.sig" -Raw).Trim()}}}
$feedFile = Join-Path $Directory 'latest.json'
# The feed is read by a JSON parser on the other side, so it is written without a byte order mark:
# `Set-Content -Encoding utf8` writes one under Windows PowerShell, and a mark makes the feed undecodable.
[IO.File]::WriteAllText($feedFile, ($feed | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding($false)))
& gh release view launcher-update --repo $repository *> $null
if ($LASTEXITCODE) {
 & gh release create launcher-update --repo $repository --target $env:GITHUB_SHA --title 'Jouzu launcher updates' --notes 'Signed launcher update feed.'
 if ($LASTEXITCODE) { throw 'Cannot create update feed release' }
}
& gh release upload launcher-update $feedFile --repo $repository --clobber
if ($LASTEXITCODE) { throw 'Cannot publish update feed' }
