param([Parameter(Mandatory=$true)][string]$Directory,[string]$Version)
$ErrorActionPreference = 'Stop'
if (-not $Version) { $Version = (Get-Content (Join-Path (Resolve-Path "$PSScriptRoot/../..").Path 'apps/launcher/package.json') -Raw | ConvertFrom-Json).version }
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid launcher version' }
$repository = $env:GITHUB_REPOSITORY
if ($repository -notmatch '^[\w.-]+/[\w.-]+$') { throw 'Invalid repository' }
$setup = Join-Path $Directory "Jouzu Launcher_${Version}_x64-setup.exe"
foreach ($file in @($setup,"$setup.sig","$Directory/build.json","$Directory/source.json")) {
 if (-not (Test-Path -LiteralPath $file)) { throw "Missing release output: $file" }
}
$tag = "launcher-v$Version"
# Version releases are immutable; only the discovery feed is replaceable.
& gh release create $tag $setup "$setup.sig" "$Directory/build.json" "$Directory/source.json" --repo $repository --target $env:GITHUB_SHA --prerelease --title "Jouzu Launcher $Version" --notes 'Windows Launcher test release.'
if ($LASTEXITCODE) { throw 'Version release creation failed; feed unchanged' }
$url = "https://github.com/$repository/releases/download/$tag/" + [Uri]::EscapeDataString([IO.Path]::GetFileName($setup))
$probe = Join-Path $env:RUNNER_TEMP 'published-setup.exe'
Invoke-WebRequest $url -OutFile $probe
if ((Get-FileHash $probe -Algorithm SHA256).Hash -ne (Get-FileHash $setup -Algorithm SHA256).Hash) { throw 'Published setup integrity mismatch; feed unchanged' }
$feed = @{version=$Version;notes='Startup recovery, installation-time Git preparation and signed Windows programs.';pub_date=[DateTime]::UtcNow.ToString('o');platforms=@{'windows-x86_64'=@{url=$url;signature=(Get-Content "$setup.sig" -Raw).Trim()}}}
$feedFile = Join-Path $Directory 'latest.json'
$feed | ConvertTo-Json -Depth 5 | Set-Content $feedFile -Encoding utf8
& gh release view launcher-update --repo $repository *> $null
if ($LASTEXITCODE) {
 & gh release create launcher-update --repo $repository --target $env:GITHUB_SHA --prerelease --title 'Launcher test updates' --notes 'Launcher test update feed.'
 if ($LASTEXITCODE) { throw 'Cannot create update feed release' }
}
& gh release upload launcher-update $feedFile --repo $repository --clobber
if ($LASTEXITCODE) { throw 'Cannot publish update feed' }
