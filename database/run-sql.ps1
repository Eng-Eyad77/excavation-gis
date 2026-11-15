# =====================================================================
# run-sql.ps1 - run a .sql file as EXCAV using the connection string
# already stored in dotnet user-secrets (set by setup-db.ps1).
#   powershell -ExecutionPolicy Bypass -File database\run-sql.ps1 database\queries\explain_plan.sql
# The password stays inside this process (sent to sqlplus via stdin);
# it is never printed or written to disk.
# =====================================================================
param([Parameter(Mandatory = $true)][string]$File)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$env:NLS_LANG = 'AMERICAN_AMERICA.AL32UTF8'

$raw = (& dotnet user-secrets list --json --project (Join-Path $root 'backend\ExcavationApi')) -join "`n"
$json = $raw -replace '(?s)^.*?//BEGIN', '' -replace '(?s)//END.*$', ''
$cs = ($json | ConvertFrom-Json).'ConnectionStrings:Oracle'
if (-not $cs) { throw 'ConnectionStrings:Oracle is not set. Run database\setup-db.ps1 first.' }
$pw = if ($cs -match 'Password="([^"]*)"') { $Matches[1] } elseif ($cs -match 'Password=([^;]*)') { $Matches[1] } else { throw 'No password in connection string' }
$ds = if ($cs -match 'Data Source=([^;]*)') { $Matches[1] } else { 'localhost:1521/FREEPDB1' }

$full = (Resolve-Path $File).Path
Push-Location (Split-Path -Parent $full)   # so @@ includes resolve next to the script
try {
    @('WHENEVER SQLERROR EXIT SQL.SQLCODE', "CONNECT excav/""$pw""@$ds", "@""$full""", 'EXIT') -join "`r`n" |
        & sqlplus -S -L /nolog
    $code = $LASTEXITCODE
} finally {
    Pop-Location
    $pw = $null; $cs = $null; $json = $null; $raw = $null
}
exit $code
