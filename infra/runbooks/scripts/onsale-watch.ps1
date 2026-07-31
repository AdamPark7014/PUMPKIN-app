#Requires -Version 5.1
<#
.SYNOPSIS
  Loop de monitoreo durante on-sale (endpoints verificados).
.PARAMETER EventId
  ID de evento (o $env:EVENT_ID).
.PARAMETER IntervalSec
  Segundos entre sondeos.
.PARAMETER Once
  Una sola pasada.
#>
param(
  [string]$EventId = $env:EVENT_ID,
  [int]$IntervalSec = 15,
  [switch]$Once
)

$ErrorActionPreference = "Continue"
if (-not $env:API_BASE) { $env:API_BASE = "http://127.0.0.1:4000" }
$base = $env:API_BASE.TrimEnd("/")

if (-not $EventId) {
  Write-Error "EventId requerido (-EventId o `$env:EVENT_ID)"
}

function Probe {
  $ts = Get-Date -Format "o"
  Write-Host "`n==== $ts event=$EventId ====" -ForegroundColor Cyan

  try {
    $ready = Invoke-RestMethod "$base/api/v1/ready" -TimeoutSec 10
    $flag = if ($ready.ready) { "OK" } else { "BAD" }
    Write-Host "[$flag] ready database=$($ready.database) redis=$($ready.redis)"
  } catch {
    Write-Host "[BAD] ready: $_" -ForegroundColor Red
  }

  try {
    $sale = Invoke-RestMethod "$base/api/v1/events/schedule/public/events/$EventId/sale-state" -TimeoutSec 10
    Write-Host "[sale-state]" ($sale | ConvertTo-Json -Compress -Depth 4)
  } catch {
    Write-Host "[WARN] sale-state: $_" -ForegroundColor Yellow
  }

  try {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $avail = Invoke-RestMethod "$base/api/v1/inventory/$EventId/availability" -TimeoutSec 15
    $sw.Stop()
    Write-Host "[availability] ${sw.ElapsedMilliseconds}ms keys=$($avail.PSObject.Properties.Name -join ',')"
  } catch {
    Write-Host "[WARN] availability: $_" -ForegroundColor Yellow
  }

  try {
    $pay = Invoke-RestMethod "$base/api/v1/payments/config" -TimeoutSec 10
    $col = if ($pay.demo) { "Red" } else { "Green" }
    Write-Host "[payments] demo=$($pay.demo) productionReady=$($pay.productionReady)" -ForegroundColor $col
  } catch {
    Write-Host "[WARN] payments/config: $_" -ForegroundColor Yellow
  }

  if ($env:JWT_STAFF) {
    try {
      $alerts = Invoke-RestMethod "$base/api/v1/metrics/alerts" -Headers @{
        Authorization = "Bearer $($env:JWT_STAFF)"
      } -TimeoutSec 15
      Write-Host "[metrics/alerts]" ($alerts | ConvertTo-Json -Compress -Depth 3)
    } catch {
      Write-Host "[INFO] metrics/alerts: $_"
    }
  }
}

if ($Once) { Probe; exit 0 }

Write-Host "Watching every ${IntervalSec}s — Ctrl+C para salir" -ForegroundColor Cyan
while ($true) {
  Probe
  Start-Sleep -Seconds $IntervalSec
}
