param(
 [Parameter(Mandatory=$true)][string]$InstallRoot,
 [switch]$Prepare,
 [switch]$Report,
 [switch]$Install,
 [string]$Preferred
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$deadline = [DateTime]::UtcNow.AddSeconds(30)
$managed = if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'Shisa.ai\Jouzu\tools\git' } else { $null }
$bundled = Join-Path $InstallRoot 'runtime\git\installed'

# Returns nothing, or the path and version of a Git for Windows tree that is signed and runs.
function Get-GitEnvironment([string]$Root) {
 if (-not $Root) { return $null }
 $versions = @{}
 foreach ($entry in @(@('bash','bin\bash.exe'), @('git','cmd\git.exe'))) {
  if ([DateTime]::UtcNow -gt $deadline) { return $null }
  $file = Join-Path $Root $entry[1]
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { return $null }
  $signature = Get-AuthenticodeSignature -LiteralPath $file
  if ($signature.Status -ne 'Valid') { return $null }
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
   if (-not $process.WaitForExit(10000)) { $process.Kill(); return $null }
   if ($process.ExitCode -ne 0) { return $null }
   $versions[$entry[0]] = ($stdout.Result + $stderr.Result).Trim().Split("`n")[0].Trim()
  } catch { return $null } finally { $process.Dispose() }
 }
 return [pscustomobject]@{ path = (Join-Path $Root 'bin\bash.exe'); root = $Root; bash = $versions['bash']; git = $versions['git'] }
}

# A system Git is reported so the interface can offer it, never used on its own.
function Get-SystemEnvironment {
 $roots = @()
 foreach ($base in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
  if ($base) { $roots += Join-Path $base 'Git' }
 }
 foreach ($directory in ($env:PATH -split ';')) {
  if ($directory -and (Test-Path -LiteralPath (Join-Path $directory 'git.exe') -PathType Leaf)) {
   $roots += [IO.Path]::GetFullPath((Join-Path $directory '..'))
  }
 }
 foreach ($root in ($roots | Select-Object -Unique)) {
  $info = Get-GitEnvironment $root
  if ($info) { return $info }
 }
 return $null
}

$bundledInfo = Get-GitEnvironment $bundled
$managedInfo = Get-GitEnvironment $managed
$preferredInfo = if ($Preferred) { Get-GitEnvironment ([IO.Path]::GetFullPath((Join-Path $Preferred '..\..'))) } else { $null }
$systemInfo = Get-SystemEnvironment
$archive = Join-Path (Join-Path $InstallRoot 'runtime\git') 'PortableGit.exe'

if ($Report) {
 $value = [ordered]@{
  bundled = if ($bundledInfo) { [ordered]@{ path = $bundledInfo.path; git = $bundledInfo.git; bash = $bundledInfo.bash } } else { $null }
  managed = if ($managedInfo) { [ordered]@{ path = $managedInfo.path; git = $managedInfo.git; bash = $managedInfo.bash } } else { $null }
  system = if ($systemInfo) { [ordered]@{ path = $systemInfo.path; git = $systemInfo.git; bash = $systemInfo.bash } } else { $null }
  preferred = if ($preferredInfo) { $preferredInfo.path } else { $null }
  archive = (Test-Path -LiteralPath $archive -PathType Leaf)
 }
 Write-Output ($value | ConvertTo-Json -Compress -Depth 4)
 exit 0
}

# The chosen source first, then Jouzu's own copies, then the one this PC has: a machine that already
# has Git Bash can open folders without installing anything else.
foreach ($info in @($preferredInfo, $bundledInfo, $managedInfo, $systemInfo)) {
 if ($info) { Write-Output $info.path; exit 0 }
}
if (-not ($Prepare -or $Install)) { throw 'Git Bash is unavailable. Install it from the launcher.' }

$parent = Join-Path $InstallRoot 'runtime\git'
New-Item -ItemType Directory -Path $parent -Force | Out-Null
if (-not (Test-Path -LiteralPath $archive -PathType Leaf)) {
 if (-not $Install) { throw 'The bundled Git Bash package is missing. Repair the installation.' }
 $url = 'https://github.com/git-for-windows/git/releases/download/v2.55.0.windows.5/PortableGit-2.55.0.5-64-bit.7z.exe'
 Invoke-WebRequest -Uri $url -OutFile $archive
}
$hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
if ($hash -ne '5aa8a20f6e9abb2c755f0e73c91c687701a46b309ad84a0ca6509380fa4ae290') {
 if (-not $Install) { throw 'PortableGit integrity verification failed' }
 Remove-Item -LiteralPath $archive -Force
 throw 'PortableGit integrity verification failed; the download was discarded'
}
$archiveSignature = Get-AuthenticodeSignature -LiteralPath $archive
if ($archiveSignature.Status -ne 'Valid' -or $archiveSignature.SignerCertificate.Subject -notmatch '(^|, )CN=Johannes Schindelin(,|$)') {
 throw 'PortableGit publisher verification failed'
}
# A downloaded archive carries the mark of the web; it is removed so extraction and later use are not
# blocked by application control.
Unblock-File -LiteralPath $archive -ErrorAction SilentlyContinue
$stage = Join-Path $parent ('prepare-' + [guid]::NewGuid().ToString('N'))
$destination = Join-Path $parent 'installed'
$backup = $null
try {
 . (Join-Path $PSScriptRoot 'extract-portable-git.ps1')
 $exitCode = Invoke-PortableGitExtraction $archive $stage
 $deadline = [DateTime]::UtcNow.AddSeconds(30)
 if ($exitCode -ne 0 -or -not (Get-GitEnvironment $stage)) { throw 'PortableGit preparation failed' }
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
