#Requires -Version 5.1
<#
.SYNOPSIS
  Triage rápido de pagos Banorte (endpoints verificados).
#>
$ErrorActionPreference = "Continue"
if (-not $env:API_BASE) { $env:API_BASE = "http://127.0.0.1:4000" }
$base = $env:API_BASE.TrimEnd("/")

Write-Host "=== Payments triage ===" -ForegroundColor Cyan
Write-Host "API_BASE=$base ENV=$($env:BOLETERA_ENV)"

try {
  $h = Invoke-RestMethod "$base/api/v1/health"
  Write-Host "health.status=$($h.status) database=$($h.database) redis=$($h.redis) payments=$($h.payments)"
} catch {
  Write-Host "[FAIL] health: $_" -ForegroundColor Red
}

try {
  $cfg = Invoke-RestMethod "$base/api/v1/payments/config"
  Write-Host "gateway=$($cfg.gateway) demo=$($cfg.demo) mode=$($cfg.mode) productionReady=$($cfg.productionReady)"
  Write-Host "methods=$($cfg.methods -join ',')"
  Write-Host "validation.ready=$($cfg.validation.ready) missing=$($cfg.validation.missing -join ',')"
  Write-Host "ipn.webhookUrl=$($cfg.ipn.webhookUrl)"
  Write-Host "ipn.webhookSecretConfigured=$($cfg.ipn.webhookSecretConfigured)"
  Write-Host "ipn.signatureHeaders=$($cfg.ipn.signatureHeaders -join ',')"

  if ($env:BOLETERA_ENV -eq "prod" -and $cfg.demo) {
    Write-Host "[SEV-1] Prod en modo DEMO — falta BANORTE_MERCHANT_ID u secretos" -ForegroundColor Red
  }
} catch {
  Write-Host "[FAIL] payments/config: $_" -ForegroundColor Red
}

if ($env:JWT_STAFF) {
  try {
    $v = Invoke-RestMethod "$base/api/v1/payments/config/validate" -Headers @{
      Authorization = "Bearer $($env:JWT_STAFF)"
    }
    $v | ConvertTo-Json -Depth 6
  } catch {
    Write-Host "[WARN] config/validate: $_" -ForegroundColor Yellow
  }
} else {
  Write-Host "[INFO] JWT_STAFF no set — se omite /payments/config/validate" -ForegroundColor Yellow
}

if ($env:INTERNAL_API_SECRET) {
  $do = Read-Host "¿Ejecutar POST /payments/reconcile/spei? (y/N)"
  if ($do -eq "y") {
    try {
      $r = Invoke-RestMethod -Method POST -Uri "$base/api/v1/payments/reconcile/spei" `
        -Headers @{ "X-Internal-Secret" = $env:INTERNAL_API_SECRET }
      $r | ConvertTo-Json -Depth 6
    } catch {
      Write-Host "[FAIL] reconcile: $_" -ForegroundColor Red
    }
  }
} else {
  Write-Host "[INFO] INTERNAL_API_SECRET no set — reconcile manual diferido" -ForegroundColor Yellow
}

Write-Host "Siguiente: logs Banorte/IPN + runbook 04" -ForegroundColor Cyan
