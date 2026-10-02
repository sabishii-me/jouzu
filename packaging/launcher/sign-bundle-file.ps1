param(
 [Parameter(Mandatory=$true)][string]$File,
 [Parameter(Mandatory=$true)][string]$Policy
)
$ErrorActionPreference = 'Stop'
$config = Get-Content -LiteralPath $Policy -Raw | ConvertFrom-Json
$path = (Resolve-Path -LiteralPath $File).Path
$owned = @($config.ownedFiles | ForEach-Object { [IO.Path]::GetFullPath($_) })
$resources = @($config.vendorRoots | ForEach-Object { [IO.Path]::GetFullPath($_).TrimEnd('\') + '\' })
if ($owned -contains $path) {
 $signature = Get-AuthenticodeSignature -LiteralPath $path
 if ($signature.Status -eq 'Valid' -and $signature.SignerCertificate.Subject -eq $config.expectedSubject -and $signature.TimeStamperCertificate) { exit 0 }
 & "$PSScriptRoot/sign-windows.ps1" -File $path -SignTool $config.signTool -Dlib $config.dlib -Metadata $config.metadata -ExpectedSubject $config.expectedSubject
 exit 0
}
foreach ($root in $resources) {
 if ($path.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
  # Resource enumeration must not transfer vendor publisher identity to Jouzu.
  Write-Output "Preserving third-party resource: $path"
  exit 0
 }
}
throw "Signing input is outside the declared build outputs: $path"
