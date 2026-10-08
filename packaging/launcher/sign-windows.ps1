param(
    [Parameter(Mandatory=$true,Position=0)][string]$File,
    [string]$SignTool = $env:JOUZU_SIGN_SIGNTOOL,
    [string]$Dlib = $env:JOUZU_SIGN_DLIB,
    [string]$Metadata = $env:JOUZU_SIGN_METADATA,
    [string]$SkipRoots = $env:JOUZU_SIGN_SKIP_ROOTS
)
# Invoked by the bundler for every own binary, every signable resource and the NSIS-generated
# uninstaller. Configuration arrives in the environment so the bundler only has to substitute one
# argument, and every failure is reported to the log file the release script prints.
$ErrorActionPreference = 'Stop'
$log = $env:JOUZU_SIGN_LOG
function Write-SignLog([string]$Message) {
    if ($log) { Add-Content -LiteralPath $log -Value $Message -Encoding utf8 }
}
function Write-SignOutput([string]$Text) {
    if ($log -and $Text) { Add-Content -LiteralPath $log -Value $Text.TrimEnd() -Encoding utf8 }
}
try {
    $full = [IO.Path]::GetFullPath($File)
    foreach ($root in @($SkipRoots -split ';' | Where-Object { $_ })) {
        $skip = [IO.Path]::GetFullPath($root).TrimEnd('\') + '\'
        if ($full.StartsWith($skip, [StringComparison]::OrdinalIgnoreCase)) {
            Write-SignLog "skipped payload file: $full"
            exit 0
        }
    }
    foreach ($path in @($File,$SignTool,$Dlib,$Metadata)) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing signing input: $path" }
    }
    $sign = & $SignTool sign /fd SHA256 /tr http://timestamp.acs.microsoft.com /td SHA256 /dlib $Dlib /dmdf $Metadata $File 2>&1
    Write-SignOutput ($sign -join "`n")
    if ($LASTEXITCODE -ne 0) { throw "Artifact signing failed for $full (exit $LASTEXITCODE)" }
    $verify = & $SignTool verify /pa /all $File 2>&1
    Write-SignOutput ($verify -join "`n")
    if ($LASTEXITCODE -ne 0) { throw "Authenticode verification failed for $full" }
    # The signer identity is asserted by the release script after bundling: this callback runs in
    # the Windows PowerShell the bundler spawns, where certificate cmdlets are not guaranteed to
    # load, and signtool verify above already proves the signature and its timestamp.
    Write-SignLog "signed: $full"
} catch {
    Write-SignLog ("FAILED: " + $_.Exception.Message)
    exit 1
}
