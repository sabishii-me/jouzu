# Locates the Authenticode signing tools for a Windows release.
#
# The NuGet packages are downloaded and expanded directly. `nuget install -OutputDirectory`
# can leave the package contents in the global cache and put nothing in the requested folder,
# which is how a release job failed with "signing client library not found".
function Install-NuGetPackage {
 param([Parameter(Mandatory=$true)][string]$Id,[Parameter(Mandatory=$true)][string]$Version,[Parameter(Mandatory=$true)][string]$ToolsDirectory)
 $lower = $Id.ToLower()
 $target = Join-Path $ToolsDirectory "$lower.$Version"
 if (Test-Path (Join-Path $target 'bin')) { return $target }
 New-Item -ItemType Directory $ToolsDirectory -Force | Out-Null
 $zip = Join-Path $ToolsDirectory "$lower.$Version.zip"
 Invoke-WebRequest -UseBasicParsing "https://api.nuget.org/v3-flatcontainer/$lower/$Version/$lower.$Version.nupkg" -OutFile $zip
 if (-not (Test-Path $zip)) { throw "Cannot download $Id $Version" }
 Expand-Archive -LiteralPath $zip -DestinationPath $target -Force
 Remove-Item $zip -Force
 return $target
}

function Select-X64Tool {
 param([Parameter(Mandatory=$true)][AllowEmptyCollection()][string[]]$Roots,[Parameter(Mandatory=$true)][string]$Name)
 $roots = @($Roots | Where-Object { $_ -and (Test-Path $_) })
 if (-not $roots.Count) { return $null }
 return Get-ChildItem $roots -Recurse -Filter $Name -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -match '[\\/]x64[\\/]' } |
  Sort-Object FullName -Descending |
  Select-Object -First 1
}

function Resolve-SigningClient {
 param([Parameter(Mandatory=$true)][string]$ToolsDirectory,[string]$Version='1.0.95')
 $root = Install-NuGetPackage -Id 'Microsoft.Trusted.Signing.Client' -Version $Version -ToolsDirectory $ToolsDirectory
 $dlib = Select-X64Tool -Roots @($root) -Name 'Azure.CodeSigning.Dlib.dll'
 if (-not $dlib) { throw "Signing client library not found under $root" }
 return $dlib.FullName
}

function Resolve-SignTool {
 param([Parameter(Mandatory=$true)][string]$ToolsDirectory,[string[]]$SdkRoots=@(),[string]$BuildToolsVersion='10.0.26100.1742')
 $found = Select-X64Tool -Roots $SdkRoots -Name 'signtool.exe'
 if (-not $found) {
  $root = Install-NuGetPackage -Id 'Microsoft.Windows.SDK.BuildTools' -Version $BuildToolsVersion -ToolsDirectory $ToolsDirectory
  $found = Select-X64Tool -Roots @($root) -Name 'signtool.exe'
 }
 if (-not $found) { throw 'signtool.exe not found; provide the Windows SDK build tools' }
 return $found.FullName
}
