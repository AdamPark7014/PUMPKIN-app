#Requires -Version 5.1
<#
.SYNOPSIS
  Verifica health/ready (y opcionalmente payments/config) de la API Boletera.
.PARAMETER Strict
  Falla si status!=ok, database!=up o ready!=true.
.PARAMETER Baseline
  Solo informa; no exit 1 (útil pre-deploy).
#>
param(
  [switch]$Strict,
  [switch]$Baseline
)

$ErrorActionPreference = "Stop"
if (-not $env:API_BASE) { $env:API_BASE = "http://127.0.0.1:4000" }
$base = $env:API_BASE.TrimEnd("/")

function Show($title, $obj) {
  Write-Host "--- $title ---" -ForegroundColor Cyan
  $obj | ConvertTo-Json -Depth 6
}

$failed = $false

try {
  $health = Invoke-RestMethod -Uri "$base/api/v1/health" -Method GET -TimeoutSec 15
  Show "GET /api/v1/health" $health
  if ($health.service -ne "boletera-api") {
    Write-Host "[FAIL] service inesperado: $($health.service)" -ForegroundColor Red
    $failed = $true
  }
  if ($Strict -and ($health.status -ne "ok" -or $health.database -ne "up")) {
    Write-Host "[FAIL] health no OK bajo -Strict" -ForegroundColor Red
    $failed = $true
  }
} catch {
  Write-Host "[FAIL] health: $_" -ForegroundColor Red
  $failed = $true
}

try {
  $ready = Invoke-RestMethod -Uri "$base/api/v1/ready" -Method GET -TimeoutSec 15
  Show "GET /api/v1/ready" $ready
  if ($Strict -and -not $ready.ready) {
    Write-Host "[FAIL] ready=false" -ForegroundColor Red
    $failed = $true
  }
} catch {
  Write-Host "[FAIL] ready (¿503 database?): $_" -ForegroundColor Red
  $failed = $true
}

try {
  $pay = Invoke-RestMethod -Uri "$base/api/v1/payments/config" -Method GET -TimeoutSec 15
  Show "GET /api/v1/payments/config" $pay
  if ($env:BOLETERA_ENV -eq "prod" -and $pay.demo -eq $true) {
    Write-Host "[FAIL] prod en modo demo Banorte" -ForegroundColor Red
    $failed = $true
  }
} catch {
  Write-Host "[WARN] payments/config: $_" -ForegroundColor Yellow
  if ($Strict) { $failed = $true }
}

if ($failed -and -not $Baseline) { exit 1 }
if ($failed -and $Baseline) {
  Write-Host "[WARN] Baseline con fallos (no aborta)" -ForegroundColor Yellow
  exit 0
}
Write-Host "[OK] health-check PASS" -ForegroundColor Green
exit 0
