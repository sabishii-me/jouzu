param(
    [Parameter(Mandatory=$true)][string]$File,
    [Parameter(Mandatory=$true)][string]$SignTool,
    [Parameter(Mandatory=$true)][string]$Dlib,
    [Parameter(Mandatory=$true)][string]$Metadata,
    [Parameter(Mandatory=$true)][string]$ExpectedSubject,
    [string]$SkipRoots = ''
)
$ErrorActionPreference = 'Stop'
# Third-party components of the application payload keep the exact bytes their own manifests
# pin: `textguard-native.js` refuses a binary whose size or SHA256 differs from it, and a
# signed vendor binary would also carry our publisher identity. Only the launcher's own
# artifacts are bootstrapped by this command.
$full = [IO.Path]::GetFullPath($File)
foreach ($root in @($SkipRoots -split ';' | Where-Object { $_ })) {
    $skip = [IO.Path]::GetFullPath($root).TrimEnd('\') + '\'
    if ($full.StartsWith($skip, [StringComparison]::OrdinalIgnoreCase)) { exit 0 }
}
foreach ($path in @($File,$SignTool,$Dlib,$Metadata)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw 'Missing signing input' }
}
& $SignTool sign /fd SHA256 /tr http://timestamp.acs.microsoft.com /td SHA256 /dlib $Dlib /dmdf $Metadata $File
if ($LASTEXITCODE -ne 0) { throw 'Artifact signing failed' }
& $SignTool verify /pa /all $File
if ($LASTEXITCODE -ne 0) { throw 'Authenticode verification failed' }
$signature = Get-AuthenticodeSignature -LiteralPath $File
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -ne $ExpectedSubject -or -not $signature.TimeStamperCertificate) {
    throw 'Unexpected signer, missing timestamp, or invalid signature'
}
