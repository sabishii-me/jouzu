param(
 [Parameter(Mandatory=$true)][ValidateSet('git','terminal')][string]$Component,
 [Parameter(Mandatory=$true)][string]$InstallRoot
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$detail = New-Object System.Text.StringBuilder
$limit = 4096

# Drain the helper's output while retaining a bounded diagnostic. Never print its raw output
# in the installer, where control characters or a credential in an error could be exposed.
function Add-Detail([object]$Value) {
 $text = [string]$Value
 $text = $text -replace '[\p{Cc}\p{Cf}]', ' '
 foreach ($path in @($InstallRoot, $env:LOCALAPPDATA, $env:USERPROFILE)) {
  if ($path) { $text = $text -replace [regex]::Escape($path), '[local]' }
 }
 $text = $text -replace '(?i)\bBearer\s+[^\s"'']+', 'Bearer [redacted]'
 $text = $text -replace '(?i)\b(token|api[_-]?key|password|secret)\s*[:=]\s*("[^"]*"|''[^'']*''|[^\s"'']+)', '$1=[redacted]'
 $text = $text -replace '(?i)(https?://)[^/\s@]+@', '$1[redacted]@'
 $remaining = $limit - $detail.Length
 if ($remaining -gt 0) {
  $text = $text.Trim() + ' '
  [void]$detail.Append($text.Substring(0, [Math]::Min($remaining, $text.Length)))
 }
}

$code = -1
try {
 $helper = Join-Path $PSScriptRoot "$Component-environment.ps1"
 if (-not (Test-Path -LiteralPath $helper -PathType Leaf)) { throw 'The component preparation helper is missing.' }
 # Keep the existing helper in a separate process: its exit must not bypass diagnostic writing.
 # Continue captures native stderr as records on Windows PowerShell 5.1 instead of aborting the pipe.
 $ErrorActionPreference = 'Continue'
 $LASTEXITCODE = -1
 & "$PSHOME\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $helper -InstallRoot $InstallRoot -Prepare 2>&1 |
  ForEach-Object { Add-Detail $_ }
 $code = $LASTEXITCODE
} catch {
 Add-Detail $_
} finally {
 $ErrorActionPreference = 'Stop'
}

$record = [ordered]@{
 version = 1
 component = $Component
 completedAt = [DateTime]::UtcNow.ToString('o')
 status = if ($code -eq 0) { 'ready' } else { 'failed' }
 exitCode = $code
 detail = $detail.ToString().Trim()
}
try {
 if (-not $env:LOCALAPPDATA) { throw 'Local application data is unavailable.' }
 $logs = Join-Path $env:LOCALAPPDATA 'Shisa.ai\Jouzu\logs'
 [void][IO.Directory]::CreateDirectory($logs)
 $report = Join-Path $logs "prepare-$Component.json"
 $json = $record | ConvertTo-Json -Depth 3
 $utf8 = New-Object System.Text.UTF8Encoding($false)
 [IO.File]::WriteAllText($report, $json, $utf8)
 # A successful retry updates current status while keeping the last failure for diagnosis.
 if ($code -ne 0) { [IO.File]::WriteAllText((Join-Path $logs "prepare-$Component.failure.json"), $json, $utf8) }
} catch {
 Write-Output "$Component preparation returned exit $code. Diagnostics could not be saved."
 exit 1
}
if ($code -ne 0) {
 Write-Output "$Component preparation failed (exit $code). Diagnostic report: $report"
 exit 1
}
exit 0
