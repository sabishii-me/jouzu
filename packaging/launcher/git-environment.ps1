param(
 [Parameter(Mandatory=$true)][string]$InstallRoot,
 [switch]$Prepare
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$deadline = [DateTime]::UtcNow.AddSeconds(30)

function Test-GitEnvironment([string]$Root) {
 foreach ($entry in @('bin\bash.exe','cmd\git.exe')) {
  if ([DateTime]::UtcNow -gt $deadline) { return $false }
  $file = Join-Path $Root $entry
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { return $false }
  $info = New-Object System.Diagnostics.ProcessStartInfo
  $info.FileName = $file
  $info.Arguments = '--version'
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $info
  try {
   [void]$process.Start()
   $stdout = $process.StandardOutput.ReadToEndAsync()
   $stderr = $process.StandardError.ReadToEndAsync()
   if (-not $process.WaitForExit(10000)) { $process.Kill(); return $false }
   if ($process.ExitCode -ne 0) { return $false }
  } catch { return $false } finally { $process.Dispose() }
 }
 return $true
}

$candidates = @((Join-Path $InstallRoot 'runtime\git\installed'))
if ($env:LOCALAPPDATA) { $candidates += Join-Path $env:LOCALAPPDATA 'Shisa.ai\Jouzu\tools\git' }
foreach ($base in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
 if ($base) { $candidates += Join-Path $base 'Git' }
}
foreach ($directory in ($env:PATH -split ';')) {
 if ($directory -and (Test-Path -LiteralPath (Join-Path $directory 'git.exe') -PathType Leaf)) {
  $candidates += [IO.Path]::GetFullPath((Join-Path $directory '..'))
 }
}
foreach ($candidate in ($candidates | Select-Object -Unique)) {
 if (Test-GitEnvironment $candidate) { Write-Output (Join-Path $candidate 'bin\bash.exe'); exit 0 }
}
if (-not $Prepare) { throw 'Git Bash is unavailable. Repair the Jouzu installation.' }

$parent = Join-Path $InstallRoot 'runtime\git'
$archive = Join-Path $parent 'PortableGit.exe'
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne '5aa8a20f6e9abb2c755f0e73c91c687701a46b309ad84a0ca6509380fa4ae290') {
 throw 'PortableGit integrity verification failed'
}
$stage = Join-Path $parent ('prepare-' + [guid]::NewGuid().ToString('N'))
$destination = Join-Path $parent 'installed'
$backup = $null
try {
 . (Join-Path $PSScriptRoot 'extract-portable-git.ps1')
 $exitCode = Invoke-PortableGitExtraction $archive $stage
 $deadline = [DateTime]::UtcNow.AddSeconds(30)
 if ($exitCode -ne 0 -or -not (Test-GitEnvironment $stage)) { throw 'PortableGit preparation failed' }
 if (Test-Path -LiteralPath $destination) {
  $backup = Join-Path $parent ('replaced-' + [guid]::NewGuid().ToString('N'))
  Move-Item -LiteralPath $destination -Destination $backup
 }
 try { Move-Item -LiteralPath $stage -Destination $destination } catch {
  if ($backup) { Move-Item -LiteralPath $backup -Destination $destination; $backup = $null }
  throw
 }
 if ($backup) { Remove-Item -LiteralPath $backup -Recurse -Force }
 Write-Output (Join-Path $destination 'bin\bash.exe')
} finally {
 if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
}
