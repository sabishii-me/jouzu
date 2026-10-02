param(
 [Parameter(Mandatory=$true)][string]$InstallRoot,
 [Parameter(Mandatory=$true)][string]$Installer,
 [Parameter(Mandatory=$true)][string]$ExpectedSubject
)
$ErrorActionPreference = 'Stop'
$files = @($Installer, (Join-Path $InstallRoot 'launcher.exe'), (Join-Path $InstallRoot 'console.exe'), (Join-Path $InstallRoot 'uninstall.exe'))
foreach ($file in $files) {
 if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing signed product file: $file" }
 $signature = Get-AuthenticodeSignature -LiteralPath $file
 if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -ne $ExpectedSubject -or -not $signature.TimeStamperCertificate) {
  throw "Invalid product signature, publisher, or timestamp: $file"
 }
 [pscustomobject]@{File=[IO.Path]::GetFileName($file);Status=$signature.Status;SHA256=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash}
}
