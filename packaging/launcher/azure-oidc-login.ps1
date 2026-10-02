$ErrorActionPreference = 'Stop'
foreach ($name in @('AZURE_CLIENT_ID','AZURE_TENANT_ID','AZURE_SUBSCRIPTION_ID','ACTIONS_ID_TOKEN_REQUEST_URL','ACTIONS_ID_TOKEN_REQUEST_TOKEN')) {
 if (-not [Environment]::GetEnvironmentVariable($name)) { throw "Missing OIDC configuration: $name" }
}
$separator = if ($env:ACTIONS_ID_TOKEN_REQUEST_URL.Contains('?')) { '&' } else { '?' }
$response = Invoke-RestMethod -Uri ($env:ACTIONS_ID_TOKEN_REQUEST_URL + $separator + 'audience=api%3A%2F%2FAzureADTokenExchange') -Headers @{ Authorization = "Bearer $env:ACTIONS_ID_TOKEN_REQUEST_TOKEN" }
if (-not $response.value) { throw 'GitHub did not issue an OIDC token' }
Write-Output "::add-mask::$($response.value)"
& az login --service-principal --username $env:AZURE_CLIENT_ID --tenant $env:AZURE_TENANT_ID --federated-token $response.value --output none
if ($LASTEXITCODE) { throw 'Azure OIDC login failed' }
& az account set --subscription $env:AZURE_SUBSCRIPTION_ID
if ($LASTEXITCODE) { throw 'Azure subscription selection failed' }
