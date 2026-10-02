# Verifies tool discovery without downloading anything: the fixtures use the real package layouts.
$ErrorActionPreference='Stop'
. "$PSScriptRoot/signing-tools.ps1"
function New-Fixture ([string]$Root,[string]$Relative) {
 $path = Join-Path $Root $Relative
 New-Item -ItemType Directory (Split-Path $path) -Force | Out-Null
 New-Item -ItemType File $path | Out-Null
 return $path
}
$base = Join-Path ([IO.Path]::GetTempPath()) ("signing-tools-test-" + [Guid]::NewGuid().ToString('N'))
try {
 $clientRoot = Join-Path $base 'client'
 $dlib = New-Fixture $clientRoot 'microsoft.trusted.signing.client.1.0.95/bin/x64/Azure.CodeSigning.Dlib.dll'
 New-Fixture $clientRoot 'microsoft.trusted.signing.client.1.0.95/bin/x86/Azure.CodeSigning.Dlib.dll' | Out-Null
 $resolved = Resolve-SigningClient -ToolsDirectory $clientRoot
 if ($resolved -ne $dlib) { throw "Wrong signing client: $resolved" }

 # No SDK present: fall back to the build-tools package layout instead of failing.
 $cacheRoot = Join-Path $base 'cache'
 $tool = New-Fixture $cacheRoot 'microsoft.windows.sdk.buildtools.10.0.26100.1742/bin/10.0.26100.1742/x64/signtool.exe'
 $resolved = Resolve-SignTool -ToolsDirectory $cacheRoot -SdkRoots @(Join-Path $base 'absent')
 if ($resolved -ne $tool) { throw "Wrong signtool fallback: $resolved" }

 # The installed Windows SDK wins when it is present, and the newest version is chosen.
 $sdk = Join-Path $base 'kits'
 $old = New-Fixture $sdk '10.0.22621.0/x64/signtool.exe'
 $new = New-Fixture $sdk '10.0.26100.0/x64/signtool.exe'
 $resolved = Resolve-SignTool -ToolsDirectory (Join-Path $base 'unused') -SdkRoots @($sdk)
 if ($resolved -ne $new) { throw "Expected the newest SDK signtool, got $resolved (old=$old)" }
 Write-Host 'signing-tools: ok'
} finally { Remove-Item $base -Recurse -Force -ErrorAction SilentlyContinue }
