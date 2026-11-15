# Stores the ArcGIS hosted layer URL and API key in dotnet user-secrets (backend)
# and in frontend/public/config.local.json (git-ignored). The key is read hidden and never printed.
#   powershell -ExecutionPolicy Bypass -File database\set-arcgis.ps1 -LayerUrl "https://services…/FeatureServer/0"
param(
    [Parameter(Mandatory = $true)][string]$LayerUrl
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$api = Join-Path $root 'backend\ExcavationApi'

$secure = Read-Host 'Paste the ArcGIS API key (hidden; leave empty for a public layer)' -AsSecureString
$key = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))

Push-Location $api
try {
    dotnet user-secrets set "ArcGis:SensitiveSitesLayerUrl" $LayerUrl | Out-Null
    if ($key) { dotnet user-secrets set "ArcGis:ApiKey" $key | Out-Null }
} finally { Pop-Location }

$config = @{ arcgisApiKey = $key; sensitiveSitesLayerUrl = $LayerUrl } | ConvertTo-Json
[IO.File]::WriteAllText((Join-Path $root 'frontend\public\config.local.json'), $config, (New-Object Text.UTF8Encoding($false)))
$key = $null

Write-Host 'Saved: backend user-secrets (ArcGis:SensitiveSitesLayerUrl, ArcGis:ApiKey) and frontend/public/config.local.json.'
Write-Host 'Restart the API so it picks up the new secrets.'
