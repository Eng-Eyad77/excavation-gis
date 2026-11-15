# =====================================================================
# setup-db.ps1 - one-shot local database setup (dev only)
#   powershell -ExecutionPolicy Bypass -File database\setup-db.ps1          # first time
#   powershell -ExecutionPolicy Bypass -File database\setup-db.ps1 -Reset   # drop EXCAV and start over
#
# 1. Asks (hidden input) for the SYSTEM password and a NEW password for EXCAV.
# 2. Runs 00 (as SYSTEM), 01 + 02 (as EXCAV), then explain_plan + analyze_examples.
# 3. Stores the API's Oracle connection string and a random JWT key in
#    dotnet user-secrets (outside the repo).
# Passwords are sent to sqlplus / dotnet through stdin only: never on the
# command line, never printed, never written to the log.
# Output goes to the console and to database\setup.log (git-ignored).
# =====================================================================
param([switch]$Reset)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$log = Join-Path $PSScriptRoot 'setup.log'
$db = 'localhost:1521/FREEPDB1'
$env:NLS_LANG = 'AMERICAN_AMERICA.AL32UTF8'   # keep Arabic text intact
'' | Set-Content -Encoding utf8 $log

function Read-Secret([string]$prompt) {
    $s = Read-Host $prompt -AsSecureString
    $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
    try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}

# Runs SQL*Plus with the given stdin lines; returns $true when it exited 0 with no ORA-/SP2- errors
function Invoke-SqlPlus([string]$title, [string[]]$lines, [string]$workDir = $root, [string[]]$allowedErrors = @()) {
    Write-Host ''
    Write-Host "===== $title =====" -ForegroundColor Cyan
    "===== $title =====" | Add-Content -Encoding utf8 $log
    Push-Location $workDir
    try {
        $out = ($lines -join "`r`n") | & sqlplus -S -L /nolog 2>&1 | ForEach-Object { "$_" }
        $code = $LASTEXITCODE
    } finally { Pop-Location }
    $out | Add-Content -Encoding utf8 $log
    $out | ForEach-Object { Write-Host $_ }
    $errors = $out | Where-Object { $_ -match '(ORA|SP2)-\d+' }
    foreach ($a in $allowedErrors) { $errors = $errors | Where-Object { $_ -notmatch $a } }
    if ($code -ne 0 -or $errors) {
        Write-Host "FAILED: $title (exit code $code)" -ForegroundColor Red
        "FAILED: $title (exit code $code)" | Add-Content -Encoding utf8 $log
        return $false
    }
    "OK: $title" | Add-Content -Encoding utf8 $log
    return $true
}

$sys = Read-Secret 'SYSTEM password'
$ex = Read-Secret 'Password for EXCAV (new user - choose one and remember it)'
if ([string]::IsNullOrWhiteSpace($ex) -or $ex.Contains('"')) { throw 'EXCAV password must not be empty or contain a double quote.' }

$connectSys = "CONNECT system/""$sys""@$db"
$connectEx  = "CONNECT excav/""$ex""@$db"

try {
    # ---- 0. (optional) drop the EXCAV user and everything it owns
    if ($Reset) {
        $ok = Invoke-SqlPlus 'Reset: drop user EXCAV' @(
            'WHENEVER SQLERROR EXIT SQL.SQLCODE', $connectSys,
            "BEGIN EXECUTE IMMEDIATE 'DROP USER excav CASCADE'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -1918 THEN RAISE; END IF; END;",
            '/', 'EXIT')
        if (-not $ok) { exit 1 }
    }

    # ---- 1. create user (ACCEPT in 00 reads the password from the next stdin line)
    #      ORA-01920 = user already exists -> keep going, the EXCAV login below verifies the password
    $ok = Invoke-SqlPlus '00_create_user.sql (as SYSTEM)' @(
        'WHENEVER SQLERROR EXIT SQL.SQLCODE', $connectSys, '@database/00_create_user.sql', $ex) -allowedErrors @('ORA-01920')
    if (-not $ok) { exit 1 }

    # ---- 2. schema + seed (as EXCAV)
    if (-not (Invoke-SqlPlus '01_schema.sql (as EXCAV)' @('WHENEVER SQLERROR EXIT SQL.SQLCODE', $connectEx, '@database/01_schema.sql'))) { exit 1 }
    if (-not (Invoke-SqlPlus '02_seed.sql (as EXCAV)'   @('WHENEVER SQLERROR EXIT SQL.SQLCODE', $connectEx, '@database/02_seed.sql')))   { exit 1 }

    # ---- 3. proof queries
    $q = Join-Path $PSScriptRoot 'queries'
    [void](Invoke-SqlPlus 'explain_plan.sql'     @('WHENEVER SQLERROR EXIT SQL.SQLCODE', $connectEx, '@explain_plan.sql') $q)
    [void](Invoke-SqlPlus 'analyze_examples.sql' @('WHENEVER SQLERROR EXIT SQL.SQLCODE', $connectEx, '@analyze_examples.sql') $q)

    # ---- 4. API secrets (dotnet user-secrets, stored in %APPDATA%\Microsoft\UserSecrets)
    Write-Host ''
    Write-Host '===== dotnet user-secrets =====' -ForegroundColor Cyan
    $bytes = New-Object byte[] 64
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $secrets = @{
        'ConnectionStrings:Oracle' = "User Id=excav;Password=""$ex"";Data Source=$db;"
        'Jwt:Key'                  = [Convert]::ToBase64String($bytes)
    } | ConvertTo-Json -Compress
    $secrets | & dotnet user-secrets set --project backend\ExcavationApi | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'dotnet user-secrets set failed' }
    $names = & dotnet user-secrets list --project backend\ExcavationApi | ForEach-Object { ($_ -split ' = ')[0] }
    $m = "user-secrets keys: $($names -join ', ')"; $m | Add-Content -Encoding utf8 $log; Write-Host $m
    'SETUP COMPLETE' | Add-Content -Encoding utf8 $log; Write-Host 'SETUP COMPLETE' -ForegroundColor Green
}
finally {
    $sys = $null; $ex = $null; $connectSys = $null; $connectEx = $null; $secrets = $null
}
